const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const readline = require('readline');

const options = parseArgs(process.argv.slice(2));
const startUrl = options.url;
const OUTPUT_ROOT = path.join(__dirname, 'downloaded_site');
const OUTPUT_DIR = path.join(OUTPUT_ROOT, timestampName());
const MAX_PAGES = Math.max(1, Number(options.maxPages || 75));

let browser;
let context;
let page;
let pageCount = 0;
const pages = [];
const downloaded = new Map();
const pageUrls = new Map();
const savedHtmlFiles = [];

main().catch(async (err) => {
  emit('error', err.message || String(err));
  await shutdown(1);
});

async function main() {
  if (!isHttpUrl(startUrl)) throw new Error('A valid http or https URL is required.');

  await fs.ensureDir(OUTPUT_DIR);
  context = await createBrowserContext();

  page = await context.newPage();
  page.on('download', async (download) => {
    const suggested = safeFileName(download.suggestedFilename() || 'download.bin');
    const target = path.join(OUTPUT_DIR, 'browser-downloads', suggested);
    await fs.ensureDir(path.dirname(target));
    await download.saveAs(target);
    emit('log', `Browser download saved: ${path.relative(__dirname, target)}`);
  });

  emit('state', { outputDir: OUTPUT_DIR, currentUrl: startUrl });
  emit('log', `Opening ${startUrl}`);
  // Some networks intermittently return ERR_EMPTY_RESPONSE on first navigation.
  // Retry a few times so the scraper can still make progress.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      emit('log', `Navigation failed (${attempt}/3): ${err.message || String(err)}. Retrying...`);
      await page.waitForTimeout(2000);
    }
  }


  if (options.waitForLogin) await waitForLoginIfNeeded(page);

  if (options.crawl) {
    await crawlSite();
    await shutdown(0);
    return;
  }

  emit('log', 'Use the browser normally. Click "Scrape Current Page" when the page you want is visible.');

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let command;
    try {
      command = JSON.parse(line);
    } catch (err) {
      emit('error', 'Invalid command received.');
      return;
    }

    try {
      if (command.action === 'scrape') await scrapeCurrentPage();
      if (command.action === 'next') await goToNextPage();
      if (command.action === 'finish') await shutdown(0);
    } catch (err) {
      emit('error', err.message || String(err));
    }
  });
}

async function waitForLoginIfNeeded(targetPage) {
  const text = await targetPage.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  if (isLoggedInText(text) && !isGuestText(text)) {
    emit('log', 'Authenticated session detected.');
    return;
  }

  emit('log', 'Login is needed. Use the opened browser to sign in; crawling will resume automatically after login.');
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await targetPage.waitForTimeout(3000);
    const currentText = await targetPage.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    emit('state', { currentUrl: targetPage.url() });
    if (isLoggedInText(currentText) && !isGuestText(currentText)) {
      emit('log', 'Login detected. Starting crawl.');
      return;
    }
  }
  throw new Error('Timed out waiting for login.');
}

function isLoggedInText(text) {
  return /You are logged in as|Log out|My courses/i.test(String(text || ''));
}

function isGuestText(text) {
  return /You are currently using guest access/i.test(String(text || ''));
}

async function createBrowserContext() {
  const launchOptions = {
    headless: !!options.headless,
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    args: [],
  };
  if (options.browserChannel) launchOptions.channel = options.browserChannel;
  if (options.profileName) launchOptions.args.push(`--profile-directory=${options.profileName}`);

  if (options.profileDir) {
    await fs.ensureDir(options.profileDir);
    emit('log', `Using persistent profile: ${options.profileDir}`);
    return chromium.launchPersistentContext(options.profileDir, launchOptions);
  }

  browser = await chromium.launch({ headless: !!options.headless });
  return browser.newContext(launchOptions);
}

async function crawlSite() {
  const start = new URL(startUrl);
  const queue = [start.href];
  const seen = new Set();

  emit('log', `Crawler enabled. Capturing up to ${MAX_PAGES} same-origin pages from ${start.origin}`);

  while (queue.length && pageCount < MAX_PAGES) {
    const nextUrl = queue.shift();
    if (!nextUrl || seen.has(nextUrl) || shouldSkipUrl(nextUrl, start)) continue;
    seen.add(nextUrl);

    emit('state', { currentUrl: nextUrl });
    emit('log', `Crawling ${seen.size}: ${nextUrl}`);
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 0 }).catch((err) => {
      emit('error', `Failed page: ${nextUrl} (${err.message || err})`);
    });

    if (normalizeComparableUrl(page.url()) !== normalizeComparableUrl(nextUrl)) {
      emit('log', `Browser landed on: ${page.url()}`);
    }

    const result = await scrapeCurrentPage({ discoverLinks: true });
    for (const link of result.links) {
      if (!seen.has(link) && !queue.includes(link) && !shouldSkipUrl(link, start)) queue.push(link);
    }
  }

  await rewriteCapturedInternalLinks();
  await writeManifest();
  emit('log', `Crawler finished: ${pageCount} page${pageCount === 1 ? '' : 's'} captured.`);
}

async function scrapeCurrentPage(settings = {}) {
  // If the page never fully loaded (e.g. navigation failed), avoid creating empty exports.
  // Let the caller decide whether to retry.
  if (!page || page.isClosed()) throw new Error('Browser page is not available.');
  await settlePage();
  const bodyTextNow = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  if (!String(bodyTextNow || '').trim()) {
    emit('error', `Current page appears empty (no body text). url=${page.url()}`);
    return { url: page.url(), title: await page.title().catch(() => ''), links: [] };
  }
  pageCount += 1;


  const url = page.url();
  const title = await page.title();
  const name = `page_${String(pageCount).padStart(3, '0')}`;

  emit('log', `Scraping visible page: ${url}`);

  const html = await page.content();
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const $ = cheerio.load(html, { decodeEntities: false });
  markScraperIds($);
  const assets = collectAssets($, url);
  const links = settings.discoverLinks ? collectPageLinks($, url) : [];

  for (const asset of assets) {
    const local = await downloadAsset(asset.url);
    if (!local) continue;

    asset.localPath = local.absolutePath;
    asset.relativePath = localHref(path.relative(OUTPUT_DIR, local.absolutePath));
    rewriteAssetReference($, asset);
  }
  prepareOfflineReplica($);

  const pageHtmlPath = path.join(OUTPUT_DIR, `${name}.html`);
  $('[data-scraper-id]').removeAttr('data-scraper-id');
  await fs.writeFile(pageHtmlPath, $.html());
  savedHtmlFiles.push(pageHtmlPath);
  pageUrls.set(normalizeComparableUrl(url), path.basename(pageHtmlPath));

  const textPath = path.join(OUTPUT_DIR, `${name}.txt`);
  await fs.writeFile(textPath, text);

  const screenshotPath = path.join(OUTPUT_DIR, `${name}.png`);
  const screenshotOk = await page
    .screenshot({ path: screenshotPath, fullPage: true, timeout: 120000 })
    .then(() => true)
    .catch((err) => {
      emit('error', `Screenshot skipped for ${url}: ${err.message || err}`);
      return false;
    });

  const savedPage = {
    title,
    url,
    htmlFile: path.basename(pageHtmlPath),
    textFile: path.basename(textPath),
    screenshotFile: screenshotOk ? path.basename(screenshotPath) : null,
    assetCount: assets.filter((asset) => asset.localPath).length,
    assets: assets
      .filter((asset) => asset.localPath)
      .map((asset) => ({
        type: asset.type,
        url: asset.url,
        file: asset.relativePath,
      })),
  };

  pages.push(savedPage);
  await writeIndex();

  emit('page', {
    url,
    title,
    outputDir: OUTPUT_DIR,
    htmlFile: pageHtmlPath,
    textFile: textPath,
    assetCount: savedPage.assetCount,
  });
  emit('log', `Saved ${path.relative(__dirname, pageHtmlPath)} with ${savedPage.assetCount} downloaded assets.`);
  return { url, title, links };
}

async function goToNextPage() {
  emit('log', 'Looking for a visible next-page link or button...');

  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'));
    const next = candidates.find((el) => {
      const label = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('rel'),
        el.textContent,
        el.className,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      return visible && /\b(next|older|more|continue|>)\b|»|›/.test(label);
    });

    if (!next) return false;
    next.scrollIntoView({ block: 'center', inline: 'center' });
    next.click();
    return true;
  });

  if (!clicked) {
    emit('error', 'No next-page control was found. Use the browser to navigate, then scrape the current page.');
    return;
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await settlePage();
  emit('state', { currentUrl: page.url() });
  emit('log', `Moved to: ${page.url()}`);
}

async function settlePage() {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let previousHeight = 0;
      let stableTicks = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, Math.max(400, Math.floor(window.innerHeight * 0.7)));
        const height = document.documentElement.scrollHeight || document.body.scrollHeight;
        stableTicks = height === previousHeight ? stableTicks + 1 : 0;
        previousHeight = height;
        if (stableTicks >= 3 || window.scrollY + window.innerHeight >= height) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 250);
    });
  });
}

function collectAssets($, baseUrl) {
  const assets = [];
  const seen = new Set();

  const add = (type, url, selector, attr, original) => {
    const absolute = toAbsoluteUrl(url, baseUrl);
    if (!absolute || seen.has(`${selector}|${attr}|${absolute}`)) return;
    seen.add(`${selector}|${attr}|${absolute}`);
    assets.push({ type, url: absolute, selector, attr, original: original || url });
  };

  $('[src]').each((i, el) => add(tagType(el), $(el).attr('src'), domSelector(el, i), 'src'));
  $('link[href], a[download][href]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    add(tagType(el), href, domSelector(el, i), 'href');
  });
  $('[poster]').each((i, el) => add('poster', $(el).attr('poster'), domSelector(el, i), 'poster'));
  $('object[data], embed[src]').each((i, el) => add(tagType(el), $(el).attr('data') || $(el).attr('src'), domSelector(el, i), $(el).attr('data') ? 'data' : 'src'));

  $('[srcset]').each((i, el) => {
    for (const item of parseSrcset($(el).attr('srcset'))) {
      add('srcset', item.url, domSelector(el, i), 'srcset', item.url);
    }
  });

  $('[data-src], [data-original], [data-lazy-src], [data-fullurl], [data-background], [data-bg], [data-background-image]').each((i, el) => {
    for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-fullurl', 'data-background', 'data-bg', 'data-background-image']) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      if (attr === 'data-src' || attr === 'data-lazy-src') add(tagType(el), raw, domSelector(el, i), attr);
      else add('image', raw, domSelector(el, i), attr);
    }
  });

  $('[data-srcset]').each((i, el) => {
    for (const item of parseSrcset($(el).attr('data-srcset'))) {
      add('srcset', item.url, domSelector(el, i), 'data-srcset', item.url);
    }
  });

  $('[style]').each((i, el) => {
    for (const cssUrl of extractCssUrls($(el).attr('style'))) {
      add('inline-style', cssUrl, domSelector(el, i), 'style', cssUrl);
    }
  });

  $('style').each((i, el) => {
    for (const cssUrl of extractCssUrls($(el).html() || '')) {
      add('style-block', cssUrl, domSelector(el, i), 'style-block', cssUrl);
    }
  });

  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (/\/(?:pluginfile|draftfile)\.php\//i.test(String(href || ''))) add('file', href, domSelector(el, i), 'href');
  });

  return assets;
}

function markScraperIds($) {
  let count = 0;
  $('*').each((i, el) => {
    $(el).attr('data-scraper-id', `scraper-${count}`);
    count += 1;
  });
}

async function downloadAsset(url) {
  if (downloaded.has(url)) return downloaded.get(url);

  try {
    const parsed = new URL(url);
    const response = context
      ? await context.request.get(url, { timeout: 30000, maxRedirects: 5 })
      : null;

    if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);

    const headers = response ? response.headers() : {};
    const body = response
      ? Buffer.from(await response.body())
      : Buffer.from((await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400,
        })).data);

    const contentType = String(headers['content-type'] || '').split(';')[0].trim();
    const disposition = String(headers['content-disposition'] || '');
    const extension = extensionFor(parsed, contentType, disposition);
    const host = safeFileName(parsed.hostname);
    const pathname = assetPathname(parsed, extension);
    const relative = path.join('assets', host, safePath(pathname, extension));
    const absolutePath = uniquePath(path.join(OUTPUT_DIR, relative));

    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, body);

    const result = { absolutePath, contentType };
    downloaded.set(url, result);
    await rewriteCssAsset(absolutePath, url, contentType);
    emit('log', `Downloaded asset: ${path.relative(__dirname, absolutePath)}`);
    return result;
  } catch (err) {
    emit('error', `Failed asset: ${url}`);
    downloaded.set(url, null);
    return null;
  }
}

function collectPageLinks($, baseUrl) {
  const links = [];
  const seen = new Set();

  const add = (value) => {
    const absolute = normalizeLink(value, baseUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    links.push(absolute);
  };

  $('a[href], area[href], [data-url], [data-href], [data-action]').each((i, el) => {
    add($(el).attr('href') || $(el).attr('data-url') || $(el).attr('data-href') || $(el).attr('data-action'));
  });

  $('option[value]').each((i, el) => add($(el).attr('value')));

  $('form[action]').each((i, el) => {
    const method = String($(el).attr('method') || 'get').toLowerCase();
    const action = $(el).attr('action');
    if (method === 'get' || /\/mod\/quiz\/review\.php/i.test(String(action))) add(action);
  });

  $('script').each((i, el) => {
    const script = String($(el).html() || '');
    for (const found of extractEmbeddedUrls(script)) add(found);
  });

  return links;
}

function extractEmbeddedUrls(value) {
  const text = String(value || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const urls = [];
  const absolute = /https?:\/\/[^\s"'<>\\)]+/gi;
  const relative = /\/(?:course|mod|my|grade|user|tag|badges|calendar|message|pluginfile|webservice)\/[^\s"'<>\\)]*\.php[^\s"'<>\\)]*/gi;
  let match;
  while ((match = absolute.exec(text))) urls.push(match[0]);
  while ((match = relative.exec(text))) urls.push(match[0]);
  return urls;
}

async function rewriteCapturedInternalLinks() {
  for (const htmlPath of savedHtmlFiles) {
    const html = await fs.readFile(htmlPath, 'utf8');
    const $ = cheerio.load(html, { decodeEntities: false });
    let changed = false;

    $('a[href], area[href]').each((i, el) => {
      const href = $(el).attr('href');
      const absolute = normalizeLink(href, startUrl);
      const local = absolute ? pageUrls.get(normalizeComparableUrl(absolute)) : null;
      if (!local) return;
      $(el).attr('href', local);
      changed = true;
    });

    if (changed) await fs.writeFile(htmlPath, $.html());
  }
}

async function writeManifest() {
  const manifest = {
    startUrl,
    capturedAt: new Date().toISOString(),
    crawl: !!options.crawl,
    maxPages: MAX_PAGES,
    pageCount,
    pages: pages.map((item) => ({
      title: item.title,
      url: item.url,
      htmlFile: item.htmlFile,
      textFile: item.textFile,
      screenshotFile: item.screenshotFile,
      assetCount: item.assetCount,
    })),
  };
  await fs.writeJson(path.join(OUTPUT_DIR, 'replica_manifest.json'), manifest, { spaces: 2 });
}

function rewriteAssetReference($, asset) {
  const el = $(asset.selector);
  if (!el.length || !asset.relativePath) return;
  if ((asset.attr === 'src' || asset.attr === 'href') && /^(script|link)$/i.test(el.prop('tagName') || '')) {
    el.removeAttr('integrity crossorigin referrerpolicy');
  }

  if (asset.attr === 'style') {
    el.attr('style', replaceAllLiteral(String(el.attr('style') || ''), asset.original, asset.relativePath));
    return;
  }

  if (asset.attr === 'style-block') {
    el.text(replaceAllLiteral(String(el.html() || ''), asset.original, asset.relativePath));
    return;
  }

  if (asset.attr === 'srcset' || asset.attr === 'data-srcset') {
    const current = String(el.attr('srcset') || '');
    const attr = asset.attr;
    el.attr(attr, replaceAllLiteral(String(el.attr(attr) || current), asset.original, asset.relativePath));
    return;
  }

  el.attr(asset.attr, asset.relativePath);
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

async function writeIndex() {
  const pageList = pages
    .map((item, index) => {
      const assetRows = item.assets
        .map((asset) => `<li><span>${escapeHtml(asset.type)}</span><a href="${escapeAttr(asset.file)}">${escapeHtml(asset.file)}</a></li>`)
        .join('');

      return `<article>
        <h2>${index + 1}. ${escapeHtml(item.title || item.url)}</h2>
        <p><a href="${escapeAttr(item.url)}">${escapeHtml(item.url)}</a></p>
        <div class="links">
          <a href="${escapeAttr(item.htmlFile)}">Saved HTML</a>
          <a href="${escapeAttr(item.textFile)}">Extracted Text</a>
          ${item.screenshotFile ? `<a href="${escapeAttr(item.screenshotFile)}">Screenshot</a>` : ''}
        </div>
        <p>${item.assetCount} assets downloaded.</p>
        <ul>${assetRows || '<li>No downloadable assets found.</li>'}</ul>
      </article>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Scraped Site Export</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #16202a; background: #f6f7f9; }
    header { padding: 28px 36px; background: #ffffff; border-bottom: 1px solid #d9dee5; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    article { background: #ffffff; border: 1px solid #d9dee5; border-radius: 8px; padding: 20px; margin-bottom: 18px; }
    h1, h2 { margin: 0 0 10px; }
    p { line-height: 1.5; }
    a { color: #0f5ea8; }
    .links { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
    .links a { padding: 8px 10px; border: 1px solid #b8c4d1; border-radius: 6px; text-decoration: none; background: #f8fbff; }
    li { margin: 7px 0; overflow-wrap: anywhere; }
    li span { display: inline-block; min-width: 86px; color: #506070; }
  </style>
</head>
<body>
  <header>
    <h1>Scraped Site Export</h1>
    <p>${pages.length} page${pages.length === 1 ? '' : 's'} saved in this run.</p>
  </header>
  <main>${pageList || '<p>No pages scraped yet.</p>'}</main>
</body>
</html>`;

  await fs.writeFile(path.join(OUTPUT_DIR, 'index.html'), html);
}

async function shutdown(code) {
  await rewriteCapturedInternalLinks().catch(() => {});
  await writeManifest().catch(() => {});
  await writeIndex().catch(() => {});
  emit('log', `Finished. Open this file: ${path.join(OUTPUT_DIR, 'index.html')}`);
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  // Avoid hard exit to let buffered stdout flush.
  setTimeout(() => process.exit(code), 250);

}

function parseSrcset(value) {
  return String(value || '')
    .split(',')
    .map((part) => {
      const raw = part.trim();
      const url = raw.split(/\s+/)[0];
      return { raw, url };
    })
    .filter((item) => item.url);
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

function toAbsoluteUrl(value, baseUrl) {
  if (!value) return null;
  if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch (err) {
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

function normalizeLink(value, baseUrl) {
  if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    url.hash = '';
    url.searchParams.delete('sesskey');
    url.searchParams.delete('redirect');
    return url.href;
  } catch (err) {
    return null;
  }
}

function shouldSkipUrl(value, start) {
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    return true;
  }

  if (url.origin !== start.origin) return true;
  if (!['http:', 'https:'].includes(url.protocol)) return true;

  const text = `${url.pathname}?${url.searchParams.toString()}`.toLowerCase();
  if (/\.(7z|avi|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|mp3|mp4|pdf|png|rar|svg|tar|ttf|webm|webp|woff2?|xlsx?|zip)$/i.test(url.pathname)) return true;
  if (/^\/(?:lib|theme|icons|pix)\//i.test(url.pathname)) return true;
  if (/^\/r\.php/i.test(url.pathname)) return true;
  if (/^\/login\//i.test(url.pathname)) return true;
  if (/^\/message\//i.test(url.pathname)) return true;
  if (/^\/user\/(?:preferences|profile|contactsitesupport)\.php/i.test(url.pathname)) return true;
  if (/(logout|logoff|delete|remove|unenrol|unsubscribe|submit|attempt\.php|startattempt\.php|finishattempt|sesskey=)/i.test(text)) return true;
  if (/\/course\/(?:decrease|increase|reset|toggle|sitecolor|footer-popover|cancel|confirm|request|accept|decline|load-more|show-category|send-message)/i.test(url.pathname)) return true;

  return false;
}

function normalizeComparableUrl(value) {
  const url = new URL(value);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.href;
}

function parseArgs(args) {
  const parsed = {
    url: args[0],
    crawl: false,
    headless: false,
    maxPages: 75,
    profileDir: null,
    waitForLogin: false,
  };

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--crawl') parsed.crawl = true;
    else if (arg === '--headless') parsed.headless = true;
    else if (arg === '--wait-for-login') parsed.waitForLogin = true;
    else if (arg === '--max-pages') parsed.maxPages = Number(args[++i] || parsed.maxPages);
    else if (arg === '--profile') parsed.profileDir = path.resolve(args[++i] || '');
    else if (arg === '--profile-name') parsed.profileName = args[++i] || '';
    else if (arg === '--browser-channel') parsed.browserChannel = args[++i] || '';
  }

  return parsed;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err) {
    return false;
  }
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
  const id = el.attribs && el.attribs['data-scraper-id'];
  if (id) return `[data-scraper-id="${id}"]`;
  const name = el.name || '*';
  return `${name}:eq(${index})`;
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
  const pieces = pathname
    .split('/')
    .filter(Boolean)
    .map((piece) => safeFileName(piece));
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
  return String(value || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 150);
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function emit(type, payload) {
  const event = typeof payload === 'object' && payload !== null ? { type, ...payload } : { type, message: payload };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
