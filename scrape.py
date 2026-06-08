import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "config.json"
STATE_FILE = ROOT / "scrape_state.json"


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def run(command: list[str], env: dict[str, str] | None = None) -> int:
    print("+ " + " ".join(command))
    return subprocess.call(command, cwd=ROOT, env=env)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the TEFSuccess scraper and build the local review website.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to config.json")
    parser.add_argument("--resume", action="store_true", help="Resume from the latest saved export and rebuild output")
    parser.add_argument("--build-only", action="store_true", help="Only rebuild output/ from sourceExportDir")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config = load_config(config_path)
    source_export = ROOT / config.get("sourceExportDir", "")

    if not args.resume and not args.build_only:
        username = os.environ.get("TEF_USERNAME", "")
        password = os.environ.get("TEF_PASSWORD", "")
        if not username or not password:
            print("Set TEF_USERNAME and TEF_PASSWORD in the environment before scraping.", file=sys.stderr)
            return 2

        command = [
            "node",
            "QuizDeepScraper.js",
            config.get("baseUrl", "https://tefsuccess.ca/course/view.php?id=2"),
        ]
        if config.get("headless", True):
            command.append("--headless")
        if config.get("browserChannel"):
            command.extend(["--browser-channel", str(config["browserChannel"])])
        if config.get("profileDir"):
            command.extend(["--profile", str(config["profileDir"])])
        if config.get("profileName"):
            command.extend(["--profile-name", str(config["profileName"])])

        env = os.environ.copy()
        print("Starting authenticated TEFSuccess scrape with credentials from environment.")
        code = run(command, env=env)
        if code:
            return code

        source_export = latest_export_dir()
        config["sourceExportDir"] = str(source_export.relative_to(ROOT)).replace("\\", "/")
        with config_path.open("w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2)
            handle.write("\n")
        STATE_FILE.write_text(json.dumps({"lastExportDir": config["sourceExportDir"]}, indent=2) + "\n", encoding="utf-8")
    elif args.resume and STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        source_export = ROOT / state.get("lastExportDir", config.get("sourceExportDir", ""))

    output_dir = ROOT / config.get("outputDir", "output")
    return run(["python", "build_site.py", "--source", str(source_export), "--output", str(output_dir)])


def latest_export_dir() -> Path:
    root = ROOT / "downloaded_site"
    candidates = [path for path in root.glob("quiz-deep-*") if path.is_dir()]
    if not candidates:
        raise SystemExit("No quiz-deep export folder found.")
    return max(candidates, key=lambda path: path.stat().st_mtime)


if __name__ == "__main__":
    raise SystemExit(main())
