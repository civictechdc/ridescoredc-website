# Full Stack Developer Guide

**For you if:** you need to work on the database, the survey API, the tile server, or nginx settings. For example, changing what the survey stores, adding an API endpoint, or working offline.

**What you will run:** four programs in Docker, plus the real DC road data loaded from a
published data package.

| program | job |
|---|---|
| **nginx** | traffic manager; handles incoming requests and routes them to the right backend service |
| **Martin** | turns road and crash data into map tiles |
| **the API** | records a survey response |
| **PostgreSQL** | database holding the safety scores and the user feedback |

**Terminology** *the pages* are what a browser runs, *the API* is the Python service in `api/`, and *the site* is all of it together.

---

## Step 0 — Do the frontend guide first

`local-frontend-development.md`. This guide assumes you have the repository, a branch, and
`npm install` done.

## Step 1 — Install additional tools

- **Docker Desktop** — <https://docs.docker.com/get-started/get-docker/>
- **uv**, which runs Python tools without installing them —
  <https://docs.astral.sh/uv/getting-started/installation/>

Check:

```bash
docker --version
uv --version
```

You do not need to install Python, PostgreSQL, or the pipeline. `uv` fetches what each
command needs in an isolated environment.

**On Windows**, Docker Desktop runs the containers on WSL2, so WSL is present either way.
Working in a WSL terminal is the smoother path, and makes every command below the macOS
and Linux one; in Docker Desktop, enable **Settings > Resources > WSL integration** for
your distribution. PowerShell versions are given for anyone who would rather stay there.

## Step 2 — Configuration

Two files are used for configuration, split by who needs the setting:

| file | holds | exists where |
|---|---|---|
| `api/.env` | what the **API** needs: the database address and password | your machine and the servers |
| `.env` | what **your machine** needs: ports, where data is stored, which upstream | your machine only |

The question is always: does the running API need this, or only my laptop?

**macOS, Linux and WSL**

```bash
cp api/.env.example api/.env
```

**Windows (PowerShell)**

```powershell
Copy-Item api/.env.example api/.env
```

You already created `.env` in the front-end guide. Check the settings:

```bash
npm run check-env
```

It prints what settings are in effect, and fails if anything is misplaced.

### If port 5432 for the database is taken

If another running PostgreSQL instance is already using port 5432, then in `.env` set:

```
DB_PORT=5544
```

**The examples in this guide use the default, 5432.** If you set `DB_PORT`, substitute
your own number wherever a command shows a port.

Only the port on your machine changes. The programs inside Docker reach the database by
its name on their own network and are unaffected.

## Step 3 — Start the full stack

```bash
npm run stack
```

This command checks the settings, then uses `docker compose up` to start the docker containers running the database, the Martin tile server, the FastAPI service, and nginx. The first run downloads the images and takes a few minutes. Leave it running in the terminal; `Ctrl-C` stops it.

In another terminal, check the API is up:

**macOS, Linux and WSL**

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

**Windows (PowerShell)**

```powershell
curl.exe http://localhost:8000/health
# {"status":"ok"}
```

Spell it `curl.exe`. Windows PowerShell has its own `curl`, which is a different program
and does not understand these options.

The database is empty at this point. There are no roads yet.

## Step 4 — Load the data and create the tables

```bash
npm run setup
```

This command does two things, which could be run separately if needed:

**`npm run data`** downloads the latest published road data and loads it into the database. A **package** holds the roads, crashes and scores; a **bundle** holds the SQL deciding what is visible on a map.

**`npm run migrate`** creates the survey tables.


### Loading different data versions

```bash
npm run data -- --version 0.1                  a particular published release
npm run data -- --package DIR --bundle DIR     something you built yourself locally
npm run data -- --database URL                 a database other than your own

npm run migrate:list                           what has been applied, and what has not
npm run migrate -- --rollback                  undo the most recent migration
```

The `--package` form is the one to use while working simultaneously on the scoring pipeline: build a run with `ridescore build`, then load the result straight from its output folder without publishing anything.

### The commands underneath

`npm run data` and `npm run migrate` are aliases. Each prints the command it runs before
running it, so you can copy that command and run it yourself:

```
  uv run https://raw.githubusercontent.com/.../load_package.py \
    --package https://github.com/.../ridescoredc-data-preview.tar.gz \
    --bundle https://github.com/.../ridescoredc-bundle-preview.tar.gz \
    --database postgres://postgres:***@127.0.0.1:5432/db
```

The password is hidden in that line; everything else is exactly what runs.

The commands themselves are `scripts/load_data.py` and `scripts/migrate.py`, written in
Python with no dependencies, so the same commands work on a server. Running them there
needs `uv` installed, which is a single binary:

```bash
uv run scripts/load_data.py
uv run scripts/migrate.py
```

The location of the published data is in `scripts/data_source.py`. Every value there is
temporary — the releases address, the `preview` in the file names, the branch in the
loader's address, and any of them can be overridden in `.env`.

### Restarting one service

```bash
npm run restart -- martin     # after changing what the database serves
npm run restart -- nginx      # after editing nginx/default.conf
npm run restart               # everything
npm run stack:logs            # watch the logs
```

The service names are the ones in `docker-compose.yml`: `nginx`, `martin`, `fastapi`, `db`.

Editing a page does not need a restart: nginx reads a page from disk on every request. Editing `api/main.py` does not need a restart either; that container reloads itself. Configuration files are the exception: `nginx/default.conf` and `martin.yaml` are read once at startup and need a restart of the service.

### Writing a migration

Add a file to `api/migrations/`, numbered after the last one, then `npm run migrate`.
Running it twice does nothing, because yoyo records what it has already applied previously.

**Never edit a migration that has been applied anywhere** — write a new one. The record
says a migration ran; it cannot know the file changed afterwards.

## Step 5 — Check it works

Open **<http://localhost:8000>** — the map, with streets colored by score.

Open **<http://localhost:8000/survey/>** — plain map for user feedback.


Test from the command line:

**macOS, Linux and WSL**

```bash
for t in update_score survey_segments crashes; do
  echo -n "$t "
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8000/tiles/$t/14/4684/6265"
done
# update_score 200
# survey_segments 200
# crashes 200
```

**Windows (PowerShell)**

```powershell
foreach ($t in 'update_score', 'survey_segments', 'crashes') {
  $code = curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8000/tiles/$t/14/4684/6265"
  "$t $code"
}
# update_score 200
# survey_segments 200
# crashes 200
```

Three tile sources, three jobs: `update_score` draws the scored map, `survey_segments`
draws the survey's plain map, `crashes` draws crash locations.

## Step 6 — Optional: a browser that reloads itself

The stack does not reload the browser when you edit a page. If you want that, run Vite
alongside it. In `.env` set:

```
VITE_UPSTREAM=http://localhost:8000
```

```bash
npm run dev
```

That gives you a second address, `http://localhost:5173`, serving the same files from the
same folder:

| | `localhost:8000` | `localhost:5173` |
|---|---|---|
| serves the pages | nginx | Vite |
| the pages come from | `frontend/` | `frontend/` |
| tiles and the API come from | your stack | wherever `VITE_UPSTREAM` points |
| reloads the browser for you | no | yes |

**Set `VITE_UPSTREAM` to your own stack if you run both.** Left at its default it names the
shared development server, so the two addresses would show different data. `npm run dev`
prints where it sends requests every time it starts.

## How a request is answered

Everything arrives at nginx on port 8000, and nginx decides what happens next:

| you ask for | answered by | reading |
|---|---|---|
| `/`, `/survey/` | nginx, straight from disk | `frontend/` |
| `/tiles/...` | Martin | the `serving` area of the database |
| `/api/...` | the API | the `app` area of the database |
| anything else | nginx | a 404, which never reaches the API |

**The map never touches the API.** Streets, scores and crashes all come from Martin
reading the database directly. The API is involved only when a survey is submitted.

**nginx serves the pages, not the API.** Asking the API for a page returns 404, because
the API has no pages.


## How the database is arranged

Three separate areas, divided by who is allowed to write to each:

| area | holds | written by |
|---|---|---|
| `data` | roads, crashes, scores | the loader, replaced wholesale on each load |
| `app` | survey responses | the API |
| `serving` | views and functions deciding what the map may show | the bundle |


The map only ever reads `serving`. Publishing `data` directly would put every column on
the open internet.

## Looking at the data

**macOS, Linux and WSL**

```bash
PGPASSWORD=localdev psql -h 127.0.0.1 -p 5432 -U postgres -d db
```

**Windows (PowerShell)**

```powershell
$env:PGPASSWORD = 'localdev'
psql -h 127.0.0.1 -p 5432 -U postgres -d db
```

This needs `psql` installed on your machine. If you would rather not install it, the
database container carries its own copy, which works everywhere:

```bash
docker compose exec db psql -U postgres -d db
```

```sql
select count(*) from data.road_segment;          -- 13829
select * from serving.survey_segments limit 5;   -- what the survey page sees
select * from app.survey_submissions;            -- responses you have submitted
select package from data.load_record limit 1;    -- which published data is loaded
```

## Working on the survey API

`api/main.py` is the API, and it is short: it records a survey response and reports
whether it can reach the database. Nothing else. It serves no pages, and the map never
touches it. The container restarts it when you save, so a change takes effect
immediately.

A response records the street by its **durable** id (`segment_id`, text), not by a row
number. The page uses an integer `tile_id` internally because the
mapping library needs one, but that number is never stored.

## Starting over

**macOS, Linux and WSL**

```bash
npm run stack:down
rm -rf pg_data
npm run stack
```

**Windows (PowerShell)**

```powershell
npm run stack:down
Remove-Item -Recurse -Force pg_data
npm run stack
```

Then `npm run setup` again. Anything you submitted through the survey locally is lost.

To keep the old database instead of deleting it, point `DB_DATA_DIR` in `.env` at a new
directory and start again.

---

## If something goes wrong

**`npm run stack` fails saying a port is in use.** Something else holds 5432 or 8000. Set
`DB_PORT` in `.env` for the database. For 8000, find what is using it, or change the
published port in `docker-compose.yml` locally without committing the change.

**The loader cannot connect.** Use `127.0.0.1`, not `db` — `db` is the name the programs
inside Docker use for each other, and it means nothing on your machine. Check the port
matches `DB_PORT`.

**A tile source returns 404, or the map shows no roads.** The tile server reads the
database when it starts and publishes what it finds then. A stack started before any data
was loaded publishes nothing, and stays that way until restarted:

```bash
npm run restart -- martin
```

`npm run data` does this for you. You would only hit it after changing what the database
serves by some other route — applying SQL by hand, for instance. The three names are in Step 5.

**Streets are missing from the map.** Confirm `npm run data` reported 13,829 rows.

**The pages show the shared server's data.** Read the `tiles and API` line at startup.

**The database will not accept a connection.** `npm run data` and `npm run migrate` wait
up to 90 seconds for it and then say what to check. A first start takes about 20 seconds
while the database builds itself.