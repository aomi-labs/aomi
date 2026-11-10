import tempfile
import unittest
from pathlib import Path

import check_doc_facts


def problems(body: str, status: str = "authoritative", rel: str = "docs/topics/t/facts/t.md") -> list[str]:
    with tempfile.TemporaryDirectory() as root:
        path = Path(root) / rel
        path.parent.mkdir(parents=True)
        path.write_text(f"---\ntitle: T\nstatus: {status}\n---\n\n# T\n\n{body}\n", encoding="utf-8")
        return check_doc_facts.check(path, rel)


def rules(found: list[str]) -> list[str]:
    return [line.split("[", 1)[1].split("]", 1)[0] for line in found]


class CheckDocFactsTest(unittest.TestCase):
    def test_present_tense_facts_pass(self) -> None:
        body = (
            "The issuer is `https://aomi.chat/api/auth`. Tokens from another origin are rejected.\n"
            "A stored mode of `denied` remains blocked. 128 facts are pending.\n"
            "The Backend rejected the request. The requested key does not match."
        )
        self.assertEqual(problems(body), [])

    def test_each_kind_of_state_fails(self) -> None:
        cases = {
            "pr-voice": "This PR prepares runtime code and does not change live config.",
            "snapshot": "Audit date: 2026-11-10. No service changed.",
            "verdict": "| Signer drain | **BLOCKED** | untested |",
            "pending": "Credential reconstruction is not yet proven.",
            "decision": "Cecilia explicitly rejected legacy issuer compatibility.",
        }
        for rule, body in cases.items():
            with self.subTest(rule=rule):
                self.assertEqual(rules(problems(body)), [rule])

    def test_dated_heading_fails(self) -> None:
        self.assertEqual(rules(problems("## Audit — 2026-11-10, main 66534f6f8")), ["snapshot"])

    def test_status_names_trust_not_progress(self) -> None:
        self.assertEqual(rules(problems("Fine.", status="blocked")), ["status"])
        self.assertEqual(problems("Fine.", status="working"), [])

    def test_code_is_not_prose(self) -> None:
        body = "Run `echo this PR` to print.\n\n```sh\n# TODO this PR\n```"
        self.assertEqual(problems(body), [])


if __name__ == "__main__":
    unittest.main()
