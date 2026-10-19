"""Entry point: python model-pipeline/run.py <command> ... (adds src/ to sys.path)."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "src"))

from fip_model.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
