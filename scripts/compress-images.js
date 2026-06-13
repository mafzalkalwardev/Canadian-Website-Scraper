const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const targetDir = path.resolve(process.argv[2] || path.join(ROOT, 'public', 'assets'));

function findFfmpeg() {
  const local = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (local.status === 0) return 'ffmpeg';
  throw new Error('ffmpeg not found. Install with: winget install Gyan.FFmpeg');
}

function collectPngFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.png')) files.push(full);
    }
  };
  walk(dir);
  return files;
}

function bytesToMb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function main() {
  const ffmpeg = findFfmpeg();
  const files = collectPngFiles(targetDir);
  let before = 0;
  let after = 0;

  for (const file of files) {
    const sizeBefore = fs.statSync(file).size;
    const temp = `${file}.compressed.tmp.png`;
    const result = spawnSync(
      ffmpeg,
      ['-y', '-i', file, '-compression_level', '9', temp],
      { encoding: 'utf8' },
    );

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      continue;
    }

    const sizeAfter = fs.statSync(temp).size;
    if (sizeAfter < sizeBefore) {
      fs.moveSync(temp, file, { overwrite: true });
      after += sizeAfter;
      console.log(`${path.relative(ROOT, file)}: ${bytesToMb(sizeBefore)} MB -> ${bytesToMb(sizeAfter)} MB`);
    } else {
      fs.removeSync(temp);
      after += sizeBefore;
    }
    before += sizeBefore;
  }

  console.log(`Processed ${files.length} PNG files: ${bytesToMb(before)} MB -> ${bytesToMb(after)} MB`);
}

main();
