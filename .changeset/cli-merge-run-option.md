---
'@sdods/cli': patch
---

`sdods report merge <dirs...> --run <id>` now writes into that run. The parent `report` command also defines `--run`, and Commander handed the option to it, so `merge` silently fell back to the latest run (or failed with "No run to merge into").
