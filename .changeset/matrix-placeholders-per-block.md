---
'@sdods/core': patch
---

Role matrices: placeholders are checked per `Examples:` block, the way Gherkin fills them. A column that only a hand-written block has is now reported for the generated blocks (it stayed a literal `<column>` in every generated row), and a hand-written block that lacks a placeholder the outline uses is reported on that block.
