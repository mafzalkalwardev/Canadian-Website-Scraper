const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function countCorrectAnswersInHtml(html) {
  const $ = cheerio.load(html);
  let count = 0;
  $('.que').each((_, element) => {
    const question = $(element);
    if (question.find('.rightanswer').text().trim()) count += 1;
    else if (question.find('.answer .correct').length) count += 1;
  });
  return count;
}

function listQuizDeepExports(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('quiz-deep-'))
    .map((entry) => path.join(rootDir, entry.name));
}

function reviewFilesForQuiz(exportDir, quizNo) {
  const prefix = `_quiz_${String(quizNo).padStart(3, '0')}_review_`;
  return fs.readdirSync(exportDir)
    .filter((name) => name.includes(prefix) && name.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(exportDir, name));
}

function scoreReviewExport(exportDir, quizNo) {
  const files = reviewFilesForQuiz(exportDir, quizNo);
  if (!files.length) return { count: 0, files: [] };
  const count = files.reduce((total, filePath) => total + countCorrectAnswersInHtml(fs.readFileSync(filePath, 'utf8')), 0);
  return { count, files };
}

function findBestReviewExport(rootDir, quizNo, preferredDir) {
  const exports = listQuizDeepExports(rootDir);
  let best = { count: 0, files: [], exportDir: preferredDir || '' };

  for (const exportDir of exports) {
    const scored = scoreReviewExport(exportDir, quizNo);
    if (scored.count > best.count) {
      best = { ...scored, exportDir };
    }
  }

  return best;
}

function collectReviewUrlsFromLandingHtml(html) {
  const $ = cheerio.load(html);
  const urls = [];
  $('form[action*="/mod/quiz/review.php"]').each((_, form) => {
    const attempt = $(form).find('[name="attempt"]').attr('value');
    const cmid = $(form).find('[name="cmid"]').attr('value');
    if (attempt && cmid) {
      urls.push(`https://tefsuccess.ca/mod/quiz/review.php?attempt=${encodeURIComponent(attempt)}&cmid=${encodeURIComponent(cmid)}`);
    }
  });
  $('a[href*="/mod/quiz/review.php"]').each((_, anchor) => {
    const href = String($(anchor).attr('href') || '').replace(/&amp;/g, '&');
    if (!href) return;
    urls.push(href.startsWith('http') ? href : `https://tefsuccess.ca${href.startsWith('/') ? '' : '/'}${href}`);
  });
  const script = $('script').map((_, el) => $(el).html() || '').get().join('\n').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  for (const match of script.matchAll(/https:\/\/tefsuccess\.ca\/mod\/quiz\/review\.php\?attempt=\d+&cmid=\d+/gi)) {
    urls.push(match[0]);
  }
  return Array.from(new Set(urls));
}

function landingFileForQuiz(exportDir, quizNo) {
  const exact = path.join(exportDir, `0001_quiz_${String(quizNo).padStart(3, '0')}_landing.html`);
  if (fs.existsSync(exact)) return exact;
  const match = fs.readdirSync(exportDir).find((name) => new RegExp(`quiz_${String(quizNo).padStart(3, '0')}_landing\\.html$`, 'i').test(name));
  return match ? path.join(exportDir, match) : '';
}

module.exports = {
  countCorrectAnswersInHtml,
  listQuizDeepExports,
  reviewFilesForQuiz,
  scoreReviewExport,
  findBestReviewExport,
  collectReviewUrlsFromLandingHtml,
  landingFileForQuiz,
};
