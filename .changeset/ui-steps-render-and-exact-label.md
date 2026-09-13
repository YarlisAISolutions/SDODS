---
'@sdods/core': patch
---

Built-in steps render every `{{variable}}` the same way, and field steps no longer trip over a control whose label merely contains the field's.

- Every built-in step renders its string arguments through one shared helper, `renderStrict()`. `the page URL should contain`, `the page title should contain`, the test-id, dropdown, checkbox, upload, visual-baseline and mock steps rendered nothing before, so `"/workspace/{{fixtureWorkspaceId}}"` was matched with its braces and could never pass. The API steps now also render JSON paths, header names and values, regex patterns and schema names.
- A variable with no value now fails the step with `no such variable: <name>` instead of being matched as the literal `{{name}}`. For a negative assertion that is the difference between a check and a no-op: `I should not see the text "{{tenantBDatasetId}}"` used to pass whatever the page showed, and a request to `/datasets/{{tenantBDatasetId}}` used to go out and 404. Doc-string bodies (JSON, HTML, raw text) still render leniently, since free text may carry `{{…}}` of its own. Arguments that name the variable being written (`… as {string}`) are identifiers and are not rendered.
- `I fill the {string} field with {string}`, `I fill the form:`, `I select … dropdown`, `I check … checkbox` and `I upload …` prefer an exact label and a control whose role fits the action, then fall back to the partial label. `getByLabel('Password')` also matched a "Show password" toggle, and the fill failed on a strict-mode violation.
- `Healer.resolve()` treats a visible locator that matches several elements as a heal trigger for click, fill, select and check: it narrows to the one element whose role fits the action and records a HealEvent, or fails with `HEAL_FAILED` naming the match count. It used to return the ambiguous locator, so the action threw a strict-mode violation that healing never saw. Assertions and hovers are unchanged.
