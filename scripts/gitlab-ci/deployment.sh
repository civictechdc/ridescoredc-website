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

# Restart the app so new code takes effect. On startup the app applies the
# idempotent patch.sql, so no separate migration step is needed.
# Requires a systemd unit and passwordless sudo for this one command (see notes).
sudo -n systemctl restart ridescore-fastapi.service
sudo -n systemctl restart martin

echo "[deploy] restarted $SERVICE — done"
