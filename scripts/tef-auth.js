async function readBodyText(page) {
  try {
    return await page.evaluate(() => document.body?.innerText || '');
  } catch {
    await page.waitForTimeout(1500);
    return '';
  }
}

function isAuthenticated(text, url = '') {
  if (/You are currently using guest access|Log in to the site/i.test(text)) return false;
  if (/Invalid login/i.test(text)) return false;
  if (/Log out|You are logged in as|My courses/i.test(text)) return true;
  if (/\/course\/view\.php/i.test(url) && /Compréhension|Mock \d+|Production/i.test(text)) return true;
  return false;
}

async function loginToTef(page, credentials) {
  const { username, password } = credentials;
  if (!username || !password) return false;

  await page.goto('https://tefsuccess.ca/login/index.php', { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.locator('input[name="username"], #username').first().fill(username);
  await page.locator('input[name="password"], #password').first().fill(password);
  await Promise.all([
    page.waitForURL((url) => !/\/login\/index\.php/i.test(url.pathname), { timeout: 30000 }).catch(() => {}),
    page.locator('button[type="submit"], input[type="submit"], #loginbtn').first().click(),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goto('https://tefsuccess.ca/course/view.php?id=2', { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForTimeout(1500);
  const text = await readBodyText(page);
  return isAuthenticated(text, page.url());
}

async function ensureLoggedIn(page, credentials = {}) {
  await page.goto('https://tefsuccess.ca/course/view.php?id=2', { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForTimeout(1500);
  let text = await readBodyText(page);
  if (isAuthenticated(text, page.url())) {
    console.log('Already authenticated.');
    return;
  }

  if (credentials.username && credentials.password) {
    const ok = await loginToTef(page, credentials);
    if (!ok) throw new Error('Login failed. Check TEF_USERNAME and TEF_PASSWORD.');
    console.log('Login succeeded.');
    return;
  }

  if (credentials.profileDir) {
    throw new Error('Persistent profile did not contain an authenticated TEFSuccess session.');
  }

  console.log('Sign in using the opened browser window. Waiting up to 15 minutes...');
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    text = await readBodyText(page);
    if (isAuthenticated(text, page.url())) {
      console.log('Login detected.');
      return;
    }
  }
  throw new Error('Timed out waiting for manual login.');
}

module.exports = {
  readBodyText,
  isAuthenticated,
  loginToTef,
  ensureLoggedIn,
};
