const fs = require('fs');
const cheerio = require('cheerio');

const landing = fs.readFileSync(
  'd:/Desktop Current/Scraper - Copy/downloaded_site/quiz-deep-2026-06-07T13-05-25-044Z/0001_quiz_001_landing.html',
  'utf8',
);
const $ = cheerio.load(landing);
const urls = [];
$('form[action*="/mod/quiz/review.php"]').each((i, form) => {
  const attempt = $(form).find('[name="attempt"]').attr('value');
  const cmid = $(form).find('[name="cmid"]').attr('value');
  if (attempt && cmid) urls.push({ attempt, cmid });
});
console.log('review forms', urls.length, urls);
