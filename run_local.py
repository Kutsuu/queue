#!/usr/bin/env python3
"""Start the Queue Vite development server from Python."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def npm_command(*args: str) -> list[str]:
    npm = shutil.which("npm.cmd") if os.name == "nt" else shutil.which("npm")
    npm = npm or shutil.which("npm")
    if not npm:
        raise RuntimeError("Node.js and npm were not found. Install Node.js 20 or later.")
    if os.name == "nt" and npm.lower().endswith((".cmd", ".bat")):
        command = subprocess.list2cmdline(["npm.cmd", *args])
        return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", command]
    return [npm, *args]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Queue local development server")
    parser.add_argument("--port", type=int, default=5173, help="Server port (default: 5173)")
    parser.add_argument("--network", action="store_true", help="Allow other devices on your local network to connect")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    if not (ROOT / "package.json").is_file():
        print("package.json was not found. Run this script from the Queue project folder.", file=sys.stderr)
        return 1

    try:
        if not (ROOT / "node_modules").is_dir():
            print("Installing locked project dependencies (npm ci)...", flush=True)
            subprocess.run(npm_command("ci"), cwd=ROOT, check=True)
        host = "0.0.0.0" if args.network else "127.0.0.1"
        print(f"Queue is starting at http://127.0.0.1:{args.port}", flush=True)
        if args.network:
            print("Network access is enabled for devices on your local network.", flush=True)
        print("Stop the server with Ctrl+C.", flush=True)
        process = subprocess.Popen(
            npm_command("run", "dev", "--", "--host", host, "--port", str(args.port), "--strictPort"),
            cwd=ROOT,
        )
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Could not start Queue: {error}", file=sys.stderr)
        return 1

    try:
        return process.wait()
    except KeyboardInterrupt:
        print("\nStopping the local server...", flush=True)
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
