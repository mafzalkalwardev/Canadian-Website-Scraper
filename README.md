# Enterpreneural Success Language TEF Scraper

Local TEFSuccess/Moodle scraper and review-site builder. The scraper captures logged-in course pages with Playwright, then converts the saved Moodle HTML into a clean offline quiz/review website backed by structured JSON.

## Setup

```bash
npm install
```

Python 3.10+ is also required for the command wrappers.

## Credentials

Do not hardcode credentials. Provide them only through environment variables:

```powershell
$env:TEF_USERNAME="your-email@example.com"
$env:TEF_PASSWORD="your-password"
```

## Run A Full Scrape

```bash
python scrape.py --config config.json
```

This runs `QuizDeepScraper.js`, updates `scrape_state.json` with the newest export folder, and builds the structured site into `output/`.

## Resume / Rebuild

Rebuild from the last successful scrape:

```bash
python scrape.py --resume
```

Build from the configured `sourceExportDir` without scraping:

```bash
python scrape.py --build-only
```

Or build directly:

```bash
python build_site.py --source downloaded_site/quiz-deep-2026-06-07T13-05-25-044Z --output output
```

## Open The Local Website

```bash
python -m http.server 8000 -d output
```

Then open:

```text
http://127.0.0.1:8000/
```

## Output Structure

```text
output/
  index.html
  assets/
    source/
  data/
    course.json
    sections/
      comprehension_ecrite.json
      comprehension_orale.json
      production_ecrite.json
      production_orale.json
  css/
    style.css
  js/
    app.js
```

## What The Builder Extracts

- Course sections and mocks
- Question order
- Question text and cleaned HTML
- MCQ options
- User/correct-answer fields when visible in the saved review HTML
- Scores/grades when visible
- Local image and audio references
- Explanations/transcriptions when present in Moodle feedback blocks

The generated frontend removes Moodle boilerplate and provides dashboard, quiz mode, review mode, clickable MCQs, localStorage answer saving, and responsive styling.

## Checks

```bash
npm run check
node --check scripts/build-tef-site.js
node --check scripts/tef-app-template.js
```
