"""Where the published road data comes from.

Every value here is provisional, which is why they are gathered in one small
file rather than spelled out wherever they are needed.

**The releases address is a stopgap.** Publishing through GitHub Releases was
chosen because creating packages in the organisation's container registry is
blocked by a permission nobody on the project can grant. A container registry is
the intended home, and moving there changes `releases` and nothing else.

**The names carry `preview` on purpose.** The road network is due to move to
OpenStreetMap, which changes what a segment is and therefore what an identifier
means. Publishing under a plain name now would leave us unable to say which of
two incompatible things a stored response refers to.

**The loader address names a branch**, because that is where the loader lives
today. Shorten it to `develop` once ridescoredc-models#11 is merged.

Any value can be overridden for one machine by setting the matching name in
`.env`, or for one run with a command-line option. Overriding is expected while
working on the pipeline; changing the values here is how the project as a whole
moves.
"""

from __future__ import annotations

DEFAULTS = {
    # Where releases are published.
    "releases": "https://github.com/civictechdc/ridescoredc-models/releases",

    # What the two published files are called. Neither name carries a version,
    # so that "latest" works without knowing one.
    "package_file": "ridescoredc-data-preview.tar.gz",
    "bundle_file": "ridescoredc-bundle-preview.tar.gz",

    # How a version becomes a release tag: --version 0.1 -> data-preview-0.1
    "tag_prefix": "data-preview-",

    # The program that does the loading. It lives in the pipeline repository and
    # is fetched and run in one step, so this repository carries no copy that
    # could drift from the original.
    "loader": (
        "https://raw.githubusercontent.com/civictechdc/ridescoredc-models/"
        "step2/package-and-load/scripts/load_package.py"
    ),
}

# The setting name that overrides each value.
OVERRIDES = {
    "releases": "DATA_RELEASES",
    "package_file": "DATA_PACKAGE",
    "bundle_file": "DATA_BUNDLE",
    "loader": "DATA_LOADER",
}


def data_source(settings: dict[str, str] | None = None) -> dict[str, str]:
    settings = settings or {}
    source = dict(DEFAULTS)
    for key, name in OVERRIDES.items():
        if settings.get(name):
            source[key] = settings[name]
    return source


def asset_url(source: dict[str, str], version: str | None, filename: str) -> str:
    if version:
        return f"{source['releases']}/download/{source['tag_prefix']}{version}/{filename}"
    return f"{source['releases']}/latest/download/{filename}"
