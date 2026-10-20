"""Give synthetic demo teams sensible short names (e.g. "Northbridge Rovers" -> "Northbridge").

Patches fixtures/demo/demo-artifact.json in place and writes SQL for the local D1 database.
The same rule lives in model-pipeline/src/fip_model/synthetic.py for future artifacts.
Usage: python scripts/fix-demo-short-names.py  (then: npx wrangler d1 execute DB --local --file .wrangler/short-names.sql)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model-pipeline" / "src"))
from fip_model.synthetic import short_name  # noqa: E402

art_path = ROOT / "fixtures" / "demo" / "demo-artifact.json"
art = json.loads(art_path.read_text(encoding="utf-8"))
sql = []
for t in art["teams"]:
    t["short_name"] = short_name(t["name"])
    sql.append(f"UPDATE teams SET short_name = '{t['short_name'].replace(chr(39), chr(39) * 2)}' WHERE id = '{t['id']}';")
art_path.write_text(json.dumps(art, separators=(",", ":"), default=str), encoding="utf-8")
out = ROOT / ".wrangler" / "short-names.sql"
out.parent.mkdir(exist_ok=True)
out.write_text("\n".join(sql) + "\n", encoding="utf-8")
print(f"patched {len(art['teams'])} teams; SQL -> {out}")
