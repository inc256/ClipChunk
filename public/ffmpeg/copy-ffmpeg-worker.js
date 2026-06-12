import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source paths (try multiple possible locations)
const possibleSourcePaths = [
  join(__dirname, '../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.worker.js'),
  join(__dirname, '../node_modules/@ffmpeg/core/dist/umd/worker.js'),
  join(__dirname, '../node_modules/@ffmpeg/core/dist/ffmpeg-core.worker.js'),
];

// Destination
const destDir = join(__dirname, '../public/ffmpeg');
const destPath = join(destDir, 'ffmpeg-core.worker.js');

// Find existing source file
let sourcePath = null;
for (const path of possibleSourcePaths) {
  if (existsSync(path)) {
    sourcePath = path;
    break;
  }
}

if (!sourcePath) {
  console.error('Could not find ffmpeg worker file. Make sure @ffmpeg/core is installed.');
  console.error('Searched in:', possibleSourcePaths);
  process.exit(1);
}

// Create destination directory if it doesn't exist
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

// Copy the file
copyFileSync(sourcePath, destPath);
console.log(`✅ Copied worker from ${sourcePath} to ${destPath}`);