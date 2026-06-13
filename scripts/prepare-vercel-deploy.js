const fs = require('fs-extra');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const coursePath = path.join(ROOT, 'public', 'data', 'course.json');
const backupPath = path.join(ROOT, 'public', 'data', 'course.local.json');

function toRemoteUrl(value) {
  if (!value || typeof value !== 'string') return value;
  const gcpPrefix = 'assets/source/storage.googleapis.com/';
  if (value.includes(gcpPrefix)) {
    return value.split(gcpPrefix).join('https://storage.googleapis.com/').replace(/%2520/g, '%20').replace(/%252/g, '%2');
  }
  const tefPrefix = 'assets/source/tefcanada.ca/';
  if (value.includes(tefPrefix)) {
    return value.split(tefPrefix).join('https://tefcanada.ca/');
  }
  return value;
}

function rewriteAssets(node) {
  if (typeof node === 'string') {
    return toRemoteUrl(node);
  }

  if (Array.isArray(node)) {
    return node.map(rewriteAssets);
  }

  if (!node || typeof node !== 'object') return node;

  for (const key of Object.keys(node)) {
    node[key] = rewriteAssets(node[key]);
  }
  return node;
}

async function main() {
  const restore = process.argv.includes('--restore');
  if (restore) {
    if (!(await fs.pathExists(backupPath))) {
      console.log('No local course backup found.');
      return;
    }
    await fs.copy(backupPath, coursePath, { overwrite: true });
    console.log('Restored local course.json from backup.');
    return;
  }

  const course = await fs.readJson(coursePath);
  if (!(await fs.pathExists(backupPath))) {
    await fs.writeJson(backupPath, course);
    console.log('Saved local course backup.');
  }

  rewriteAssets(course);
  await fs.writeJson(coursePath, course);
  console.log('Rewrote course.json asset URLs for Vercel deploy.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
