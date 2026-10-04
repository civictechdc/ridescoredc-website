# Front-End Developer Guide

**For you if:** you want to change how the Ride Score DC website looks and behaves — layout, styling, colours, popups, the survey flow.

**Not for you if:** you need to change how the safety scores are computed, make changes to the database, extend the API, or work on any of the other services (Martin tile server, nginx).

**What you will run:** the webpages will be run from your own folder, on your own machine. The map tiles and the survey API come from the shared development server.

---

## Step 1 — Install the required tools

- **Git** — <https://git-scm.com/downloads>
- **Node.js**, version 20 or newer — <https://nodejs.org> (includes `npm`)
- **An editor** — <https://code.visualstudio.com> if you have no preference
- **A GitHub account** — <https://github.com/signup>

### Where to type the commands

| | open |
|---|---|
| **macOS** | Terminal, in Applications > Utilities |
| **Linux** | your terminal application |
| **Windows** | Windows Terminal, or PowerShell from the Start menu |
| **Windows with WSL** | the terminal of your WSL distribution |

In VS Code, **View > Terminal** opens one on all of them.

Most commands in these guides are `git`, `node` and `npm`, which are the same everywhere.
Where a command differs, two versions are given: one for **macOS, Linux and WSL**, one for
**Windows PowerShell**. Command Prompt is not covered.

**In WSL, keep the repository inside the WSL file system** — a path under `~`, not under
`/mnt/c`. `npm install` and the development server are much slower across the Windows
boundary.

Check the first two:

```bash
git --version
node --version    # v20 or newer
```

## Step 2 — Get your own copy of the code

You work on a **fork**, which is your own copy on GitHub, and propose changes back with
a pull request. You do not need write access to the project.

1. Open <https://github.com/civictechdc/ridescoredc-website>, click **Fork**, then
   **Create fork**. Leave **Copy the `develop` branch only** checked — `develop` is the
   branch the next step works from.
2. Clone your fork, replacing `YOUR-USERNAME`:

```bash
git clone https://github.com/YOUR-USERNAME/ridescoredc-website.git
cd ridescoredc-website
git remote add upstream https://github.com/civictechdc/ridescoredc-website.git
```

The last command connects your fork to the upstream repository so that you can pull in any upstream changes if needed.

3. Make a branch for every new piece of work. Never commit directly to the `develop` or `main` branches. Create the new branch off of the `develop` branch:

```bash
git checkout develop
git checkout -b feature/short-name
```

The first command switches to `develop`; the second creates your branch from whatever
branch you are on, so the order matters. A fresh clone already starts on `develop`, so the
first command usually changes nothing — run it anyway and your branch can never start from
`main` by accident.

## Step 3 — Install the Vite development server

```bash
npm install
```

This installs Vite and the browser-testing tools into `node_modules/` inside the repository. Vite serves the
pages and reloads the browser when you save. The site is plain HTML, CSS and JavaScript
with no build step, so the files you edit are exactly the files the servers publish.

## Step 4 — Configure where the map data comes from

**macOS, Linux and WSL**

```bash
cp .env.example .env
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.example .env
```

The relevant line in the copied file already points Vite to the development server:

```
VITE_UPSTREAM=https://dev.ridescoredc.com
```

Any request for something that is not a page — map tiles, the survey API — is routed to the shared development server. The `.env` file remains local and is never committed (it is listed in `.gitignore`)

## Step 5 — Start the development server

```bash
npm run dev
```

This command prints the settings that are used and the local address where the website is served:

```
  settings in effect
    VITE_UPSTREAM      https://dev.ridescoredc.com

  tiles and API  ->  https://dev.ridescoredc.com

  ➜  Local:   http://localhost:5173/
```

**If the `settings in effect` block does not appear, you have no `.env`** — go back to
Step 4. The `tiles and API` line is the same either way, because the address in
`.env.example` is also the built-in default, so that line alone does not tell you whether
Step 4 worked.

Leave this command running and work in a second terminal. In VS Code, the **+** in the
terminal panel opens one; otherwise open a second terminal window.

## Step 6 — Check the website works

Open **<http://localhost:5173>**. You should see:

- a map of DC with streets colored green through red
- a **Settings** panel with six sliders and a RideScore/Custom switch
- **Imagery** and **Accidents** toggling on and off
- a popup when you click a street

Then open **<http://localhost:5173/survey/>**, which is the survey.

If the map page looks right, your setup is correct: the pages come from your folder and
everything else from the shared server.

## Step 7 — Make your changes

The pages that are shown in the browser can be found under `frontend/`:

```
frontend/
  index.html            the map            ->  /
  survey/index.html     the survey         ->  /survey/
  src/shared/           used by both pages
    config.js             the map's style, centre, and the tile addresses
    basemap.js            building the map, aerial imagery, the three buttons
    crashes.js            crash points, the heatmap, the crash popup
```

Edit or add files, and the browser reloads automatically.

Each page is one large file holding its own styles and scripts. Work by searching for the
text or the element ID you want rather than reading top to bottom.

**A change in `src/shared/` affects both pages.** Check both pages after an edit.

**Adding a page** means adding a directory with an `index.html`. A folder named
`about` containing `index.html` is served at `/about/`.

## Step 8 — Check and test your changes before opening a Pull Request

- All pages still load without errors in the browser console (F12, or Cmd+Option+I on macOS)
- The behavior you changed works, and everything else still works
- You did not commit `.env`, `node_modules/`, or a database directory

```bash
git status        # nothing unexpected
git diff          # every line is one you meant to write
```

### Survey browser tests and hard-to-reproduce bugs

Install Chromium once, then run the Playwright suite:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:ui
```

On Linux runners that lack browser system libraries, use
`npx playwright install --with-deps chromium` instead. Playwright starts its own
Vite server. The automated tests use synthetic, fixed road tiles and a local
MapLibre distribution, not the shared database or live basemap. API submissions
are intercepted: running tests does not send survey responses to staging.
Mouse and touch projects exercise painting, erasing, undo, overlapping strokes,
mode changes, camera movement, and the survey flow, including delayed responses.

Every test retains a trace, including passing runs. The HTML report and
`test-results/` contain the evidence attachments. Open the report with
`npx playwright show-report`, or a trace with
`npx playwright show-trace PATH-TO-TRACE.zip`.
Traces provide browser screenshots, DOM and network history; WebGL highlights
and internal selection state also need the attached survey diagnostics.
Artifacts are ignored by Git and should be reviewed before sharing.

The sequence tests use a repeatable seed. To replay or explore another seed:

**macOS, Linux and WSL**

```bash
SURVEY_SEED=24 npm run test:e2e
SURVEY_SEED=24 SURVEY_TILE_DELAY_MS=500 npm run test:e2e
```

**Windows (PowerShell)**

```powershell
$env:SURVEY_SEED = "24"
$env:SURVEY_TILE_DELAY_MS = "500"
npm run test:e2e
```

The default tile delay is 120 ms; use `SURVEY_TILE_DELAY_MS=0` for the baseline
and rerun the same seed with slower tiles to investigate timing sensitivity.
Submission tests also cover delayed success, HTTP errors, and network failures.

For manual exploration against your configured upstream, start `npm run dev`
and open **http://localhost:5173/survey/?debugSurvey=1**. In the browser console:

```javascript
RideScore.surveyDebug.snapshot()
copy(RideScore.surveyDebug.export())
```

`copy` is a browser DevTools helper; save the copied JSON locally. Export **before**
submitting, clearing, or reloading when a ghost appears. The log retains the
last 1,000 events and reports how many earlier events were dropped. It records
pointer coordinates/types, camera state, typed tile IDs, selected roads' durable
IDs/names/endpoints, feature-state changes, selection and undo history, and
consistency snapshots. It does not record survey
answers or free-text comments. Diagnostics are injected only by Vite and require
both a loopback hostname and the explicit query parameter; normal pages and
production do not load them.

Check `snapshot().issues` after a gesture completes. Intermediate snapshots can
legitimately differ while a selection operation updates the map and badge.
The checks detect committed highlight/selection disagreement and orphan pending
highlights, including IDs touched earlier that have left the viewport. The badge
counts grouped roads produced by the route sequencer, **not** raw tile IDs.
These are state-based checks, not proof of actual rendered pixels.

For issue #24, no original reproduction is assumed. If exploration or a seeded
test fails, keep the trace, seed, action history, diagnostics, and road fixture
together. Replay the same environment, remove actions until the smallest sequence
still fails, then add that sequence as a named regression test before fixing it.
Synthetic tiles isolate selection logic but do not replace a follow-up test with
the real failing road geometry. Never commit a production database dump or
unreviewed browser artifacts.

## Step 9 — Open a Pull Request

```bash
git add frontend/index.html        # name your files; avoid "git add -A"
git commit -m "Short description of what changed"
git push -u origin feature/short-name
```

Then open your fork on GitHub and click **Compare & pull request**. Target `develop`.
Say what changed and why; add a screenshot for anything visual.

---

## If something goes wrong

**The map is blank, or streets are missing.** Check the `tiles and API` line printed at
startup. If it names the shared server and your changes did not touch the map rendering, then contact an admin to check on the server.

**A change does not appear.** Confirm you edited the file under `frontend/`, and that
the terminal running `npm run dev` has not stopped.

**A change to `.env` has no effect.** `npm run dev` reads that file once, when it starts.
Stop it with `Ctrl-C` and start it again.

**Port 5173 is in use.** `npm run dev -- --port 5174`.

**You want to work without the shared server.** See `local-fullstack-development.md`.