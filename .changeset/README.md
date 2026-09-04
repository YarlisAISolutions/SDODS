# Changesets

Every change to a published `@sdods/*` package needs a changeset:

```bash
bunx changeset            # pick packages + bump type, write a summary
```

`release.yml` opens a "version packages" PR on `main`; merging it publishes to npm. All `@sdods/*` packages are versioned together (`fixed` group).
