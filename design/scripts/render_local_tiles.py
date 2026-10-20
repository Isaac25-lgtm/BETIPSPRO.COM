"""LOCAL-ONLY league tile backgrounds cut from the owner's reference screenshot (owner decision 2026-10-20).

They contain trademarked league emblems (Premier League, LaLiga, UEFA Champions League), so - like the
local hero - they are written to public/images/local/ (gitignored), used only in `vite dev` with
VITE_LOCAL_REFERENCE_HERO=true, and stripped from production builds. Baked-in text and buttons are
removed by inpainting so the page renders its own text on top.

Run: python design/scripts/render_local_tiles.py
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "design" / "reference" / "homepage-reference.png"
OUT = ROOT / "public" / "images" / "local"
OUT.mkdir(parents=True, exist_ok=True)

TILES = {"premier": (65, 383), "liga": (397, 713), "continental": (727, 1041)}
Y0, Y1 = 829, 980
TEXT_X = 88  # text/button area starts this far from the tile's left edge (emblem is left of it)

ref = cv2.cvtColor(np.asarray(Image.open(REF).convert("RGB")), cv2.COLOR_RGB2BGR)

for name, (x0, x1) in TILES.items():
    tile = ref[Y0:Y1, x0 + 2 : x1 - 2].copy()
    h, w = tile.shape[:2]
    gray = cv2.cvtColor(tile, cv2.COLOR_BGR2GRAY)
    mask = np.zeros((h, w), np.uint8)
    region = gray[:, TEXT_X:]
    bright = (region > 150).astype(np.uint8) * 255
    mask[:, TEXT_X:] = bright
    # Buttons: fill the whole bounding box of bright pixels in the lower band (outline + label + fill).
    ys, xs = np.nonzero(mask[int(h * 0.62) :, :])
    if len(xs):
        by0, by1 = ys.min() + int(h * 0.62), ys.max() + int(h * 0.62)
        bx0, bx1 = xs.min(), xs.max()
        mask[max(by0 - 5, 0) : by1 + 6, max(bx0 - 6, 0) : bx1 + 7] = 255
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=2)
    clean = cv2.inpaint(tile, mask, 7, cv2.INPAINT_TELEA)
    # Soften inpainted areas slightly so smears read as out-of-focus background.
    blurred = cv2.GaussianBlur(clean, (0, 0), 3)
    soft = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 4)[..., None]
    clean = (clean * (1 - soft) + blurred * soft).astype(np.uint8)
    img = Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))
    img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img.save(OUT / f"league-{name}.webp", "WEBP", quality=88, method=6)
    print("wrote", f"league-{name}", img.size)
