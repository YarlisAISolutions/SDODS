---
'@sdods/core': patch
---

Mailpit: a message read in full now has a real `receivedAt`. Mailpit's full `Message` object carries `Date` and no `Created` (only the search summary has `Created`), so `receivedAt` was always 1970-01-01.
