#!/usr/bin/env python3
"""Split a video into fixed-duration chunks using ffmpeg.

Example:
  python scripts/split_video.py --input input.mp4 --output-dir out --chunk-seconds 30
"""

from __future__ import annotations

import argparse
import math
import subprocess
from pathlib import Path


def run_cmd(args: list[str]) -> None:
    completed = subprocess.run(args, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            f"Command failed ({completed.returncode}): {' '.join(args)}\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )


def get_duration_seconds(input_path: Path) -> float:
    probe_cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(input_path),
    ]
    completed = subprocess.run(probe_cmd, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {completed.stderr.strip()}")
    return float(completed.stdout.strip())


def split_video(input_path: Path, output_dir: Path, chunk_seconds: float) -> int:
    duration = get_duration_seconds(input_path)
    total_chunks = max(1, math.ceil(duration / chunk_seconds))
    output_dir.mkdir(parents=True, exist_ok=True)

    for idx in range(total_chunks):
        start = idx * chunk_seconds
        segment_duration = min(chunk_seconds, duration - start)
        out_name = f"chunk_{idx + 1:03d}.mp4"
        out_path = output_dir / out_name

        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(input_path),
            "-t",
            f"{segment_duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
        run_cmd(cmd)

    return total_chunks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split a video into chunks.")
    parser.add_argument("--input", required=True, type=Path, help="Input video path")
    parser.add_argument("--output-dir", required=True, type=Path, help="Output directory")
    parser.add_argument(
        "--chunk-seconds",
        required=True,
        type=float,
        help="Length of each chunk in seconds",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.chunk_seconds <= 0:
        raise ValueError("--chunk-seconds must be greater than 0")
    if not args.input.exists():
        raise FileNotFoundError(f"Input not found: {args.input}")

    count = split_video(args.input, args.output_dir, args.chunk_seconds)
    print(f"Done. Created {count} chunk(s) in {args.output_dir}")


if __name__ == "__main__":
    main()
