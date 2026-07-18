# ridescoredc-website

Web application for the DC Bike Safety Map — interactive map, survey tool, and REST API.

Part of the [RidescoreDC](https://github.com/civictechdc/ridescoredc) project by [Civic Tech DC](https://www.civictechdc.org/).

**Related repos**
- [ridescoredc](https://github.com/civictechdc/ridescoredc) — parent repo and project overview
- [ridescoredc-models](https://github.com/civictechdc/ridescoredc-models) — data processing and scoring model (Jupyter notebooks, PostGIS setup)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/JS, MapLibre GL |
| API | Python 3.12, FastAPI |
| Tile server | Martin (MVT) |
| Database | PostgreSQL 17 + PostGIS |
| Container | Docker Compose |

---

## Developer Spinup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Git

### 1. Clone and configure

```bash
git clone https://github.com/civictechdc/ridescoredc-website
cd ridescoredc-website
```

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

The default `POSTGRES_PASSWORD` is fine for local development.

### 2. Start the stack

```bash
docker compose up
```

This starts four services:

| Service | Address | Purpose |
|---|---|---|
| `nginx` | http://localhost:8000 | Reverse proxy — the single entry point |
| `fastapi` | internal | FastAPI app + frontend, serves `index.html` |
| `martin` | internal | MVT tile server |
| `db` | localhost:5432 | PostGIS database |

Open the app at **http://localhost:8000** — that's NGINX, which routes `/tiles/` to Martin and everything else (the app, static files, and `/api`) to FastAPI. Only NGINX and the database are published to the host; `fastapi` and `martin` are reached *through* NGINX, exactly as on the servers.

The `fastapi` service runs the stock `python:3.12-slim` image with `api/` mounted in, installing its dependencies on start — so the first boot takes a little longer while pip runs. The `patch.sql` schema patch is then applied automatically. If the database container isn't ready yet, the API retries for up to 20 seconds.

**Routing mirrors staging and production.** Both locally and on the servers, **NGINX is the front door and routes by path** — `/api` → `fastapi` and `/tiles/` → Martin — so the frontend uses relative URLs (`/tiles/update_score/...`) that work in every environment. This is a deliberate convention: **tiles must go through `/tiles/` to Martin**, and because Martin isn't reachable any other way locally, a hardcoded direct URL fails in dev instead of silently breaking in production. Locally the proxy config lives at `nginx/default.conf`; on the servers NGINX lives outside this repo (ask an org admin to see or change it).

### 3. Seed the database from production

The app expects an existing database — most importantly the `ridescoredc` road-data table, which is **not** created by this repo. **Request a copy of the production SQL dump (`dev_backup.sql`) from an org admin.** It is a plain `pg_dump` file and is intentionally kept out of version control.

With the stack running, load the dump into the database container with `psql` (run this in a separate terminal):

```bash
docker compose exec -T db psql -U postgres -d db < dev_backup.sql
```

This writes the imported data into `pg_data/` (see [Database](#database) below), so you only need to do it once — the data persists across restarts. `api/patch.sql` runs on top of it as an idempotent patch on every boot, adding/updating the survey tables without touching the imported road data.

### 4. Open the app

Navigate to [http://localhost:8000](http://localhost:8000). Refresh after seeding to see the road data appear.

### 5. Tear down

```bash
docker compose down
```

To also wipe the database volume (this deletes your restored production data — you'll need to restore the dump again):

```bash
docker compose down -v
rm -rf pg_data/
```

---

## Database

Local development starts from a **copy of the production database**, not from an empty schema. Request the production SQL dump (`dev_backup.sql`) from an org admin and load it via `psql` as part of getting set up (see step 3 above).

- **`dev_backup.sql`** is a plain-text `pg_dump` of production — the *input* to a restore. You load it by piping it through `psql` against the running database container; you never place it inside `pg_data/`. It is not committed to this repo (request it from an admin).
- **`pg_data/`** is Postgres's own on-disk data directory, mounted into the PostgreSQL container. It is the *result* of the restore — where the imported data actually lives — and it persists across `docker compose down` (but not `down -v`), so you only restore the dump once. It is **deliberately excluded from version control** (see `.gitignore`): it holds real data and is machine-local, so never commit it.
- **`api/patch.sql`** is not a full schema definition — it is an **idempotent patch** applied on top of the restored production copy on every boot. It creates the survey tables if missing and reconciles their columns, using `IF NOT EXISTS` / `ALTER ... IF EXISTS` so it's safe to re-run.
- **`api/migrations/`** holds one-off schema migrations.

The road-data pipeline that produces the `ridescoredc` table lives in [ridescoredc-models](https://github.com/civictechdc/ridescoredc-models).

---

## Deploy

Deployment is driven entirely by Git. You develop on a feature branch, verify it locally with the linter and tests, then open a pull request into `develop`. Merging to `develop` deploys to staging; merging to `main` deploys to production. GitHub Actions runs the same lint and test checks on every push and pull request, and a branch that fails them cannot be deployed.

### Branching (Gitflow)

This project follows [Gitflow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow). Never commit directly to `develop` or `main` — start every piece of work from a new branch off `develop`:

```bash
git checkout develop
git checkout -b feature/FEATURE_NAME_HERE   # creates a new feature branch
```

When the work is ready, push the branch and open a pull request back into `develop`.

### Lint and Tests

Run the linter and tests **before every commit** — CI runs the same checks, and a branch that fails them will not deploy. The `fastapi` service already installed `ruff` and `pytest` (from `requirements-dev.txt`) when it started, so with the stack running (from [step 2](#2-start-the-stack)) you just `exec` into it — no Python needed on your host:

**Lint (Ruff):**

```bash
docker compose exec fastapi ruff check .
```

**Tests (Pytest):**

```bash
docker compose exec fastapi pytest tests/ -v
```

Because `api/` is mounted into the container, these check your current working-tree code. The tests mock the database, so they never touch the running `db` service.

### GitHub Actions

CI runs on every push and pull request to `develop` and `main`.

| Job | Trigger | What it does |
|---|---|---|
| `lint` | all branches | Runs Ruff on `api/` |
| `test` | all branches | Runs Pytest against mocked DB |
| `stage` | push to `develop` | Deploys to [dev.ridescoredc.com](https://dev.ridescoredc.com) |
| `deploy` | push to `main` | Deploys to [ridescoredc.com](https://ridescoredc.com) |

The `stage` and `deploy` jobs only run after `lint` and `test` pass.

When you open a pull request from your feature branch into `develop`, **check the GitHub Actions tab (or the checks on the PR) and confirm `lint` and `test` pass** before asking for review. Fix any failures and push again — the checks re-run automatically.

Promotion from `develop` to production is handled with care: a **senior dev will help you open the pull request from `develop` into `main`**. Merging to `develop` deploys to the staging server and merging to `main` deploys to the production server, both automatically, so the `develop` → `main` step is done deliberately and with review.

### SSH Access

Deployments use SSH keys stored as GitHub Actions secrets (`STG_SSH_PRIVATE_KEY`, `PRD_SSH_PRIVATE_KEY`). To get access to the staging or production server, **request an SSH key from an org admin**.

---

## Project Structure

```
ridescoredc-website/
├── api/
│   ├── main.py              # FastAPI app (endpoints + static file serving)
│   ├── patch.sql            # Idempotent schema patch (survey tables)
│   ├── requirements.txt     # Production dependencies
│   ├── requirements-dev.txt # Dev/test dependencies
│   ├── migrations/
│   ├── static/
│   │   ├── index.html       # Main map UI
│   │   └── feedback_mvp.html
│   └── tests/
│       ├── conftest.py
│       └── test_api.py
├── nginx/
│   └── default.conf         # Local reverse proxy (/tiles/ -> martin, / -> fastapi)
├── scripts/
│   └── gitlab-ci/
│       └── deployment.sh    # Remote deployment script
├── docker-compose.yml
├── martin.yaml              # Tile server config
└── .github/
    └── workflows/
        └── ci.yml
```
