const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let child = null;
let clients = [];
let lastState = {
  running: false,
  startedAt: null,
  outputDir: null,
  currentUrl: null,
};

app.post('/start', (req, res) => {
  if (child) return res.status(400).json({ error: 'Scraper already running' });

  const startUrl = normalizeUrl(req.body && req.body.url);
  if (!startUrl) return res.status(400).json({ error: 'Enter a valid http or https URL' });

  const scraperPath = path.join(__dirname, 'Scraper.js');
  const args = [scraperPath, startUrl];
  if (req.body && req.body.crawl) args.push('--crawl');
  if (req.body && req.body.headless) args.push('--headless');
  if (req.body && req.body.waitForLogin) args.push('--wait-for-login');
  if (req.body && req.body.maxPages) args.push('--max-pages', String(req.body.maxPages));
  if (req.body && req.body.profileDir) args.push('--profile', String(req.body.profileDir));
  if (req.body && req.body.profileName) args.push('--profile-name', String(req.body.profileName));
  if (req.body && req.body.browserChannel) args.push('--browser-channel', String(req.body.browserChannel));

  child = spawn(process.execPath, args, {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  lastState = {
    running: true,
    startedAt: new Date().toISOString(),
    outputDir: null,
    currentUrl: startUrl,
  };

  child.stdout.on('data', (d) => handleProcessOutput(d.toString(), false));
  child.stderr.on('data', (d) => handleProcessOutput(d.toString(), true));

  child.on('exit', (code) => {
    broadcast({ type: 'log', message: `Process exited with code ${code}` });
    child = null;
    lastState.running = false;
    broadcast({ type: 'state', state: lastState });
  });

  broadcast({ type: 'state', state: lastState });
  res.json({ ok: true, state: lastState });
});

app.post('/scrape-current', (req, res) => sendCommand(res, { action: 'scrape' }));
app.post('/next-page', (req, res) => sendCommand(res, { action: 'next' }));
app.post('/finish', (req, res) => sendCommand(res, { action: 'finish' }));

app.post('/continue', (req, res) => sendCommand(res, { action: 'scrape' }));

app.post('/stop', (req, res) => {
  if (!child) return res.status(400).json({ error: 'Scraper not running' });
  child.kill();
  res.json({ ok: true });
});

app.get('/status', (req, res) => {
  res.json(lastState);
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders && res.flushHeaders();

  clients.push(res);
  writeEvent(res, { type: 'state', state: lastState });

  req.on('close', () => {
    clients = clients.filter((c) => c !== res);
  });
});

function sendCommand(res, payload) {
  if (!child) return res.status(400).json({ error: 'Scraper not running' });
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  res.json({ ok: true });
}

function handleProcessOutput(text, isError) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line);
      if (event.type === 'state') {
        const state = event.state || event;
        lastState = { ...lastState, ...state, running: !!child };
      }
      if (event.type === 'page') {
        lastState.currentUrl = event.url || lastState.currentUrl;
        lastState.outputDir = event.outputDir || lastState.outputDir;
      }
      broadcast(event);
    } catch (err) {
      broadcast({ type: isError ? 'error' : 'log', message: line });
    }
  }
}

function broadcast(event) {
  console.log(event.message || JSON.stringify(event));
  for (const client of clients) writeEvent(client, event);
}

function writeEvent(client, event) {
  client.write(`data: ${JSON.stringify(event)}\n\n`);
}

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch (err) {
    return null;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
