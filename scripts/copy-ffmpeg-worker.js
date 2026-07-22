import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const classWorkerCandidates = [
  join(rootDir, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm", "worker.js"),
  join(rootDir, "node_modules", "@ffmpeg", "ffmpeg", "dist", "umd", "worker.js"),
];

const classWorkerDirCandidates = [
  join(rootDir, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm"),
  join(rootDir, "node_modules", "@ffmpeg", "ffmpeg", "dist", "umd"),
];

const mtWorkerCandidates = [
  join(rootDir, "node_modules", "@ffmpeg", "core-mt", "dist", "umd", "ffmpeg-core.worker.js"),
  join(rootDir, "node_modules", "@ffmpeg", "core-mt", "dist", "esm", "ffmpeg-core.worker.js"),
];

const coreJsCandidates = [
  join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "esm", "ffmpeg-core.js"),
  join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd", "ffmpeg-core.js"),
];

const coreWasmCandidates = [
  join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "esm", "ffmpeg-core.wasm"),
  join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd", "ffmpeg-core.wasm"),
];

const destinationDir = join(rootDir, "public", "ffmpeg");
const classWorkerDestPath = join(destinationDir, "ffmpeg-worker.js");
const mtWorkerDestPath = join(destinationDir, "ffmpeg-core.worker.js");
const coreJsDestPath = join(destinationDir, "ffmpeg-core.js");
const coreWasmDestPath = join(destinationDir, "ffmpeg-core.wasm");

const classWorkerSource = classWorkerCandidates.find((candidate) => existsSync(candidate));
const mtWorkerSource = mtWorkerCandidates.find((candidate) => existsSync(candidate));
const classWorkerDir = classWorkerDirCandidates.find((candidate) => existsSync(candidate));
const coreJsSource = coreJsCandidates.find((candidate) => existsSync(candidate));
const coreWasmSource = coreWasmCandidates.find((candidate) => existsSync(candidate));

if (!classWorkerSource) {
  console.error("Could not find ffmpeg class worker. Ensure @ffmpeg/ffmpeg is installed.");
  console.error("Checked:", classWorkerCandidates);
  process.exit(1);
}

if (!coreJsSource || !coreWasmSource) {
  console.error("Could not find ffmpeg core assets. Ensure @ffmpeg/core is installed.");
  console.error("Checked js:", coreJsCandidates);
  console.error("Checked wasm:", coreWasmCandidates);
  process.exit(1);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(classWorkerSource, classWorkerDestPath);
copyFileSync(coreJsSource, coreJsDestPath);
copyFileSync(coreWasmSource, coreWasmDestPath);

if (classWorkerDir) {
  const companionFiles = ["const.js", "errors.js", "types.js", "utils.js"];
  for (const fileName of companionFiles) {
    const source = join(classWorkerDir, fileName);
    const dest = join(destinationDir, fileName);
    if (existsSync(source)) {
      copyFileSync(source, dest);
    }
  }
}

if (mtWorkerSource) {
  copyFileSync(mtWorkerSource, mtWorkerDestPath);
}

console.log(`Copied ffmpeg class worker to ${classWorkerDestPath}`);
console.log(`Copied ffmpeg core JS to ${coreJsDestPath}`);
console.log(`Copied ffmpeg core WASM to ${coreWasmDestPath}`);
if (mtWorkerSource) {
  console.log(`Copied ffmpeg core-mt worker to ${mtWorkerDestPath}`);
}
