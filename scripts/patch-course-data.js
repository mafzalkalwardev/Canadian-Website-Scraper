const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const sourceDir = path.resolve(process.argv[2] || 'downloaded_site/quiz-deep-2026-06-07T13-05-25-044Z');
const outputDir = path.resolve(process.argv[3] || 'public');

if (!fs.existsSync(sourceDir)) {
  console.error('Source export not found:', sourceDir);
  process.exit(1);
}

const tempDir = path.join(__dirname, '..', '.tmp-course-build');
fs.removeSync(tempDir);
fs.ensureDirSync(tempDir);

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'build-tef-site.js'), sourceDir, tempDir],
  { stdio: 'inherit' },
);

if (result.status !== 0) process.exit(result.status || 1);

fs.ensureDirSync(path.join(outputDir, 'data', 'sections'));
fs.copySync(path.join(tempDir, 'data'), path.join(outputDir, 'data'));
fs.removeSync(tempDir);

const clean = spawnSync(process.execPath, [path.join(__dirname, 'clean-course-media.js'), path.join(outputDir, 'data', 'course.json')], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
if (clean.status !== 0) process.exit(clean.status || 1);

console.log(`Updated course data in ${outputDir}/data`);
