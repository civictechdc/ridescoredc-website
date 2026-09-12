#!/usr/bin/env python3
"""Load published road data into a database.

    uv run scripts/load_data.py                       the latest published data
    uv run scripts/load_data.py --version 0.1         a particular release
    uv run scripts/load_data.py --package DIR --bundle DIR
    uv run scripts/load_data.py --database URL        somewhere other than here

On a contributor's machine `npm run data` calls exactly this.

A package is the data a pipeline run produced: roads, crashes and scores. A
bundle is the SQL deciding what a map may show of them. The two are published
and versioned separately, so changing what the map shows does not mean
republishing the data.

The loading itself is done by a program in the pipeline repository, fetched and
run in one step, so this repository carries no copy of it that could drift.
Where it comes from is in `data_source.py`.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from data_source import asset_url, data_source  # noqa: E402
from db import database_urls, settings, wait_for_database  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--version", help="a published release, e.g. 0.1")
    parser.add_argument("--package", help="a directory, or an address")
    parser.add_argument("--bundle", help="a directory, or an address")
    parser.add_argument("--database", help="where to load it")
    parser.add_argument(
        "--wait", type=int, default=90,
        help="seconds to wait for the database (0 to not wait)",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    found = settings(root)
    source = data_source(found)

    package = args.package or asset_url(source, args.version, source["package_file"])
    bundle = args.bundle or asset_url(source, args.version, source["bundle_file"])

    for label, value in (("package", package), ("bundle", bundle)):
        if not value.startswith("http") and not Path(value).exists():
            sys.exit(f"\nNo {label} at {value}\n")

    urls = database_urls(root)
    database = args.database or urls["direct"]
    ours = database == urls["direct"]

    if not shutil.which("uv"):
        sys.exit(
            "\nuv is not installed, and it is what runs the loader.\n\n"
            "  https://docs.astral.sh/uv/getting-started/installation/\n"
        )

    # Printed so this teaches the command rather than replacing it. The password
    # is hidden; everything else is exactly what runs.
    print(
        f"\n  uv run {source['loader']} \\\n"
        f"    --package {package} \\\n"
        f"    --bundle {bundle} \\\n"
        f"    --database {urls['display'] if ours else '<the database you gave>'}\n"
    )

    sys.stdout.flush()

    if ours and args.wait:
        wait_for_database(urls, seconds=args.wait)

    result = subprocess.run(
        ["uv", "run", source["loader"],
         "--package", package, "--bundle", bundle, "--database", database],
        check=False,
    )
    if result.returncode != 0:
        return result.returncode

    print("\n  Road data loaded. Create the survey tables next:")
    print("    uv run scripts/migrate.py        (or: npm run migrate)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
