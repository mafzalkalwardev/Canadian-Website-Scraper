const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');

const options = parseArgs(process.argv.slice(2));
const startUrl = options.url || 'https://tefsuccess.ca/course/view.php?id=2';
const OUTPUT_ROOT = path.join(__dirname, 'downloaded_site');
const OUTPUT_DIR = path.join(OUTPUT_ROOT, `quiz-deep-${timestampName()}`);
const MAX_QUIZZES = Math.max(1, Number(options.maxQuizzes || 250));
const MAX_PAGES_PER_QUIZ = Math.max(1, Number(options.maxPagesPerQuiz || 80));

let context;
let page;
let savedCount = 0;
const downloaded = new Map();
const savedPages = [];
const urlToFile = new Map();

main().catch(async (err) => {
  emit('error', err.stack || err.message || String(err));
  await shutdown(1);
});

async function main() {
  await fs.ensureDir(OUTPUT_DIR);
  context = await launchContext();
  page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  emit('state', { outputDir: OUTPUT_DIR, currentUrl: startUrl });
  emit('log', `Opening ${startUrl}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 0 });

  const text = await bodyText(page);
  if (/You are currently using guest access|Log in/i.test(text) && !/Log out|You are logged in as/i.test(text)) {
    if (options.username && options.password) {
      await login(page);
    } else {
      emit('log', 'Login is needed. Use the opened browser to sign in; scraping will resume automatically.');
      await waitForLogin(page);
    }
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
  }

  let quizUrls = await discoverQuizUrls(page);
  if (options.quizIds.length) {
    const allowed = new Set(options.quizIds);
    quizUrls = quizUrls.filter((quizUrl) => allowed.has(new URL(quizUrl).searchParams.get('id')));
    emit('log', `Filtered to ${quizUrls.length} requested quiz landing page(s): ${options.quizIds.join(', ')}`);
  }
  emit('log', `Discovered ${quizUrls.length} quiz landing page(s).`);

  let quizIndex = 0;
  for (const quizUrl of quizUrls.slice(0, MAX_QUIZZES)) {
    quizIndex += 1;
    emit('log', `Quiz ${quizIndex}/${Math.min(quizUrls.length, MAX_QUIZZES)}: ${quizUrl}`);
    await scrapeQuiz(quizUrl, quizIndex).catch((err) => emit('error', `Quiz failed ${quizUrl}: ${err.message || err}`));
  }

  await rewriteLinks();
  await writeIndex();
  await writeManifest();
  await shutdown(0);
}

async function launchContext() {
  const launchOptions = {
    channel: options.browserChannel || 'chrome',
    headless: !!options.headless,
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    args: [],
  };
  if (options.profileName) launchOptions.args.push(`--profile-directory=${options.profileName}`);
  if (options.profileDir) {
    await fs.ensureDir(options.profileDir);
    emit('log', `Using persistent profile: ${options.profileDir}`);
    return chromium.launchPersistentContext(options.profileDir, launchOptions);
  }
  const browser = await chromium.launch({ headless: !!options.headless });
  return browser.newContext(launchOptions);
}

async function waitForLogin(targetPage) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await targetPage.waitForTimeout(3000);
    emit('state', { currentUrl: targetPage.url() });
    const text = await bodyText(targetPage);
    if (/Log out|You are logged in as|My courses/i.test(text) && !/You are currently using guest access/i.test(text)) {
      emit('log', 'Login detected.');
      return;
    }
  }
  throw new Error('Timed out waiting for login.');
}

async function login(targetPage) {
  emit('log', 'Signing in with supplied credentials.');
  if (!/\/login\/index\.php/i.test(targetPage.url())) {
    await targetPage.goto('https://tefsuccess.ca/login/index.php', { waitUntil: 'domcontentloaded', timeout: 0 });
  }
  await targetPage.locator('input[name="username"], #username').first().fill(options.username);
  await targetPage.locator('input[name="password"], #password').first().fill(options.password);
  await Promise.all([
    targetPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
    targetPage.locator('button[type="submit"], input[type="submit"], #loginbtn').first().click(),
  ]);
  await targetPage.waitForFunction(() => {
    const text = document.body ? document.body.innerText : '';
    return /Log out|You are logged in as|My courses/i.test(text) || /Invalid login|Log in to the site/i.test(text);
  }, { timeout: 15000 }).catch(() => {});
  await targetPage.waitForTimeout(1000);
  const text = await bodyText(targetPage);
  if (!/Log out|You are logged in as|My courses/i.test(text) || /Invalid login|Log in to the site/i.test(text)) {
    throw new Error('Login did not reach an authenticated page.');
  }
  emit('log', 'Login succeeded.');
}

async function discoverQuizUrls(sourcePage) {
  await settle(sourcePage);
  const html = await sourcePage.content();
  const $ = cheerio.load(html);
  const urls = new Set();

  const add = (value) => {
    try {
      const url = new URL(value, sourcePage.url());
      url.hash = '';
      url.searchParams.delete('forceview');
      if (url.hostname === new URL(startUrl).hostname && /\/mod\/quiz\/view\.php$/i.test(url.pathname) && url.searchParams.get('id')) {
        urls.add(url.href);
      }
    } catch {}
  };

  $('a[href], option[value]').each((i, el) => add($(el).attr('href') || $(el).attr('value')));

  const scriptText = $('script').map((i, el) => $(el).html() || '').get().join('\n').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  for (const match of scriptText.matchAll(/\/mod\/quiz\/view\.php\?id=\d+/gi)) add(match[0]);

  return Array.from(urls);
}

async function scrapeQuiz(quizUrl, quizIndex) {
  await page.goto(quizUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
  await settle(page);
  await saveCurrentPage(`quiz_${String(quizIndex).padStart(3, '0')}_landing`);

  const reviewUrls = await collectReviewUrls(page);
  if (reviewUrls.length) {
    emit('log', `Found ${reviewUrls.length} review attempt(s); scraping latest review.`);
    await scrapeReview(reviewUrls[0], quizIndex);
    return;
  }

  const entered = await enterQuizAttempt(page);
  if (!entered) {
    emit('log', `No attempt/continue button found for ${quizUrl}; landing page saved only.`);
    return;
  }

  const attemptUrls = await collectAttemptQuestionUrls(page);
  if (attemptUrls.length > 1) {
    emit('log', `Found ${attemptUrls.length} question navigation page(s); scraping in page order.`);
    for (let i = 0; i < Math.min(attemptUrls.length, MAX_PAGES_PER_QUIZ); i += 1) {
      await page.goto(attemptUrls[i], { waitUntil: 'domcontentloaded', timeout: 0 });
      await settle(page);
      await saveCurrentPage(`quiz_${String(quizIndex).padStart(3, '0')}_question_${String(i + 1).padStart(3, '0')}`);
    }
    if (attemptUrls.length > MAX_PAGES_PER_QUIZ) emit('error', `Quiz page limit reached for ${quizUrl}`);
    return;
  }

  for (let i = 1; i <= MAX_PAGES_PER_QUIZ; i += 1) {
    await settle(page);
    const currentUrl = page.url();
    if (/summary\.php|finishattempt\.php/i.test(currentUrl)) {
      emit('log', `Reached quiz summary; stopping before final submit: ${currentUrl}`);
      await saveCurrentPage(`quiz_${String(quizIndex).padStart(3, '0')}_summary`);
      return;
    }

    await saveCurrentPage(`quiz_${String(quizIndex).padStart(3, '0')}_question_${String(i).padStart(3, '0')}`);
    const moved = await clickNextQuestion(page);
    if (!moved) {
      emit('log', `No safe next button found; finished quiz capture at ${currentUrl}`);
      return;
    }
  }

  emit('error', `Quiz page limit reached for ${quizUrl}`);
}

async function collectAttemptQuestionUrls(targetPage) {
  return targetPage.evaluate(() => {
    const urls = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a.qnbutton[href], .qn_buttons a[href]'));
    for (const anchor of anchors) {
      if (!/\/mod\/quiz\/attempt\.php/i.test(anchor.href || '')) continue;
      const url = new URL(anchor.href);
      url.hash = '';
      const pageValue = Number(anchor.getAttribute('data-quiz-page') || url.searchParams.get('page') || '0');
      const key = url.href;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push({ url: key, page: Number.isFinite(pageValue) ? pageValue : 0 });
    }
    return urls.sort((a, b) => a.page - b.page).map((item) => item.url);
  }).catch(() => []);
}

async function collectReviewUrls(targetPage) {
  const html = await targetPage.content();
  const $ = cheerio.load(html);
  const urls = [];
  $('form[action*="/mod/quiz/review.php"]').each((i, form) => {
    const attempt = $(form).find('[name="attempt"]').attr('value');
    const cmid = $(form).find('[name="cmid"]').attr('value');
    if (attempt && cmid) urls.push(`https://tefsuccess.ca/mod/quiz/review.php?attempt=${encodeURIComponent(attempt)}&cmid=${encodeURIComponent(cmid)}`);
  });
  const script = $('script').map((i, el) => $(el).html() || '').get().join('\n').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  for (const match of script.matchAll(/https:\/\/tefsuccess\.ca\/mod\/quiz\/review\.php\?attempt=\d+&cmid=\d+/gi)) urls.push(match[0]);
  return Array.from(new Set(urls));
}

async function scrapeReview(reviewUrl, quizIndex) {
  let current = reviewUrl;
  for (let i = 1; i <= MAX_PAGES_PER_QUIZ; i += 1) {
    await page.goto(current, { waitUntil: 'domcontentloaded', timeout: 0 });
    await settle(page);
    await saveCurrentPage(`quiz_${String(quizIndex).padStart(3, '0')}_review_${String(i).padStart(3, '0')}`);

    const next = await nextReviewUrl(page);
    if (!next || normalizeUrl(next) === normalizeUrl(current)) return;
    current = next;
  }
  emit('error', `Review page limit reached for ${reviewUrl}`);
}

async function nextReviewUrl(targetPage) {
  return targetPage.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const next = anchors.find((a) => {
      const label = `${a.textContent || ''} ${a.getAttribute('aria-label') || ''} ${a.title || ''}`.toLowerCase();
      return a.href.includes('/mod/quiz/review.php') && /\bnext\b|next page|question\s+\d+/i.test(label) && !a.classList.contains('thispage');
    });
    if (next) return next.href;

    const current = document.querySelector('.qnbutton.thispage');
    if (!current) return null;
    const currentPage = Number(current.getAttribute('data-quiz-page') || '0');
    const byPage = anchors.find((a) => a.href.includes('/mod/quiz/review.php') && Number(a.getAttribute('data-quiz-page') || '-1') === currentPage + 1);
    return byPage ? byPage.href : null;
  }).catch(() => null);
}

async function enterQuizAttempt(targetPage) {
  const selectors = [
    '.quizstartbuttondiv button[type="submit"]',
    '.quizstartbuttondiv input[type="submit"]',
    'form[action*="/mod/quiz/attempt.php"] button[type="submit"]',
    'input[type="submit"][value*="Continue"]',
    'input[type="submit"][value*="Attempt"]',
    'input[type="submit"][value*="Re-attempt"]',
    'button:has-text("Continue")',
    'button:has-text("Attempt quiz")',
    'button:has-text("Re-attempt quiz")',
    'a:has-text("Continue")',
    'a:has-text("Attempt quiz")',
  ];

  for (const selector of selectors) {
    const locator = targetPage.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    emit('log', `Clicking quiz entry control: ${selector}`);
    await Promise.all([
      targetPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await targetPage.waitForTimeout(1500);
    await clickStartPopupIfPresent(targetPage);
    await targetPage.waitForTimeout(1500);
    const attemptPage = await waitForAttemptPage(targetPage);
    if (attemptPage) {
      page = attemptPage;
      return true;
    }
    const entered = /\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(targetPage.url());
    if (entered) return true;
    emit('log', `Entry click did not enter attempt yet; still at ${targetPage.url()}`);
  }

  await clickStartPopupIfPresent(targetPage);
  if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(targetPage.url())) return true;
  const attemptPage = await waitForAttemptPage(targetPage);
  if (attemptPage) {
    page = attemptPage;
    return true;
  }
  const submitted = await submitQuizStartForm(targetPage);
  if (submitted) return true;
  const submittedAttemptPage = await waitForAttemptPage(targetPage);
  if (submittedAttemptPage) {
    page = submittedAttemptPage;
    return true;
  }
  return false;
}

async function clickStartPopupIfPresent(targetPage) {
  const popupSelectors = [
    'input[type="submit"][value*="Start attempt"]',
    'button:has-text("Start attempt")',
    '.modal-dialog button:has-text("Start")',
    '.modal-dialog input[type="submit"]',
  ];
  for (const selector of popupSelectors) {
    const locator = targetPage.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    emit('log', `Confirming quiz start popup: ${selector}`);
    await Promise.all([
      targetPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await targetPage.waitForTimeout(2000);
    return true;
  }
  return false;
}

async function waitForAttemptPage(sourcePage) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const candidate of context.pages()) {
      if (candidate.isClosed() || candidate === sourcePage) continue;
      await candidate.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await candidate.waitForTimeout(250).catch(() => {});
      if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(candidate.url())) {
        emit('log', `Using quiz attempt window: ${candidate.url()}`);
        await candidate.bringToFront().catch(() => {});
        return candidate;
      }
    }
    await sourcePage.waitForTimeout(500);
  }
  return null;
}

async function submitQuizStartForm(targetPage) {
  const formPayload = await targetPage.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    const form = forms.find((item) => item.id === 'mod_quiz_preflight_form')
      || forms.find((item) => /\/mod\/quiz\/startattempt\.php/i.test(item.action || ''))
      || forms.find((item) => /\/mod\/quiz\/attempt\.php/i.test(item.action || ''));
    if (!form) return null;

    const data = {};
    for (const input of Array.from(form.querySelectorAll('input, button'))) {
      const name = input.getAttribute('name');
      if (!name || name === 'cancel') continue;
      if (input.getAttribute('type') === 'checkbox') {
        input.checked = true;
        input.setAttribute('checked', 'checked');
      }
      data[name] = input.getAttribute('value') || '';
    }
    if (/\/mod\/quiz\/startattempt\.php/i.test(form.action || '')) data.submitbutton = data.submitbutton || 'Start attempt';
    return { action: form.action, data };
  }).catch(() => null);

  if (!formPayload) return false;

  if (/\/mod\/quiz\/startattempt\.php/i.test(formPayload.action || '')) {
    const response = await context.request.post(formPayload.action, { form: formPayload.data, timeout: 30000 }).catch((err) => {
      emit('error', `Start attempt POST failed: ${err.message || err}`);
      return null;
    });
    if (response) {
      const html = await response.text().catch(() => '');
      const attemptUrl = extractAttemptUrl(html, targetPage.url());
      if (attemptUrl) {
        emit('log', `Opening quiz attempt URL from Moodle response: ${attemptUrl}`);
        await targetPage.goto(attemptUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await settle(targetPage);
        return /\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(targetPage.url());
      }
    }
  }

  const submitted = await targetPage.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    const form = forms.find((item) => /\/mod\/quiz\/attempt\.php/i.test(item.action || ''));
    if (!form) return false;

    for (const checkbox of Array.from(form.querySelectorAll('input[type="checkbox"]'))) {
      checkbox.checked = true;
      checkbox.setAttribute('checked', 'checked');
    }

    const submit = form.querySelector('[name="submitbutton"], button[type="submit"], input[type="submit"]');
    if (submit && typeof submit.click === 'function') {
      submit.click();
    } else if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
    return true;
  }).catch(() => false);

  if (!submitted) return false;
  emit('log', 'Submitted Moodle quiz start form directly.');
  await targetPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await targetPage.waitForTimeout(2500);
  return /\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(targetPage.url());
}

function extractAttemptUrl(html, baseUrl) {
  const decoded = String(html || '').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  const absolute = decoded.match(/https:\/\/tefsuccess\.ca\/mod\/quiz\/attempt\.php\?attempt=\d+&cmid=\d+/i);
  if (absolute) return absolute[0];
  const relative = decoded.match(/\/mod\/quiz\/attempt\.php\?attempt=\d+&cmid=\d+/i);
  if (relative) return new URL(relative[0], baseUrl).href;
  const cmidOnly = decoded.match(/(?:https:\/\/tefsuccess\.ca)?\/mod\/quiz\/attempt\.php\?cmid=\d+/i);
  if (cmidOnly) return new URL(cmidOnly[0], baseUrl).href;
  const summary = decoded.match(/(?:https:\/\/tefsuccess\.ca)?\/mod\/quiz\/summary\.php\?attempt=(\d+)&cmid=(\d+)/i);
  if (summary) return new URL(`/mod/quiz/attempt.php?attempt=${summary[1]}&cmid=${summary[2]}`, baseUrl).href;
  return null;
}

async function clickNextQuestion(targetPage) {
  const unsafeText = /submit all|finish attempt|submit and finish/i;
  const candidates = [
    'input[type="submit"][name="next"]',
    'input[type="submit"][value*="Next"]',
    'button:has-text("Next page")',
    'button:has-text("Next")',
    'a:has-text("Next")',
  ];
  for (const selector of candidates) {
    const locator = targetPage.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    const label = await locator.evaluate((el) => `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`).catch(() => '');
    if (unsafeText.test(label)) continue;
    emit('log', `Next question: ${label.trim() || selector}`);
    const before = targetPage.url();
    await Promise.all([
      targetPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await targetPage.waitForTimeout(1500);
    return targetPage.url() !== before || true;
  }
  return false;
}

async function saveCurrentPage(nameBase) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const html = await page.content();
  const text = await bodyText(page);
  const $ = cheerio.load(html, { decodeEntities: false });

  const assets = collectAssets($, url);
  for (const asset of assets) {
    const local = await downloadAsset(asset.url);
    if (!local) continue;
    asset.relativePath = localHref(path.relative(OUTPUT_DIR, local.absolutePath));
    rewriteAssetReference($, asset);
  }
  prepareOfflineReplica($);

  savedCount += 1;
  const safeBase = `${String(savedCount).padStart(4, '0')}_${safeFileName(nameBase)}`;
  const htmlFile = `${safeBase}.html`;
  const textFile = `${safeBase}.txt`;
  const screenshotFile = `${safeBase}.png`;
  const htmlPath = path.join(OUTPUT_DIR, htmlFile);

  await fs.writeFile(htmlPath, $.html());
  await fs.writeFile(path.join(OUTPUT_DIR, textFile), text);
  const screenshotOk = await page.screenshot({ path: path.join(OUTPUT_DIR, screenshotFile), fullPage: true, timeout: 120000 }).then(() => true).catch((err) => {
    emit('error', `Screenshot skipped for ${url}: ${err.message || err}`);
    return false;
  });

  urlToFile.set(normalizeUrl(url), htmlFile);
  savedPages.push({
    title,
    url,
    htmlFile,
    textFile,
    screenshotFile: screenshotOk ? screenshotFile : null,
    assetCount: assets.filter((asset) => asset.relativePath).length,
  });
  emit('page', { url, title, outputDir: OUTPUT_DIR, htmlFile: htmlPath, textFile: path.join(OUTPUT_DIR, textFile), assetCount: assets.filter((asset) => asset.relativePath).length });
}

function collectAssets($, baseUrl) {
  const assets = [];
  const seen = new Set();
  const add = (type, raw, selector, attr, original = raw) => {
    const absolute = toAbsoluteUrl(raw, baseUrl);
    if (!absolute || seen.has(`${selector}|${attr}|${absolute}`)) return;
    seen.add(`${selector}|${attr}|${absolute}`);
    assets.push({ type, url: absolute, selector, attr, original });
  };

  $('[src]').each((i, el) => add(tagType(el), $(el).attr('src'), domSelector(el, i), 'src'));
  $('link[href], a[download][href]').each((i, el) => add(tagType(el), $(el).attr('href'), domSelector(el, i), 'href'));
  $('[poster]').each((i, el) => add('poster', $(el).attr('poster'), domSelector(el, i), 'poster'));
  $('object[data], embed[src]').each((i, el) => add(tagType(el), $(el).attr('data') || $(el).attr('src'), domSelector(el, i), $(el).attr('data') ? 'data' : 'src'));
  $('[srcset]').each((i, el) => parseSrcset($(el).attr('srcset')).forEach((item) => add('srcset', item.url, domSelector(el, i), 'srcset', item.url)));
  $('[data-src], [data-original], [data-lazy-src], [data-fullurl], [data-background], [data-bg], [data-background-image]').each((i, el) => {
    for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-fullurl', 'data-background', 'data-bg', 'data-background-image']) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      if (attr === 'data-src' || attr === 'data-lazy-src') add(tagType(el), raw, domSelector(el, i), attr);
      else add('image', raw, domSelector(el, i), attr);
    }
  });
  $('[data-srcset]').each((i, el) => parseSrcset($(el).attr('data-srcset')).forEach((item) => add('srcset', item.url, domSelector(el, i), 'data-srcset', item.url)));
  $('[style]').each((i, el) => extractCssUrls($(el).attr('style')).forEach((cssUrl) => add('inline-style', cssUrl, domSelector(el, i), 'style', cssUrl)));
  $('style').each((i, el) => extractCssUrls($(el).html() || '').forEach((cssUrl) => add('style-block', cssUrl, domSelector(el, i), 'style-block', cssUrl)));
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (/\/(?:pluginfile|draftfile)\.php\//i.test(String(href || ''))) add('file', href, domSelector(el, i), 'href');
  });
  return assets;
}

async function downloadAsset(url) {
  if (downloaded.has(url)) return downloaded.get(url);
  try {
    const parsed = new URL(url);
    const response = await context.request.get(url, { timeout: 45000, maxRedirects: 5 });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const headers = response.headers();
    const contentType = String(headers['content-type'] || '').split(';')[0].trim();
    const extension = extensionFor(parsed, contentType, String(headers['content-disposition'] || ''));
    const relative = path.join('assets', safeFileName(parsed.hostname), safePath(assetPathname(parsed, extension), extension));
    const absolutePath = uniquePath(path.join(OUTPUT_DIR, relative));
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, Buffer.from(await response.body()));
    const result = { absolutePath, contentType };
    downloaded.set(url, result);
    await rewriteCssAsset(absolutePath, url, contentType);
    return result;
  } catch (err) {
    emit('error', `Failed asset: ${url} (${err.message || err})`);
    downloaded.set(url, null);
    return null;
  }
}

function rewriteAssetReference($, asset) {
  const el = $(asset.selector);
  if (!el.length || !asset.relativePath) return;
  if ((asset.attr === 'src' || asset.attr === 'href') && /^(script|link)$/i.test(el.prop('tagName') || '')) {
    el.removeAttr('integrity crossorigin referrerpolicy');
  }
  if (asset.attr === 'style') el.attr('style', replaceAllLiteral(String(el.attr('style') || ''), asset.original, asset.relativePath));
  else if (asset.attr === 'style-block') el.text(replaceAllLiteral(String(el.html() || ''), asset.original, asset.relativePath));
  else if (asset.attr === 'srcset' || asset.attr === 'data-srcset') el.attr(asset.attr, replaceAllLiteral(String(el.attr(asset.attr) || ''), asset.original, asset.relativePath));
  else el.attr(asset.attr, asset.relativePath);
}

function prepareOfflineReplica($) {
  $('audio, video').each((i, el) => {
    const node = $(el);
    node.attr('controls', 'controls');
    node.attr('preload', 'metadata');
    node.removeAttr('autoplay');
  });
  $('script').remove();
  $('[onclick], [onload], [onerror], [onmouseover], [onmouseout], [onchange], [onsubmit]').each((i, el) => {
    for (const attr of Object.keys(el.attribs || {})) {
      if (/^on/i.test(attr)) $(el).removeAttr(attr);
    }
  });
}

async function rewriteLinks() {
  for (const item of savedPages) {
    const htmlPath = path.join(OUTPUT_DIR, item.htmlFile);
    const $ = cheerio.load(await fs.readFile(htmlPath, 'utf8'), { decodeEntities: false });
    let changed = false;
    $('a[href], form[action]').each((i, el) => {
      const attr = el.name === 'form' ? 'action' : 'href';
      const absolute = normalizeUrl(new URL($(el).attr(attr), item.url).href);
      const local = urlToFile.get(absolute);
      if (!local) return;
      $(el).attr(attr, local);
      changed = true;
    });
    if (changed) await fs.writeFile(htmlPath, $.html());
  }
}

async function writeIndex() {
  const rows = savedPages.map((item, index) => `<article>
    <h2>${index + 1}. ${escapeHtml(item.title || item.url)}</h2>
    <p><a href="${escapeAttr(item.htmlFile)}">${escapeHtml(item.url)}</a></p>
    <div class="links"><a href="${escapeAttr(item.htmlFile)}">HTML</a><a href="${escapeAttr(item.textFile)}">Text</a>${item.screenshotFile ? `<a href="${escapeAttr(item.screenshotFile)}">Screenshot</a>` : ''}</div>
    <p>${item.assetCount} assets downloaded.</p>
  </article>`).join('');
  await fs.writeFile(path.join(OUTPUT_DIR, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEF Quiz Deep Replica</title><style>body{font-family:Arial,sans-serif;margin:0;background:#f6f7f9;color:#172331}header{padding:24px 32px;background:#fff;border-bottom:1px solid #d8e0ea}main{max-width:1100px;margin:0 auto;padding:20px}article{background:#fff;border:1px solid #d8e0ea;border-radius:8px;padding:16px;margin:12px 0}.links{display:flex;gap:10px;flex-wrap:wrap}.links a{border:1px solid #b8c4d1;border-radius:6px;padding:7px 9px;text-decoration:none}</style></head><body><header><h1>TEF Quiz Deep Replica</h1><p>${savedPages.length} saved quiz/course pages. Open pages from here for offline reading.</p></header><main>${rows}</main></body></html>`);
}

async function writeManifest() {
  await fs.writeJson(path.join(OUTPUT_DIR, 'quiz_deep_manifest.json'), {
    startUrl,
    capturedAt: new Date().toISOString(),
    pageCount: savedPages.length,
    pages: savedPages,
  }, { spaces: 2 });
}

async function shutdown(code) {
  await writeIndex().catch(() => {});
  await writeManifest().catch(() => {});
  emit('log', `Finished. Open this file: ${path.join(OUTPUT_DIR, 'index.html')}`);
  if (context) await context.close().catch(() => {});
  process.exit(code);
}

async function settle(targetPage) {
  await targetPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await targetPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

async function bodyText(targetPage) {
  return targetPage.locator('body').innerText({ timeout: 10000 }).catch(() => '');
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  url.searchParams.delete('sesskey');
  return url.href;
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function localHref(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function parseSrcset(value) {
  return String(value || '').split(',').map((part) => {
    const raw = part.trim();
    const url = raw.split(/\s+/)[0];
    return { raw, url };
  }).filter((item) => item.url);
}

function replaceAllLiteral(value, search, replacement) {
  if (!search) return value;
  return String(value || '').split(search).join(replacement);
}

function extractCssUrls(value) {
  const urls = [];
  const re = /url\((['"]?)(.*?)\1\)/gi;
  let match;
  while ((match = re.exec(String(value || '')))) urls.push(match[2]);
  return urls;
}

async function rewriteCssAsset(filePath, sourceUrl, contentType) {
  if (contentType !== 'text/css' && path.extname(filePath).toLowerCase() !== '.css') return;
  let css = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!css) return;

  let changed = false;
  for (const cssUrl of extractCssUrls(css)) {
    const absolute = toAbsoluteUrl(cssUrl, sourceUrl);
    if (!absolute) continue;
    const local = await downloadAsset(absolute);
    if (!local) continue;
    const relative = localHref(path.relative(path.dirname(filePath), local.absolutePath));
    css = replaceAllLiteral(css, cssUrl, relative);
    changed = true;
  }

  if (changed) await fs.writeFile(filePath, css);
}

function tagType(el) {
  const name = (el.name || '').toLowerCase();
  if (name === 'audio' || name === 'video' || name === 'source' || name === 'track') return 'media';
  if (name === 'img' || name === 'picture') return 'image';
  if (name === 'script') return 'script';
  if (name === 'link') return 'link';
  return name || 'asset';
}

function domSelector(el, index) {
  if (el.attribs) {
    if (el.attribs['data-deep-scraper-id']) return `[data-deep-scraper-id="${el.attribs['data-deep-scraper-id']}"]`;
    const marker = `deep-${index}-${Math.random().toString(16).slice(2)}`;
    el.attribs['data-deep-scraper-id'] = marker;
    return `[data-deep-scraper-id="${marker}"]`;
  }
  return `${el.name || '*'}:eq(${index})`;
}

function extensionFor(input, contentType, contentDisposition = '') {
  const url = typeof input === 'string' ? null : input;
  const pathname = url ? url.pathname : input;
  const dispositionName = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (dispositionName) {
    const current = path.extname(decodeURIComponent(dispositionName[1].replace(/"/g, '')));
    if (current) return current;
  }
  const queryName = url ? (url.searchParams.get('file') || url.searchParams.get('filename') || url.searchParams.get('forcedownload')) : '';
  if (queryName) {
    const current = path.extname(queryName);
    if (current) return current;
  }
  const current = path.extname(pathname);
  if (current) return current;
  const map = {
    'text/css': '.css',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/x-m4a': '.m4a',
    'audio/mp4': '.m4a',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'text/html': '.html',
    'application/pdf': '.pdf',
  };
  return map[contentType] || '.bin';
}

function assetPathname(parsed, extension) {
  let pathname = parsed.pathname.endsWith('/') ? `${parsed.pathname}index${extension}` : parsed.pathname;
  if (parsed.search) {
    const hash = crypto.createHash('sha1').update(parsed.search).digest('hex').slice(0, 10);
    const ext = path.extname(pathname) || extension;
    const base = path.extname(pathname) ? pathname.slice(0, -path.extname(pathname).length) : pathname;
    pathname = `${base}_${hash}${ext}`;
  }
  return pathname;
}

function safePath(pathname, extension) {
  const pieces = pathname.split('/').filter(Boolean).map((piece) => safeFileName(piece));
  if (!pieces.length) return `asset${extension}`;
  const last = pieces[pieces.length - 1];
  if (!path.extname(last)) pieces[pieces.length - 1] = `${last}${extension}`;
  return path.join(...pieces);
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  let count = 2;
  while (fs.existsSync(`${base}_${count}${ext}`)) count += 1;
  return `${base}_${count}${ext}`;
}

function safeFileName(value) {
  return String(value || 'file').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0, 150);
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function parseArgs(args) {
  const parsed = {
    url: args[0],
    maxQuizzes: 250,
    maxPagesPerQuiz: 80,
    profileDir: null,
    profileName: 'Default',
    browserChannel: 'chrome',
    headless: false,
    username: process.env.TEF_USERNAME || '',
    password: process.env.TEF_PASSWORD || '',
    quizIds: parseIdList(process.env.TEF_QUIZ_IDS || ''),
  };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--headless') parsed.headless = true;
    else if (arg === '--max-quizzes') parsed.maxQuizzes = Number(args[++i] || parsed.maxQuizzes);
    else if (arg === '--max-pages-per-quiz') parsed.maxPagesPerQuiz = Number(args[++i] || parsed.maxPagesPerQuiz);
    else if (arg === '--profile') parsed.profileDir = path.resolve(args[++i] || '');
    else if (arg === '--profile-name') parsed.profileName = args[++i] || '';
    else if (arg === '--browser-channel') parsed.browserChannel = args[++i] || '';
    else if (arg === '--username') parsed.username = args[++i] || '';
    else if (arg === '--password') parsed.password = args[++i] || '';
    else if (arg === '--quiz-ids') parsed.quizIds = parseIdList(args[++i] || '');
  }
  return parsed;
}

function parseIdList(value) {
  return String(value || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function emit(type, payload) {
  const event = typeof payload === 'object' && payload !== null ? { type, ...payload } : { type, message: payload };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
