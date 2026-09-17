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

This installs one tool, Vite, into `node_modules/` inside the repository. Vite serves the
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

Make sure that the `tiles and API` line points to the Ride Score DC development server. Leave the command running in its own terminal while you work in another terminal.

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

**Port 5173 is in use.** `npm run dev -- --port 5174`.

**You want to work without the shared server.** See `local-fullstack-development.md`.