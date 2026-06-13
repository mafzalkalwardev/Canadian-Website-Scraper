const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const targetDir = path.resolve(process.argv[2] || path.join(ROOT, 'public', 'assets'));
const bitrate = process.argv[3] || '16k';

function findFfmpeg() {
  const local = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (local.status === 0) return 'ffmpeg';
  throw new Error('ffmpeg not found. Install with: winget install Gyan.FFmpeg');
}

function collectMp3Files(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.mp3')) files.push(full);
    }
  };
  walk(dir);
  return files;
}

function bytesToMb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function compressFile(ffmpeg, file) {
  const sizeBefore = fs.statSync(file).size;
  const temp = `${file}.compressed.tmp.mp3`;

  const result = spawnSync(
    ffmpeg,
    ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '22050', '-b:a', bitrate, temp],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`Failed to compress ${file}`);
  }

  const sizeAfter = fs.statSync(temp).size;
  fs.moveSync(temp, file, { overwrite: true });
  console.log(`${path.relative(ROOT, file)}: ${bytesToMb(sizeBefore)} MB -> ${bytesToMb(sizeAfter)} MB @ ${bitrate}`);
  return { before: sizeBefore, after: sizeAfter };
}

function main() {
  const ffmpeg = findFfmpeg();
  const files = collectMp3Files(targetDir);
  if (!files.length) {
    console.log(`No MP3 files found under ${targetDir}`);
    return;
  }

  let before = 0;
  let after = 0;

  for (const file of files) {
    const result = compressFile(ffmpeg, file);
    before += result.before;
    after += result.after;
  }

  console.log(`Compressed ${files.length} files: ${bytesToMb(before)} MB -> ${bytesToMb(after)} MB`);
}

main();
