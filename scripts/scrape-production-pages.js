const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { ensureLoggedIn } = require('./tef-auth');

const outputFile = path.resolve(process.argv[2] || 'public/data/production-pages.json');

const SECTIONS = [
  {
    id: 'production_ecrite',
    title: 'Expression écrite',
    pages: [
      { id: 'intro', title: 'Introduction', url: 'https://tefsuccess.ca/mod/page/view.php?id=113' },
      { id: 'section_a', title: 'Section A', url: 'https://tefsuccess.ca/mod/page/view.php?id=114' },
      { id: 'section_b', title: 'Section B', url: 'https://tefsuccess.ca/mod/page/view.php?id=115' },
    ],
  },
  {
    id: 'production_orale',
    title: 'Expression orale',
    pages: [
      { id: 'intro', title: 'Introduction', url: 'https://tefsuccess.ca/mod/page/view.php?id=116' },
      { id: 'section_a', title: 'Section A', url: 'https://tefsuccess.ca/mod/page/view.php?id=117' },
      { id: 'section_b', title: 'Section B', url: 'https://tefsuccess.ca/mod/page/view.php?id=118' },
    ],
  },
];

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await ensureLoggedIn(page, {
    username: process.env.TEF_USERNAME || '',
    password: process.env.TEF_PASSWORD || '',
  });

  const sections = [];
  for (const section of SECTIONS) {
    const scrapedPages = [];
    for (const entry of section.pages) {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      const content = extractPageContent(html, entry.url);
      scrapedPages.push({
        id: entry.id,
        title: content.title || entry.title,
        url: entry.url,
        html: content.html,
        text: content.text,
      });
      console.log(`Scraped ${section.title} / ${entry.title}`);
    }
    sections.push({ id: section.id, title: section.title, pages: scrapedPages });
  }

  await browser.close();
  await fs.ensureDir(path.dirname(outputFile));
  await fs.writeJson(outputFile, { sections, capturedAt: new Date().toISOString() }, { spaces: 2 });
  console.log(`Saved production pages to ${outputFile}`);
}

function extractPageContent(html, pageUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = normalizeText($('#page-header h1, .page-header-headings h1, h1').first().text())
    || normalizeText($('title').text().replace(/\s*\|\s*tefsuccess\s*$/i, ''));
  const region = $('.box.generalbox, #region-main .box, #region-main, [role="main"]').first();
  const clone = cheerio.load(region.html() || '', { decodeEntities: false });
  clone('script, style, nav, .navbar, .breadcrumb, .activity-header, .modified, .footer').remove();
  clone('[src],[href]').each((_, el) => {
    const attr = clone(el).attr('src') ? 'src' : 'href';
    const value = clone(el).attr(attr);
    if (!value || value.startsWith('#') || value.startsWith('data:')) return;
    try {
      clone(el).attr(attr, new URL(value, pageUrl).href);
    } catch {}
  });
  const bodyHtml = (clone.root().html() || '').trim();
  const text = normalizeText(cheerio.load(bodyHtml).text());
  return { title, html: bodyHtml, text };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
