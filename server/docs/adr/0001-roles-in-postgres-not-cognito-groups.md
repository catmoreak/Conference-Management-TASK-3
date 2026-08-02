# ADR 0001: Roles and scoped assignments live in Postgres, not Cognito groups

## Status

Accepted

## Context

Cognito can carry authorization data two ways: group membership (baked into
the ID token's `cognito:groups` claim, and optionally the access token) or
custom claims added by a pre-token-generation Lambda trigger. Either would
let a handler read a role list straight off the verified token, with no
database round trip. We rejected both in favor of a `user_role_assignments`
table resolved fresh on every request.

## Decision

A Cognito token is used **only to establish identity** (the verified `sub`).
Every request or WebSocket message resolves that user's current role set by
querying Postgres at decision time. Nothing about authorization is trusted
from the token itself beyond "this is really user `sub`."

## Why

**Scope doesn't fit in a group name.** A role assignment here is `(user,
role, scope)`, where scope is an event, a session, "own," or global. Cognito
groups are flat strings with a hard cap of 50 groups per user and no
structured way to attach `event_id` or `session_id` to a group without
encoding it into the group name (`reviewer:event:<uuid>`) and parsing it back
out in every handler — which reintroduces exactly the kind of ad hoc,
per-handler string parsing this design is trying to eliminate. A Postgres
table with a `scope_type`/`scope_id` column pair is the natural shape for
this data; a group name is not.

**Revocation has to be immediate, not eventually-consistent.** Cognito
groups are only re-read from the identity provider when a token is issued or
refreshed. Pulling a compromised `reception_staff` account's access, or
correcting a reviewer's event assignment, would otherwise take effect only
after their access token expires (typically up to an hour) or a forced
global sign-out — unacceptable for a system where the same admin action
("this person shouldn't be reviewing this event anymore") needs to apply to
their very next API call. Because roles are read from Postgres per request,
revoking a row (`revoked_at = now()`) is live immediately.

**Time-boxed grants need a real expiry column.** The presenter self-playback
clicker (see the playback-principal decision below) is implemented as an
ordinary `operator` row scoped to one session with an `expires_at`. Cognito
tokens have their own TTL, but it's the wrong TTL — it governs how long the
*identity* is trusted, not how long a specific *capability* should be live.
Decoupling the two required grant-level expiry, which only exists because
the grant is a database row.

**Service principals need to sit in the same authorization model without
being Cognito users at all.** The conversion worker, malware scanner, and
podium app authenticate via IAM/service credentials, never a Cognito login.
Keeping the role→permission policy in application code and data (rather than
inside the identity provider's token-issuance pipeline) means humans and
services go through the exact same `canUserPerform` resolution path instead
of two divergent authorization systems that both need to be kept correct.

**Audit and joins.** Every decision produces an audit row referencing the
acting user and the resource. Assignments, submissions, sessions, and events
all live in the same Postgres database, so scope-matching and audit queries
are ordinary SQL joins. None of that is available if the authoritative
assignment data lives inside Cognito.

The cost we accepted: a DB round trip (a single indexed lookup on
`user_role_assignments` by `user_id`) on every authorization check, instead
of reading a claim already sitting in memory. For an authorization boundary
gating submission approval and live playback control, correctness and
immediate revocation were worth more than that lookup.

## How a Cognito token maps to a role set on each request

1. The client sends `Authorization: Bearer <token>` (REST) or presents the
   token during the WebSocket `$connect` handshake.
2. A verification step upstream of this module (not part of the
   authorization layer — see scope note below) validates the JWT signature
   against Cognito's JWKS, and checks `iss`, `aud`/`client_id`, `token_use`,
   and `exp`. If verification fails or the token is expired, no actor is
   attached to the request at all.
3. On success, the verified `sub` claim becomes a `HumanActor { kind: 'user',
   userId: sub }`, attached to `req.actor` (REST) or bound to the connection
   ID in a connection store (WebSocket, at `$connect` time only).
4. From here, Cognito is out of the picture. Every `requirePermission` call
   and every `authorizeWsMessage` call resolves that `userId`'s current,
   non-revoked, non-expired role assignments from `user_role_assignments`
   fresh, at decision time — never from a cached claim, and for WebSocket,
   never only once at connect. A role revoked or an assignment expired
   between two messages on the same open connection changes the outcome of
   the very next message.
5. `canUserPerform` combines that assignment set with the permission's
   role→permission grant (`ROLE_PERMISSIONS`) and its scope match against the
   resource, and records an audit row regardless of outcome.

Token verification itself (step 2) is deliberately out of scope for this
authorization layer — it's authentication, not authorization, and is
expected to be a small, swappable seam (e.g. `aws-jwt-verify` against the
User Pool) sitting in front of `requirePermission`/the WS `$connect` handler.
This is also why "expired/absent token" is tested at the `req.actor`
boundary: an expired token and no token at all are, by design,
indistinguishable to this module — both simply mean no actor was attached,
and `requirePermission` denies both identically with `reason:
'unauthenticated'`.

## Revocation, not just expiry

`user_role_assignments` has both `expires_at` (for grants that are meant to
end on their own, like the presenter's self-playback clicker below) and
`revoked_at` (for grants an admin actively pulls). Both are filtered at the
store boundary — `getActiveAssignments` and `hasActiveOperatorForSession`
exclude any row where `revoked_at` is set or `expires_at` has passed — so
the decision logic in `authorize.ts` never sees either column; it only ever
sees rows that are currently valid. Revoking a row takes effect on that
user's very next authorization check, on any open connection, mid-session,
with no dependency on token refresh or reconnect — that immediacy is the
core argument in this ADR, and revocation is where it matters most in
practice: pulling a compromised account's access, or correcting a mis-typed
event assignment, needs to apply *now*, not at the next login.

## Playback grant lifetime vs. JWT expiry

A presenter driving their own slides from a phone must not lose control
mid-talk because their access token happened to expire. This is only safe
because two things that could easily get conflated are kept strictly
separate:

- **Identity** (who is this connection) is bound once at WebSocket
  `$connect` time, from a verified token, and held by the connection store
  for the life of the connection. `authorizeWsMessage`'s signature does not
  accept a token at all — there is no code path in this module by which a
  token's `exp` could affect a decision on an already-open connection. See
  the contract documented on `WsConnectionStore` in `ws-authorize.ts`: a
  real implementation must not re-verify the original JWT or evict the
  identity binding based on its `exp`, only on an actual disconnect.
- **Capability** (can this identity control this session's playback right
  now) is governed entirely by the assignment row's own `expires_at` —
  typically set to the session's end time when the presenter is checked in
  — re-checked fresh on every single message via `canUserPerform`.

So "re-resolve identity per message," as this module does, does not mean
"re-verify the token per message" — those are different things bound to
different lifetimes for different reasons. The grant's `expires_at` is the
only authority over how long playback control lasts; the token only ever
gates whether a *new* connection can be opened.

## Presigned URL TTL and the revocation gap

`authorizeAndPresign` mints S3 presigned URLs only after an allow decision,
always with a fixed `PRESIGNED_URL_TTL_SECONDS` (300s / 5 minutes — see
`presign-policy.ts`) that the caller cannot override. This exists because
minting a URL is a one-way trapdoor: S3 has no API to revoke a presigned URL
early, so from the moment one is issued until it expires, anyone holding the
link can use it regardless of what happens to the underlying authorization
afterward — a submission gets rejected, a reviewer's event assignment gets
pulled, an operator's session grant gets revoked. `canUserPerform` is not
consulted again for that URL. The TTL is the entire bound on that gap, which
is why it's kept short: `submission:download` / `submission:read_approved`
can always be re-derived from a fresh check on demand, so nothing legitimate
needs a link that outlives the request that asked for it.

## Audit write failures don't get to decide authorization outcomes

`canUserPerform` (and therefore `requirePermission` and
`authorizeWsMessage`) treats every audit write as best-effort: the write is
attempted, but a failure is swallowed and never changes the returned
decision or propagates to the caller. The alternative — letting an
audit-log outage block every read and silently hang every request, which is
what happened before this was made explicit — turns an observability
component into a single point of failure for the whole system. Denials are
always best-effort for the same reason; there's nothing for a denial's audit
row to be atomic with.

Mutations are the one place this isn't good enough: an approval, rejection,
or other state change that commits while its audit row silently fails to
write is a real gap in the record ("every decision produces an audit log
row" stops being true exactly when it matters most). `authorizeMutationAndRun`
exists for this: the allow-decision audit row and the caller's mutation run
inside one `AuthzStore.runInTransaction` call, sharing a transaction, so
they commit together or roll back together. A failed audit insert takes the
mutation down with it — deliberately fail-closed, and only for the mutating
path. `requirePermission`, the Express middleware, is not this path; it's a
cheap preliminary gate that runs before a handler's own transaction even
starts, so it cannot provide this guarantee by itself. Mutating route
handlers are expected to call `authorizeMutationAndRun` around their actual
write, not rely on `requirePermission` alone.
