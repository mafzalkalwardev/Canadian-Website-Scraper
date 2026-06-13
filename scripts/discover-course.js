const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { ensureLoggedIn } = require('./tef-auth');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await ensureLoggedIn(page, {
    username: process.env.TEF_USERNAME || '',
    password: process.env.TEF_PASSWORD || '',
  });

  await page.goto('https://tefsuccess.ca/course/view.php?id=2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const html = await page.content();
  const $ = cheerio.load(html);

  const sections = [];
  $('[data-sectionid]').each((_, sectionEl) => {
    const section = $(sectionEl);
    const title = section.find('.sectionname, h3.sectionname').first().text().replace(/\s+/g, ' ').trim();
    const activities = [];
    section.find('a[href*="/mod/"]').each((__, link) => {
      const href = $(link).attr('href') || '';
      const name = $(link).text().replace(/\s+/g, ' ').trim();
      if (name) activities.push({ name, href });
    });
    if (title || activities.length) sections.push({ title, activities });
  });

  console.log(JSON.stringify(sections, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
