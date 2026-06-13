const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.join(__dirname, '..', 'downloaded_site');
const dirs = fs.readdirSync(root).filter((name) => name.startsWith('quiz-deep-')).slice(-5);

for (const dir of dirs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, dir, 'quiz_deep_manifest.json'), 'utf8'));
  for (const mockNum of [1, 2]) {
    const review = manifest.pages.find((page) => /review/i.test(page.htmlFile || '') && new RegExp(`quiz_0*${mockNum}_`, 'i').test(page.htmlFile || ''));
    if (!review) continue;
    const html = fs.readFileSync(path.join(root, dir, review.htmlFile), 'utf8');
    const $ = cheerio.load(html);
    let withRight = 0;
    let withCorrectClass = 0;
    $('.que').each((i, el) => {
      if ($(el).find('.rightanswer').text().trim()) withRight += 1;
      if ($(el).find('.answer .correct, .answer [class*="correct"]').length) withCorrectClass += 1;
    });
    console.log(dir, `mock_${mockNum}`, review.htmlFile, 'questions', $('.que').length, 'rightanswer', withRight, 'correctClass', withCorrectClass);
  }
}
