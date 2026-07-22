import { mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

function parseArgs(argv) {
  const args = { chunkSeconds: 30 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (name === "input") args.input = value;
    if (name === "output-dir") args.outputDir = value;
    if (name === "chunk-seconds") args.chunkSeconds = Number(value);
    i++;
  }
  return args;
}

function run(bin, args) {
  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${bin} ${args.join(" ")}`);
  }
}

function getDurationSeconds(inputPath) {
  const result = spawnSync(
    ffprobe.path,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr || "unknown error"}`);
  }
  const duration = Number((result.stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not detect valid duration from input video.");
  }
  return duration;
}

function main() {
  if (!ffmpegPath || !ffprobe?.path) {
    throw new Error("ffmpeg-static or ffprobe-static binary path missing.");
  }

  const args = parseArgs(process.argv);
  if (!args.input) {
    throw new Error("Missing --input <path>");
  }
  if (!args.outputDir) {
    throw new Error("Missing --output-dir <path>");
  }
  if (!Number.isFinite(args.chunkSeconds) || args.chunkSeconds <= 0) {
    throw new Error("--chunk-seconds must be a positive number");
  }

  const inputPath = resolve(args.input);
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const duration = getDurationSeconds(inputPath);
  const total = Math.max(1, Math.ceil(duration / args.chunkSeconds));

  const stem = basename(inputPath, extname(inputPath));
  const outputPattern = join(outputDir, `${stem}_chunk_%03d.mp4`);

  run(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-f",
    "segment",
    "-segment_time",
    String(args.chunkSeconds),
    "-reset_timestamps",
    "1",
    outputPattern,
  ]);

  console.log(`Done. Created up to ${total} chunk(s) in ${outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
