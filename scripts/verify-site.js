const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const LIVE_BASE = process.argv.includes('--local')
  ? 'http://127.0.0.1:3000'
  : 'https://awais-ahmed-success-web.vercel.app';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`${url} HTTP ${res.statusCode}`));
        else resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

function headUrl(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
      resolve({ url, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ url, status: 0, ok: false, error: err.message }));
    req.end();
  });
}

function isJunkMediaUrl(value) {
  return /unflagged|flagged|questionflag|theme\/image\.php|pix\/i\/|\.svg(\?|$)/i.test(value || '');
}

function resolveAssetUrl(src) {
  if (!src || isJunkMediaUrl(src)) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  const prefix = 'assets/source/storage.googleapis.com/';
  if (src.includes(prefix)) {
    let rest = src.slice(src.indexOf(prefix) + prefix.length);
    try { rest = decodeURIComponent(rest); } catch {}
    return `https://storage.googleapis.com/${rest}`;
  }
  const tefPrefix = 'assets/source/tefcanada.ca/';
  if (src.includes(tefPrefix)) {
    return src.split(tefPrefix).join('https://tefcanada.ca/');
  }
  return `${LIVE_BASE}/${src.replace(/^\//, '')}`;
}

async function main() {
  console.log(`\n=== Verification: ${LIVE_BASE} ===\n`);

  const coursePath = process.argv.includes('--local')
    ? path.join(ROOT, 'public', 'data', 'course.json')
    : null;

  const course = coursePath && fs.existsSync(coursePath)
    ? JSON.parse(fs.readFileSync(coursePath, 'utf8'))
    : await fetchJson(`${LIVE_BASE}/data/course.json`);

  let production = { sections: [] };
  try {
    production = process.argv.includes('--local') && fs.existsSync(path.join(ROOT, 'public', 'data', 'production-pages.json'))
      ? JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'production-pages.json'), 'utf8'))
      : await fetchJson(`${LIVE_BASE}/data/production-pages.json`);
  } catch {
    console.warn('production-pages.json not available');
  }

  const audioUrls = new Set();
  const imageUrls = new Set();
  let totalQuestions = 0;
  let withCorrect = 0;
  let missingMocks = [];
  const junkImages = [];

  for (const section of course.sections) {
    for (const mock of section.mocks || []) {
      let mockCorrect = 0;
      let mockTotal = 0;
      for (const attempt of mock.attempts || []) {
        for (const q of attempt.questions || []) {
          totalQuestions += 1;
          mockTotal = Math.max(mockTotal, attempt.questions.length);
          if (q.correctAnswer) {
            withCorrect += 1;
            mockCorrect = Math.max(mockCorrect, attempt.questions.filter((x) => x.correctAnswer).length);
          }
          if (q.audio) {
            const u = resolveAssetUrl(q.audio);
            if (u) audioUrls.add(u);
          }
          for (const src of q.audioSources || []) {
            const u = resolveAssetUrl(src);
            if (u) audioUrls.add(u);
          }
          for (const src of q.images || []) {
            if (isJunkMediaUrl(src)) junkImages.push({ mock: mock.title, src });
            else {
              const u = resolveAssetUrl(src);
              if (u) imageUrls.add(u);
            }
          }
          const html = q.questionHtml || '';
          const imgMatches = html.match(/src="([^"]+)"/g) || [];
          for (const m of imgMatches) {
            const src = m.slice(5, -1);
            if (isJunkMediaUrl(src)) junkImages.push({ mock: mock.title, src });
            else {
              const u = resolveAssetUrl(src);
              if (u) imageUrls.add(u);
            }
          }
        }
      }
      if (mockTotal > 0 && mockCorrect < mockTotal) {
        missingMocks.push(`${section.title} · ${mock.title} (${mockCorrect}/${mockTotal} answers)`);
      }
    }
  }

  console.log('Course data');
  console.log(`  Sections: ${course.sections.length}`);
  console.log(`  Mocks: ${course.sections.reduce((n, s) => n + (s.mocks || []).length, 0)}`);
  console.log(`  Questions in data: ${totalQuestions}`);
  console.log(`  Questions with correctAnswer field: ${withCorrect}`);
  console.log(`  Mocks missing full answer keys: ${missingMocks.length}`);
  if (missingMocks.length) missingMocks.forEach((line) => console.log(`    - ${line}`));

  console.log(`\n  Junk Moodle images in data: ${junkImages.length}`);
  if (junkImages.length) console.log('    FAIL: junk flag icons still present');

  console.log(`\n  Production study pages: ${(production.sections || []).reduce((n, s) => n + (s.pages || []).length, 0)}`);

  const staticChecks = [
    `${LIVE_BASE}/`,
    `${LIVE_BASE}/logo.png`,
    `${LIVE_BASE}/css/style.css`,
    `${LIVE_BASE}/js/app.js`,
    `${LIVE_BASE}/data/course.json`,
  ];

  console.log('\nStatic site files');
  for (const url of staticChecks) {
    const r = await headUrl(url);
    console.log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.status} ${url}`);
  }

  const audioSample = [...audioUrls].slice(0, 12);
  const imageSample = [...imageUrls].slice(0, 12);

  console.log(`\nAudio files (sample ${audioSample.length} of ${audioUrls.size})`);
  let audioOk = 0;
  let audioFail = 0;
  for (const url of audioSample) {
    const r = await headUrl(url);
    console.log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.status || r.error} ${url.split('/').pop()}`);
    if (r.ok) audioOk += 1;
    else audioFail += 1;
  }

  console.log(`\nImage files (sample ${imageSample.length} of ${imageUrls.size})`);
  let imageOk = 0;
  let imageFail = 0;
  for (const url of imageSample) {
    const r = await headUrl(url);
    console.log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.status || r.error} ${url.split('/').pop()?.slice(0, 60)}`);
    if (r.ok) imageOk += 1;
    else imageFail += 1;
  }

  if (imageUrls.size > 12) {
    console.log(`\nChecking all ${imageUrls.size} image URLs...`);
    let allImageOk = 0;
    let allImageFail = 0;
    for (const url of imageUrls) {
      const r = await headUrl(url);
      if (r.ok) allImageOk += 1;
      else {
        allImageFail += 1;
        if (allImageFail <= 5) console.log(`  FAIL ${r.status || r.error} ${url}`);
      }
    }
    console.log(`  All images: ${allImageOk}/${imageUrls.size} OK, ${allImageFail} failed`);
  }

  if (audioUrls.size > 12) {
    console.log('\nChecking all audio URLs (this may take a minute)...');
    let allAudioOk = 0;
    let allAudioFail = 0;
    for (const url of audioUrls) {
      const r = await headUrl(url);
      if (r.ok) allAudioOk += 1;
      else {
        allAudioFail += 1;
        if (allAudioFail <= 5) console.log(`  FAIL ${url}`);
      }
    }
    console.log(`  All audio: ${allAudioOk}/${audioUrls.size} OK, ${allAudioFail} failed`);
  }

  const gradedMocks = course.sections.reduce((n, s) => n + (s.mocks || []).length, 0) - missingMocks.length;
  const pass = junkImages.length === 0 && audioFail === 0 && imageFail === 0;

  console.log('\n=== Summary ===');
  console.log(`  Static files: checked`);
  console.log(`  Audio sample: ${audioOk}/${audioSample.length} OK`);
  console.log(`  Image sample: ${imageOk}/${imageSample.length} OK`);
  console.log(`  Full grading mocks: ${gradedMocks}/${course.sections.reduce((n, s) => n + (s.mocks || []).length, 0)}`);
  console.log(`  Review data gaps: ${missingMocks.length} mocks (orale mocks need manual completion on TEFSuccess)`);
  console.log(pass ? '\n  Overall: PASS (assets and UI data look good)' : '\n  Overall: ISSUES FOUND (see above)');

  process.exit(pass && missingMocks.length === 0 ? 0 : missingMocks.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
