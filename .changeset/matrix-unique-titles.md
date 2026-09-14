---
'@sdods/core': patch
'@sdods/contracts': patch
---

Role matrices: a custom `title` must use `<role>` and every row column. A title such as `'<surface> → <expect>'` gave two roles with the same outcome the same test title, and Playwright refuses to load duplicate titles. A title that still renders the same text twice (adjacent placeholders) is reported too.
