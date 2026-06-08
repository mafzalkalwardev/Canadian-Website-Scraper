import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the structured local TEF quiz website.")
    parser.add_argument("--source", default="downloaded_site/quiz-deep-2026-06-07T13-05-25-044Z")
    parser.add_argument("--output", default="output")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    if not source.is_absolute():
        source = ROOT / source
    if not output.is_absolute():
        output = ROOT / output

    return subprocess.call(
        ["node", "scripts/build-tef-site.js", str(source), str(output)],
        cwd=ROOT,
    )


if __name__ == "__main__":
    raise SystemExit(main())
