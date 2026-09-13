---
'@sdods/core': patch
---

`I should not see the text` checks what the user can see, and the text steps get exact variants.

- `I should not see the text {string}` passes when no VISIBLE element contains the text. It used to assert that no element in the DOM contained it, so a closed FAQ answer (`hidden`) or a collapsed panel failed the step although nothing was on screen. It now filters on visibility (`getByText(...).filter({ visible: true })` + `toHaveCount(0)`), which is strict-mode safe and retries until the text goes away.
- `I should see the text {string}` looks past hidden matches: a hidden copy earlier in the DOM no longer fails the step when a visible copy is on the page.
- New `I should see the exact text {string}` and `I should not see the exact text {string}` match an element's whole text, so `"already"` no longer collides with "the clients you already serve".
- Migration: new `the page should not contain the text {string}` keeps the old DOM-absence check (substring, hidden elements included). A scenario that relied on `I should not see the text` failing for hidden text should switch to it.
- All new steps render `{{variables}}` through `renderStrict()`, so an unset variable fails the step instead of passing a negative check.
