# Canadian Website Scraper

A local website capture tool for saving live web pages as offline HTML packages. It can run from a browser-based control panel, a small desktop GUI, or directly from the command line.

## Features

- Capture the currently visible page after manual navigation or login.
- Crawl same-origin pages up to a configurable page limit.
- Download page assets and rewrite references for offline viewing.
- Save HTML, plain text, screenshots, and a manifest for each export.
- Reuse an existing Chrome profile when a site requires an authenticated session.
- Optional deep quiz scraper for Moodle-style quiz review pages.

## Requirements

- Node.js 18 or newer
- npm
- Python 3.10 or newer, only needed for the optional desktop GUI
- Google Chrome, recommended when using persistent Chrome profiles

## Install

```bash
npm install
```

The install step also downloads the Playwright browser runtime.

## Run The Web App

```bash
npm start
```

Open `http://localhost:3000`, enter a website URL, and click `Start`. Use the opened browser normally, then choose `Scrape Current Page`, `Next Page`, or `Finish` from the web controls.

## Run The Desktop App

```bash
npm run app
```

The desktop app starts the same scraper engine and provides local controls for scraping the visible browser page.

## Command Line Usage

Scrape interactively:

```bash
node Scraper.js https://example.com
```

Crawl same-origin pages:

```bash
node Scraper.js https://example.com --crawl --max-pages 75 --headless
```

Use a persistent Chrome profile:

```bash
node Scraper.js https://example.com --profile ./persistent_profiles/default --browser-channel chrome --profile-name Default
```

Deep quiz capture:

```bash
node QuizDeepScraper.js https://example.com/course/view.php?id=2 --profile ./persistent_profiles/default --browser-channel chrome
```

For quiz sites that support username and password login, credentials can be provided with `--username` and `--password`, or with the `TEF_USERNAME` and `TEF_PASSWORD` environment variables. Do not commit real credentials.

## Output

Exports are written under `downloaded_site/`. Each run creates a timestamped folder containing captured pages, screenshots, downloaded assets, and `manifest.json`.

The output folder is intentionally ignored by git so the repository only contains source code and runnable project files.

## GitHub Upload Set

This repository is intended to track only:

- `Scraper.js`
- `QuizDeepScraper.js`
- `server.js`
- `app.py`
- `public/`
- `run-server.ps1`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`

Generated folders such as `node_modules/`, `downloaded_site/`, `persistent_profiles/`, caches, logs, and editor metadata are ignored.
