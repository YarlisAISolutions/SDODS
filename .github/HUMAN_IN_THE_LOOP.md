# Human in the loop

An issue labelled `human-in-the-loop` has had everything automatable done, and the rest needs a
person: a decision, access, an approval, or a manual action. New ones use the issue form
(`.github/ISSUE_TEMPLATE/human_in_the_loop.yml`). An **existing** issue gets the label and a comment
in the shape below, since a form cannot be applied after the fact.

**How to react:** 👀 on the issue when you take it · tick the checklist as you go · comment `done`
with the verification output and close · comment `blocked: <why>` if you cannot.

**Order:** 1 Blocker (production, security or a release waits) · 2 Next (unblocks PRs or issues) ·
3 Planned (a design decision, nobody blocked yet) · 4 Housekeeping (another repo, cleanup).

```markdown
## 🧑 Human in the loop

| | |
|---|---|
| **Order** | 2 — Next |
| **Blocks / blocked by** | Blocks #… · blocked by #… |
| **Why a human** | Decision / Access / Approval / Manual action |
| **App name** | … |
| **Repo name** | siri1410/SDODS |
| **Last release** | @sdods/cli@x.y.z (date) · api revision … |

### Context
What is already done (PRs, commits, runs) and the one thing still needed.

### Steps to reproduce
1. `command`
Expected: … · Actual: …

### Screenshots / videos
Links to run artifacts, or n/a.

### Instructions to resolve
- [ ] 1. …
- [ ] 2. …

### How to verify it is done
`command` → expected output.
```

List what is waiting on people:

```
gh issue list --label human-in-the-loop --state open
```
