# Step-4 cutover gate

Written in advance so cutting a call site over from `rbac.ts` to this module
is a mechanical check against a pre-agreed bar, not a judgment call made
under deadline pressure. Applies independently to each of the 9(+1) call
sites — cutting one over does not cut over the others.

## Explicitly deferred: `event:delete`

The old model's `staff` role had `event:delete`; the new catalogue has no
`event:delete` permission string at all, and no role can be granted it.
Checked for signal before deferring rather than assuming either way:
`submissions` has an explicit lifecycle (`status` + `deleted_at`, real
soft-delete); `events` has neither -- no status, no `deleted_at`, no archive
flag of any kind, in either `server/`'s original migration or main-panel's
schema. No "archive instead of delete" pattern exists anywhere for events.
Combined with `0001_authz_core.sql`'s own header comment ("this migration
intentionally does not model the full feature set... those belong to
feature-endpoint migrations that come later"), this reads as **event
deletion/archival simply hasn't been designed yet**, not a deliberate
decision that events are undeletable. Needs a schema/lifecycle decision
(hard delete? soft delete matching submissions' pattern? archive status?)
before any permission can be added -- out of scope for the RBAC
reconciliation itself. No call site should be blocked on this; it's a gap
to carry forward, not a blocker for cutover.

## What "cut over" actually means

Not "delete `shadowCompare`". `shadowCompare` (see `shadow-check.ts`) always
has one *authoritative* side and one *observed* side. Before cutover: legacy
is authoritative, the new module is observed-only. Cutover flips which side
is authoritative — it does not remove the comparison. Concretely, `legacy`
and `candidate` swap roles in the `shadowCompare` call at that site. The
wrapper stays in place for the **reverse-shadow window** below, so there's a
fast, mechanical revert path (flip back) if something surfaces that the
pre-cutover window didn't catch, rather than needing a code deploy to undo.

## Gate 1 — deterministic coverage (required before any live shadowing starts)

A scripted test suite (same shape as `verify-authz-module.ts`) covering, for
that specific call site's permission(s):
- Every role that can legitimately reach the permission — both allow and
  deny cases.
- Every scope combination relevant to that permission (`event`/`session`/
  `own`/`global` as applicable per `PERMISSION_ALLOWED_SCOPES`).
- The tenant-mismatch case specifically — same role/scope shape, wrong
  tenant. This is the new behavior this reconciliation introduces; it does
  not get to ride on old test coverage.
- Expired and revoked grants (`expires_at`/`revoked_at`) denying correctly.

All passing with **zero** discrepancy between legacy and the new module,
run standalone, before step 2 (below) begins. This answers "does the
candidate even structurally agree with legacy," not "does it agree under
real usage timing" — necessary, not sufficient on its own.

## Gate 2 — live shadow window

Two ways to satisfy this, since pre-launch traffic may not exist yet for
every call site:

**Path A — organic traffic**, if the call site has any (staff/QA/soft-launch
usage counts):
- At least **200 shadow-compared calls**, AND
- Spanning at least **7 consecutive calendar days**.

Both together, not either alone — volume alone can be produced in a single
burst and miss timing-dependent edge cases (a grant expiring mid-window, a
revocation landing between two calls); time alone doesn't prove the
candidate handles real variety.

**Path B — staged/synthetic exercise**, if Path A's volume won't be reached
within 14 days:
- 100% of the role × scope × tenant-match/mismatch matrix from Gate 1,
  exercised through the real call site (not just the standalone test
  suite) in a staging environment.
- Executed across **at least 3 distinct sessions on at least 3 different
  days**, by a person, not a single scripted burst — the point is
  confirming the candidate doesn't behave differently across different
  real-world timing conditions (different login sessions, different clock
  states), which a single automated loop can't prove even at high volume.

Either path: **zero mismatches** logged in `authz_shadow_mismatches` for
that `checkName` across the entire window.

## Zero tolerance, one direction resets the clock

A `legacy=allow, candidate=deny` mismatch (candidate more restrictive) is an
availability bug — investigate and fix, but doesn't necessarily invalidate
prior clean history once fixed.

A `legacy=deny, candidate=allow` mismatch (candidate more permissive) is a
potential privilege-escalation bug. **Any single occurrence resets Gate 2's
window to zero for that call site**, regardless of how much clean history
preceded it. This is deliberately stricter than "just outnumber it with
successful matches" — authorization bugs in this direction don't get
averaged away.

## Gate 3 — human sign-off

Quantitative gates passing is necessary, not sufficient. Before cutover:
- A second person (not whoever wrote the candidate path for that call site)
  reads the accumulated `authz_shadow_mismatches` rows for that `checkName`
  (expected: none) and reviews the specific legacy-vs-candidate diff.
- Sign-off recorded (a PR approval referencing this document is enough —
  no separate tracking system needed).

## After cutover

Leave `shadowCompare` running with the new module now authoritative and
legacy observed, for the **same window** as Gate 2 was required
pre-cutover, before removing the wrapper and calling that call site fully
migrated. Same mismatch-resets-the-clock rule applies in reverse.
