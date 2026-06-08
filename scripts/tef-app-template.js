let course;
let currentSection;
let currentMock;
let mode = 'review';
let activeSectionId = 'all';
let searchQuery = '';

const nav = document.getElementById('sectionNav');
const content = document.getElementById('content');
const title = document.getElementById('pageTitle');
const meta = document.getElementById('courseMeta');
const quizBtn = document.getElementById('quizModeBtn');
const reviewBtn = document.getElementById('reviewModeBtn');
const sidebar = document.querySelector('.sidebar');

fetch('data/course.json')
  .then((response) => response.json())
  .then((data) => {
    course = data;
    meta.textContent = `${data.sections.reduce((count, section) => count + section.mocks.length, 0)} mocks loaded`;
    renderNav();
    renderDashboard();
  })
  .catch((err) => {
    content.innerHTML = `<div class="empty">Unable to load course data: ${esc(err.message || err)}</div>`;
  });

quizBtn.onclick = () => {
  mode = 'quiz';
  setModeButtons();
  if (currentMock) renderMock(currentMock);
};

reviewBtn.onclick = () => {
  mode = 'review';
  setModeButtons();
  if (currentMock) renderMock(currentMock);
};

function setModeButtons() {
  quizBtn.classList.toggle('active', mode === 'quiz');
  reviewBtn.classList.toggle('active', mode === 'review');
}

function renderNav() {
  const sectionsWithMocks = course.sections.filter((section) => section.mocks.length);
  const sectionTabs = [
    `<button class="section-filter ${activeSectionId === 'all' ? 'active' : ''}" data-section-filter="all" type="button">All</button>`,
    ...sectionsWithMocks.map((section) => (
      `<button class="section-filter ${activeSectionId === section.id ? 'active' : ''}" data-section-filter="${section.id}" type="button">${esc(section.title)}</button>`
    )),
  ].join('');

  const visibleSections = course.sections
    .filter((section) => activeSectionId === 'all' || section.id === activeSectionId)
    .map((section) => ({
      ...section,
      mocks: section.mocks.filter((mock) => {
        const haystack = `${section.title} ${mock.title} ${mock.id}`.toLowerCase();
        return !searchQuery || haystack.includes(searchQuery);
      }),
    }));

  nav.innerHTML = `
    <div class="nav-tools">
      <label class="nav-search"><span>Find mock</span><input id="mockSearch" type="search" value="${esc(searchQuery)}" placeholder="Mock 1, orale, reading"></label>
      <div class="section-filters">${sectionTabs}</div>
    </div>
    ${visibleSections.map((section) => {
    const mocks = section.mocks.length
      ? section.mocks.map((mock) => {
        const questionCount = mock.attempts.reduce((count, attempt) => count + attempt.questions.length, 0);
        return `<button class="mock-btn" data-section="${section.id}" data-mock="${mock.id}">
          ${esc(mock.title)}<br><small>${questionCount} questions</small>
        </button>`;
      }).join('')
      : '<div class="empty" style="margin:8px">No scraped mocks yet</div>';
    return `<section class="section-card"><h3>${esc(section.title)}</h3>${mocks}</section>`;
  }).join('')}`;

  nav.querySelectorAll('.mock-btn').forEach((button) => {
    button.onclick = () => {
      currentSection = course.sections.find((section) => section.id === button.dataset.section);
      currentMock = currentSection.mocks.find((mock) => mock.id === button.dataset.mock);
      document.querySelectorAll('.mock-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderMock(currentMock);
    };
  });

  nav.querySelectorAll('.section-filter').forEach((button) => {
    button.onclick = () => {
      activeSectionId = button.dataset.sectionFilter;
      renderNav();
    };
  });

  const search = document.getElementById('mockSearch');
  search.oninput = () => {
    searchQuery = search.value.trim().toLowerCase();
    renderNav();
    document.getElementById('mockSearch').focus();
  };
}

function renderDashboard() {
  title.textContent = 'Dashboard';
  currentMock = null;
  document.querySelectorAll('.mock-btn').forEach((item) => item.classList.remove('active'));
  const mocks = course.sections.reduce((count, section) => count + section.mocks.length, 0);
  const attempts = course.sections.reduce((count, section) => (
    count + section.mocks.reduce((mockCount, mock) => mockCount + mock.attempts.length, 0)
  ), 0);
  const questions = course.sections.reduce((count, section) => (
    count + section.mocks.reduce((mockCount, mock) => (
      mockCount + mock.attempts.reduce((questionCount, attempt) => questionCount + attempt.questions.length, 0)
    ), 0)
  ), 0);

  content.innerHTML = `
    <div class="dashboard">
      <div class="metric"><strong>${course.sections.length}</strong><span>Sections</span></div>
      <div class="metric"><strong>${mocks}</strong><span>Mocks</span></div>
      <div class="metric"><strong>${attempts}</strong><span>Attempts</span></div>
      <div class="metric"><strong>${questions}</strong><span>Questions</span></div>
    </div>
    <div class="panel">
      <h2>${esc(course.courseTitle)}</h2>
      <p>Select a mock from the sidebar to practice MCQs or review saved answers, images, and audio.</p>
    </div>`;
}

function renderMock(mock) {
  setModeButtons();
  title.textContent = mock.title;
  if (sidebar) sidebar.classList.add('has-selection');
  const attempts = mock.attempts.filter((attempt) => (mode === 'review' ? attempt.mode === 'review' : true));
  const activeAttempts = attempts.length ? attempts : mock.attempts;
  const questionCount = activeAttempts.reduce((count, attempt) => count + attempt.questions.length, 0);
  content.innerHTML = `
    <div class="panel mock-header">
      <div>
        <h2>${esc(mock.title)}</h2>
        <p>${esc(currentSection.title)} - ${questionCount} questions</p>
      </div>
      <button class="primary" id="dashboardBtn" type="button">Dashboard</button>
    </div>
    ${activeAttempts.map(renderAttempt).join('')}`;
  document.getElementById('dashboardBtn').onclick = renderDashboard;
  wireOptions();
}

function renderAttempt(attempt) {
  return `<section class="panel">
    <h2>${attempt.mode === 'review' ? 'Review / answers' : 'Quiz page'}</h2>
    <p>Status: ${esc(attempt.status || 'Saved')}${attempt.score ? ` - Score: ${esc(attempt.score)}` : ''}${attempt.grade ? ` - Grade: ${esc(attempt.grade)}` : ''}</p>
  </section>${attempt.questions.map((question) => renderQuestion(question, attempt)).join('')}`;
}

function renderQuestion(question, attempt) {
  const key = `esl:${attempt.sourceHtml}:q${question.number}`;
  const saved = localStorage.getItem(key) || question.userAnswer || '';
  const status = question.correctAnswer && saved
    ? (saved === question.correctAnswer ? 'correct' : 'wrong')
    : question.isCorrect ? 'correct' : '';

  return `<article class="question-card ${status}">
    <div class="question-head">
      <h3>Question ${question.number}</h3>
      <span class="status-pill ${status}">${status === 'correct' ? 'Correct' : status === 'wrong' ? 'Review' : 'MCQ'}</span>
    </div>
    <div class="qtext">${question.questionHtml || esc(question.questionText)}</div>
    ${media(question)}
    <div class="options">${question.options.map((option) => optionHtml(option, question, key, saved)).join('')}</div>
    ${reviewBlock(question, saved)}
  </article>`;
}

function optionHtml(option, question, key, saved) {
  const selected = saved === option.label;
  const correct = question.correctAnswer === option.label;
  return `<label class="option ${selected ? 'selected ' : ''}${correct ? 'correct' : ''}">
    <input type="radio" name="${key}" value="${option.label}" ${selected ? 'checked' : ''} data-key="${key}">
    <strong>${esc(option.label)}.</strong>
    <span>${option.html || esc(option.text)}</span>
  </label>`;
}

function media(question) {
  const html = question.questionHtml || '';
  const audio = question.audio && !html.includes(question.audio)
    ? `<audio controls src="${esc(question.audio)}"></audio>`
    : '';
  const images = question.images
    .filter((src) => !html.includes(src))
    .map((src) => `<img src="${esc(src)}" loading="lazy">`)
    .join('');
  if (!audio && !images) return '';
  return `<div class="question-media">
    ${audio}
    ${images}
  </div>`;
}

function reviewBlock(question, saved) {
  if (mode !== 'review' && !question.correctAnswer) return '';
  return `<div class="explain">
    ${saved ? `<p><strong>Your answer:</strong> ${esc(saved)}</p>` : ''}
    ${question.correctAnswer ? `<p><strong>Correct answer:</strong> ${esc(question.correctAnswer)}</p>` : ''}
    ${question.explanation ? `<p><strong>Explanation:</strong> ${esc(question.explanation)}</p>` : ''}
    ${question.transcription ? `<p><strong>Transcription:</strong> ${esc(question.transcription)}</p>` : ''}
  </div>`;
}

function wireOptions() {
  document.querySelectorAll('input[type=radio][data-key]').forEach((input) => {
    input.onchange = () => {
      localStorage.setItem(input.dataset.key, input.value);
      if (currentMock) renderMock(currentMock);
    };
  });
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}
