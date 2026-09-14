# Traceability: Shop (shop)

Generated 2026-09-02T08:00:00.000Z.

| Field | Value |
| --- | --- |
| Run | run-1 |
| Environment | staging |
| Started | 2026-09-01T09:59:00.000Z |
| Finished | 2026-09-01T10:00:00.000Z |
| Exit code | 1 |
| Git | 0123456789abcdef0123456789abcdef01234567 (main) |
| SDODS version | 0.7.2 |
| Tags | @smoke or @regression |
| CI | https://ci.example.com/runs/42 |
| Results from | cucumber-messages |

## Summary

| Field | Value |
| --- | --- |
| Requirements | 5 |
| Covered | 4 |
| Passed | 1 |
| Failed | 2 |
| Not run | 1 |
| Not covered | 1 |
| Undeclared ids | 0 |
| Scenarios | 5 (4 traced, 1 untraced) |

## Requirements

| Requirement | Title | Status | Scenarios |
| --- | --- | --- | --- |
| [AUTH-1](https://jira.example.com/browse/AUTH-1) | A registered user can sign in | failed | 2 |
| [AUTH-2](https://jira.example.com/browse/AUTH-2) | A locked account cannot sign in | failed | 1 |
| [ORD-1](https://jira.example.com/browse/ORD-1) | A customer can place an order | passed | 1 |
| [ORD-2](https://jira.example.com/browse/ORD-2) | A customer can cancel an order | not-run | 1 |
| [PAY-1](https://jira.example.com/browse/PAY-1) | Card payments are captured | not-covered | 0 |

### AUTH-1: A registered user can sign in

Status: **failed**

| Scenario | Location | Tags | Status | Results | Duration |
| --- | --- | --- | --- | --- | --- |
| Valid login | features/auth/login.feature:5 | @ui @req:AUTH-1 @smoke | passed | shop--ui--chromium: passed; shop--ui--firefox: passed | 2.7s |
| Locked user | features/auth/login.feature:11 | @ui @req:AUTH-1 @regression @req:AUTH-2 | failed | shop--ui--chromium: passed (flaky); shop--ui--firefox: failed | 1.8s |

### AUTH-2: A locked account cannot sign in

Status: **failed**

| Scenario | Location | Tags | Status | Results | Duration |
| --- | --- | --- | --- | --- | --- |
| Locked user | features/auth/login.feature:11 | @ui @req:AUTH-1 @regression @req:AUTH-2 | failed | shop--ui--chromium: passed (flaky); shop--ui--firefox: failed | 1.8s |

### ORD-1: A customer can place an order

Status: **passed**

| Scenario | Location | Tags | Status | Results | Duration |
| --- | --- | --- | --- | --- | --- |
| Create order | features/api/orders.feature:6 | @api @smoke @req:ORD-1 | passed | shop--api #1: passed; shop--api #2: passed | 0.7s |

### ORD-2: A customer can cancel an order

Status: **not-run**

| Scenario | Location | Tags | Status | Results | Duration |
| --- | --- | --- | --- | --- | --- |
| Cancel order | features/api/orders.feature:16 | @api @regression @req:ORD-2 | not-run |  |  |

### PAY-1: Card payments are captured

Status: **not-covered**

No scenario covers this requirement.

## Scenarios without a requirement

| Scenario | Location | Status |
| --- | --- | --- |
| Health | features/api/orders.feature:21 | skipped |

## Notes

- A requirement passes only when every scenario that covers it passed in this run; skipped or missing results count as not run.
- The sign-off block is filled in by a person. SDODS never writes it: sign-off authority is human.

## Sign-off

To be completed by a person. SDODS does not fill in this section.

| Field | Value |
| --- | --- |
| Signed by |  |
| Role |  |
| Date |  |
| Decision |  |
| Notes |  |
