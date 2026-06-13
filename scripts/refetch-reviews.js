const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const {
  collectReviewUrlsFromLandingHtml,
  countCorrectAnswersInHtml,
  findBestReviewExport,
  landingFileForQuiz,
  reviewFilesForQuiz,
  scoreReviewExport,
} = require('./review-utils');
const { ensureLoggedIn } = require('./tef-auth');
const { autoCompleteQuizAttempt } = require('./quiz-auto-complete');

const sourceDir = path.resolve(process.argv[2] || '');
const options = parseArgs(process.argv.slice(3));

if (!sourceDir || !fs.existsSync(sourceDir)) {
  console.error('Usage: node scripts/refetch-reviews.js <source-export-dir> [--headless] [--username x] [--password y] [--profile dir] [--only-missing]');
  process.exit(1);
}

const manifestPath = path.join(sourceDir, 'quiz_deep_manifest.json');
const manifest = fs.readJsonSync(manifestPath);
const supplementalRoot = path.join(sourceDir, '..');

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

async function main() {
  const targets = buildTargets();
  if (!targets.length) {
    console.log('All mocks already have full review answer keys.');
    return;
  }

  console.log(`Refetching review pages for ${targets.length} mock(s) with missing answer keys.`);

  const context = await launchContext();
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  await ensureLoggedIn(page, {
    username: options.username,
    password: options.password,
    profileDir: options.profileDir,
  });

  let updated = 0;
  for (const target of targets) {
    const landingPath = landingFileForQuiz(sourceDir, target.quizNo);
    if (!landingPath) {
      console.warn(`Skipping quiz ${target.quizNo}: landing page not found.`);
      continue;
    }

    await page.goto(`https://tefsuccess.ca/mod/quiz/view.php?id=${target.quizId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 0,
    });
    await page.waitForTimeout(1500);

    let reviewUrls = await collectReviewUrls(page);
    if (!reviewUrls.length) {
      const landingHtml = await fs.readFile(landingPath, 'utf8');
      reviewUrls = collectReviewUrlsFromLandingHtml(landingHtml);
    }

    if (!reviewUrls.length) {
      console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: no review attempts yet; auto-completing...`);
      const quizUrl = `https://tefsuccess.ca/mod/quiz/view.php?id=${target.quizId}`;
      if (await autoCompleteQuizAttempt(page, quizUrl, 80, context)) {
        await page.goto(quizUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForTimeout(3000);
        reviewUrls = await collectReviewUrls(page);
        for (const openPage of context.pages()) {
          const url = openPage.url();
          if (/review\.php/i.test(url) && url.includes(`cmid=${target.quizId}`)) reviewUrls.push(url);
        }
        reviewUrls = Array.from(new Set(reviewUrls));
      }
    }

    if (!reviewUrls.length) {
      console.warn(`Skipping quiz ${target.quizNo}: no review attempts found after auto-complete.`);
      continue;
    }

    let best = { url: reviewUrls[0], score: -1, pages: [] };
    for (const reviewUrl of reviewUrls) {
      const scored = await scoreLiveReviewAttempt(page, reviewUrl);
      console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: ${scored.score} answers from ${reviewUrl}`);
      if (scored.score > best.score) best = { url: reviewUrl, score: scored.score, pages: scored.pages };
    }

    if (best.score < 30) {
      console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: auto-completing attempt for answer keys...`);
      const quizUrl = `https://tefsuccess.ca/mod/quiz/view.php?id=${target.quizId}`;
      if (await autoCompleteQuizAttempt(page, quizUrl, 80, context)) {
        await page.goto(quizUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForTimeout(3000);
        reviewUrls = await collectReviewUrls(page);
        for (const openPage of context.pages()) {
          const url = openPage.url();
          if (/review\.php/i.test(url) && url.includes(`cmid=${target.quizId}`)) reviewUrls.push(url);
        }
        reviewUrls = Array.from(new Set(reviewUrls));
        for (const reviewUrl of reviewUrls) {
          const scored = await scoreLiveReviewAttempt(page, reviewUrl);
          console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: ${scored.score} answers after auto-complete from ${reviewUrl}`);
          if (scored.score > best.score) best = { url: reviewUrl, score: scored.score, pages: scored.pages };
        }
      }
    }

    if (best.score <= target.currentCount) {
      console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: live best (${best.score}) not better than local (${target.currentCount}).`);
      continue;
    }

    await writeReviewPages(target.quizNo, best.pages);
    updated += 1;
    console.log(`  quiz ${String(target.quizNo).padStart(3, '0')}: saved ${best.pages.length} review page(s) with ${best.score} answers.`);

    for (const openPage of context.pages()) {
      if (openPage !== page && !openPage.isClosed()) await openPage.close().catch(() => {});
    }
  }

  await context.close();
  console.log(`Updated ${updated} mock review export(s) in ${sourceDir}`);
}

function buildTargets() {
  const byQuiz = new Map();

  for (const pageEntry of manifest.pages) {
    const match = (pageEntry.htmlFile || '').match(/quiz_(\d+)_landing/i);
    if (!match) continue;
    const quizNo = Number(match[1]);
    const quizId = extractQuizId(pageEntry.url || pageEntry.htmlFile);
    const localScore = scoreReviewExport(sourceDir, quizNo).count;
    const bestScore = findBestReviewExport(supplementalRoot, quizNo, sourceDir).count;
    const currentCount = Math.max(localScore, bestScore);
    byQuiz.set(quizNo, {
      quizNo,
      quizId: extractQuizId(pageEntry.url) || byQuiz.get(quizNo)?.quizId || '',
      currentCount,
      questionTotal: inferQuestionTotal(quizNo),
    });
  }

  return [...byQuiz.values()]
    .filter((target) => !options.quizNos.length || options.quizNos.includes(target.quizNo))
    .filter((target) => !options.onlyMissing || target.currentCount < target.questionTotal)
    .filter((target) => !options.onlyMissing || target.currentCount < 30)
    .sort((a, b) => a.quizNo - b.quizNo);
}

function inferQuestionTotal(quizNo) {
  const reviewFiles = reviewFilesForQuiz(sourceDir, quizNo);
  if (!reviewFiles.length) return 40;
  const $ = cheerio.load(fs.readFileSync(reviewFiles[0], 'utf8'));
  const count = $('.que').length;
  return count || 40;
}

function extractQuizId(value) {
  const match = String(value || '').match(/[?&]id=(\d+)/i);
  return match ? match[1] : '';
}

async function launchContext() {
  const launchOptions = {
    channel: options.browserChannel,
    headless: options.headless,
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    args: [],
  };
  if (options.profileName) launchOptions.args.push(`--profile-directory=${options.profileName}`);
  if (options.profileDir) {
    await fs.ensureDir(options.profileDir);
    return chromium.launchPersistentContext(options.profileDir, launchOptions);
  }
  const browser = await chromium.launch({ headless: options.headless, channel: options.browserChannel });
  return browser.newContext(launchOptions);
}

async function collectReviewUrls(page) {
  const html = await page.content();
  return collectReviewUrlsFromLandingHtml(html);
}

async function scoreLiveReviewAttempt(page, reviewUrl) {
  let current = reviewUrl;
  const seen = new Set();
  const pages = [];
  let score = 0;

  for (let i = 0; i < 80; i += 1) {
    const key = normalizeUrl(current);
    if (seen.has(key)) break;
    seen.add(key);

    await page.goto(current, { waitUntil: 'domcontentloaded', timeout: 0 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    pages.push(html);
    score += countCorrectAnswersInHtml(html);

    const next = await nextReviewUrl(page);
    if (!next || normalizeUrl(next) === key) break;
    current = next;
  }

  return { score, pages };
}

async function nextReviewUrl(page) {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const next = anchors.find((anchor) => {
      const label = `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''} ${anchor.title || ''}`.toLowerCase();
      return anchor.href.includes('/mod/quiz/review.php') && /\bnext\b|next page|question\s+\d+/i.test(label) && !anchor.classList.contains('thispage');
    });
    if (next) return next.href;

    const current = document.querySelector('.qnbutton.thispage');
    if (!current) return null;
    const currentPage = Number(current.getAttribute('data-quiz-page') || '0');
    const byPage = anchors.find((anchor) => anchor.href.includes('/mod/quiz/review.php') && Number(anchor.getAttribute('data-quiz-page') || '-1') === currentPage + 1);
    return byPage ? byPage.href : null;
  }).catch(() => null);
}

async function writeReviewPages(quizNo, pages) {
  const landingName = fs.readdirSync(sourceDir).find((name) => name.includes(`quiz_${String(quizNo).padStart(3, '0')}_landing`));
  const landingNo = landingName ? Number(landingName.match(/^(\d+)_/)[1]) : quizNo;

  for (const filePath of reviewFilesForQuiz(sourceDir, quizNo)) {
    await fs.remove(filePath);
  }

  for (let i = 0; i < pages.length; i += 1) {
    const fileNo = landingNo + 1 + i;
    const fileName = `${String(fileNo).padStart(4, '0')}_quiz_${String(quizNo).padStart(3, '0')}_review_${String(i + 1).padStart(3, '0')}.html`;
    await fs.writeFile(path.join(sourceDir, fileName), pages[i], 'utf8');
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '');
  }
}

function parseArgs(args) {
  const parsed = {
    headless: false,
    browserChannel: 'chrome',
    profileDir: process.env.TEF_PROFILE_DIR || '',
    profileName: process.env.TEF_PROFILE_NAME || 'Default',
    username: process.env.TEF_USERNAME || '',
    password: process.env.TEF_PASSWORD || '',
    onlyMissing: true,
    quizNos: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--headless') parsed.headless = true;
    else if (arg === '--all') parsed.onlyMissing = false;
    else if (arg === '--username') parsed.username = args[++i] || '';
    else if (arg === '--password') parsed.password = args[++i] || '';
    else if (arg === '--profile') parsed.profileDir = path.resolve(args[++i] || '');
    else if (arg === '--profile-name') parsed.profileName = args[++i] || '';
    else if (arg === '--quiz') parsed.quizNos = String(args[++i] || '').split(/[,\s]+/).map(Number).filter(Boolean);
  }

  return parsed;
}
