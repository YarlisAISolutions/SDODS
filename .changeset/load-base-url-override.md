---
'@sdods/contracts': patch
'@sdods/core': patch
---

`sdods load` refuses a `SDODS_API_BASE_URL` that differs from the environment's `api.baseUrl`, because the opt-in (`load.allowed`) belongs to that environment file and a stray override sent the load to another host. `--dry-run` reports it as a guard problem. An environment whose URL is meant to change per run sets `load.allowBaseUrlOverride: true`.
