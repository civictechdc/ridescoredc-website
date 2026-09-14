"""Where the database is, and whether it is ready.

Shared by `load_data.py` and `migrate.py`. Python with no dependencies, so that
one implementation serves both a contributor's machine and a server.

Python because the servers already run the API on it. Running these through
`uv` does mean installing `uv` on a server that does not have it, which is a
single binary and no system packages. The alternative was Node, which would be
a whole runtime added for tooling alone.

Settings are read from the environment first, then from the files. On a server
the address arrives in the environment; on a contributor's machine it is in
`api/.env`, which Compose hands to the containers.
"""

from __future__ import annotations

import os
import re
import socket
import struct
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

# The name the containers use for the database among themselves. It means
# nothing outside Compose, which is why an address using it has to be rewritten
# before anything on this machine can connect. Any other host is already a real
# address and is left exactly as given -- a server's own address, most often.
COMPOSE_DB_HOST = "db"

DEFAULT_PORT = "5432"

_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def _read_env_file(path: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    if not path.exists():
        return found
    for line in path.read_text().splitlines():
        m = _LINE.match(line)
        if not m:
            continue
        value = m.group(2).strip()
        value = re.sub(r"\s+#.*$", "", value).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        found[m.group(1)] = value.strip()
    return found


def settings(root: Path | None = None) -> dict[str, str]:
    """Every setting, with the real environment taking precedence over the files.

    `.env` holds what one machine needs. `api/.env` holds what the application
    needs, and exists on the servers too. Which file a setting belongs in is
    explained in `.env.example`, and `npm run check-env` enforces it.
    """
    root = root or Path.cwd()
    merged = {**_read_env_file(root / ".env"), **_read_env_file(root / "api" / ".env")}
    for key in ("DATABASE_URL", "DB_PORT", "DATA_RELEASES", "DATA_PACKAGE",
                "DATA_BUNDLE", "DATA_LOADER"):
        if os.environ.get(key):
            merged[key] = os.environ[key]
    return merged


def _mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]*@", r"://\1:***@", url)


def database_urls(root: Path | None = None) -> dict[str, str]:
    """The database address, in the two spellings that get used.

    yoyo chooses its driver from the scheme and wants a spelling that psql and
    the loader do not accept, so both are worked out here rather than by hand.
    """
    found = settings(root)
    raw = found.get("DATABASE_URL")
    if not raw:
        sys.exit(
            "\nDATABASE_URL is not set, so there is no database to connect to.\n\n"
            "  cp api/.env.example api/.env\n"
        )

    parts = urlsplit(raw)
    host = parts.hostname or ""
    port = parts.port

    if host == COMPOSE_DB_HOST:
        # An address only the containers can use. From here it is this machine,
        # on whichever port Compose publishes.
        host = "127.0.0.1"
        port = found.get("DB_PORT", DEFAULT_PORT)
    elif port is None and found.get("DB_PORT"):
        # An address with no port of its own. DB_PORT is the best guess.
        port = found["DB_PORT"]
    # An address that names its own port keeps it. DB_PORT describes where
    # Compose publishes the database, and says nothing about a database
    # somewhere else -- so pointing DATABASE_URL at another one has to win.

    userinfo = parts.username or ""
    if parts.password:
        userinfo += f":{parts.password}"
    netloc = f"{userinfo}@{host}" if userinfo else host
    if port:
        netloc += f":{port}"

    direct = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return {
        "direct": direct,
        "yoyo": re.sub(r"^postgres(ql)?:", "postgresql+psycopg:", direct),
        "host": host,
        "port": str(port or DEFAULT_PORT),
        "display": _mask(direct),
    }


# Asking PostgreSQL whether it speaks TLS. Any running PostgreSQL answers with a
# single byte whatever its password or settings, and anything that is not yet a
# database closes the connection instead.
_SSL_REQUEST = struct.pack("!ii", 8, 80877103)


def _answers(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(_SSL_REQUEST)
            reply = sock.recv(1)
            return reply in (b"S", b"N")
    except OSError:
        return False


def wait_for_database(urls: dict[str, str], seconds: int = 90) -> None:
    """Wait until the database can answer, which is not when the port opens.

    Docker publishes the port as soon as the container starts, so a connection
    can succeed against a database that is still building itself and will drop
    it. On a first start that lasts about twenty seconds.
    """
    import time

    host, port = urls["host"], int(urls["port"])
    for attempt in range(seconds):
        if _answers(host, port):
            if attempt:
                print()
            return
        if attempt == 0:
            print(f"  waiting for the database on {host}:{port}", end="", flush=True)
        else:
            print(".", end="", flush=True)
        time.sleep(1)

    print()
    sys.exit(
        f"\nNothing answered on {host}:{port} after {seconds} seconds.\n\n"
        "  Is the stack running?   npm run stack\n"
        "  Is DB_PORT right?       npm run check-env\n"
    )
