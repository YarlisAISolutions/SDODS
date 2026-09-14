---
'@sdods/core': patch
---

`sdods load` no longer passes `K6_*` environment variables to k6. k6 reads `K6_VUS`, `K6_STAGES`, `K6_DURATION`, `K6_ITERATIONS`, `K6_SCENARIOS` and the rest as options that override the script, so a stray one bypassed the profile and `load.maxVus`. The run prints a warning naming the variables it left out.
