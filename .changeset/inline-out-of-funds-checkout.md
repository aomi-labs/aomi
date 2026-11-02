---
"@aomi-labs/widget": patch
"@aomi-labs/react": patch
---

Out of funds, the widget opens Add funds checkout in place instead of linking to Chat on another origin, so embedded hosts' visitors top up without leaving the page. A `builder_debt` refusal shows "App paused" instead of asking the user to pay, since their own balance can't fix it.
