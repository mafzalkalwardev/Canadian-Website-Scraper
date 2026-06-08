const fs = require('fs');
const path = require('path');

const CSS_TEMPLATE = path.join(__dirname, 'review-template.css');
const exportDir = path.resolve(process.argv[2] || '');
if (!exportDir || !fs.existsSync(exportDir)) {
  console.error('Usage: node scripts/build-review-website.js <export-dir>');
  process.exit(1);
}

const manifestPath = path.join(exportDir, 'quiz_deep_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pages = manifest.pages.map((page, index) => {
  const fileBase = page.htmlFile.replace(/\.html$/i, '');
  const quizMatch = page.htmlFile.match(/quiz_(\d+)/i);
  const kind = /question/i.test(page.htmlFile)
    ? 'Practice'
    : /review/i.test(page.htmlFile)
      ? 'Review'
      : 'Overview';
  const group = quizMatch ? `Mock ${Number(quizMatch[1])}` : 'Course';
  return {
    id: index + 1,
    title: cleanTitle(page.title),
    url: page.url,
    htmlFile: page.htmlFile,
    textFile: page.textFile,
    screenshotFile: page.screenshotFile,
    assetCount: page.assetCount || 0,
    kind,
    group,
    fileBase,
  };
});

fs.writeFileSync(path.join(exportDir, 'website-data.js'), `window.ESL_PAGES = ${JSON.stringify(pages, null, 2)};\n`, 'utf8');
fs.writeFileSync(path.join(exportDir, 'review.css'), css(), 'utf8');
fs.writeFileSync(path.join(exportDir, 'review.js'), js(), 'utf8');
fs.writeFileSync(path.join(exportDir, 'index.html'), html(manifest), 'utf8');

console.log(`Built Enterpreneural Success Language review website with ${pages.length} pages.`);

function cleanTitle(value) {
  return String(value || 'Saved page')
    .replace(/\s*\|\s*tefsuccess\s*$/i, '')
    .replace(/^PREMIUM PLAN:\s*/i, '')
    .trim();
}

function html(manifest) {
  const reviewCount = pages.filter((page) => page.kind === 'Review').length;
  const practiceCount = pages.filter((page) => page.kind === 'Practice').length;
  const assetTotal = pages.reduce((total, page) => total + page.assetCount, 0);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Enterpreneural Success Language</title>
  <link rel="stylesheet" href="review.css">
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <header class="brand">
        <div class="mark" aria-hidden="true">ES</div>
        <div>
          <h1>Enterpreneural Success Language</h1>
          <p>${manifest.pageCount} saved pages</p>
        </div>
      </header>

      <section class="summary" aria-label="Saved content summary">
        <div>
          <strong>${reviewCount}</strong>
          <span>Reviews</span>
        </div>
        <div>
          <strong>${practiceCount}</strong>
          <span>Practice</span>
        </div>
        <div>
          <strong>${assetTotal}</strong>
          <span>Assets</span>
        </div>
      </section>

      <section class="toolbar" aria-label="Content filters">
        <label class="search">
          <span>Search</span>
          <input id="searchInput" type="search" autocomplete="off" placeholder="Mock, review, question">
        </label>
        <div class="segments" role="tablist" aria-label="Page type">
          <button class="segment active" data-filter="All" type="button">All</button>
          <button class="segment" data-filter="Overview" type="button">Overview</button>
          <button class="segment" data-filter="Review" type="button">Review</button>
          <button class="segment" data-filter="Practice" type="button">Practice</button>
        </div>
      </section>

      <nav id="pageList" class="page-list" aria-label="Saved pages"></nav>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div class="topbar-stack">
          <nav class="main-nav" aria-label="Primary page filters">
            <button class="nav-item active" data-nav-filter="All" type="button">All Pages</button>
            <button class="nav-item" data-nav-filter="Overview" type="button">Overviews</button>
            <button class="nav-item" data-nav-filter="Review" type="button">Reviews</button>
            <button class="nav-item" data-nav-filter="Practice" type="button">Practice</button>
          </nav>
          <div class="current">
            <span id="currentKind">Review</span>
            <h2 id="currentTitle">Saved Course Page</h2>
          </div>
        </div>
        <div class="actions">
          <button id="prevBtn" class="icon-button" type="button" title="Previous page" aria-label="Previous page">
            <span aria-hidden="true">&larr;</span>
          </button>
          <button id="nextBtn" class="icon-button" type="button" title="Next page" aria-label="Next page">
            <span aria-hidden="true">&rarr;</span>
          </button>
          <a id="htmlLink" class="action-link" href="#" target="_blank" rel="noopener">HTML</a>
          <a id="textLink" class="action-link" href="#" target="_blank" rel="noopener">Text</a>
          <a id="shotLink" class="action-link" href="#" target="_blank" rel="noopener">Screenshot</a>
        </div>
      </header>

      <section class="viewer-shell">
        <iframe id="viewer" title="Saved TEFSuccess page viewer"></iframe>
      </section>
    </main>
  </div>

  <script src="website-data.js"></script>
  <script src="review.js"></script>
</body>
</html>
`;
}

function css() {
  return fs.readFileSync(CSS_TEMPLATE, 'utf8');

  return `:root {
  color-scheme: light;
  --ink: #18212f;
  --muted: #657084;
  --line: #d9e0e8;
  --panel: #ffffff;
  --page: #f4f6f8;
  --green: #0f766e;
  --coral: #b94731;
  --gold: #a46a14;
  --blue: #315f9f;
  --focus: #173f7a;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: Arial, Helvetica, sans-serif;
  color: var(--ink);
  background: var(--page);
}

button, input { font: inherit; }

.app {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: #fbfcfd;
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 18px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: var(--green);
  color: #fff;
  font-weight: 700;
}

.brand h1 {
  margin: 0;
  font-size: 17px;
  line-height: 1.2;
}

.brand p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.toolbar {
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--line);
}

.search {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.search input {
  width: 100%;
  min-height: 38px;
  border: 1px solid #c7d0db;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--ink);
  background: #fff;
}

.search input:focus {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.segments {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 12px;
}

.segment {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: #38465a;
  cursor: pointer;
}

.segment.active {
  border-color: var(--green);
  background: #e8f4f1;
  color: #0b534d;
  font-weight: 700;
}

.page-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.page-button {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.page-button:hover { background: #eef3f7; }

.page-button.active {
  border-color: #b8c7d8;
  background: #fff;
  box-shadow: 0 1px 3px rgba(24, 33, 47, 0.08);
}

.num {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 7px;
  background: #e9edf3;
  color: #4b5b70;
  font-size: 12px;
  font-weight: 700;
}

.page-button.active .num {
  background: var(--blue);
  color: #fff;
}

.page-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
}

.page-meta {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}

.badge {
  border-radius: 999px;
  padding: 4px 7px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.badge.Overview { background: var(--blue); }
.badge.Review { background: var(--green); }
.badge.Practice { background: var(--coral); }

.workspace {
  display: grid;
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.topbar {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  border-bottom: 1px solid var(--line);
  padding: 12px 16px;
  background: var(--panel);
}

.current {
  min-width: 0;
}

.current span {
  display: inline-block;
  color: var(--gold);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.current h2 {
  margin: 3px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 20px;
}

.actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
}

.icon-button,
.action-link {
  display: inline-grid;
  min-width: 38px;
  min-height: 36px;
  place-items: center;
  border: 1px solid #c7d0db;
  border-radius: 6px;
  background: #fff;
  color: #243246;
  text-decoration: none;
  cursor: pointer;
}

.action-link {
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
}

.icon-button:hover,
.action-link:hover {
  border-color: #94a5b8;
  background: #f5f8fb;
}

.viewer-shell {
  min-height: 0;
  padding: 12px;
}

#viewer {
  width: 100%;
  height: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

@media (max-width: 900px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(260px, 42vh) minmax(0, 1fr);
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .actions {
    width: 100%;
    overflow-x: auto;
  }
}
`;
}

function js() {
  return `const pages = window.ESL_PAGES || [];
let currentFilter = 'All';
let currentIndex = 0;

const list = document.getElementById('pageList');
const viewer = document.getElementById('viewer');
const searchInput = document.getElementById('searchInput');
const currentTitle = document.getElementById('currentTitle');
const currentKind = document.getElementById('currentKind');
const htmlLink = document.getElementById('htmlLink');
const textLink = document.getElementById('textLink');
const shotLink = document.getElementById('shotLink');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

function filteredPages() {
  const query = searchInput.value.trim().toLowerCase();
  return pages.filter((page) => {
    const matchesFilter = currentFilter === 'All' || page.kind === currentFilter;
    const haystack = [page.title, page.kind, page.group, page.url, page.htmlFile].join(' ').toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderList() {
  const items = filteredPages();
  list.innerHTML = '';
  for (const page of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-button' + (pages[currentIndex] === page ? ' active' : '');
    button.dataset.index = String(pages.indexOf(page));
    button.innerHTML = '<span class="num">' + page.id + '</span>' +
      '<span><span class="page-title">' + escapeHtml(page.title) + '</span>' +
      '<span class="page-meta">' + escapeHtml(page.group) + ' - ' + page.assetCount + ' assets</span></span>' +
      '<span class="badge ' + page.kind + '">' + page.kind + '</span>';
    button.addEventListener('click', () => selectPage(Number(button.dataset.index)));
    list.appendChild(button);
  }
}

function selectPage(index) {
  if (!pages[index]) return;
  currentIndex = index;
  const page = pages[currentIndex];
  viewer.src = page.htmlFile;
  currentTitle.textContent = page.title;
  currentKind.textContent = page.kind + ' - ' + page.group;
  htmlLink.href = page.htmlFile;
  textLink.href = page.textFile;
  shotLink.href = page.screenshotFile;
  renderList();
  const active = list.querySelector('.page-button.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function step(delta) {
  const items = filteredPages();
  const currentPage = pages[currentIndex];
  const filteredIndex = Math.max(0, items.indexOf(currentPage));
  const nextPage = items[filteredIndex + delta];
  if (nextPage) selectPage(pages.indexOf(nextPage));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

document.querySelectorAll('.segment').forEach((button) => {
  button.addEventListener('click', () => {
    setFilter(button.dataset.filter);
  });
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.navFilter));
});

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.segment').forEach((item) => {
    item.classList.toggle('active', item.dataset.filter === filter);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.navFilter === filter);
  });
  renderList();
  const first = filteredPages()[0];
  if (first) selectPage(pages.indexOf(first));
}

searchInput.addEventListener('input', () => {
  renderList();
  const items = filteredPages();
  if (items.length && !items.includes(pages[currentIndex])) selectPage(pages.indexOf(items[0]));
});

prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));

document.addEventListener('keydown', (event) => {
  if (event.target === searchInput) return;
  if (event.key === 'ArrowLeft') step(-1);
  if (event.key === 'ArrowRight') step(1);
  if (event.key === '/') {
    event.preventDefault();
    searchInput.focus();
  }
});

renderList();
selectPage(0);
`;
}
