#!/usr/bin/env python3
"""Apply this repository's database migrations.

    uv run scripts/migrate.py              apply everything not yet applied
    uv run scripts/migrate.py --list       what has been applied, and what has not
    uv run scripts/migrate.py --rollback   undo the most recent one
    uv run scripts/migrate.py --database URL

On a contributor's machine `npm run migrate` calls exactly this.

These migrations own the `app` area of the database, which holds survey
responses. The road data has no migrations: it is replaced wholesale from a
published package by `load_data.py`.

yoyo records what it has applied in a table of its own, so applying twice does
nothing and is safe. That table is named in `api/yoyo.ini`, and deliberately is
not the default name: two repositories write to one database, and a shared
record would have each treat the other's migrations as missing.
"""

from __future__ import annotations

import argparse
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import database_urls, wait_for_database  # noqa: E402

# yoyo runs in an environment of its own, which is why the database driver has
# to be named here. Without it yoyo starts and fails on a missing import, with a
# message that does not mention the database at all.
YOYO = [
    "uvx",
    "--python", "3.12",
    "--from", "yoyo-migrations==9.0.0",
    "--with", "psycopg[binary]>=3.2",
    "yoyo",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--list", action="store_true", help="show what has been applied")
    group.add_argument("--rollback", action="store_true", help="undo the most recent")
    parser.add_argument("--database", help="which database to act on")
    parser.add_argument(
        "--wait", type=int, default=90,
        help="seconds to wait for the database (0 to not wait)",
    )
    args = parser.parse_args()

    command = "list" if args.list else "rollback" if args.rollback else "apply"

    root = Path(__file__).resolve().parent.parent
    urls = database_urls(root)
    database = args.database or urls["yoyo"]
    ours = database == urls["yoyo"]
    config = root / "api" / "yoyo.ini"
    source = root / "api" / "migrations"

    # yoyo treats the directory it is given as a glob pattern, and a pattern
    # matching nothing leaves it with no migrations to apply, which it reports
    # as success. Saying so here costs one check and turns the quietest failure
    # this script has into the loudest.
    migrations = sorted(source.glob("*.sql")) + sorted(source.glob("*.py"))
    if not migrations:
        sys.exit(f"\nNo migrations found in {source}\n")
    if set("*?[]") & set(str(source)):
        sys.exit(
            f"\nThe path to the migrations contains a character yoyo reads as a\n"
            f"glob pattern, so it would search for a name that does not exist:\n\n"
            f"  {source}\n\n"
            f"Move the checkout somewhere without * ? [ or ] in the path.\n"
        )

    # uvx, not uv: it is a separate binary beside uv, and it is the one that
    # fetches and runs yoyo. Saying which name was looked for, and that it was
    # looked for on PATH, distinguishes "uv was never installed" from "uv is
    # installed but this shell cannot see the directory it lives in" -- which is
    # what happens over `ssh host 'bash -s'`, where no profile is read.
    if not shutil.which("uvx"):
        sys.exit(
            "\nuvx was not found on PATH, and it is what runs the migration tool.\n\n"
            "  If uv is not installed:\n"
            "    https://docs.astral.sh/uv/getting-started/installation/\n\n"
            "  If uv is installed, uvx sits beside it and that directory is not on\n"
            "  PATH. Add it:\n"
            '    PATH="$(dirname "$(command -v uv)"):$PATH"\n'
        )

    shown = urls["display"].replace("postgres:", "postgresql+psycopg:", 1)
    print(
        f"\n  {shlex.join(YOYO)} {command} \\\n"
        f"    --database {shown if ours else '<the database you gave>'} \\\n"
        f"    --config {shlex.quote(str(config))} {shlex.quote(str(source))}\n"
    )

    sys.stdout.flush()

    if ours and args.wait:
        wait_for_database(urls, seconds=args.wait)

    result = subprocess.run(
        [*YOYO, command, "--database", database, "--config", str(config), str(source)],
        check=False,
    )
    if result.returncode != 0:
        return result.returncode

    if command == "apply":
        print("\n  Survey tables are ready. See what was applied:")
        print("    uv run scripts/migrate.py --list        (or: npm run migrate:list)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
