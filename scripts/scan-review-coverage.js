const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.resolve(process.argv[2] || 'downloaded_site');
const dirs = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('quiz-deep-'))
  .map((entry) => path.join(root, entry.name));

function countRightAnswers(html) {
  const $ = cheerio.load(html);
  let count = 0;
  $('.que').each((_, element) => {
    const question = $(element);
    if (question.find('.rightanswer').text().trim()) count += 1;
    else if (question.find('.answer .correct').length) count += 1;
  });
  return count;
}

function scanDir(exportDir) {
  const files = fs.readdirSync(exportDir).filter((name) => /_review_\d+\.html$/i.test(name));
  const byQuiz = new Map();
  for (const file of files) {
    const match = file.match(/quiz_(\d+)_review_/i);
    if (!match) continue;
    const quizIndex = Number(match[1]);
    const html = fs.readFileSync(path.join(exportDir, file), 'utf8');
    const count = countRightAnswers(html);
    const current = byQuiz.get(quizIndex);
    if (!current || count > current.count) {
      byQuiz.set(quizIndex, { count, file, exportDir: path.basename(exportDir) });
    }
  }
  return byQuiz;
}

const best = new Map();
for (const dir of dirs) {
  const coverage = scanDir(dir);
  for (const [quizIndex, info] of coverage.entries()) {
    const current = best.get(quizIndex);
    if (!current || info.count > current.count) best.set(quizIndex, info);
  }
}

console.log('Best review coverage across exports:');
for (const [quizIndex, info] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`quiz ${String(quizIndex).padStart(3, '0')}: ${info.count} answers (${info.exportDir}/${info.file})`);
}
