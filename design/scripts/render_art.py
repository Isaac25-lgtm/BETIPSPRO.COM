"""Render ORIGINAL procedural artwork for the site (no third-party photos, logos or likenesses).

Outputs (public/images/):
  hero-desktop-{1600,2400,3200}.webp   night stadium, floodlights, pitch, ball, backlit players
  hero-mobile-{800,1200}.webp          art-directed portrait crop for phones
  league-{premier,liga,continental}.webp
  premium-ball.webp                    ball-in-net art for the premium card

Run: python design/scripts/render_art.py
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

OUT = Path(__file__).resolve().parents[2] / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)
RNG = np.random.default_rng(42)


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def to_img(a: np.ndarray, mode="RGB") -> Image.Image:
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).convert(mode)


def blur(a: np.ndarray, r: float) -> np.ndarray:
    if a.ndim == 2:
        return gaussian_filter(a.astype(np.float32), r)
    return np.stack([gaussian_filter(a[..., c].astype(np.float32), r) for c in range(a.shape[2])], axis=-1)


def mask_from_draw(w, h, fn, ss=1) -> np.ndarray:
    im = Image.new("L", (w * ss, h * ss), 0)
    fn(ImageDraw.Draw(im), ss)
    if ss > 1:
        im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def comp(base: np.ndarray, color, alpha: np.ndarray) -> np.ndarray:
    c = color if isinstance(color, np.ndarray) and color.ndim == 3 else np.asarray(color, dtype=np.float32)
    return base * (1 - alpha[..., None]) + c * alpha[..., None]


def screen(base: np.ndarray, light: np.ndarray) -> np.ndarray:
    return 1 - (1 - base) * (1 - np.clip(light, 0, 1))


# ------------------------------------------------------------------ football

def _ball_centres():
    phi = (1 + 5 ** 0.5) / 2
    ico = []
    for a in (-1, 1):
        for b in (-phi, phi):
            ico += [(0, a, b), (a, b, 0), (b, 0, a)]
    ico = np.array(ico, dtype=np.float64)
    ico /= np.linalg.norm(ico, axis=1, keepdims=True)
    faces = []
    for i in range(12):
        for j in range(i + 1, 12):
            for k in range(j + 1, 12):
                if all(np.dot(ico[x], ico[y]) > 0.4 for x, y in ((i, j), (j, k), (i, k))):
                    c = ico[i] + ico[j] + ico[k]
                    faces.append(c / np.linalg.norm(c))
    return ico, np.array(faces)


PENT, HEX = _ball_centres()


def render_ball(size: int, rot=(0.4, 0.6, 0.1), light=(-0.5, -0.6, 0.62), rim=(0.6, -0.5, -0.3), rim_color="#bfe9ff") -> np.ndarray:
    """Return RGBA float array of a classic 32-panel football."""
    s = size
    y, x = np.mgrid[0:s, 0:s].astype(np.float64)
    nx = (x + 0.5 - s / 2) / (s / 2)
    ny = (y + 0.5 - s / 2) / (s / 2)
    r2 = nx**2 + ny**2
    inside = r2 <= 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    N = np.stack([nx, ny, nz], -1)
    ax, ay, az = rot
    Rx = np.array([[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]])
    Ry = np.array([[math.cos(ay), 0, math.sin(ay)], [0, 1, 0], [-math.sin(ay), 0, math.cos(ay)]])
    Rz = np.array([[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]])
    V = N @ (Rz @ Ry @ Rx).T
    ap = np.arccos(np.clip(V @ PENT.T, -1, 1))
    ah = np.arccos(np.clip(V @ HEX.T, -1, 1))
    dp = ap.min(-1)
    dh = ah.min(-1)
    is_pent = dp - 0.035 < dh
    allang = np.sort(np.concatenate([ap - 0.035, ah], -1), -1)
    seam = np.clip(1 - (allang[..., 1] - allang[..., 0]) / 0.03, 0, 1)
    base = np.where(is_pent[..., None], hex_rgb("#0b1520"), hex_rgb("#f4f7fa"))
    base = base * (1 - 0.65 * seam[..., None])
    L = np.array(light) / np.linalg.norm(light)
    lam = np.clip(N @ L, 0, 1)
    shade = 0.22 + 0.85 * lam
    H = (L + np.array([0, 0, 1])) / np.linalg.norm(L + np.array([0, 0, 1]))
    spec = np.clip(N @ H, 0, 1) ** 40 * 0.55
    Rm = np.array(rim) / np.linalg.norm(rim)
    rimlight = np.clip(1 - nz, 0, 1) ** 2.2 * np.clip(N @ np.array([Rm[0], Rm[1], 0.0]) + 0.3, 0, 1)
    col = base * shade[..., None] + spec[..., None] + rimlight[..., None] * hex_rgb(rim_color) * 0.9
    # soft edge AA
    edge = np.clip((1 - np.sqrt(r2)) * s / 2, 0, 1)
    return np.concatenate([np.clip(col, 0, 1), edge[..., None] * inside[..., None]], -1).astype(np.float32)


def paste_rgba(base: np.ndarray, rgba: np.ndarray, x: int, y: int) -> np.ndarray:
    h, w = rgba.shape[:2]
    H, W = base.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1:
        return base
    sub = rgba[y0 - y : y1 - y, x0 - x : x1 - x]
    a = sub[..., 3:4]
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - a) + sub[..., :3] * a
    return base


# ------------------------------------------------------------------ stadium

def stadium(W: int, H: int, focus=(0.70, 0.30), tint="#0d3b63", pitch_top=0.70, seed=1, crowd=True) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = x / W, y / H
    img = np.zeros((H, W, 3), np.float32)
    top, bot = hex_rgb("#02111d"), hex_rgb("#010d17")
    img[:] = top * (1 - v[..., None]) + bot * v[..., None]
    fx, fy = focus
    d = np.sqrt(((u - fx) * W / H * 0.55) ** 2 + (v - fy) ** 2)
    glow = np.exp(-(d**2) / 0.10)
    img = img + hex_rgb(tint) * glow[..., None] * 0.95

    # Stands: curved bands with crowd texture
    if crowd:
        arc_c = (fx * W, H * 1.55)
        rr = np.sqrt(((x - arc_c[0]) * 0.62) ** 2 + (y - arc_c[1]) ** 2)
        r_in, r_out = H * 0.95, H * 1.48
        band = np.clip((rr - r_in) / (H * 0.02), 0, 1) * np.clip((r_out - rr) / (H * 0.02), 0, 1)
        dots = (rng.random((H, W)) > 0.82).astype(np.float32) * rng.random((H, W)).astype(np.float32)
        dots = blur(dots, 0.9)
        tiers = 0.55 + 0.45 * (np.sin(rr / (H * 0.035)) > -0.2)
        crowd_l = band * (0.10 + 0.55 * dots) * tiers * (0.35 + glow)
        img = img + crowd_l[..., None] * hex_rgb("#5d86ab") * 0.55

    # Floodlight rows + bokeh
    lights = np.zeros((H, W), np.float32)
    for row, (yy, x0, x1, n) in enumerate(((0.07, 0.40, 0.98, 46), (0.13, 0.46, 1.0, 38), (0.035, 0.55, 0.92, 26))):
        for i in range(n):
            px = (x0 + (x1 - x0) * i / max(n - 1, 1)) * W + rng.normal(0, W * 0.002)
            py = (yy + 0.03 * math.sin(i / n * math.pi)) * H + rng.normal(0, H * 0.004)
            r = rng.uniform(1.2, 2.6) * H / 800
            lights += np.exp(-(((x - px) ** 2 + (y - py) ** 2) / (2 * r**2))) * rng.uniform(0.7, 1.0)
    halo = blur(lights, H * 0.012) * 6 + blur(lights, H * 0.05) * 18
    img = screen(img, (lights[..., None] * 1.4 + halo[..., None] * 0.9) * hex_rgb("#d9ecff"))
    bok = np.zeros((H, W), np.float32)
    for _ in range(70):
        px, py = rng.uniform(0.35, 1.0) * W, rng.uniform(0.0, 0.45) * H
        r = rng.uniform(0.008, 0.03) * H * 2.2
        bok += (np.sqrt((x - px) ** 2 + (y - py) ** 2) < r) * rng.uniform(0.03, 0.12)
    img = screen(img, blur(bok, 2.5)[..., None] * hex_rgb("#9ccfff"))

    # Light beams
    beams = np.zeros((H, W), np.float32)
    for bx in (0.55, 0.72, 0.9):
        ang = np.arctan2(y - 0.05 * H, x - bx * W)
        beams += np.exp(-((ang - math.radians(100 + (bx - 0.7) * 40)) ** 2) / 0.004) * np.clip(v * 1.4, 0, 1)
    img = screen(img, beams[..., None] * 0.07 * hex_rgb("#cfe6ff"))

    # Pitch with perspective stripes
    pt = pitch_top
    pv = np.clip((v - pt) / (1 - pt), 0, 1)
    depth = 1 / (0.15 + pv)
    stripes = (np.sin((u - 0.5) * depth * 6.0 * 2.2) > 0).astype(np.float32)
    grass = hex_rgb("#0b4a2a") * (0.55 + 0.18 * stripes[..., None]) * (0.4 + 0.9 * pv[..., None])
    pm = np.clip((v - pt) / 0.02, 0, 1)
    grass_light = 0.5 + 0.8 * np.exp(-(((u - fx) * 1.6) ** 2))
    img = img * (1 - pm[..., None]) + grass * grass_light[..., None] * pm[..., None]
    # pitch haze at horizon
    haze = np.exp(-((v - pt) ** 2) / 0.0012) * np.exp(-(((u - fx) * 1.2) ** 2))
    img = screen(img, haze[..., None] * 0.35 * hex_rgb("#8fd3ff"))

    # Grain
    img += (rng.random((H, W, 1)).astype(np.float32) - 0.5) * 0.025
    return np.clip(img, 0, 1)


def green_shards(img: np.ndarray, x0f: float, strength=1.0) -> np.ndarray:
    H, W = img.shape[:2]

    def draw(d, ss):
        d.polygon([((x0f + 0.07) * W * ss, 0.18 * H * ss), (W * ss, -0.05 * H * ss), (W * ss, 0.62 * H * ss)], fill=150)
        d.polygon([((x0f + 0.03) * W * ss, 1.0 * H * ss), (W * ss, 0.45 * H * ss), (W * ss, 1.0 * H * ss)], fill=255)
        d.polygon([((x0f - 0.03) * W * ss, 1.0 * H * ss), ((x0f + 0.04) * W * ss, 0.86 * H * ss), ((x0f + 0.10) * W * ss, 1.0 * H * ss)], fill=110)

    m = mask_from_draw(W, H, draw, ss=2)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    grad = np.clip((x / W - x0f) / (1 - x0f), 0, 1) ** 0.8
    col = hex_rgb("#16c76f") * (0.35 + 0.65 * grad[..., None])
    a = m * 0.85 * strength
    img = comp(img, col, a)
    img = screen(img, blur(m, H * 0.03)[..., None] * 0.35 * strength * hex_rgb("#1df992"))
    return img


# ------------------------------------------------------------------ backlit players (abstract busts)

def _capsule(d, p0, p1, r, fill=255):
    (x0, y0), (x1, y1) = p0, p1
    d.line([p0, p1], fill=fill, width=int(2 * r))
    d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=fill)
    d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=fill)


def player_bust(w: int, h: int, jersey: str, pose: int, skin: str, seed: int) -> np.ndarray:
    """Stylised backlit athlete bust (no likeness, no badges, no sponsors). Returns RGBA."""
    ss = 3
    S = lambda px, py: (px * w * ss, py * h * ss)  # noqa: E731

    def torso(d, s):
        pts = [S(0.22, 1.02), S(0.18, 0.62), S(0.26, 0.47), S(0.40, 0.40), S(0.60, 0.40), S(0.74, 0.47), S(0.82, 0.62), S(0.78, 1.02)]
        d.polygon(pts, fill=255)
        r = 0.075 * w * ss
        if pose == 0:   # right fist raised, left arm bent
            _capsule(d, S(0.75, 0.50), S(0.92, 0.33), r); _capsule(d, S(0.92, 0.33), S(0.86, 0.12), r * 0.85)
            d.ellipse([*S(0.80, 0.03), *S(0.93, 0.15)], fill=255)
            _capsule(d, S(0.25, 0.50), S(0.10, 0.74), r); _capsule(d, S(0.10, 0.74), S(0.24, 0.66), r * 0.85)
        elif pose == 1:  # both fists clenched at chest (roar)
            _capsule(d, S(0.75, 0.50), S(0.90, 0.72), r); _capsule(d, S(0.90, 0.72), S(0.68, 0.62), r * 0.85)
            d.ellipse([*S(0.58, 0.55), *S(0.71, 0.68)], fill=255)
            _capsule(d, S(0.25, 0.50), S(0.10, 0.72), r); _capsule(d, S(0.10, 0.72), S(0.32, 0.62), r * 0.85)
        else:            # arms wide, celebrating
            _capsule(d, S(0.75, 0.50), S(0.98, 0.56), r); _capsule(d, S(0.98, 0.56), S(1.0, 0.38), r * 0.85)
            _capsule(d, S(0.25, 0.50), S(0.04, 0.66), r)

    def head(d, s):
        d.rectangle([*S(0.44, 0.30), *S(0.56, 0.44)], fill=255)  # neck
        tilt = (-0.02, 0.0, 0.03)[pose]
        d.ellipse([*S(0.385 + tilt, 0.09), *S(0.615 + tilt, 0.36)], fill=255)

    body = mask_from_draw(w, h, torso, ss)
    hd = mask_from_draw(w, h, head, ss)
    sil = np.clip(body + hd, 0, 1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    jc = hex_rgb(jersey)
    # Lighting: key from upper-left floodlights, falloff to the right/bottom
    light = np.clip(1.15 - 0.55 * (x / w) - 0.35 * (y / h), 0.25, 1.1)
    folds = 0.92 + 0.08 * np.sin(x / w * 18 + y / h * 7 + seed)
    col = np.zeros((h, w, 3), np.float32)
    col[:] = jc * (light * folds)[..., None]
    skin_c = hex_rgb(skin) * (0.55 + 0.35 * light)[..., None]
    col = col * (1 - hd[..., None]) + skin_c * hd[..., None]
    # Collar / trim line
    trim = mask_from_draw(w, h, lambda d, s: d.arc([*S(0.40, 0.33), *S(0.60, 0.50)], 0, 180, fill=255, width=int(0.018 * w * s)), ss)
    col = comp(col, hex_rgb("#f8fafc") if jersey.lower() not in ("#f4f6f8", "#eef2f6") else hex_rgb("#1f2937"), trim * body * 0.8)
    # Hair cap
    hair = mask_from_draw(w, h, lambda d, s: d.chord([*S(0.38, 0.075), *S(0.625, 0.30)], 180, 360, fill=255), ss) * hd
    col = comp(col, hex_rgb("#1b130e"), hair * 0.95)
    # Rim light from behind
    shifted = np.roll(sil, (-int(h * 0.006), int(w * 0.01)), (0, 1))
    rim = np.clip(sil - shifted, 0, 1)
    rim = blur(rim, 1.2)
    col = screen(col, rim[..., None] * hex_rgb("#d8f3ff") * 1.3)
    # Depth fade at the bottom (body cropped by pitch haze)
    fade = np.clip((1.0 - y / h) / 0.25, 0, 1) ** 0.6
    return np.concatenate([col, (sil * fade)[..., None]], -1).astype(np.float32)


# ------------------------------------------------------------------ compositions

def distant_players(img: np.ndarray, spots: list[tuple[float, float, float, int]]) -> np.ndarray:
    """Small, depth-of-field-blurred running figures on the pitch (no likeness)."""
    H, W = img.shape[:2]
    for (cx, base_y, hfrac, pose) in spots:
        ph = hfrac * H
        cxp, by = cx * W, base_y * H

        def draw(d, ss, cxp=cxp, by=by, ph=ph, pose=pose):
            k = ss
            P = lambda dx, dy: ((cxp + dx * ph) * k, (by - dy * ph) * k)  # noqa: E731
            r = 0.055 * ph * k
            lean = 0.06 if pose % 2 else -0.04
            hip, neck = P(0, 0.52), P(lean, 0.86)
            _capsule(d, hip, neck, r * 1.5)
            d.ellipse([P(lean - 0.07, 1.0)[0], P(0, 1.0)[1], P(lean + 0.07, 0.86)[0], P(0, 0.86)[1]], fill=255)
            a = 0.22 if pose % 2 else -0.18
            _capsule(d, hip, P(a, 0.27), r); _capsule(d, P(a, 0.27), P(a + 0.05, 0.0), r * 0.9)
            _capsule(d, hip, P(-a * 0.8, 0.26), r); _capsule(d, P(-a * 0.8, 0.26), P(-a * 1.2, 0.03), r * 0.9)
            _capsule(d, P(lean, 0.80), P(lean + 0.2, 0.62), r * 0.85); _capsule(d, P(lean, 0.80), P(lean - 0.2, 0.60), r * 0.85)

        m = mask_from_draw(W, H, draw, ss=3)
        shade = 0.85
        img = comp(img, hex_rgb("#03101b") * shade, m * 0.92)
        rim = np.clip(m - np.roll(m, (1, -2), (0, 1)), 0, 1)
        img = screen(img, blur(rim, 0.8)[..., None] * hex_rgb("#cfe9ff") * 0.9)
        shadow = mask_from_draw(W, H, lambda d, ss: d.ellipse([(cxp - 0.25 * ph) * ss, (by - 0.03 * ph) * ss, (cxp + 0.25 * ph) * ss, (by + 0.04 * ph) * ss], fill=255), 2)
        img = img * (1 - 0.35 * blur(shadow, 2)[..., None])
    return img


def trajectory(img: np.ndarray, p0, p1, p2, color="#1df992", dashes=True, width=0.004) -> np.ndarray:
    """Quadratic-bezier dashed 'shot trajectory' with node markers (data motif)."""
    H, W = img.shape[:2]
    t = np.linspace(0, 1, 400)
    pts = [((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u**2 * p2[0], (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u**2 * p2[1]) for u in t]

    def draw(d, ss):
        for i in range(len(pts) - 1):
            if dashes and (i // 9) % 2:
                continue
            a, b = pts[i], pts[i + 1]
            d.line([(a[0] * W * ss, a[1] * H * ss), (b[0] * W * ss, b[1] * H * ss)], fill=int(90 + 165 * i / len(pts)), width=max(1, int(width * H * ss)))
        for u in (0.25, 0.5, 0.75):
            k = int(u * (len(pts) - 1))
            x, y = pts[k][0] * W * ss, pts[k][1] * H * ss
            r = 0.009 * H * ss
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)

    m = mask_from_draw(W, H, draw, ss=2)
    img = comp(img, hex_rgb(color), m * 0.85)
    return screen(img, blur(m, H * 0.012)[..., None] * hex_rgb(color) * 0.6)


def motion_streak(img: np.ndarray, cx, cy, r, angle_deg=200, length=2.6) -> np.ndarray:
    H, W = img.shape[:2]
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    a = math.radians(angle_deg)
    dx, dy = (x - cx * W), (y - cy * H)
    along = dx * math.cos(a) + dy * math.sin(a)
    across = -dx * math.sin(a) + dy * math.cos(a)
    R = r * H
    m = np.clip(along / (R * length), 0, 1)
    streak = (1 - m) * (along > 0) * np.exp(-(across**2) / (2 * (R * 0.55 * (1 - 0.5 * m)) ** 2))
    return screen(img, streak[..., None] * 0.45 * hex_rgb("#bfe6ff"))


def hero(W=3200, H=830) -> np.ndarray:
    img = stadium(W, H, focus=(0.70, 0.30), pitch_top=0.70, seed=3)
    img = distant_players(img, [(0.47, 0.80, 0.16, 1), (0.585, 0.745, 0.12, 0), (0.655, 0.775, 0.14, 3), (0.94, 0.79, 0.15, 2), (0.53, 0.725, 0.09, 2), (0.885, 0.735, 0.10, 1)])
    img = trajectory(img, (0.40, 0.92), (0.58, 0.05), (0.735, 0.40))
    ball_r = 0.33
    cx, cy = 0.79, 0.47
    img = motion_streak(img, cx, cy, ball_r, angle_deg=195)
    b = int(H * ball_r * 2)
    img = paste_rgba(img, render_ball(b, rot=(0.5, 0.9, 0.3), light=(-0.55, -0.55, 0.62)), int(cx * W - b / 2), int(cy * H - b / 2))
    img = green_shards(img, 0.88, 0.9)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    dark = np.clip(1 - (x / W - 0.16) / 0.40, 0, 1) ** 1.4 * 0.55
    img = img * (1 - dark[..., None]) + hex_rgb("#001424") * dark[..., None]
    return img


def hero_mobile(W=1200, H=1350) -> np.ndarray:
    img = stadium(W, H, focus=(0.62, 0.20), pitch_top=0.42, seed=5)
    img = distant_players(img, [(0.18, 0.52, 0.10, 1), (0.36, 0.48, 0.075, 0), (0.92, 0.50, 0.09, 2)])
    img = trajectory(img, (0.05, 0.50), (0.30, 0.02), (0.55, 0.22), width=0.003)
    cx, cy, r = 0.72, 0.25, 0.16
    img = motion_streak(img, cx, cy, r, angle_deg=200, length=2.2)
    b = int(H * r * 2)
    img = paste_rgba(img, render_ball(b, rot=(0.5, 0.9, 0.3)), int(cx * W - b / 2), int(cy * H - b / 2))
    img = green_shards(img, 0.80, 0.5)
    y = np.mgrid[0:H, 0:W][0].astype(np.float32)
    dark = np.clip((y / H - 0.40) / 0.30, 0, 1) ** 1.2 * 0.94
    img = img * (1 - dark[..., None]) + hex_rgb("#001424") * dark[..., None]
    return img


def league_tile(W, H, tint, accent, seed, ball_pos=None) -> np.ndarray:
    img = stadium(W, H, focus=(0.6, 0.18), tint=tint, pitch_top=0.66, seed=seed, crowd=True)
    if ball_pos:
        b = int(H * 0.42)
        img = paste_rgba(img, render_ball(b, rot=(0.2 + seed, 0.4, 0.1)), int(ball_pos[0] * W), int(ball_pos[1] * H))
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    glow = np.exp(-(((x / W - 0.85) * 2) ** 2 + ((y / H - 0.1) * 2) ** 2))
    img = screen(img, glow[..., None] * hex_rgb(accent) * 0.35)
    return img


def premium_art(W=840, H=580) -> np.ndarray:
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = x / W, y / H
    img = np.zeros((H, W, 3), np.float32)
    img[:] = hex_rgb("#001a1c")
    d = np.sqrt(((u - 0.82) * 1.4) ** 2 + (v - 0.28) ** 2)
    img = screen(img, np.exp(-(d**2) / 0.08)[..., None] * hex_rgb("#0a7a4a") * 0.9)
    # Net: curved mesh lines
    net = np.zeros((H, W), np.float32)
    for k in range(-30, 30):
        a = k * 0.045
        xx = 0.62 * W + (y - 0.1 * H) * math.tan(a) + 40 * np.sin(v * 3 + k)
        net += np.exp(-((x - xx) ** 2) / 1.6) * (u > 0.55)
        yy = 0.02 * H + k * 0.055 * H + 20 * np.sin(u * 4 + k * 0.3)
        net += np.exp(-((y - yy) ** 2) / 1.6) * (u > 0.55)
    net = np.clip(net, 0, 1) * np.clip((u - 0.55) / 0.15, 0, 1)
    img = screen(img, net[..., None] * hex_rgb("#cfeee0") * 0.55)
    b = int(H * 0.62)
    img = paste_rgba(img, render_ball(b, rot=(0.9, 0.2, 0.4), light=(-0.7, -0.4, 0.6), rim_color="#1df992"), int(0.70 * W), int(0.04 * H))
    left = np.clip(1 - (u - 0.30) / 0.45, 0, 1) ** 1.3 * 0.85
    img = img * (1 - left[..., None]) + hex_rgb("#001a1c") * left[..., None]
    return img


def save_webp(a: np.ndarray, name: str, widths: list[int] | None = None, q=72):
    im = to_img(a)
    if widths is None:
        im.save(OUT / f"{name}.webp", "WEBP", quality=q, method=6)
        print("wrote", name, im.size)
        return
    for w in widths:
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(OUT / f"{name}-{w}.webp", "WEBP", quality=q, method=6)
        print("wrote", f"{name}-{w}", (w, h))


if __name__ == "__main__":
    save_webp(hero(), "hero-desktop", [1600, 2400, 3200], q=72)
    save_webp(hero_mobile(), "hero-mobile", [800, 1200], q=72)
    import sys
    if "--hero-only" in sys.argv:
        save_webp(hero(), "hero-desktop", [1600, 2400, 3200], q=72)
        save_webp(hero_mobile(), "hero-mobile", [800, 1200], q=72)
        raise SystemExit
    save_webp(league_tile(960, 460, "#2b1d63", "#a78bfa", 11, ball_pos=(0.06, 0.52)), "league-premier")
    save_webp(league_tile(960, 460, "#5a1a1f", "#ff6b4a", 12), "league-liga")
    save_webp(league_tile(960, 460, "#0b2a6b", "#60a5fa", 13, ball_pos=(0.08, 0.10)), "league-continental")
    save_webp(premium_art(), "premium-ball")
