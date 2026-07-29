"""Entry point for ``python -m cli``.

A module entry point rather than a console script: ``[tool.uv] package = false``
means nothing is installed into the environment, so this is the one invocation
that works identically in a checkout, in CI and inside the container image.
"""

from __future__ import annotations

import sys

from cli.main import main

if __name__ == "__main__":
    sys.exit(main())
