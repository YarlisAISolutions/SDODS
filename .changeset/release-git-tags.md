---
'@sdods/cli': patch
---

The release job no longer goes red after a successful publish.

`scripts/publish-npm.sh` printed the `New tag: <name>@<version>` line that
`changesets/action` parses, but never created the git tag it names. The action
then ran `git push origin <name>@<version>` for each published package and every
push failed with `src refspec does not match any` — so 0.3.0 went to npm
correctly and the job still reported failure, with no tags on the repo.

The script now creates each tag after the publish that earned it. Failing to tag
is not fatal: the packages are on the registry by that point and cannot be taken
back, so aborting would leave the release half-done for nothing.
