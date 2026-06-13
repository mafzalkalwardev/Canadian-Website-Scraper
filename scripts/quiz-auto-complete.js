async function answerVisibleQuestions(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.que').forEach((question) => {
      const radios = Array.from(question.querySelectorAll('.answer input[type="radio"]:not(:disabled)'));
      if (!radios.length) return;
      const checked = radios.find((radio) => radio.checked);
      if (!checked) {
        radios[0].click();
        radios[0].checked = true;
        radios[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }).catch(() => {});
}

async function confirmQuizSubmitIfPresent(page) {
  const confirmSelectors = [
    '.modal-dialog button:has-text("Submit all and finish")',
    '.modal-dialog input[type="submit"][value*="Submit all and finish"]',
    '.modal-dialog input[type="submit"][value*="Submit"]',
    '.modal-dialog button:has-text("Submit")',
    'input[type="submit"][value*="Submit all and finish"]',
    'input[type="submit"][value*="Submit"]',
    'button:has-text("Submit all and finish")',
  ];
  for (const selector of confirmSelectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click({ timeout: 5000 }).catch(async () => locator.evaluate((el) => el.click()));
    await page.waitForTimeout(2000);
    return;
  }
}

async function submitQuizSummary(page) {
  const finishSelectors = [
    'input[type="submit"][name="finishattempt"]',
    'input[type="submit"][value*="Submit all"]',
    'input[type="submit"][value*="Finish attempt"]',
    'button:has-text("Submit all and finish")',
    'button:has-text("Submit all")',
    'button:has-text("Finish attempt")',
  ];
  for (const selector of finishSelectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await page.waitForTimeout(1500);
    await confirmQuizSubmitIfPresent(page);
    await page.waitForTimeout(2500);
    return /review\.php|view\.php/i.test(page.url());
  }
  return false;
}

async function clickNextQuestion(page) {
  const unsafeText = /submit all and finish|submit and finish/i;
  const candidates = [
    'input[type="submit"][name="next"]',
    'input[type="submit"][value*="Next"]',
    'button:has-text("Next page")',
    'button:has-text("Next")',
    'a:has-text("Next")',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    const name = await locator.getAttribute('name').catch(() => '');
    const label = await locator.evaluate((el) => `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`).catch(() => '');
    if (name !== 'next' && unsafeText.test(label)) continue;
    const before = page.url();
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await page.waitForTimeout(1500);
    return page.url() !== before || /summary\.php|review\.php/i.test(page.url());
  }
  return false;
}

async function clickStartPopupIfPresent(page) {
  const popupSelectors = [
    'input[type="submit"][value*="Start attempt"]',
    'button:has-text("Start attempt")',
    '.modal-dialog button:has-text("Start")',
    '.modal-dialog input[type="submit"]',
  ];
  for (const selector of popupSelectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await page.waitForTimeout(2000);
    return true;
  }
  return false;
}

async function waitForAttemptPage(context, sourcePage) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const candidate of context.pages()) {
      if (candidate.isClosed()) continue;
      await candidate.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(candidate.url())) {
        await candidate.bringToFront().catch(() => {});
        return candidate;
      }
    }
    await sourcePage.waitForTimeout(500);
  }
  return null;
}

function extractAttemptUrl(html, baseUrl) {
  const decoded = String(html || '').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  const absolute = decoded.match(/https:\/\/tefsuccess\.ca\/mod\/quiz\/attempt\.php\?attempt=\d+&cmid=\d+/i);
  if (absolute) return absolute[0];
  const relative = decoded.match(/\/mod\/quiz\/attempt\.php\?attempt=\d+&cmid=\d+/i);
  if (relative) return new URL(relative[0], baseUrl).href;
  return null;
}

async function submitQuizStartForm(page, context) {
  const formPayload = await page.evaluate(() => {
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

  if (!formPayload) return null;

  if (/\/mod\/quiz\/startattempt\.php/i.test(formPayload.action || '')) {
    const response = await context.request.post(formPayload.action, { form: formPayload.data, timeout: 30000 }).catch(() => null);
    if (response) {
      const html = await response.text().catch(() => '');
      const attemptUrl = extractAttemptUrl(html, page.url());
      if (attemptUrl) {
        await page.goto(attemptUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForTimeout(1500);
        if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(page.url())) return page;
      }
    }
  }

  const submitted = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    const form = forms.find((item) => /\/mod\/quiz\/attempt\.php/i.test(item.action || ''));
    if (!form) return false;
    for (const checkbox of Array.from(form.querySelectorAll('input[type="checkbox"]'))) {
      checkbox.checked = true;
      checkbox.setAttribute('checked', 'checked');
    }
    const submit = form.querySelector('[name="submitbutton"], button[type="submit"], input[type="submit"]');
    if (submit && typeof submit.click === 'function') submit.click();
    else if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return true;
  }).catch(() => false);

  if (!submitted) return null;
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return /\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(page.url()) ? page : null;
}

async function enterQuizAttempt(page, context) {
  const selectors = [
    '.quizstartbuttondiv button[type="submit"]',
    '.quizstartbuttondiv input[type="submit"]',
    'form[action*="/mod/quiz/attempt.php"] button[type="submit"]',
    'input[type="submit"][value*="Continue"]',
    'input[type="submit"][value*="Attempt"]',
    'input[type="submit"][value*="Re-attempt"]',
    'button:has-text("Continue")',
    'button:has-text("Continue your attempt")',
    'input[type="submit"][value*="Continue your attempt"]',
    'button:has-text("Attempt quiz")',
    'button:has-text("Re-attempt quiz")',
    'a:has-text("Continue")',
    'a:has-text("Attempt quiz")',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
      locator.click({ timeout: 10000 }).catch(async () => locator.evaluate((el) => el.click())),
    ]);
    await page.waitForTimeout(1500);
    await clickStartPopupIfPresent(page);
    await page.waitForTimeout(1500);
    const attemptPage = await waitForAttemptPage(context, page);
    if (attemptPage) return attemptPage;
    if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(page.url())) return page;
  }

  await clickStartPopupIfPresent(page);
  let attemptPage = await waitForAttemptPage(context, page);
  if (attemptPage) return attemptPage;
  if (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(page.url())) return page;

  attemptPage = await submitQuizStartForm(page, context);
  if (attemptPage) return attemptPage;
  attemptPage = await waitForAttemptPage(context, page);
  return attemptPage || (/\/mod\/quiz\/attempt\.php|\/mod\/quiz\/summary\.php/i.test(page.url()) ? page : null);
}

async function autoCompleteQuizAttempt(page, quizUrl, maxPages = 80, context = null) {
  const ctx = context || page.context();
  await page.goto(quizUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForTimeout(1500);

  const attemptPage = await enterQuizAttempt(page, ctx);
  if (!attemptPage) return false;
  let workPage = attemptPage;

  for (let step = 0; step < maxPages; step += 1) {
    workPage = ctx.pages().find((p) => /summary\.php|attempt\.php|review\.php/i.test(p.url())) || workPage;
    await workPage.bringToFront().catch(() => {});
    const currentUrl = workPage.url();
    if (/review\.php/i.test(currentUrl)) return true;
    if (/summary\.php/i.test(currentUrl)) {
      await answerVisibleQuestions(workPage);
      return submitQuizSummary(workPage);
    }
    await answerVisibleQuestions(workPage);
    const moved = await clickNextQuestion(workPage);
    await workPage.waitForTimeout(800);
    if (!moved && /summary\.php/i.test(workPage.url())) {
      await answerVisibleQuestions(workPage);
      return submitQuizSummary(workPage);
    }
    if (!moved && /review\.php/i.test(workPage.url())) return true;
    if (!moved) return /review\.php/i.test(workPage.url());
  }
  return /review\.php|view\.php/i.test(workPage.url());
}

module.exports = {
  autoCompleteQuizAttempt,
  answerVisibleQuestions,
  clickNextQuestion,
  submitQuizSummary,
  enterQuizAttempt,
};
