<div align="center">

# 🚀 Canadian Website Scraper

**A python Playwright Scrapper used to scrap Canadian Study website including encrypted Voices, Text, MCQS, Pictures and make a replica website**

Documented · MIT licensed · Maintained

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)](CONTRIBUTING.md)

</div>

---

## Screenshots

![Application screenshot](docs/screenshots/app.png)


## 🐍 Contribution graph

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mafzalkalwardev/Canadian-Website-Scraper/output/snake-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mafzalkalwardev/Canadian-Website-Scraper/output/snake.svg" />
  <img alt="Contribution snake" src="https://raw.githubusercontent.com/mafzalkalwardev/Canadian-Website-Scraper/output/snake.svg" />
</picture>

---

Local TEFSuccess scraper and quiz website for **Muhammad Awais Success Web**. The scraper logs into [tefsuccess.ca](https://tefsuccess.ca), captures quiz review pages with Playwright, and builds a static practice site deployed to Vercel.

## Setup

```bash
npm install
```

## Credentials

Never commit credentials. Use environment variables only:

```powershell
$env:TEF_USERNAME="your-email@example.com"
$env:TEF_PASSWORD="your-password"
```

## Full refresh (scrape → build → deploy)

Re-scrapes all quizzes (auto-completing attempts when answer keys are missing), refetches reviews, scrapes Expression écrite/orale pages, rebuilds `public/`, and deploys:

```powershell
npm run refresh:all
```

Rebuild and deploy from the latest scrape without re-scraping:

```powershell
npm run refresh:build
```

## Individual commands

| Command | Purpose |
|---------|---------|
| `npm start` | Local server at http://localhost:3000 |
| `npm run scrape:tef` | Scrape only (via `scrape.py`) |
| `npm run refetch:reviews` | Re-download review pages for mocks missing answer keys |
| `npm run scrape:production` | Scrape Expression écrite/orale study pages |
| `npm run rebuild:public` | Rebuild `public/data/course.json` from latest export |
| `npm run deploy:vercel` | Deploy `public/` to Vercel |

## Live site

https://awais-ahmed-success-web.vercel.app

## What gets scraped

- **Compréhension écrite** — 21 mock quizzes
- **Compréhension orale** — 20 mock quizzes (audio + images)
- **Expression écrite / orale** — introduction and section study pages
- Correct answers from completed Moodle review pages (auto-submits attempts when needed)

## Checks

```bash
npm run check
```

---

## Discoverability

**Author:** Muhammad Afzal Kalwar ([@mafzalkalwardev](https://github.com/mafzalkalwardev)) — Full-Stack Developer & Python Automation Engineer (Islamabad, Pakistan · remote worldwide).

**Hire / contact:** GitHub [@mafzalkalwardev](https://github.com/mafzalkalwardev) · LinkedIn [@mafzalkalwardev](https://www.linkedin.com/in/mafzalkalwardev) · WhatsApp [+92 307 9670503](https://wa.me/923079670503) · [Portfolio](https://mafzalkalwardev.github.io) · [Email](mailto:kalwarmuhammadafzal3@gmail.com)

### Who is this for?
Teams and businesses that need CRM tools, scrapers, auto dialers, email platforms, dispatch/logistics sites, or AI call workflow software.

### FAQ
- **Who built this?** Muhammad Afzal Kalwar (`mafzalkalwardev`).
- **Can I hire the author?** Yes — remote freelance and contract. See contact links above.
- **Related work?** Browse [all repositories](https://github.com/mafzalkalwardev?tab=repositories) and the [live portfolio](https://mafzalkalwardev.github.io).

<details>
<summary><strong>SEO / GEO / AEO keywords</strong></summary>

Muhammad Afzal Kalwar, mafzalkalwardev, Canadian-Website-Scraper, full-stack developer, Python automation engineer, Islamabad Pakistan, freelance remote developer, CRM scraping dialer email AI tools, playwright, javascript, automation, mit, web-scraping

</details>

---

## Contact

| Channel | Handle / Number |
|:--|:--|
| GitHub | [@mafzalkalwardev](https://github.com/mafzalkalwardev) |
| LinkedIn | [@mafzalkalwardev](https://www.linkedin.com/in/mafzalkalwardev) |
| WhatsApp | [+92 307 9670503](https://wa.me/923079670503) |
| Portfolio | [mafzalkalwardev.github.io](https://mafzalkalwardev.github.io) |
| Email | [kalwarmuhammadafzal3@gmail.com](mailto:kalwarmuhammadafzal3@gmail.com) |
