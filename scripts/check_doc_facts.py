#!/usr/bin/env python3
"""Fail when a facts page states something other than a fact.

A facts page (`docs/topics/<topic>/facts/*.md`) says what is true of the code
at this commit. It changes only when the code changes. A sentence that can
become false without a commit is state, and state lives in the system that
owns it: the pull request, the tracking issue, a workflow artifact or the
release ledger.

Rules, each reported as `path:line: [rule] text`:

  status     frontmatter `status` is `authoritative`, `working` or `archived`
  pr-voice   the page talks about the pull request or branch that wrote it
  snapshot   a dated audit, review or "as of" statement
  verdict    a run result such as PASS, FAIL or BLOCKED
  pending    work that has not happened yet
  decision   who approved, rejected or decided something

One-line dated history is allowed in a page listed in LEDGERS.

Usage: check_doc_facts.py [--root DIR] [FILE ...]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FACTS_GLOB = "docs/topics/**/facts/**/*.md"
STATUSES = {"authoritative", "working", "archived"}

# Pages whose whole purpose is one dated row per event.
LEDGERS: set[str] = set()
LEDGER_EXEMPT = {"snapshot", "verdict"}

DATE = r"20\d\d-\d\d-\d\d"
SHIPPED = (
    r"deployed|activated|enabled|live|merged|shipped|released|landed|"
    r"implemented|wired|proven|verified|migrated|rolled out"
)

RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "pr-voice",
        re.compile(
            r"\b(this|the current|the present) (PR|pull request|branch|commit|patch|change set|changeset)\b"
            r"|\bin (this|a|the) follow-up (PR|pull request|change)\b"
            r"|\bfollow-up PR\b",
            re.I,
        ),
    ),
    (
        "snapshot",
        re.compile(
            rf"^#+ .*\b{DATE}\b"
            rf"|\b(audit(ed)?|review(ed)?|snapshot|verified|observed|measured|inspected|checked|qualified)"
            rf"( date| on| at)?:? +{DATE}"
            rf"|\bas of (main )?({DATE}|[0-9a-f]{{7,40}}\b)"
            rf"|\blast (reviewed|verified|checked|audited)\b",
            re.I,
        ),
    ),
    (
        "verdict",
        re.compile(
            r"^#+ .*\b(BLOCKED|PASS(ED)?|FAIL(ED)?|NO-GO)\b"
            r"|\*\*(PASS|FAIL|BLOCKED|GO|NO-GO)\*\*"
            r"|\b(remains?|still|is|are) BLOCKED\b"
            r"|\b(result|verdict|outcome|readiness): +\**(BLOCKED|PASS|FAIL|GO|NO-GO)\b"
        ),
    ),
    (
        "pending",
        re.compile(
            rf"\b(is|are|was|were|has|have)( still)? not( yet)? been ({SHIPPED})\b"
            rf"|\bnot yet ({SHIPPED})\b"
            rf"|\b(is|are|remains?) (currently )?blocked (by|on|pending|until)\b"
            rf"|\b(rollout|activation|deployment|evidence|verification|sign-off|qualification|acceptance)"
            rf"( [a-z]+)? (is|are|remains?) (still )?pending\b"
            rf"|\bimplementation status\b"
            rf"|\bwill be (removed|deleted|migrated|enabled|added|retired|replaced) (in|after|once|when|by)\b"
            rf"|\b(TODO|WIP|TBD)\b",
            re.I,
        ),
    ),
    (
        "decision",
        re.compile(
            r"\b[A-Z][a-z]+ (has|explicitly|has explicitly) "
            r"(approved|rejected|decided|signed off|authorized|vetoed|asked for|requested)\b"
            r"|\b(approved|rejected|decided|authorized|signed off|requested) by [A-Z][a-z]+\b"
        ),
    ),
]

FENCE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE = re.compile(r"`[^`\n]*`")
LINK_TARGET = re.compile(r"\]\([^)]*\)")


def split_frontmatter(lines: list[str]) -> tuple[dict[str, str], int]:
    """Return top-level scalar frontmatter keys and the first body line index."""
    if not lines or lines[0].strip() != "---":
        return {}, 0
    meta: dict[str, str] = {}
    for index in range(1, len(lines)):
        line = lines[index]
        if line.strip() == "---":
            return meta, index + 1
        match = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if match:
            meta[match.group(1)] = match.group(2).strip().strip("\"'")
    return {}, 0


def check(path: Path, rel: str) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    meta, body_start = split_frontmatter(lines)
    exempt = LEDGER_EXEMPT if rel in LEDGERS else set()
    problems: list[str] = []

    status = meta.get("status")
    if status is not None and status not in STATUSES:
        allowed = ", ".join(sorted(STATUSES))
        problems.append(f"{rel}:1: [status] `{status}` is not one of {allowed}")

    fenced = False
    for number, raw in enumerate(lines[body_start:], start=body_start + 1):
        if FENCE.match(raw):
            fenced = not fenced
            continue
        if fenced:
            continue
        text = LINK_TARGET.sub("]", INLINE_CODE.sub("``", raw))
        for rule, pattern in RULES:
            if rule in exempt:
                continue
            if pattern.search(text):
                problems.append(f"{rel}:{number}: [{rule}] {raw.strip()[:140]}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("files", nargs="*", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()

    paths = [p.resolve() for p in args.files] or sorted(root.glob(FACTS_GLOB))
    problems: list[str] = []
    for path in paths:
        problems += check(path, path.relative_to(root).as_posix())

    if problems:
        print("\n".join(problems))
        files = len({p.split(":", 1)[0] for p in problems})
        print(
            f"\n{len(problems)} problem(s) in {files} facts page(s). "
            "A facts page states what is true of the code at this commit. "
            "See docs/index.md, What Belongs Here.",
            file=sys.stderr,
        )
        return 1
    print(f"doc facts: {len(paths)} page(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
