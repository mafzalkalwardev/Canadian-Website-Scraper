let course;
let currentSection;
let currentMock;
let currentPage = null;
let mode = 'quiz';
let activeSectionId = 'all';
let searchQuery = '';
let userProfile = null;
let showResults = false;

const PROFILE_KEY = 'maaw:profile';
const RESULTS_KEY = 'maaw:results';

const nav = document.getElementById('sectionNav');
const content = document.getElementById('content');
const title = document.getElementById('pageTitle');
const meta = document.getElementById('courseMeta');
const quizBtn = document.getElementById('quizModeBtn');
const reviewBtn = document.getElementById('reviewModeBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const menuToggle = document.getElementById('menuToggle');
const quizProgress = document.getElementById('quizProgress');
const submitBar = document.getElementById('submitBar');
const submitQuizBtn = document.getElementById('submitQuizBtn');
const submitHint = document.getElementById('submitHint');
const profileGate = document.getElementById('profileGate');
const profileForm = document.getElementById('profileForm');
const userChip = document.getElementById('userChip');

if (menuToggle) menuToggle.onclick = () => toggleSidebar(true);
if (sidebarOverlay) sidebarOverlay.onclick = () => toggleSidebar(false);

if (profileForm) {
  profileForm.onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(profileForm);
    userProfile = {
      name: String(data.get('name') || '').trim(),
      age: String(data.get('age') || '').trim(),
      gender: String(data.get('gender') || '').trim(),
      joinedAt: new Date().toISOString(),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    profileGate.hidden = true;
    renderUserChip();
    if (course) renderDashboard();
  };
}

quizBtn.onclick = () => {
  if (isMockSubmitted()) {
    mode = 'review';
    showResults = true;
  } else {
    mode = 'quiz';
    showResults = false;
  }
  setModeButtons();
  if (currentMock) renderMock(currentMock);
};

reviewBtn.onclick = () => {
  mode = 'review';
  showResults = true;
  setModeButtons();
  if (currentMock) renderMock(currentMock);
};

if (submitQuizBtn) {
  submitQuizBtn.onclick = () => submitCurrentQuiz();
}

loadProfile();
boot();

function boot() {
  Promise.all([
    fetch('data/course.json').then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }),
    fetch('data/production-pages.json')
      .then((response) => (response.ok ? response.json() : { sections: [] }))
      .catch(() => ({ sections: [] })),
  ])
    .then(([data, production]) => {
      course = data;
      mergeProductionPages(production);
      const mockCount = data.sections.reduce((count, section) => count + section.mocks.length, 0);
      const pageCount = data.sections.reduce((count, section) => count + (section.pages || []).length, 0);
      meta.textContent = `${mockCount} mocks · ${pageCount} study pages`;
      renderUserChip();
      renderNav();
      if (userProfile) renderDashboard();
      else profileGate.hidden = false;
      hideQuizProgress();
      updateSubmitBar();
    })
    .catch((err) => {
      content.innerHTML = `<div class="empty">Unable to load course data: ${esc(err.message || err)}</div>`;
      hideQuizProgress();
    });
}

function mergeProductionPages(production) {
  if (!production?.sections?.length) return;
  production.sections.forEach((prodSection) => {
    const section = course.sections.find((item) => item.id === prodSection.id);
    if (section) {
      section.pages = prodSection.pages || [];
      if (prodSection.title) section.title = prodSection.title;
    } else {
      course.sections.push({
        id: prodSection.id,
        title: prodSection.title,
        mocks: [],
        pages: prodSection.pages || [],
      });
    }
  });
}

function loadProfile() {
  try {
    userProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch (err) {
    userProfile = null;
  }
  if (userProfile && profileGate) profileGate.hidden = true;
}

function renderUserChip() {
  if (!userChip || !userProfile) return;
  userChip.hidden = false;
  userChip.innerHTML = `<strong>${esc(userProfile.name)}</strong><br>Age ${esc(userProfile.age)} · ${esc(userProfile.gender)}`;
}

function getResults() {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function resultKey(section, mock) {
  return `${section.id}:${mock.id}`;
}

function getMockResult(section, mock) {
  return getResults()[resultKey(section, mock)] || null;
}

function isMockSubmitted() {
  if (!currentSection || !currentMock) return false;
  return Boolean(getMockResult(currentSection, currentMock));
}

function setModeButtons() {
  quizBtn.classList.toggle('active', mode === 'quiz');
  reviewBtn.classList.toggle('active', mode === 'review');
}

function toggleSidebar(open) {
  if (!sidebar) return;
  const shouldOpen = typeof open === 'boolean' ? open : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  if (sidebarOverlay) sidebarOverlay.hidden = !shouldOpen;
  if (menuToggle) menuToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function resolveAssetUrl(src) {
  if (!src || typeof src !== 'string') return src;
  if (isJunkMediaUrl(src)) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  const prefix = 'assets/source/storage.googleapis.com/';
  if (src.startsWith(prefix)) {
    let rest = src.slice(prefix.length);
    try { rest = decodeURIComponent(rest); } catch (err) { /* keep */ }
    return `https://storage.googleapis.com/${rest}`;
  }
  const tefPrefix = 'assets/source/tefcanada.ca/';
  if (src.startsWith(tefPrefix)) {
    return `https://tefcanada.ca/${src.slice(tefPrefix.length)}`;
  }
  return src;
}

function isJunkMediaUrl(value) {
  if (!value || typeof value !== 'string') return true;
  return /unflagged|flagged|questionflag|theme\/image\.php|\/i\/unflagged|\/i\/flagged|pix\/i\/|\.svg(\?|$)/i.test(value);
}

function fixAssetHtml(html) {
  if (!html) return html;
  return html
    .replace(/<img\b[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => (isJunkMediaUrl(src) ? '' : match))
    .replace(/src="([^"]+)"/g, (match, src) => `src="${esc(resolveAssetUrl(src))}"`);
}

function gradeClass(pct) {
  if (pct >= 70) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}

function allMocks() {
  const list = [];
  course.sections.forEach((section) => {
    section.mocks.forEach((mock) => list.push({ section, mock }));
  });
  return list;
}

function renderNav() {
  const sectionsWithContent = course.sections.filter((section) => section.mocks.length || (section.pages || []).length);
  const results = getResults();
  const sectionTabs = [
    `<button class="section-filter ${activeSectionId === 'all' ? 'active' : ''}" data-section-filter="all" type="button">All</button>`,
    ...sectionsWithContent.map((section) => (
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
      pages: (section.pages || []).filter((page) => {
        const haystack = `${section.title} ${page.title} ${page.id}`.toLowerCase();
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
        const result = results[resultKey(section, mock)];
        const scoreBadge = result
          ? `<span class="mock-btn-score">${esc(result.grade)}</span>`
          : '';
        return `<button class="mock-btn" data-section="${section.id}" data-mock="${mock.id}">
          <span class="mock-btn-icon">📝</span>
          <span class="mock-btn-body"><strong>${esc(mock.title)}</strong><small>${questionCount} questions</small></span>
          ${scoreBadge}
        </button>`;
      }).join('')
      : '';
    const pages = (section.pages || []).length
      ? section.pages.map((page) => (
        `<button class="mock-btn page-btn" data-section="${section.id}" data-page="${page.id}">
          <span class="mock-btn-icon">📄</span>
          <span class="mock-btn-body"><strong>${esc(page.title)}</strong><small>Study page</small></span>
        </button>`
      )).join('')
      : '';
    const body = mocks || pages
      ? `${mocks}${pages}`
      : '<div class="empty">No content in this section</div>';
    return `<section class="section-card"><h3>${esc(section.title)}</h3>${body}</section>`;
  }).join('')}`;

  nav.querySelectorAll('.mock-btn[data-mock]').forEach((button) => {
    button.onclick = () => {
      currentSection = course.sections.find((section) => section.id === button.dataset.section);
      currentMock = currentSection.mocks.find((mock) => mock.id === button.dataset.mock);
      currentPage = null;
      const submitted = Boolean(getMockResult(currentSection, currentMock));
      if (submitted) {
        mode = 'review';
        showResults = true;
      } else {
        showResults = mode === 'review';
      }
      setModeButtons();
      document.querySelectorAll('.mock-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderMock(currentMock);
      if (window.matchMedia('(max-width: 960px)').matches) toggleSidebar(false);
    };
  });

  nav.querySelectorAll('.mock-btn[data-page]').forEach((button) => {
    button.onclick = () => {
      currentSection = course.sections.find((section) => section.id === button.dataset.section);
      currentPage = (currentSection.pages || []).find((page) => page.id === button.dataset.page);
      currentMock = null;
      showResults = false;
      document.querySelectorAll('.mock-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderProductionPage(currentPage);
      if (window.matchMedia('(max-width: 960px)').matches) toggleSidebar(false);
    };
  });

  nav.querySelectorAll('.section-filter').forEach((button) => {
    button.onclick = () => {
      activeSectionId = button.dataset.sectionFilter;
      renderNav();
    };
  });

  const search = document.getElementById('mockSearch');
  if (search) {
    search.oninput = () => {
      searchQuery = search.value.trim().toLowerCase();
      renderNav();
      document.getElementById('mockSearch').focus();
    };
  }
}

function renderDashboard() {
  title.textContent = 'Dashboard';
  currentMock = null;
  showResults = false;
  content.scrollTop = 0;
  document.querySelectorAll('.mock-btn').forEach((item) => item.classList.remove('active'));
  hideQuizProgress();
  updateSubmitBar();

  const mocks = course.sections.reduce((count, section) => count + section.mocks.length, 0);
  const questions = course.sections.reduce((count, section) => (
    count + section.mocks.reduce((mockCount, mock) => (
      mockCount + mock.attempts.reduce((questionCount, attempt) => questionCount + attempt.questions.length, 0)
    ), 0)
  ), 0);

  const results = getResults();
  const submitted = Object.keys(results).length;
  const avgPct = submitted
    ? Math.round(Object.values(results).reduce((sum, item) => sum + item.pct, 0) / submitted * 10) / 10
    : 0;

  const courseComplete = submitted >= mocks && mocks > 0;

  content.innerHTML = `
    <div class="dashboard">
      <div class="metric"><div class="metric-icon">📚</div><strong>${course.sections.length}</strong><span>Sections</span></div>
      <div class="metric"><div class="metric-icon">📝</div><strong>${mocks}</strong><span>Mocks</span></div>
      <div class="metric"><div class="metric-icon">✅</div><strong>${submitted}</strong><span>Submitted</span></div>
      <div class="metric"><div class="metric-icon">❓</div><strong>${questions}</strong><span>Questions</span></div>
    </div>
    <div class="hero-panel">
      <div>
        <h2>Bienvenue, ${esc(userProfile ? userProfile.name : 'Student')}!</h2>
        <p>${esc(course.courseTitle)}</p>
        <p style="margin-top:8px;font-size:14px;opacity:.85">Your path to French language success — practice, submit, and track every mock.</p>
      </div>
      <img class="hero-logo" src="logo.png" alt="Success Web">
    </div>
    ${courseComplete ? renderCourseResultCard() : ''}
    ${submitted ? renderResultsSummaryTable() : `<div class="panel"><h2>Get started</h2><p>Pick a mock from the sidebar, answer in <strong>Quiz</strong> mode, then click <strong>Submit Quiz</strong> to see your grade.</p></div>`}`;
}

function renderCourseResultCard() {
  const results = getResults();
  const entries = Object.values(results);
  const avg = entries.length
    ? Math.round(entries.reduce((sum, item) => sum + item.pct, 0) / entries.length * 10) / 10
    : 0;
  const totalCorrect = entries.reduce((sum, item) => sum + item.correct, 0);
  const totalGraded = entries.reduce((sum, item) => sum + item.graded, 0);

  return `<div class="result-card course-result">
    <p class="eyebrow" style="margin-bottom:8px">Course Complete</p>
    <h2 style="margin:0 0 8px;font-family:'Playfair Display',serif">Congratulations, ${esc(userProfile.name)}!</h2>
    <p style="color:var(--muted);margin:0 0 16px">You submitted all ${entries.length} mocks.</p>
    <div class="result-grade">${avg}%</div>
    <div class="result-stats">
      <div class="result-stat"><strong>${totalCorrect}</strong><span>Correct answers</span></div>
      <div class="result-stat"><strong>${totalGraded}</strong><span>Graded questions</span></div>
      <div class="result-stat"><strong>${entries.length}</strong><span>Mocks done</span></div>
    </div>
    <p style="font-size:14px;color:var(--muted)">Age ${esc(userProfile.age)} · ${esc(userProfile.gender)}</p>
  </div>`;
}

function renderResultsSummaryTable() {
  const results = getResults();
  const rows = Object.entries(results).map(([key, result]) => {
    const wrong = result.wrong ?? Math.max(0, result.graded - result.correct);
    return `<tr>
      <td>${esc(result.sectionTitle)}</td>
      <td>${esc(result.mockTitle)}</td>
      <td>${result.correct} ✓ · ${wrong} ✗</td>
      <td><span class="grade-badge ${gradeClass(result.pct)}">${esc(result.grade)}</span></td>
    </tr>`;
  }).join('');

  return `<div class="panel">
    <h2>Your quiz results</h2>
    <div style="overflow-x:auto">
      <table class="results-table">
        <thead><tr><th>Section</th><th>Mock</th><th>Score</th><th>Grade</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function getReviewQuestions(mock) {
  const review = mock.attempts.find((attempt) => attempt.mode === 'review' && attempt.questions.length);
  if (review) return review.questions;
  const fallback = mock.attempts.find((attempt) => attempt.questions.length);
  return fallback ? fallback.questions : [];
}

function getCorrectAnswer(mock, questionNumber) {
  const reviewMap = new Map(getReviewQuestions(mock).map((question) => [question.number, question.correctAnswer]));
  const active = attemptsForMode(mock).flatMap((attempt) => attempt.questions);
  const question = active.find((item) => item.number === questionNumber);
  return (question && question.correctAnswer) || reviewMap.get(questionNumber) || '';
}

function getDisplayQuestions(mock) {
  if (isMockSubmitted() || mode === 'review' || showResults) {
    const reviewQs = getReviewQuestions(mock);
    if (reviewQs.length) return reviewQs;
  }
  return attemptsForMode(mock).flatMap((attempt) => attempt.questions);
}

function scoreMock(mock) {
  const questions = getDisplayQuestions(mock);
  let correct = 0;
  let graded = 0;
  let answered = 0;

  questions.forEach((question) => {
    const userAnswer = localStorage.getItem(answerKey(question)) || '';
    if (userAnswer) answered += 1;
    const correctAnswer = question.correctAnswer || getCorrectAnswer(mock, question.number);
    if (!correctAnswer) return;
    graded += 1;
    if (userAnswer === correctAnswer) correct += 1;
  });

  const wrong = graded - correct;
  const skipped = questions.length - answered;
  const pct = graded ? Math.round((correct / graded) * 1000) / 10 : 0;

  return {
    correct,
    wrong,
    skipped,
    graded,
    total: questions.length,
    answered,
    ungraded: questions.length - graded,
    pct,
    grade: `${pct}%`,
  };
}

function submitCurrentQuiz() {
  if (!currentMock || !currentSection) return;
  const score = scoreMock(currentMock);

  if (score.answered === 0) {
    submitHint.textContent = 'Please answer at least one question before submitting.';
    return;
  }

  const unanswered = score.total - score.answered;
  const confirmMsg = unanswered > 0
    ? `You have ${unanswered} unanswered question(s). Submit anyway and view your results?`
    : 'Submit your quiz? You will see your score and correct answers in review mode.';
  if (!confirm(confirmMsg)) return;

  const results = getResults();
  results[resultKey(currentSection, currentMock)] = {
    mockTitle: currentMock.title,
    sectionTitle: currentSection.title,
    sectionId: currentSection.id,
    mockId: currentMock.id,
    ...score,
    submittedAt: new Date().toISOString(),
  };
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));

  mode = 'review';
  showResults = true;
  setModeButtons();
  renderNav();
  renderMock(currentMock);

  requestAnimationFrame(() => {
    document.getElementById('quizResultCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const all = allMocks().length;
  if (Object.keys(results).length >= all) {
    setTimeout(() => {
      if (confirm('Congratulations! You completed all mocks. View your course result on the dashboard?')) {
        renderDashboard();
      }
    }, 600);
  }
}

function retakeMock() {
  if (!currentMock) return;
  currentMock.attempts.flatMap((attempt) => attempt.questions).forEach((question) => {
    localStorage.removeItem(answerKey(question));
  });
  const results = getResults();
  delete results[resultKey(currentSection, currentMock)];
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  mode = 'quiz';
  showResults = false;
  setModeButtons();
  renderNav();
  renderMock(currentMock);
}

function renderProductionPage(page) {
  if (!page || !currentSection) return;
  title.textContent = page.title;
  currentMock = null;
  hideQuizProgress();
  updateSubmitBar();
  content.innerHTML = `
    <div class="panel mock-header">
      <div>
        <h2>${esc(page.title)}</h2>
        <p>${esc(currentSection.title)} · Study material</p>
      </div>
      <button class="primary" type="button" id="dashboardBtn">Dashboard</button>
    </div>
    <article class="panel production-page">
      <div class="qtext">${fixAssetHtml(page.html || esc(page.text || ''))}</div>
    </article>`;
  document.getElementById('dashboardBtn').onclick = renderDashboard;
}

function renderMock(mock) {
  setModeButtons();
  title.textContent = mock.title;
  const submitted = isMockSubmitted();
  const result = getMockResult(currentSection, mock);
  const reveal = mode === 'review' || showResults || submitted;
  const displayQuestions = getDisplayQuestions(mock);

  updateQuizProgress(mock, displayQuestions);

  let headerExtra = '';
  if (submitted && result) {
    headerExtra = renderQuizResultCard(result);
  }

  const reviewBanner = reveal && submitted
    ? `<section class="panel review-banner">
        <h2>Answer Review</h2>
        <p style="margin:0;color:var(--muted)">Scroll through each question — <strong style="color:var(--green)">green</strong> marks the correct answer, <strong style="color:var(--red)">red</strong> shows your wrong choice.</p>
      </section>`
    : reveal && !submitted
      ? `<section class="panel review-banner"><h2>Review Mode</h2><p style="margin:0;color:var(--muted)">Compare your saved answers with the correct ones below.</p></section>`
      : `<section class="panel"><h2>Quiz</h2><p style="margin:0;color:var(--muted)">Select your answers for all questions, then click <strong>Submit Quiz</strong>.</p></section>`;

  content.innerHTML = `
    <div class="panel mock-header">
      <div>
        <h2>${esc(mock.title)}</h2>
        <p style="color:var(--muted);margin:4px 0 0">${esc(currentSection.title)} · ${displayQuestions.length} questions</p>
      </div>
      <div class="action-row" style="margin:0">
        <button class="btn-secondary" id="dashboardBtn" type="button">Dashboard</button>
        ${submitted ? '<button class="btn-secondary btn-danger" id="retakeBtn" type="button">Retake Quiz</button>' : ''}
      </div>
    </div>
    ${headerExtra}
    ${reviewBanner}
    ${displayQuestions.map((question) => renderQuestion(question, mock, reveal)).join('')}`;

  content.scrollTop = 0;
  document.getElementById('dashboardBtn').onclick = renderDashboard;
  const retakeBtn = document.getElementById('retakeBtn');
  if (retakeBtn) retakeBtn.onclick = retakeMock;
  wireOptions(reveal && submitted);
  wireMedia();
  updateSubmitBar();
}

function renderQuizResultCard(result) {
  const wrong = result.wrong ?? Math.max(0, result.graded - result.correct);
  const skipped = result.skipped ?? Math.max(0, result.total - result.answered);
  const correctPct = result.graded ? Math.round((result.correct / result.graded) * 100) : 0;
  const wrongPct = result.graded ? Math.round((wrong / result.graded) * 100) : 0;
  const verdict = result.pct >= 70
    ? 'Excellent work! Review any mistakes below.'
    : result.pct >= 50
      ? 'Good effort — check the questions you missed below.'
      : 'Keep practicing — review the correct answers below.';

  return `<div class="result-card quiz-result" id="quizResultCard">
    <p class="eyebrow" style="margin-bottom:6px">Quiz Submitted — Now in Review Mode</p>
    <div class="result-grade">${esc(result.grade)}</div>
    <p class="result-verdict">${verdict}</p>
    <div class="score-breakdown">
      <div class="score-bar">
        <div class="score-bar-correct" style="width:${correctPct}%"></div>
        <div class="score-bar-wrong" style="width:${wrongPct}%"></div>
      </div>
      <div class="score-legend">
        <span class="legend-item correct">${result.correct} Correct (${correctPct}%)</span>
        <span class="legend-item wrong">${wrong} Wrong (${wrongPct}%)</span>
        <span class="legend-item skipped">${skipped} Unanswered</span>
      </div>
    </div>
    <div class="result-stats">
      <div class="result-stat"><strong>${result.correct}</strong><span>Correct</span></div>
      <div class="result-stat"><strong>${wrong}</strong><span>Wrong</span></div>
      <div class="result-stat"><strong>${skipped}</strong><span>Skipped</span></div>
      <div class="result-stat"><strong>${result.graded}</strong><span>Graded</span></div>
    </div>
    <p class="result-summary-line">You scored <strong>${result.correct} / ${result.graded}</strong> on graded questions — overall grade <strong>${esc(result.grade)}</strong>.</p>
  </div>`;
}

function updateQuizProgress(mock, questions) {
  if (!quizProgress) return;
  if (mode !== 'quiz' || !mock || showResults || isMockSubmitted()) {
    hideQuizProgress();
    return;
  }

  const total = questions.length;
  const answered = questions.filter((question) => localStorage.getItem(answerKey(question))).length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  quizProgress.hidden = false;
  quizProgress.innerHTML = `
    <div class="quiz-progress-inner">
      <span>Progress: ${answered} / ${total} answered</span>
      <span>${pct}%</span>
    </div>
    <div class="quiz-progress-bar" role="progressbar" aria-valuenow="${answered}" aria-valuemin="0" aria-valuemax="${total}">
      <div class="quiz-progress-fill" style="width:${pct}%"></div>
    </div>`;
}

function hideQuizProgress() {
  if (!quizProgress) return;
  quizProgress.hidden = true;
  quizProgress.innerHTML = '';
}

function updateSubmitBar() {
  if (!submitBar) return;
  const show = mode === 'quiz' && currentMock && !showResults && !isMockSubmitted();
  submitBar.hidden = !show;
  if (show && submitHint) {
    submitHint.textContent = 'Answer all questions, then submit to see your grade.';
  }
}

function renderQuestion(question, mock, reveal) {
  const key = answerKey(question);
  const saved = savedAnswer(question);
  const correctAnswer = question.correctAnswer || getCorrectAnswer(mock, question.number);
  let status = '';

  if (reveal && correctAnswer) {
    if (!saved) status = 'unanswered';
    else status = saved === correctAnswer ? 'correct' : 'wrong';
  } else if (reveal && !correctAnswer && saved) {
    status = '';
  }

  const statusLabel = status === 'correct'
    ? '✓ Correct'
    : status === 'wrong'
      ? '✗ Wrong'
      : status === 'unanswered'
        ? '○ Skipped'
        : 'MCQ';

  return `<article class="question-card ${status}" id="q-${question.number}">
    <div class="question-head">
      <h3>Question ${question.number}</h3>
      <span class="status-pill ${status}">${statusLabel}</span>
    </div>
    <div class="qtext">${fixAssetHtml(question.questionHtml || esc(question.questionText))}</div>
    ${media(question)}
    <div class="options">${question.options.map((option) => optionHtml(option, question, key, saved, reveal, correctAnswer)).join('')}</div>
    ${reviewBlock(question, saved, reveal, correctAnswer)}
  </article>`;
}

function optionHtml(option, question, key, saved, reveal, correctAnswer) {
  const selected = saved === option.label;
  const isCorrectOption = reveal && correctAnswer === option.label;
  const isWrongChoice = reveal && selected && correctAnswer && saved !== correctAnswer;
  const locked = reveal && (isMockSubmitted() || mode === 'review');

  const classes = [
    'option',
    isCorrectOption ? 'correct-answer' : '',
    isWrongChoice ? 'wrong' : '',
    selected && isCorrectOption ? 'selected' : '',
    selected && isWrongChoice ? 'selected' : '',
    locked ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  return `<label class="${classes}">
    <input type="radio" name="${key}" value="${option.label}" ${selected ? 'checked' : ''} data-key="${key}"${locked ? ' disabled' : ''}>
    <strong>${esc(option.label)}.</strong>
    <span>${fixAssetHtml(option.html || esc(option.text))}</span>
    ${reveal && isCorrectOption ? '<span style="margin-left:auto;font-size:11px;font-weight:800;color:var(--green)">Correct</span>' : ''}
    ${reveal && isWrongChoice ? '<span style="margin-left:auto;font-size:11px;font-weight:800;color:var(--red)">Your choice</span>' : ''}
  </label>`;
}

function media(question) {
  const html = question.questionHtml || '';
  const audioSrc = question.audio ? resolveAssetUrl(question.audio) : '';
  const hasAudio = audioSrc && !html.includes(question.audio);
  const images = (question.images || []).filter((src) => !html.includes(src) && !isJunkMediaUrl(src));

  if (!hasAudio && !images.length) return '';

  const audio = hasAudio
    ? `<div class="question-media-label">🎧 Listen carefully</div>
       <audio controls preload="metadata" src="${esc(audioSrc)}" data-media="audio"></audio>
       <div class="media-error" hidden data-media-error>Audio failed to load. <a href="${esc(audioSrc)}" target="_blank" rel="noopener">Open audio</a></div>`
    : '';

  const imageHtml = images.map((src) => {
    const url = resolveAssetUrl(src);
    return `<img src="${esc(url)}" loading="lazy" alt="Question image" data-media="image">
            <div class="media-error" hidden data-media-error>Image failed to load.</div>`;
  }).join('');

  return `<div class="question-media">${audio}${imageHtml}</div>`;
}

function wireMedia() {
  document.querySelectorAll('audio[data-media], img[data-media]').forEach((element) => {
    const errorEl = element.parentElement && element.parentElement.querySelector('[data-media-error]');
    const showError = () => { if (errorEl) errorEl.hidden = false; };
    element.addEventListener('error', showError);
  });
}

function reviewBlock(question, saved, reveal, correctAnswer) {
  if (!reveal) return '';

  if (!correctAnswer) {
    return saved
      ? `<div class="explain"><p><strong>Your answer:</strong> ${esc(saved)}</p><p><em>Official correct answer not available for auto-grading.</em></p></div>`
      : '';
  }

  const isCorrect = saved === correctAnswer;
  let verdict = '';

  if (isCorrect) {
    verdict = `<p class="answer-verdict correct">✓ Correct! You chose <strong>${esc(saved)}</strong>.</p>`;
  } else if (saved) {
    verdict = `<p class="answer-verdict wrong">✗ Incorrect. You chose <strong>${esc(saved)}</strong> — the correct answer is <strong>${esc(correctAnswer)}</strong>.</p>`;
  } else {
    verdict = `<p class="answer-verdict skipped">○ You did not answer this question. The correct answer is <strong>${esc(correctAnswer)}</strong>.</p>`;
  }

  return `<div class="explain ${isCorrect ? 'explain-correct' : saved ? 'explain-wrong' : ''}">
    ${verdict}
    ${question.explanation ? `<p><strong>Explanation:</strong> ${esc(question.explanation)}</p>` : ''}
    ${question.transcription ? `<p><strong>Transcription:</strong> ${esc(question.transcription)}</p>` : ''}
  </div>`;
}

function attemptsForMode(mock) {
  const withQuestions = mock.attempts.filter((attempt) => attempt.questions.length);
  if (mode === 'review') {
    const reviews = withQuestions.filter((attempt) => attempt.mode === 'review');
    return reviews.length ? reviews : withQuestions;
  }
  const practice = withQuestions.filter((attempt) => attempt.mode !== 'review');
  return practice.length ? practice : withQuestions;
}

function answerKey(question) {
  return `maaw:${currentSection ? currentSection.id : 'sec'}:${currentMock ? currentMock.id : 'mock'}:q${question.number}`;
}

function savedAnswer(question) {
  return localStorage.getItem(answerKey(question)) || '';
}

function wireOptions(lock) {
  document.querySelectorAll('input[type=radio][data-key]').forEach((input) => {
    if (lock) return;
    input.onchange = () => {
      localStorage.setItem(input.dataset.key, input.value);
      const scroller = document.querySelector('.content');
      const prevScrollTop = scroller ? scroller.scrollTop : null;
      if (currentMock) {
        updateQuizProgress(currentMock, getDisplayQuestions(currentMock));
        renderMock(currentMock);
      }
      if (scroller && prevScrollTop !== null) scroller.scrollTop = prevScrollTop;
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
