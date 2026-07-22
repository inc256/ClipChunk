import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const ffmpegDir = join(root, "public", "ffmpeg");

const requiredFiles = [
  "ffmpeg-core.js",
  "ffmpeg-core.wasm",
  "ffmpeg-worker.js",
  "const.js",
  "errors.js",
  "types.js",
  "utils.js",
];

function fail(message) {
  console.error(`FFmpeg asset verification failed: ${message}`);
  process.exit(1);
}

for (const file of requiredFiles) {
  const fullPath = join(ffmpegDir, file);
  if (!existsSync(fullPath)) fail(`missing ${fullPath}`);
  const size = statSync(fullPath).size;
  if (size <= 0) fail(`empty file ${fullPath}`);
}

const coreJsPath = join(ffmpegDir, "ffmpeg-core.js");
const coreJs = readFileSync(coreJsPath, "utf8");
if (!coreJs.includes("createFFmpegCore")) {
  fail("ffmpeg-core.js does not look like a valid ffmpeg core bundle");
}

const workerPath = join(ffmpegDir, "ffmpeg-worker.js");
const workerJs = readFileSync(workerPath, "utf8");
if (!workerJs.includes("FFMessageType") || !workerJs.includes("createFFmpegCore")) {
  fail("ffmpeg-worker.js does not look like a valid ffmpeg class worker bundle");
}

console.log("FFmpeg asset verification passed.");
