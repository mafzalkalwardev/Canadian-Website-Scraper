const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOWNLOADS = path.join(ROOT, 'downloaded_site');

function run(command, args, env = process.env) {
  console.log(`+ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function latestExportDir() {
  const dirs = fs.readdirSync(DOWNLOADS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('quiz-deep-'))
    .map((entry) => path.join(DOWNLOADS, entry.name));
  if (!dirs.length) throw new Error('No quiz-deep export found.');
  return dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function bestExportDir() {
  const dirs = fs.readdirSync(DOWNLOADS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('quiz-deep-'))
    .map((entry) => path.join(DOWNLOADS, entry.name));
  if (!dirs.length) throw new Error('No quiz-deep export found.');

  let best = dirs[0];
  let bestCount = 0;
  let bestMtime = 0;
  for (const dir of dirs) {
    const manifestPath = path.join(dir, 'quiz_deep_manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = fs.readJsonSync(manifestPath);
    const count = manifest.pages.filter((page) => /quiz_\d+_landing/i.test(page.htmlFile || '')).length;
    const mtime = fs.statSync(dir).mtimeMs;
    if (count > bestCount || (count === bestCount && mtime > bestMtime)) {
      bestCount = count;
      bestMtime = mtime;
      best = dir;
    }
  }
  return best;
}

async function main() {
  const skipRefetch = process.argv.includes('--skip-refetch');
  const skipScrape = process.argv.includes('--skip-scrape');
  const skipDeploy = process.argv.includes('--skip-deploy');
  const headless = process.argv.includes('--headed') ? [] : ['--headless'];

  if (!skipScrape) {
    if (!process.env.TEF_USERNAME || !process.env.TEF_PASSWORD) {
      console.error('Set TEF_USERNAME and TEF_PASSWORD before running a full refresh.');
      process.exit(2);
    }
    run(process.execPath, ['QuizDeepScraper.js', 'https://tefsuccess.ca/course/view.php?id=2', ...headless, '--browser-channel', 'chrome']);
  }

  const exportDir = bestExportDir();
  const relativeExport = path.relative(ROOT, exportDir).replace(/\\/g, '/');
  console.log(`Using export: ${relativeExport}`);

  const configPath = path.join(ROOT, 'config.json');
  const config = await fs.readJson(configPath);
  config.sourceExportDir = relativeExport;
  await fs.writeJson(configPath, config, { spaces: 2 });
  await fs.writeJson(path.join(ROOT, 'scrape_state.json'), { lastExportDir: relativeExport }, { spaces: 2 });

  if (!skipRefetch) {
    try {
      run(process.execPath, ['scripts/refetch-reviews.js', exportDir, '--headless']);
    } catch (err) {
      console.warn('Refetch skipped due to error:', err.message || err);
    }
  }
  run(process.execPath, ['scripts/scrape-production-pages.js', 'public/data/production-pages.json']);
  run(process.execPath, ['scripts/patch-course-data.js', exportDir, 'public']);
  run(process.execPath, ['scripts/clean-course-media.js', 'public/data/course.json']);

  fs.copySync(path.join(ROOT, 'scripts', 'tef-app-template.js'), path.join(ROOT, 'public', 'js', 'app.js'));
  fs.copySync(path.join(ROOT, 'scripts', 'tef-style-template.css'), path.join(ROOT, 'public', 'css', 'style.css'));
  fs.copySync(path.join(ROOT, 'scripts', 'tef-index-template.html'), path.join(ROOT, 'public', 'index.html'));

  if (!skipDeploy) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npmCmd, ['run', 'deploy:vercel'], process.env);
  }

  console.log('Full refresh complete.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
