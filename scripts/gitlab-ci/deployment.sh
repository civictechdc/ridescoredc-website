#!/bin/bash
#
# Runs ON the staging/production server, invoked from CI as:
#   ssh <user>@<server> 'bash -s' < scripts/gitlab-ci/deployment.sh <path> <user> <branch>
#
# `bash -s` reads this file from stdin and assigns the trailing args to $1..$3.
# The repo is already cloned at <path> and owned by <user>; a GitHub deploy key
# lets that user `git fetch` over SSH.
#
set -euo pipefail

DEPLOY_PATH="${1:?deploy path required}"
DEPLOY_USER="${2:?deploy user required}"
BRANCH="${3:?branch required}"

echo "[deploy] $(date -u +%FT%TZ) path=$DEPLOY_PATH user=$(whoami) branch=$BRANCH"

cd "$DEPLOY_PATH"

# Sanity: refuse to run anywhere that isn't a git checkout the deploy user owns.
# stderr is left visible on purpose: if $DEPLOY_PATH isn't owned by this user,
# git's "dubious ownership" error surfaces here and the deploy fails — an
# ownership mismatch is a setup bug we want to halt on, not paper over.
git rev-parse --is-inside-work-tree >/dev/null || {
  echo "[deploy] ERROR: $DEPLOY_PATH is not a usable git checkout for $(whoami)"; exit 1;
}

# Fast-forward only. If the server checkout has diverged — intentional local
# edits or commits — the pull FAILS, and with `set -e` the whole deploy aborts
# instead of clobbering that work. A maintainer can then SSH in and reconcile.
# Gitignored files (e.g. api/.env) are untouched either way.
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[deploy] deployed $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# Apply the survey tables' migrations, before the restart and not after.
#
# A deploy has a moment where the code and the schema disagree, and which way
# round decides what breaks. Migrating first leaves the new schema with the old
# code for a few seconds, which survives. Restarting first leaves the new code
# with the old schema, which fails on every request that touches a column the
# migration was going to add.
#
# `set -e` above means a failed migration ends the deploy here, before the
# restart, leaving the old code and the old schema -- a pair that works.
# PostgreSQL applies DDL inside a transaction, so a migration that fails part of
# the way through leaves nothing behind.
#
# Only the `app` area is migrated. `data` and `serving` are dropped and rebuilt
# wholesale from a published package by scripts/load_data.py, which is run
# deliberately and separately: they are derived, and a migration history for
# derived data would be a fiction.
#
# yoyo records what it has already applied, so this does nothing when there is
# nothing new.
#
# uv is named by its path. This script runs over `ssh host 'bash -s'`, a
# non-interactive shell that does not read a profile, so ~/.local/bin is not on
# PATH and a bare `uv` would not be found -- even though it works when you log
# in and try it.
UV="${UV:-$HOME/.local/bin/uv}"
if [ ! -x "$UV" ]; then
  echo "[deploy] ERROR: uv is not at $UV, so migrations cannot be applied."
  echo "[deploy]        curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

echo "[deploy] applying migrations"
"$UV" run scripts/migrate.py

# Dependencies are NOT installed here, deliberately. This host runs the app on
# the system Python with /usr/bin/gunicorn, so installing would need root, would
# fight the package manager, and is refused outright by newer Pythons. Adding a
# dependency to api/requirements.txt therefore still needs an administrator.
# Fixing that means giving the service a virtual environment of its own, which
# is a change to the unit file rather than to this script.

# Restart the app so new code takes effect.
# Requires a systemd unit and passwordless sudo for this one command (see notes).
sudo -n systemctl restart ridescore-fastapi.service
sudo -n systemctl restart martin

echo "[deploy] restarted martin and ridescore-fastapi services — done"
