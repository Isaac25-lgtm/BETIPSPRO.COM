"""Download club crests and competition emblems listed in stored football-data.org responses, optimise them and
serve them from our own static assets (fast, no hotlinking). Writes public/crests/{teams,comps}/ and
src/lib/crest-manifest.json (which ids have a crest, so the UI never requests a missing file).

Usage: python scripts/fetch-crests.py   (reads the local D1 database; owner decision D-028)
"""
from __future__ import annotations

import glob
import io
import json
import pathlib
import sqlite3
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "crests"
SIZE = 128  # rendered at <= 64 CSS px, so 128 covers 2x screens

# football-data.org competition codes -> canonical competition ids used on the site
COMP_IDS = {"PL": "apif:39", "PD": "apif:140", "CL": "apif:2", "BL1": "apif:78", "SA": "apif:135", "FL1": "apif:61"}


def db_path() -> pathlib.Path:
    files = [pathlib.Path(p) for p in glob.glob(str(ROOT / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite"))]
    files = [f for f in files if f.stat().st_size > 1_000_000]
    return max(files, key=lambda f: f.stat().st_size)


def collect() -> tuple[dict[str, str], dict[str, str]]:
    con = sqlite3.connect(db_path())
    teams: dict[str, str] = {}
    comps: dict[str, str] = {}
    for (body,) in con.execute("SELECT body_json FROM provider_snapshots WHERE provider = 'football_data_org'"):
        data = json.loads(body)
        comp = data.get("competition") or {}
        if comp.get("code") in COMP_IDS and comp.get("emblem"):
            comps[COMP_IDS[comp["code"]]] = comp["emblem"]
        for m in data.get("matches", []):
            for side in ("homeTeam", "awayTeam"):
                t = m.get(side) or {}
                if t.get("id") and t.get("crest"):
                    teams[f"fdo:team:{t['id']}"] = t["crest"]
    return teams, comps


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "bettipspro-crest-cache/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def save(url: str, dest_stem: pathlib.Path) -> str | None:
    raw = fetch(url)
    if url.lower().endswith(".svg") or raw.lstrip()[:5] in (b"<?xml", b"<svg "):
        dest = dest_stem.with_suffix(".svg")
        dest.write_bytes(raw)
        return dest.name
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    dest = dest_stem.with_suffix(".webp")
    im.save(dest, "WEBP", quality=88, method=6)
    return dest.name


def main() -> None:
    teams, comps = collect()
    (OUT / "teams").mkdir(parents=True, exist_ok=True)
    (OUT / "comps").mkdir(parents=True, exist_ok=True)
    manifest = {"teams": {}, "comps": {}}
    for kind, items in (("teams", teams), ("comps", comps)):
        for cid, url in sorted(items.items()):
            stem = OUT / kind / cid.split(":")[-1]
            try:
                name = save(url, stem)
                if name:
                    manifest[kind][cid] = f"/crests/{kind}/{name}"
            except Exception as e:  # keep going; the UI falls back to a monogram
                print(f"skip {cid}: {e}")
    (ROOT / "src/lib/crest-manifest.json").write_text(json.dumps(manifest, indent=0, sort_keys=True), encoding="utf-8")
    print(f"teams {len(manifest['teams'])}/{len(teams)}, comps {len(manifest['comps'])}/{len(comps)}")


if __name__ == "__main__":
    main()
