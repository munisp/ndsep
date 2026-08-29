"""Minimal runtime-compatibility coverage for NDSEP Python sources.

The workers use optional third-party runtimes, so this test intentionally validates the
invariant that every version-controlled Python module can be parsed and compiled by the
Python version selected in CI. Service-specific integration tests can be added without
weakening this baseline gate.
"""

from __future__ import annotations

import py_compile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = (
    REPOSITORY_ROOT / "orchestration",
    REPOSITORY_ROOT / "workers" / "python",
    REPOSITORY_ROOT / "services" / "python",
)


def test_version_controlled_python_sources_compile() -> None:
    """Every owned Python source file must compile with the CI interpreter."""
    failures: list[str] = []

    for source_root in SOURCE_ROOTS:
        for source_path in source_root.rglob("*.py"):
            if "__pycache__" in source_path.parts or ".venv" in source_path.parts:
                continue
            try:
                py_compile.compile(str(source_path), doraise=True)
            except py_compile.PyCompileError as error:
                failures.append(f"{source_path.relative_to(REPOSITORY_ROOT)}: {error.msg}")

    assert not failures, "Python source compilation failures:\n" + "\n".join(failures)
