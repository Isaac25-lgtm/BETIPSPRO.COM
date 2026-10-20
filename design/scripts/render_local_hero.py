"""LOCAL-ONLY hero built from the owner's reference screenshot (owner decision 2026-10-20).

The reference shows recognisable real players and sponsor logos. Per the owner's choice these
images are for LOCAL beta preview only:
  * output goes to public/images/local/ (gitignored, never pushed),
  * the app uses them only in `vite dev` with VITE_LOCAL_REFERENCE_HERO=true (.env.local),
  * vite.config.ts deletes images/local from every production build.
Replace with a licensed photo before any public launch.

Run: python design/scripts/render_local_hero.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "design" / "reference" / "homepage-reference.png"
OUT = ROOT / "public" / "images" / "local"
OUT.mkdir(parents=True, exist_ok=True)

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_art import green_shards, hex_rgb, stadium  # noqa: E402

ref = Image.open(REF).convert("RGB")
HERO_TOP, HERO_BOTTOM = 74, 472          # hero band in the 1536x1024 reference
CROP_X0 = 740                            # include the red player's arm; headline fragment masked below
TEXT_X1, TEXT_Y1 = 814, 206              # baked-in headline fragment ("...hts") lives left/above this point
STRIP_Y = 392                            # baked-in feature-strip text starts here (x < ~1085)


def players_layer() -> tuple[np.ndarray, np.ndarray]:
    """RGB + alpha for the players area: feathered left edge, headline fragment masked,
    baked strip text erased, brightness eased into the darker page art."""
    crop = ref.crop((CROP_X0, HERO_TOP, 1536, HERO_BOTTOM))
    a = np.asarray(crop, dtype=np.float32) / 255.0
    h, w = a.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    ax, ay = x + CROP_X0, y + HERO_TOP
    # short feather where the red player is; much wider feather in the sky above him
    ramp = 46.0 + 190.0 * np.clip((215 - ay) / 70.0, 0, 1)
    alpha = np.clip(x / ramp, 0, 1)
    text_mask = np.clip((TEXT_X1 - ax) / 22.0, 0, 1) * np.clip((TEXT_Y1 - ay) / 22.0, 0, 1)
    alpha = alpha * (1 - text_mask)
    # ease brightness so the bright reference stadium meets the darker art without a seam
    a = a * (0.42 + 0.58 * np.clip(x / 300.0, 0, 1) ** 0.8)[..., None]
    fade = np.clip((ay - (STRIP_Y - 34)) / 30.0, 0, 1) * np.clip((1085 + 70 - ax) / 70.0, 0, 1)
    dark = hex_rgb("#02111d")
    a = a * (1 - fade[..., None]) + dark * fade[..., None]
    return a, alpha


def compose(width: int) -> Image.Image:
    scale = width / 1536
    H = round((HERO_BOTTOM - HERO_TOP) * scale)
    base = stadium(width, H, focus=(0.66, 0.26), tint="#1a4f80", pitch_top=0.97, seed=3)
    base = green_shards(base, 0.92, 0.6)
    rgb, alpha = players_layer()
    pw, ph = round(rgb.shape[1] * scale), H
    layer = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize((pw, ph), Image.LANCZOS), dtype=np.float32) / 255
    al = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).resize((pw, ph), Image.LANCZOS), dtype=np.float32) / 255
    x0 = width - pw
    region = base[:, x0:]
    base[:, x0:] = region * (1 - al[..., None]) + layer * al[..., None]
    img = Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8))
    if scale > 1:
        img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    return img


def compose_mobile(W=800, H=1480) -> Image.Image:
    """Portrait image matching the phone hero box (~390x725 CSS px): players across the top,
    centred on the middle player, dark lower area for the headline and CTA."""
    base = np.zeros((H, W, 3), np.float32)
    base[:] = hex_rgb("#001424")
    crop = ref.crop((TEXT_X1 - 40, HERO_TOP, 1536, STRIP_Y - 6))
    scale = 1.32
    cw, ch = round(crop.width * scale), round(crop.height * scale)
    layer = np.asarray(crop.resize((cw, ch), Image.LANCZOS), dtype=np.float32) / 255
    centre = round((1160 - (TEXT_X1 - 40)) * scale)          # middle player's centre in the scaled crop
    x0 = max(0, min(cw - W, centre - W // 2))
    layer = layer[:, x0:x0 + W]
    y0 = 0
    y, x = np.mgrid[0:ch, 0:layer.shape[1]].astype(np.float32)
    al = np.clip((ch - y) / 150, 0, 1)                         # fade the players out towards the headline
    base[y0:y0 + ch, : layer.shape[1]] = base[y0:y0 + ch, : layer.shape[1]] * (1 - al[..., None]) + layer * al[..., None]
    return Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8))


if __name__ == "__main__":
    for w in (1600, 2400):
        im = compose(w)
        im.save(OUT / f"hero-desktop-{w}.webp", "WEBP", quality=88, method=6)
        print("wrote", f"hero-desktop-{w}", im.size)
    m = compose_mobile()
    m.save(OUT / "hero-mobile-800.webp", "WEBP", quality=86, method=6)
    print("wrote hero-mobile-800", m.size)
