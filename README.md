# Decision Navigator

Weighted decision matrix tool for the browser. Compare options against your own priorities, get a ranked recommendation with a confidence score, no server, no signup, no dependencies.

[![Live](https://img.shields.io/badge/live-decision--navigator.vercel.app-2563EB)](https://decision-navigator.vercel.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](#license)
[![No dependencies](https://img.shields.io/badge/dependencies-0-success)](#tech-stack)

**Live app:** https://decision-navigator-2.vercel.app

---

## Contents

- [What it does](#what-it-does)
- [Why weighted scoring](#why-weighted-scoring)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Usage](#usage)
- [How the scoring works](#how-the-scoring-works)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Decision Navigator walks you through a structured comparison of options instead of relying on gut feeling:

1. State the decision you're making
2. List the options you're choosing between
3. Define the criteria that matter, and weight each by importance
4. Rate every option against every criterion
5. Get a weighted ranking, a confidence level, and a plain-English recommendation

The output is a ranked list with percentage scores. The tool never tells you what to value — it only does the arithmetic once you've told it what matters.

---

## Why weighted scoring

A plain pros/cons list treats every factor as equally important, which is rarely true. A spreadsheet matrix works but requires manual setup every time and isn't built for sharing.

This tool assigns each criterion a weight (1–10) and each option a per-criterion score (1–10). The final ranking is a weighted average, so criteria you care about more actually move the result more. The interesting part is usually not the winner — it's seeing which criterion is quietly deciding the outcome.

---

## Features

- **Guided flow** — five discrete steps (Decision → Options → Criteria → Score → Result), one screen at a time
- **Slider-based scoring** — drag to rate, no manual entry into a grid
- **Completion gating** — the results step is unreachable until every option has been scored against every criterion, so there's no way to see a meaningless default output
- **Confidence level** — derived from the score gap between the top two options, not just the raw ranking
- **Plain-English recommendation** — a generated summary, not just a table of numbers
- **Shareable state** — the full decision is encoded into the URL hash; sending a link reproduces the exact session, no account or backend required
- **Local autosave** — work persists across page reloads via `localStorage`
- **Copy summary** — one click to copy a formatted text report
- **Zero network requests** — nothing is transmitted anywhere; everything runs in the tab

---

## Tech stack

Vanilla HTML, CSS, and JavaScript. No framework, no bundler, no package manager, no build step.

This is a deliberate choice, not a limitation. The state is simple enough that a framework adds overhead without adding capability, and a dependency-free tool is trivial to audit, fork, and self-host.

---

## Project structure

```
decision-navigator/
├── index.html      # Markup for all five steps + header/footer shells
├── styles.css       # All styling — design tokens, layout, responsive rules
├── script.js         # State, persistence, scoring engine, rendering, events
└── README.md
```

Single-page app. No routing, no server-rendered views.

---

## Getting started

```bash
git clone https://github.com/<your-username>/decision-navigator-2.git
cd decision-navigator
open index.html
```

Or serve it with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

No install step. No environment variables. No build command.

---

## Usage

1. Open the app and describe the decision you're making
2. Add at least two options
3. Add at least two criteria and set how much each one matters to you (1–10)
4. Rate every option against every criterion (1–10)
5. Review the ranked result, confidence level, and recommendation

To share a decision, use **Share URL** on the results screen — it copies a link that reproduces the exact state for whoever opens it. To save a copy elsewhere, use **Copy Summary**.

---

## How the scoring works

Each option's final score is a weighted percentage:

```
weightedScore = Σ (score_i × weight_i)      for each criterion i
maxPossible   = Σ (10 × weight_i)
percentage    = round(weightedScore / maxPossible × 100)
```

Weights determine how much each criterion influences the outcome. Scores determine how well a specific option performs on that criterion. Both are independent inputs — changing one without the other will not change the result if all options are still scored identically.

**Confidence** is calculated from the gap between the top two ranked options:

| Gap between #1 and #2 | Confidence |
|---|---|
| 0–4% | Low |
| 5–12% | Medium |
| 13%+ | High |

A low-confidence result is a signal to revisit your weights or scores, not a failure of the tool — it means your options are genuinely close given what you said matters.

---

## Architecture

`script.js` is organized into clearly separated concerns, in dependency order:

```
STATE          → single in-memory object, no external state management
PERSISTENCE    → debounced localStorage writes + URL hash encoding/decoding
CALCULATIONS   → pure functions, no DOM access, fully unit-testable in isolation
STEP CONTROL   → validation gates and navigation between the five steps
RENDER         → DOM writes only, reads from state, never mutates it
EVENTS         → delegated listeners, dispatch into state updates + targeted re-renders
INIT           → resolves initial state (URL → localStorage → blank) and boots the UI
```

Calculation functions (`calcScores`, `calcConf`, `genRec`) take state and return plain data — they don't touch the DOM, which makes them straightforward to test independently of the UI.

State changes fan out through two debounced side effects — `localStorage` and `location.hash` — so autosave and shareable links stay in sync without extra wiring at each call site.

---

## Data model

```javascript
{
  meta: { id, version, created, updated },
  decision: { title, context },
  options:  [{ id, name, pros, cons }],
  criteria: [{ id, name, weight }],       // weight: 1–10
  scores:   { [optionId]: { [criterionId]: 1–10 } },
  outcome:    null,   // reserved — what was actually chosen
  reflection: null    // reserved — how it turned out, filled in later
}
```

`outcome` and `reflection` are present in every saved state but unused by the current UI. They're placeholders for a decision-journal feature — recording what you chose and revisiting it later — without requiring a breaking schema change when that's built.

---

## Roadmap

- Surface `outcome` / `reflection` for a "revisit this decision later" flow
- Optional AI-assisted scoring suggestions (kept out of the core tool to preserve the zero-dependency, zero-cost baseline)
- Template presets for common decisions (job offers, apartments, vendor selection)
- Independent multi-person scoring on a shared decision, to compare where two people's priorities diverge

None of the above is implemented yet. This section reflects direction, not current functionality.

---

## Contributing

Issues and pull requests are welcome. Since there's no build step, the fastest way to verify a change is to open `index.html` directly in a browser after editing.

Keep the zero-dependency constraint in mind — a PR introducing a framework or external library needs a strong justification.

---

## License

MIT. Use it, fork it, modify it.

---

Built by [Shreshth Adlakha](mailto:shreshthadlakha@gmail.com)
