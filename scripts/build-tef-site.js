const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const APP_TEMPLATE = path.join(__dirname, 'tef-app-template.js');
const sourceDir = path.resolve(process.argv[2] || '');
const outputDir = path.resolve(process.argv[3] || 'output');

if (!sourceDir || !fs.existsSync(sourceDir)) {
  console.error('Usage: node scripts/build-tef-site.js <source-export-dir> <output-dir>');
  process.exit(1);
}

const manifestPath = path.join(sourceDir, 'quiz_deep_manifest.json');
const manifest = fs.readJsonSync(manifestPath);

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

async function main() {
  await fs.remove(outputDir);
  await fs.ensureDir(path.join(outputDir, 'assets'));
  await fs.ensureDir(path.join(outputDir, 'data', 'sections'));
  await fs.ensureDir(path.join(outputDir, 'css'));
  await fs.ensureDir(path.join(outputDir, 'js'));

  await copyAssets();
  const course = buildCourse();
  await writeData(course);
  await writeFrontend();

  const questionCount = course.sections.reduce((total, section) => (
    total + section.mocks.reduce((mockTotal, mock) => (
      mockTotal + mock.attempts.reduce((attemptTotal, attempt) => attemptTotal + attempt.questions.length, 0)
    ), 0)
  ), 0);

  console.log(`Built structured TEF website: ${course.sections.length} sections, ${questionCount} questions.`);
}

async function copyAssets() {
  const assetsDir = path.join(sourceDir, 'assets');
  if (await fs.pathExists(assetsDir)) {
    await fs.copy(assetsDir, path.join(outputDir, 'assets', 'source'));
  }
}

function buildCourse() {
  const mocks = new Map();

  for (const page of manifest.pages) {
    const meta = pageMeta(page);
    if (!meta.mockId) continue;
    const htmlPath = path.join(sourceDir, page.htmlFile);
    if (!fs.existsSync(htmlPath)) continue;

    const html = fs.readFileSync(htmlPath, 'utf8');
    const questions = extractQuestions(html, page, meta);
    if (!mocks.has(meta.mockId)) {
      mocks.set(meta.mockId, {
        id: meta.mockId,
        title: meta.mockTitle,
        sourcePages: [],
        attempts: [],
      });
    }

    const mock = mocks.get(meta.mockId);
    mock.sourcePages.push({
      title: cleanTitle(page.title),
      htmlFile: page.htmlFile,
      screenshotFile: page.screenshotFile,
      type: meta.pageType,
    });

    if (questions.length) {
      mock.attempts.push({
        attemptNo: mock.attempts.length + 1,
        status: meta.pageType === 'review' ? 'Finished' : 'Practice',
        score: extractScore(html),
        grade: extractGrade(html),
        sourceHtml: page.htmlFile,
        sourceScreenshot: page.screenshotFile,
        mode: meta.pageType,
        questions,
      });
    }
  }

  const sectionMap = new Map();
  for (const mock of mocks.values()) {
    const hasAudio = mock.attempts.some((attempt) => attempt.questions.some((question) => question.audio));
    const sectionId = hasAudio ? 'comprehension_orale' : 'comprehension_ecrite';
    const sectionTitle = hasAudio ? 'Compréhension orale' : 'Compréhension écrite';
    if (!sectionMap.has(sectionId)) {
      sectionMap.set(sectionId, {
        id: sectionId,
        title: sectionTitle,
        mocks: [],
      });
    }
    sectionMap.get(sectionId).mocks.push(mock);
  }

  const sections = Array.from(sectionMap.values()).map((section) => ({
    ...section,
    mocks: section.mocks.sort((a, b) => naturalMockNumber(a.id) - naturalMockNumber(b.id)),
  }));

  for (const placeholder of [
    ['production_ecrite', 'Production écrite'],
    ['production_orale', 'Production orale'],
  ]) {
    if (!sectionMap.has(placeholder[0])) {
      sections.push({ id: placeholder[0], title: placeholder[1], mocks: [] });
    }
  }

  return {
    courseTitle: 'TEF SUCCESS PREPARATION - PREMIUM PLAN',
    sourceUrl: manifest.startUrl,
    capturedAt: manifest.capturedAt,
    sections,
  };
}

function extractQuestions(html, page, meta) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const questions = [];
  $('.que').each((index, element) => {
    const question = $(element);
    const number = Number(question.find('.qno').first().text().trim()) || index + 1;
    const state = normalizeText(question.find('.state').first().text());
    const grade = normalizeText(question.find('.grade').first().text());
    const qtext = question.find('.qtext').first();
    const questionHtml = cleanFragment($, qtext);
    const questionText = normalizeText(cheerio.load(questionHtml).text());
    const options = [];

    question.find('.answer > div').each((optionIndex, optionEl) => {
      const option = $(optionEl);
      const labelText = normalizeText(option.find('.answernumber').first().text()).replace(/\.$/, '').toUpperCase();
      const label = labelText || String.fromCharCode(65 + optionIndex);
      const clone = cheerio.load(option.html() || '', { decodeEntities: false });
      clone('.answernumber').remove();
      const text = normalizeText(clone.root().text());
      const html = cleanFragment(clone, clone.root());
      const input = option.find('input[type="radio"]').first();
      const checked = input.is('[checked]') || option.hasClass('checked') || option.hasClass('selected');
      const className = option.attr('class') || '';
      options.push({
        label,
        text,
        html,
        value: input.attr('value') || String(optionIndex),
        selected: checked,
        correct: /\bcorrect\b/.test(className),
      });
    });

    const rightAnswer = normalizeText(question.find('.rightanswer').first().text().replace(/^The correct answer is:?\s*/i, ''));
    const selected = options.find((option) => option.selected);
    const correctOption = options.find((option) => option.correct)
      || options.find((option) => rightAnswer && option.text.includes(rightAnswer));
    const images = collectMedia($, question, 'img', 'src');
    const audioSources = collectMedia($, question, 'audio source, audio', 'src');
    const explanation = normalizeText(question.find('.generalfeedback, .specificfeedback, .feedback').text());
    const statusText = `${state} ${question.attr('class') || ''}`.toLowerCase();

    questions.push({
      number,
      type: 'mcq',
      questionText,
      questionHtml,
      images,
      audio: audioSources[0] || '',
      audioSources,
      options,
      userAnswer: selected ? selected.label : '',
      correctAnswer: correctOption ? correctOption.label : answerLabelFromText(options, rightAnswer),
      isCorrect: statusText.includes('correct') && !statusText.includes('incorrect'),
      status: state,
      marks: grade,
      explanation,
      transcription: extractTranscription(question),
      sourcePage: page.htmlFile,
      sourceScreenshot: page.screenshotFile,
      sectionHint: meta.sectionHint,
    });
  });
  return questions;
}

function cleanFragment($, node) {
  const clone = cheerio.load(node.html() || '', { decodeEntities: false });
  clone('audio').each((i, el) => {
    const audio = clone(el).clone();
    const player = clone(el).closest('.video-js');
    if (player.length) player.replaceWith(audio);
  });
  clone('script, style, input, .accesshide, .visually-hidden, .questionflag, .vjs-control-bar, .vjs-big-play-button, .vjs-modal-dialog, .vjs-loading-spinner, .vjs-poster, .vjs-title-bar, .vjs-text-track-display, .vjs-error-display, .vjs-menu').remove();
  clone('[src]').each((i, el) => {
    const src = clone(el).attr('src');
    if (src) clone(el).attr('src', localAsset(src));
  });
  clone('[href]').each((i, el) => {
    const href = clone(el).attr('href');
    if (href && !href.startsWith('#')) clone(el).attr('href', localAsset(href));
  });
  clone('audio').attr('controls', 'controls');
  clone('*').each((i, el) => {
    const attribs = { ...el.attribs };
    for (const name of Object.keys(attribs)) {
      if (/^on/i.test(name) || name.startsWith('data-setup') || name === 'style') clone(el).removeAttr(name);
    }
  });
  return (clone('body').html() || clone.root().html() || '').trim();
}

function collectMedia($, node, selector, attr) {
  const values = [];
  node.find(selector).each((i, el) => {
    const value = $(el).attr(attr);
    if (!value) return;
    if (/unflagged\.svg|flagged\.svg/i.test(value)) return;
    values.push(localAsset(value));
  });
  return Array.from(new Set(values));
}

function localAsset(value) {
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value)) return value;
  if (value.startsWith('assets/')) {
    const normalized = `assets/source/${value.slice('assets/'.length).replace(/%25/g, '%')}`;
    return encodeURI(normalized);
  }
  return value;
}

function extractScore(html) {
  const text = normalizeText(cheerio.load(html).text());
  const match = text.match(/(?:score|marks?|grade)\s*[:\-]?\s*(\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)/i);
  return match ? match[1] : '';
}

function extractGrade(html) {
  const text = normalizeText(cheerio.load(html).text());
  const match = text.match(/(\d+(?:\.\d+)?\s*%)/);
  return match ? match[1] : '';
}

function extractTranscription(question) {
  const text = normalizeText(question.text());
  const match = text.match(/(?:transcription|transcript)\s*[:\-]\s*(.+)$/i);
  return match ? match[1].trim() : '';
}

function answerLabelFromText(options, answerText) {
  if (!answerText) return '';
  const match = String(answerText).match(/^([a-d])\b/i);
  if (match) return match[1].toUpperCase();
  const found = options.find((option) => option.text.includes(answerText));
  return found ? found.label : '';
}

function pageMeta(page) {
  const htmlFile = page.htmlFile || '';
  const quizMatch = htmlFile.match(/quiz_(\d+)/i);
  const questionMatch = htmlFile.match(/question_(\d+)/i);
  const review = /review/i.test(htmlFile);
  const mockNo = quizMatch ? Number(quizMatch[1]) : 0;
  return {
    mockId: mockNo ? `mock_${mockNo}` : '',
    mockTitle: cleanTitle(page.title).replace(/\s*\(page\s+\d+\s+of\s+\d+\)\s*/i, ''),
    pageType: review ? 'review' : questionMatch ? 'practice' : 'overview',
    sectionHint: mockNo >= 22 ? 'comprehension_orale' : 'comprehension_ecrite',
  };
}

function naturalMockNumber(id) {
  const match = String(id).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function cleanTitle(value) {
  return normalizeText(String(value || 'Saved page')
    .replace(/\s*\|\s*tefsuccess\s*$/i, '')
    .replace(/^PREMIUM PLAN:\s*/i, ''));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/Your browser does not support the audio element\./gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function writeData(course) {
  await fs.writeJson(path.join(outputDir, 'data', 'course.json'), course, { spaces: 2 });
  for (const section of course.sections) {
    await fs.writeJson(path.join(outputDir, 'data', 'sections', `${section.id}.json`), section, { spaces: 2 });
  }
}

async function writeFrontend() {
  await fs.writeFile(path.join(outputDir, 'index.html'), frontendHtml(), 'utf8');
  await fs.writeFile(path.join(outputDir, 'css', 'style.css'), frontendCss(), 'utf8');
  await fs.writeFile(path.join(outputDir, 'js', 'app.js'), frontendJs(), 'utf8');
}

function frontendHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Enterpreneural Success Language</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="app" class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span>ES</span><div><h1>Enterpreneural Success Language</h1><p id="courseMeta">Loading course...</p></div></div>
      <nav id="sectionNav" class="section-nav"></nav>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><p class="eyebrow">Local TEF mock review</p><h2 id="pageTitle">Dashboard</h2></div>
        <div class="top-actions"><button id="quizModeBtn">Quiz Mode</button><button id="reviewModeBtn">Review Mode</button></div>
      </header>
      <section id="content" class="content"></section>
    </main>
  </div>
  <script src="js/app.js"></script>
</body>
</html>
`;
}

function frontendCss() {
  return `:root{--ink:#17202f;--muted:#667085;--line:#d8dee8;--panel:#fff;--page:#eef2f6;--teal:#0f766e;--blue:#2e5e9e;--coral:#b5533f;--green:#157347;--red:#b42318;--shadow:0 12px 32px rgba(23,32,47,.1)}*{box-sizing:border-box}body{margin:0;font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fafc,var(--page));}.app-shell{display:grid;grid-template-columns:340px minmax(0,1fr);height:100vh;overflow:hidden}.sidebar{display:flex;flex-direction:column;border-right:1px solid var(--line);background:rgba(255,255,255,.94)}.brand{display:flex;gap:12px;align-items:center;padding:18px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,rgba(15,118,110,.1),rgba(46,94,158,.08)),#fff}.brand span{display:grid;width:44px;height:44px;place-items:center;border-radius:8px;background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff;font-weight:900}.brand h1{margin:0;font-size:17px}.brand p{margin:4px 0 0;color:var(--muted);font-size:13px}.section-nav{overflow:auto;padding:12px}.section-card{margin-bottom:10px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(23,32,47,.05)}.section-card h3{margin:0;padding:12px 12px 8px;font-size:14px}.mock-btn{display:block;width:calc(100% - 16px);margin:0 8px 8px;border:1px solid transparent;border-radius:7px;padding:9px 10px;background:#f6f8fb;color:#273548;text-align:left;font-weight:750;cursor:pointer}.mock-btn:hover,.mock-btn.active{border-color:#aab8c9;background:#eaf1f8}.main{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;height:100vh;overflow:hidden}.topbar{display:flex;justify-content:space-between;gap:16px;align-items:center;min-height:86px;padding:16px 20px;border-bottom:1px solid var(--line);background:#fff;box-shadow:0 8px 20px rgba(23,32,47,.05)}.eyebrow{margin:0 0 4px;color:#9b6a19;font-size:12px;font-weight:900;text-transform:uppercase}.topbar h2{margin:0;font-size:22px}.top-actions{display:flex;gap:8px}.top-actions button,.primary{border:1px solid #bdc8d6;border-radius:8px;background:#fff;color:#233247;min-height:38px;padding:0 13px;font-weight:850;cursor:pointer}.top-actions button.active,.primary{border-color:rgba(15,118,110,.35);background:#e7f4f1;color:#0b534d}.content{overflow:auto;padding:20px}.dashboard{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.metric,.panel,.question-card{border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow)}.metric{padding:16px}.metric strong{font-size:28px}.metric span{display:block;margin-top:4px;color:var(--muted);font-weight:800}.panel{padding:16px}.mock-header{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.mode-tabs{display:flex;gap:8px;flex-wrap:wrap}.question-card{padding:18px;margin-bottom:14px}.question-card.correct{border-left:5px solid var(--green)}.question-card.wrong{border-left:5px solid var(--red)}.question-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.question-head h3{margin:0;font-size:17px}.status-pill{border-radius:999px;padding:5px 9px;background:#eef2f6;color:#3d4a5f;font-size:12px;font-weight:900}.status-pill.correct{background:#dcfce7;color:#166534}.status-pill.wrong{background:#fee2e2;color:#991b1b}.qtext{line-height:1.6}.qtext img,.question-media img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;margin:8px 0}.question-media audio{display:block;width:100%;margin:10px 0}.options{display:grid;gap:9px;margin-top:14px}.option{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:11px;cursor:pointer}.option input{margin-top:3px}.option.correct{border-color:#86efac;background:#f0fdf4}.option.selected:not(.correct){border-color:#fca5a5;background:#fff1f2}.explain{margin-top:12px;border-top:1px solid var(--line);padding-top:12px;color:#344054}.empty{padding:30px;border:1px dashed #b8c3d1;border-radius:8px;background:#fff;color:var(--muted)}@media(max-width:900px){.app-shell{grid-template-columns:1fr;grid-template-rows:330px minmax(0,1fr)}.sidebar{border-right:0;border-bottom:1px solid var(--line)}.topbar{align-items:flex-start;flex-direction:column}.dashboard{grid-template-columns:repeat(2,minmax(0,1fr))}.content{padding:12px}}`;
}

function frontendJs() {
  return fs.readFileSync(APP_TEMPLATE, 'utf8');

  return `let course;let currentSection;let currentMock;let mode='review';const nav=document.getElementById('sectionNav');const content=document.getElementById('content');const title=document.getElementById('pageTitle');const meta=document.getElementById('courseMeta');const quizBtn=document.getElementById('quizModeBtn');const reviewBtn=document.getElementById('reviewModeBtn');fetch('data/course.json').then(r=>r.json()).then(data=>{course=data;meta.textContent=data.sections.reduce((n,s)=>n+s.mocks.length,0)+' mocks loaded';renderNav();renderDashboard();});quizBtn.onclick=()=>{mode='quiz';setModeButtons();if(currentMock)renderMock(currentMock);};reviewBtn.onclick=()=>{mode='review';setModeButtons();if(currentMock)renderMock(currentMock);};function setModeButtons(){quizBtn.classList.toggle('active',mode==='quiz');reviewBtn.classList.toggle('active',mode==='review');}function renderNav(){nav.innerHTML=course.sections.map(section=>'<section class="section-card"><h3>'+esc(section.title)+'</h3>'+(section.mocks.length?section.mocks.map(mock=>'<button class="mock-btn" data-section="'+section.id+'" data-mock="'+mock.id+'">'+esc(mock.title)+'<br><small>'+mock.attempts.reduce((n,a)=>n+a.questions.length,0)+' questions</small></button>').join(''):'<div class="empty" style="margin:8px">No scraped mocks yet</div>')+'</section>').join('');nav.querySelectorAll('.mock-btn').forEach(btn=>btn.onclick=()=>{currentSection=course.sections.find(s=>s.id===btn.dataset.section);currentMock=currentSection.mocks.find(m=>m.id===btn.dataset.mock);document.querySelectorAll('.mock-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderMock(currentMock);});}function renderDashboard(){title.textContent='Dashboard';const mocks=course.sections.reduce((n,s)=>n+s.mocks.length,0);const attempts=course.sections.reduce((n,s)=>n+s.mocks.reduce((m,x)=>m+x.attempts.length,0),0);const questions=course.sections.reduce((n,s)=>n+s.mocks.reduce((m,x)=>m+x.attempts.reduce((q,a)=>q+a.questions.length,0),0),0);content.innerHTML='<div class="dashboard"><div class="metric"><strong>'+course.sections.length+'</strong><span>Sections</span></div><div class="metric"><strong>'+mocks+'</strong><span>Mocks</span></div><div class="metric"><strong>'+attempts+'</strong><span>Attempts</span></div><div class="metric"><strong>'+questions+'</strong><span>Questions</span></div></div><div class="panel"><h2>'+esc(course.courseTitle)+'</h2><p>Select a mock from the sidebar to practice MCQs or review saved answers and media.</p></div>';}function renderMock(mock){setModeButtons();title.textContent=mock.title;const attempts=mock.attempts.filter(a=>mode==='review'?a.mode==='review':true);const activeAttempts=attempts.length?attempts:mock.attempts;content.innerHTML='<div class="panel mock-header"><div><h2>'+esc(mock.title)+'</h2><p>'+esc(currentSection.title)+' - '+activeAttempts.reduce((n,a)=>n+a.questions.length,0)+' questions</p></div><button class="primary" onclick="renderDashboard()">Dashboard</button></div>'+activeAttempts.map(renderAttempt).join('');wireOptions();}function renderAttempt(attempt){return '<section class="panel"><h2>'+(attempt.mode==='review'?'Review / answers':'Quiz page')+'</h2><p>Status: '+esc(attempt.status||'Saved')+(attempt.score?' - Score: '+esc(attempt.score):'')+(attempt.grade?' - Grade: '+esc(attempt.grade):'')+'</p></section>'+attempt.questions.map(q=>renderQuestion(q,attempt)).join('');}function renderQuestion(q,attempt){const key='esl:'+attempt.sourceHtml+':q'+q.number;const saved=localStorage.getItem(key)||q.userAnswer||'';const status=q.correctAnswer&&saved?(saved===q.correctAnswer?'correct':'wrong'):q.isCorrect?'correct':'';return '<article class="question-card '+status+'"><div class="question-head"><h3>Question '+q.number+'</h3><span class="status-pill '+status+'">'+(status==='correct?'Correct':status==='wrong'?'Review':'MCQ')+'</span></div><div class="qtext">'+(q.questionHtml||esc(q.questionText))+'</div>'+media(q)+'<div class="options">'+q.options.map(o=>optionHtml(o,q,key,saved)).join('')+'</div>'+reviewBlock(q,saved)+'</article>';}function optionHtml(o,q,key,saved){const selected=saved===o.label;const correct=q.correctAnswer===o.label;return '<label class="option '+(selected?'selected ':'')+(correct?'correct':'')+'"><input type="radio" name="'+key+'" value="'+o.label+'" '+(selected?'checked':'')+' data-key="'+key+'"><strong>'+esc(o.label)+'.</strong><span>'+(o.html||esc(o.text))+'</span></label>';}function media(q){return '<div class="question-media">'+(q.audio?'<audio controls src="'+esc(q.audio)+'"></audio>':'')+q.images.map(src=>'<img src="'+esc(src)+'" loading="lazy">').join('')+'</div>';}function reviewBlock(q,saved){if(mode!=='review'&&!q.correctAnswer)return'';return '<div class="explain">'+(saved?'<p><strong>Your answer:</strong> '+esc(saved)+'</p>':'')+(q.correctAnswer?'<p><strong>Correct answer:</strong> '+esc(q.correctAnswer)+'</p>':'')+(q.explanation?'<p><strong>Explanation:</strong> '+esc(q.explanation)+'</p>':'')+(q.transcription?'<p><strong>Transcription:</strong> '+esc(q.transcription)+'</p>':'')+'</div>';}function wireOptions(){document.querySelectorAll('input[type=radio][data-key]').forEach(input=>input.onchange=()=>{localStorage.setItem(input.dataset.key,input.value);if(currentMock)renderMock(currentMock);});}function esc(value){return String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));}`;
}
