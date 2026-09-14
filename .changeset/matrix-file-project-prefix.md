---
'@sdods/cli': patch
---

`sdods matrix expand --file <path>` without `-p` no longer also plans the file under a project whose folder name is a prefix of the right one (`projects/shop` for a file in `projects/shop-admin`).
