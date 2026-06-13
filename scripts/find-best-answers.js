const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.join(__dirname, '..', 'downloaded_site');
const dirs = fs.readdirSync(root).filter((name) => name.startsWith('quiz-deep-'));

let best = null;
for (const dir of dirs) {
  const manifestPath = path.join(root, dir, 'quiz_deep_manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const mockNum of [1, 22]) {
    const review = manifest.pages.find((page) => /review/i.test(page.htmlFile || '') && new RegExp(`quiz_0*${mockNum}_`, 'i').test(page.htmlFile || ''));
    if (!review) continue;
    const htmlPath = path.join(root, dir, review.htmlFile);
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const $ = cheerio.load(html);
    let withRight = 0;
    $('.que').each((i, el) => {
      if ($(el).find('.rightanswer').text().trim()) withRight += 1;
    });
    if (!best || withRight > best.withRight) {
      best = { dir, mockNum, file: review.htmlFile, withRight, total: $('.que').length };
    }
    if (withRight > 0) {
      console.log('FOUND', dir, `mock_${mockNum}`, withRight, '/', $('.que').length, review.htmlFile);
    }
  }
}

console.log('Best overall:', best);
