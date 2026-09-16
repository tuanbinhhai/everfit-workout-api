# Workout Logging API

A production-oriented Workout Logging API built for the Everfit Backend Engineer take-home
assignment: bulk workout logging, filterable/paginated history, personal-record calculation, and
personal-record range comparison, on top of PostgreSQL with a schema and query strategy sized for
50,000+ entries per user.

## Project Overview

- **Workout logging** — log one or many exercises (each with one or more sets) in a single
  atomic request. Each set's weight is stored both as originally entered and normalized to a
  canonical kg value.
- **Workout history / search** — paginated history for a user, filterable by partial exercise
  name, date range, and muscle group, with weights convertible to a requested display unit.
- **Personal records (PRs)** — heaviest set, highest-volume set, and best estimated 1RM for a
  user + exercise, each with its achievement date.
- **PR range comparison** — the same three PR metrics computed independently over two
  caller-supplied date ranges, plus the absolute/percentage delta between them.
- **kg/lb normalization** — every stored set carries both its original `{weight, unit}` and a
  canonical `weightKg`; all comparison/ranking logic operates in kg, converting to the requested
  display unit only at the response boundary.
- **Production-oriented design** — structured JSON logging with request-id correlation, a global
  structured error envelope, atomic bulk writes, indexes chosen for the actual query patterns
  (not guessed), and every non-trivial performance claim backed by real `EXPLAIN (ANALYZE,
  BUFFERS)` evidence against a real 50,000-entry dataset (see
  [Performance Verification](#performance-verification)).

## Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | **>= 22.12** (required by `nestjs-pino` v5) |
| Framework | NestJS | 11.2.5 |
| Language | TypeScript | 5.9.3 |
| Database | PostgreSQL | 16 (`postgres:16-alpine`, verified against 16.15) |
| ORM | Prisma | 7.10.0 (`@prisma/adapter-pg` driver adapter) |
| Containerization | Docker / Docker Compose | — |
| Testing | Jest 30 + Supertest 7 | — |
| Logging | `nestjs-pino` 5.2.0 / `pino-http` 11 / `pino` 10.3.1 | — |

NestJS 11 (not the current NestJS 12 default) and Jest/Supertest (not the current Vitest/oxlint
CLI default) were deliberate choices for ecosystem maturity, not oversights — see
`AI_WORKFLOW.md`'s rejected-suggestion entry.

## Architecture

```
Controller
    ↓
Service
    ↓
Repository
    ↓
PostgreSQL
```

```mermaid
flowchart TD
    Client -->|HTTP| Controller[WorkoutsController]
    Controller --> WS[WorkoutsService]
    Controller --> PRS[PersonalRecordsService]
    WS --> WR[WorkoutsRepository]
    PRS --> PRR[PersonalRecordsRepository]
    WR --> DB[(PostgreSQL)]
    PRR --> DB
    WS --> UCS[UnitConversionService]
    WR --> MGP[MuscleGroupProvider]
    MGP --> DB
    Controller -.-> GEF[GlobalExceptionFilter]
    Controller -.-> LOG[pino-http structured logging]
```

`WorkoutsController` exposes both the workout-logging/history endpoints and the PR endpoints (a
single controller, not split — see [Architecture deviations](#architecture-deviations-from-the-original-plan)).
`WorkoutsRepository` is the only place Prisma queries are built for workouts; `PersonalRecordsRepository`
is the only place the PR raw-SQL query lives. Services never construct queries directly.

Supporting components:

- **`UnitConversionService`** (`src/unit-conversion/`) — a small `Record<string, number>`
  kg-per-unit factor table (`kg: 1`, `lb: 0.45359237`), with `toKg`/`fromKg`/`isSupported`. Adding
  a unit (e.g. `stone`) is one new entry in that table — no new class, no service/controller
  change.
- **`MuscleGroupProvider`** (`src/exercise-metadata/`) — an interface + DI token
  (`MUSCLE_GROUP_PROVIDER`), implemented by `PrismaMuscleGroupProvider`, backed by a plain
  `exercise_muscle_groups` table rather than a hardcoded map. Swapping the backing store later is
  a provider-level change only.
- **`GlobalExceptionFilter`** (`src/common/filters/`) — a single `@Catch()` filter mapping every
  thrown error (DTO validation failures, domain errors like `UnsupportedUnitError`/
  `InvalidCursorError`, and anything unexpected) to one structured JSON error envelope. See
  [Validation / Errors](#validation--errors).
- **Structured logging** (`src/common/logging/`) — `nestjs-pino` replaces Nest's console logger
  everywhere; every request produces one JSON log line with a correlated request id. See
  [Logging](#logging).

## Database Design

```
WorkoutEntry 1 ──< N WorkoutSet

exercise_muscle_groups   (independent lookup table, keyed by normalized exercise name)
```

- **`WorkoutEntry`** — one exercise logged on one calendar date (`userId`, `exerciseName`,
  `exerciseNameNormalized`, `date`, timestamps).
- **`WorkoutSet`** — one set within an entry (`reps`, `weight`, `unit`, `weightKg`, `setIndex`),
  `ON DELETE CASCADE` from its parent entry.
- **`exercise_muscle_groups`** — `exerciseNameNormalized → muscleGroup`, a plain table (not a
  code constant), resolved at query time via a join/lookup, so editing the mapping changes future
  results without touching any service code.

**Why sets are relational rows, not a JSONB array on the entry:** PR calculation operates at the
individual-set level (max weight/volume/1RM of any single set) across potentially tens of
thousands of sets per user+exercise. Postgres can index and rank a plain numeric column across
rows; it cannot efficiently index "the max of an expression across elements of a JSONB array."
Sets also have a small, fixed, known shape — no schema-flexibility benefit from JSONB, only an
aggregation-cost penalty. The trade-off accepted is one extra join versus a single-document read,
which is cheap at the modeled scale of ≤10 sets/entry.

**Original weight/unit + canonical `weightKg`:** every set stores what the user actually entered
(`weight`, `unit` — never mutated) *and* a canonical `weightKg` computed once at write time. All
comparison, ranking, and PR-winner logic operates on `weightKg`; conversion to a caller's
requested display unit happens only at the response boundary, and only after all comparisons are
already decided — so the unit a value happens to be displayed in can never change which set wins
a PR.

**Constraints:**
- `UNIQUE (workout_entry_id, set_index)` (`uq_sets_entry_set_index`) — a set's position within its
  entry is stable and unique; defense in depth behind application-level `setIndex` assignment.
- `CHECK (reps >= 1)` (`chk_sets_reps_positive`), `CHECK (weight >= 0)`
  (`chk_sets_weight_non_negative`), `CHECK (weight_kg >= 0)` (`chk_sets_weight_kg_non_negative`) —
  DB-level backstops behind DTO validation, not the only line of defense.
- `weight`/`weight_kg` are `NUMERIC(10,4)` — avoids binary floating-point error in PR/volume/1RM
  comparisons, and 4 decimal places comfortably absorbs `lb → kg` conversion precision
  (`0.45359237`) without visible drift.

## Timezone Handling

The assignment recommends UTC storage; this system stores **two different kinds of temporal
data differently**, deliberately, rather than applying one blanket "everything in UTC" rule:

- **`WorkoutEntry.date`** is a plain `DATE` column (`YYYY-MM-DD`, no time-of-day, no offset) —
  **not** converted through UTC. This is a *business calendar date* the caller explicitly chose
  ("I did this workout on the 15th"), not an instant in time. Converting it through UTC would be
  actively wrong: a client-supplied datetime like `2026-09-15T23:00:00-05:00` would shift to
  `2026-09-16` under naive UTC conversion — silently changing the day the user actually logged,
  purely as a side effect of whatever offset happened to be attached to the request. To prevent
  this entirely, the API only accepts a plain `YYYY-MM-DD` string for `date` (an ISO datetime is
  rejected with a `400`, not silently truncated — see [Validation](#validation--errors)), and
  parses/formats it via explicit UTC calendar-component construction
  (`src/common/calendar-date.ts`, using `Date.UTC(...)` and `getUTC*()` accessors) so the host
  machine's own local timezone can never shift the stored day by ±1, regardless of where the API
  process happens to run.
- **`createdAt`/`updatedAt`** genuinely are instants in time (when a row was written), so they
  **are** stored as UTC (`TIMESTAMPTZ`), per the assignment's recommendation.

**Trade-off:** this means two timestamp-shaped columns in the same schema follow different
storage rules. The trade-off is accepted because treating a business date as an instant is the
more common and more subtle bug in systems like this — the small inconsistency of "one column
type follows the UTC recommendation, one doesn't" is worth avoiding a real, easy-to-trigger
date-shifting bug. Verified end-to-end (not just asserted): boundary dates
(`2026-01-01`, `2026-12-31`, a leap day) round-trip through the full HTTP → DTO → service → Prisma
→ PostgreSQL `DATE` → HTTP response path with zero shift, independent of the server's or
database's own local timezone.

## Index Strategy

| Index | Table | Columns | Design intent |
|---|---|---|---|
| `idx_entries_user_date` | `workout_entries` | `(user_id, date DESC, id DESC)` | Base history list + cursor pagination |
| `idx_entries_user_exercise_date` | `workout_entries` | `(user_id, exercise_name_normalized, date DESC, id DESC)` | Exercise-scoped history/PR-candidate lookup |
| `idx_entries_exercise_trgm` | `workout_entries` | GIN, `exercise_name_normalized gin_trgm_ops` | Substring/partial exercise-name matching |
| `idx_sets_entry` | `workout_sets` | `(workout_entry_id)` | Set lookup per entry; also the FK's supporting index |
| `uq_sets_entry_set_index` | `workout_sets` | `(workout_entry_id, set_index)` | Uniqueness constraint, also usable as an index |

**Design intent vs. measured behavior — do not assume the trigram index is always used for
substring search.** At the Step 12 measured data shape (50,000 entries for one user, `LIMIT 20`
page), PostgreSQL's planner **did not** use `idx_entries_exercise_trgm` for `findHistory`'s
partial-match queries — it preferred scanning `idx_entries_user_date` (scoped by `user_id`) and
applying the substring match as a cheap `Filter`, because the `user_id` scope combined with
`LIMIT 20` made that plan cheaper than a GIN bitmap scan. The trigram index **is** used for a
different query — the personal-records repository's *exact-match* candidate lookup, where
`gin_trgm_ops` supports the `=` operator directly. Both are real, measured planner decisions, not
assumptions — see `docs/PERFORMANCE_NOTES.md` §7 and §10 for the full `EXPLAIN (ANALYZE,
BUFFERS)` evidence. The index still exists and is exercised by real traffic; it simply isn't the
index used for every query shape someone might expect it to serve.

## API Documentation

All endpoints are under no version prefix (e.g. `http://localhost:3000/workouts`).

### `GET /health`

Liveness check.

```
curl http://localhost:3000/health
```
```json
{"status":"ok"}
```

### `POST /workouts`

Bulk-create one or more workout entries (each with one or more sets) atomically — all entries in
the request are validated and persisted, or none are.

**Body:**
```json
{
  "entries": [
    {
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-08-01",
      "sets": [
        { "reps": 5, "weight": 100, "unit": "kg" },
        { "reps": 3, "weight": 110, "unit": "kg" }
      ]
    },
    {
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-08-15",
      "sets": [
        { "reps": 5, "weight": 225, "unit": "lb" }
      ]
    }
  ]
}
```
`userId` is per-entry (not a top-level field), so a single bulk request can — if a client chooses
to — span more than one user. `entries` accepts up to `MAX_BULK_ENTRIES` (default 100).

**Response (`201`):**
```json
{
  "entries": [
    {
      "id": "102236",
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-08-01",
      "sets": [
        { "id": "403542", "setIndex": 0, "reps": 5, "weight": "100", "unit": "kg", "weightKg": "100" },
        { "id": "403543", "setIndex": 1, "reps": 3, "weight": "110", "unit": "kg", "weightKg": "110" }
      ]
    },
    {
      "id": "102237",
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-08-15",
      "sets": [
        { "id": "403544", "setIndex": 0, "reps": 5, "weight": "225", "unit": "lb", "weightKg": "102.0583" }
      ]
    }
  ]
}
```

**Validation:** `date` must be `YYYY-MM-DD` and a real calendar date (`2026-02-30` is rejected,
not silently rolled over); `exerciseName` non-empty; `sets` non-empty; each set's `reps >= 1`
(integer), `weight >= 0`, `unit` must be a currently-supported unit. Any failure anywhere in the
batch rejects the **entire** request with `400` before any DB write — no partial persistence (see
[Transactions / Concurrency](#transactions--concurrency)).

### `GET /workouts`

Paginated history for a user, with filtering and unit conversion.

**Query parameters:** `userId` (required), `exerciseName` (optional, partial/substring match),
`from`/`to` (optional, `YYYY-MM-DD`, inclusive), `muscleGroup` (optional), `unit` (optional,
default `kg`), `cursor` (optional, opaque), `limit` (optional, default from `DEFAULT_PAGE_SIZE`,
capped at `MAX_PAGE_SIZE`).

```
curl "http://localhost:3000/workouts?userId=user-1&limit=2"
```
```json
{
  "data": [
    {
      "id": "102238",
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-09-10",
      "sets": [
        { "id": "403545", "setIndex": 0, "reps": 5, "originalWeight": "105", "originalUnit": "kg", "convertedWeight": "105.00", "unit": "kg" },
        { "id": "403546", "setIndex": 1, "reps": 1, "originalWeight": "120", "originalUnit": "kg", "convertedWeight": "120.00", "unit": "kg" }
      ]
    },
    {
      "id": "102237",
      "userId": "user-1",
      "exerciseName": "Bench Press",
      "date": "2026-08-15",
      "sets": [
        { "id": "403544", "setIndex": 0, "reps": 5, "originalWeight": "225", "originalUnit": "lb", "convertedWeight": "102.06", "unit": "kg" }
      ]
    }
  ],
  "pagination": { "nextCursor": "eyJkYXRlIjoiMjAyNi0wOC0xNSIsImlkIjoiMTAyMjM3In0", "hasMore": true }
}
```

Follow `nextCursor` for the next page: `GET /workouts?userId=user-1&limit=2&cursor=eyJkYXRlIjoi...`.
`nextCursor: null` and `hasMore: false` signal the last page. An empty result is still `200`, with
`data: []` and a `message` field (not an error). `unit=lb` converts every returned weight without
mutating stored data (`originalWeight`/`originalUnit` are always the as-logged values). A
malformed `cursor` is a `400`, not a silent reset to page 1 — see
[Validation / Errors](#validation--errors).

### `GET /workouts/prs`

Personal records for a user + exercise: heaviest set, highest-volume set, best estimated 1RM.

**Query parameters:** `userId` (required), `exerciseName` (required, exact match — normalized for
case/whitespace, not partial), `unit` (optional, default `kg`).

```
curl "http://localhost:3000/workouts/prs?userId=user-1&exerciseName=Bench+Press"
```
```json
{
  "userId": "user-1",
  "exerciseName": "Bench Press",
  "unit": "kg",
  "hasData": true,
  "heaviestSet": { "weight": "120.00", "reps": 1, "date": "2026-09-10", "unit": "kg" },
  "highestVolumeSet": { "weight": "105.00", "reps": 5, "volume": "525.00", "date": "2026-09-10", "unit": "kg" },
  "best1Rm": { "estimated1Rm": "124.00", "weight": "120.00", "reps": 1, "date": "2026-09-10", "unit": "kg" }
}
```
With `unit=lb`, the same data converted (not re-ranked — the winners are already decided in kg):
```json
{
  "userId": "user-1", "exerciseName": "Bench Press", "unit": "lb", "hasData": true,
  "heaviestSet": { "weight": "264.55", "reps": 1, "date": "2026-09-10", "unit": "lb" },
  "highestVolumeSet": { "weight": "231.49", "reps": 5, "volume": "1157.43", "date": "2026-09-10", "unit": "lb" },
  "best1Rm": { "estimated1Rm": "273.37", "weight": "264.55", "reps": 1, "date": "2026-09-10", "unit": "lb" }
}
```
No data for that user+exercise: `200`, `hasData: false`, all three fields `null`, plus a
`message`.

### `GET /workouts/prs/compare`

The same three PR metrics computed independently over two caller-supplied date ranges, plus the
delta between them.

**Query parameters:** `userId`, `exerciseName` (required); `currentFrom`, `currentTo`,
`previousFrom`, `previousTo` (required, `YYYY-MM-DD`); `unit` (optional, default `kg`).

```
curl "http://localhost:3000/workouts/prs/compare?userId=user-1&exerciseName=Bench+Press&currentFrom=2026-09-01&currentTo=2026-09-30&previousFrom=2026-08-01&previousTo=2026-08-31"
```
```json
{
  "userId": "user-1", "exerciseName": "Bench Press", "unit": "kg",
  "current": {
    "from": "2026-09-01", "to": "2026-09-30", "hasData": true,
    "heaviestSet": { "weight": "120.00", "reps": 1, "date": "2026-09-10", "unit": "kg" },
    "highestVolumeSet": { "weight": "105.00", "reps": 5, "volume": "525.00", "date": "2026-09-10", "unit": "kg" },
    "best1Rm": { "estimated1Rm": "124.00", "weight": "120.00", "reps": 1, "date": "2026-09-10", "unit": "kg" }
  },
  "previous": {
    "from": "2026-08-01", "to": "2026-08-31", "hasData": true,
    "heaviestSet": { "weight": "110.00", "reps": 3, "date": "2026-08-01", "unit": "kg" },
    "highestVolumeSet": { "weight": "102.06", "reps": 5, "volume": "510.29", "date": "2026-08-15", "unit": "kg" },
    "best1Rm": { "estimated1Rm": "121.00", "weight": "110.00", "reps": 3, "date": "2026-08-01", "unit": "kg" }
  },
  "delta": {
    "heaviestSet": { "absolute": "10.00", "percentage": "9.09" },
    "highestVolumeSet": { "absolute": "14.71", "percentage": "2.88" },
    "best1Rm": { "absolute": "3.00", "percentage": "2.48" }
  }
}
```

## Workout History

- **Partial exercise search** (`exerciseName`) matches a case-insensitive substring, e.g.
  `bench` matches `"Bench Press"`. Matching is done against `exerciseNameNormalized`
  (lowercased/whitespace-collapsed at write time), so the query itself is a plain (case-sensitive)
  substring match against an already-normalized column — no `ILIKE`/`mode: 'insensitive'` needed
  at query time.
- **Date filtering** (`from`/`to`) is inclusive on both ends; `from` after `to` is a `400`, not a
  silently-empty result.
- **Muscle group filtering** (`muscleGroup`) resolves to a set of exercise names via
  `MuscleGroupProvider`, then filters history to those names. An exercise with no mapping row is
  simply excluded from muscle-group-filtered results, not an error.
- **Output unit conversion** (`unit`) converts every returned `weight` to the requested unit at
  the response boundary; stored data is never mutated by a read.
- **Keyset (cursor) pagination**, ordered by `date DESC, id DESC`. `id` (an auto-incrementing
  `BIGSERIAL`) breaks ties on `date`, since many entries can share a date — without it, keyset
  pagination could skip or repeat rows at a date boundary. The cursor is opaque to the client:
  base64url-encoded JSON `{"date":"...","id":"..."}` (see `src/workouts/cursor.ts`).

**Why not `OFFSET` pagination:** at 50k+ rows/user, `OFFSET 40000 LIMIT 20` still requires
Postgres to walk and discard the first 40,000 matching rows on every request — cost grows with
page depth. It's also unstable under concurrent inserts (a new row landing before the offset point
shifts every subsequent page). Keyset pagination avoids both: cost per page is bounded by the page
size, not the depth, for the *forward-scan* case — see
[Performance Verification](#performance-verification) for the measured exception (a benchmark-only
deep-offset lookup, not the production path).

**Pagination correctness under concurrent inserts — stated precisely, not oversold.** For a
*stable* dataset (no writes between page requests), keyset pagination guarantees no skipped and no
duplicated rows: each page's boundary is an absolute `(date, id)` value, not a relative offset. If
a new entry is inserted *while* a client is paginating: a new row that would sort **after** the
client's current cursor position (i.e., it belongs on a page already fetched) is simply never seen
— it doesn't retroactively appear or shift anything already returned. A new row that belongs
**before** the cursor (i.e., on a page not yet fetched) will correctly appear when that page is
fetched — this is new data appearing in its correct position, not a duplicate or a skip. No
snapshot isolation is used, and none is claimed: each page reflects the live table state at the
moment it's fetched. A cursor is also not scoped to the user who obtained it — reusing another
user's cursor value with a different `userId` is well-defined (the `userId` filter still applies
independently) and returns no cross-user data, but this is a byproduct of `userId` being a required
filter, not an authorization boundary (the assignment specifies no authentication).

## Personal Records

Computed in a single windowed SQL query (`PersonalRecordsRepository.findCandidates`) over three
metrics, all in canonical kg:

- **Heaviest set** — max `weightKg` of any single set.
- **Highest-volume set** — max `reps * weightKg`.
- **Estimated 1RM** — max `weightKg * (1 + reps / 30)` (Epley formula).

Tie-breaking is fully deterministic: `metric DESC, date ASC, set id ASC` — the earliest date wins
a metric tie, and if two sets share both metric and date, the lower (earlier-inserted) set id
wins. Without the `id` tiebreak, two equal-PR sets on the same date would have an undefined winner
under Postgres's `ORDER BY`.

**PR selection happens entirely in canonical kg before any display conversion.** The query ranks
sets by their kg-space metrics, and only the already-decided winning row is converted to the
requested display unit — so the unit a caller asks for can never change which set is reported as
the PR.

## PR Comparison

`current` and `previous` are two independently-computed PR results over two caller-supplied date
ranges (not required to be adjacent or equal-length), each with its own `hasData` — either range
may have data while the other doesn't. `delta` is computed from the two ranges' **canonical kg**
values (never from rounded display strings), then converted to the requested unit only for the
absolute delta; the percentage delta is unit-independent by construction.

**Missing-data / division-by-zero semantics:** if either range has no data for a metric, both
`delta.<metric>.absolute` and `.percentage` are `null` — never a stand-in zero. If the previous
value for a metric is exactly `0`, `percentage` is `null` (division by zero is undefined, never
returned as `Infinity`/`NaN`); `absolute` is still computed.

## Validation / Errors

Every error — DTO validation failure, a recognized domain error, or an unexpected exception — is
rendered through one `GlobalExceptionFilter` into the same structured envelope:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "entries.0.date", "issue": "date must be a valid calendar date in YYYY-MM-DD format" }
  ],
  "timestamp": "2026-09-16T07:49:09.879Z",
  "path": "/workouts"
}
```

- **Calendar-date validation**: `YYYY-MM-DD` shape plus a real round-trip check — `2026-02-30` is
  rejected outright, not silently rolled over to March.
- **Unsupported units**: `400` with `details: [{ "field": "unit", "issue": "Unsupported weight unit: \"oz\"" }]`.
- **Malformed cursors**: `400` with `details: [{ "field": "cursor", "issue": "Invalid pagination cursor" }]`
  — a client can't accidentally skip to a wrong page by corrupting the cursor; it fails loudly.
- **Unexpected server errors** (`500`): the client receives a generic
  `{"message": "An unexpected error occurred.", "details": []}` body with zero leaked internals;
  the full stack trace is logged server-side, correlated by request id. Verified for real by
  stopping the Postgres container mid-request and observing both sides (see `AI_WORKFLOW.md`).

## Transactions / Concurrency

- **Bulk writes are atomic.** `POST /workouts` validates the entire request via DTOs before
  opening any DB connection; if valid, entries and sets are inserted in **one PostgreSQL
  transaction** (batched multi-row `INSERT ... RETURNING`, not one round trip per row). Any
  DB-level failure rolls back the whole batch — nothing is partially persisted. Verified directly:
  an invalid batch leaves the row count unchanged, confirmed via `psql`, not just the HTTP
  response.
- **Isolation level: `READ COMMITTED`** (Postgres's default) — sufficient because this workload is
  **append-only**. No request reads a row and writes back a modified version of it; two concurrent
  bulk-insert transactions, even for the same user+exercise at the same instant, each insert their
  own new rows and do not conflict. `BIGSERIAL` sequences generate distinct ids under concurrent
  transactions safely by design.
- **Concurrent identical writes are allowed**, by design. There is no `UNIQUE (user_id,
  exercise_name, date, ...)` constraint — two requests logging what looks like "the same" workout
  are treated as legitimate independent data (e.g., a user genuinely did two bench sessions on the
  same day), not an error condition.
- **No distributed locking / idempotency was added**, because nothing in this workload needs it:
  there's no shared mutable state being read-then-written (no counters, no "increment PR" style
  logic — PRs are always derived fresh from the set rows, never stored/updated in place).
  **Idempotency keys are a plausible future requirement** (e.g., if client retry behavior under
  network flakiness starts producing real duplicate-submission complaints) — not something
  currently implemented, and not assumed necessary without that evidence.

## Logging

`nestjs-pino`/`pino-http` replace Nest's console logger everywhere (app startup, existing
`Logger` calls, and one automatic per-request completion log). Every log line is structured JSON:

```json
{"level":30,"req":{"id":"6f282a91-...","method":"GET","url":"/workouts/prs?userId=user-1..."},"res":{"statusCode":200},"responseTime":2,"msg":"request completed"}
```

- **Request id**: reuses a client-supplied `x-request-id` header when present, otherwise generates
  one via `crypto.randomUUID()`. The resolved id is echoed back as a response header and included
  in every log line for that request, so a caller can always correlate their request with
  server-side logs.
- **`x-request-id` propagation**: set on every response, regardless of status code.
- **What's logged**: `method`, `url` (path + query string), `statusCode`, `responseTime` — nothing
  else. A custom serializer intentionally strips everything pino-http would otherwise include
  (headers, remote address, etc.).
- **Sensitive payloads are never logged**: request/response bodies are not part of the serializer
  output at all — not redacted, simply never captured.
- **Unexpected server errors** are logged with their full stack trace at `error` level, correlated
  by the same request id, without ever leaking that detail to the client (see
  [Validation / Errors](#validation--errors)).

## Testing

Three independent test layers:

| Layer | What it exercises | Command |
|---|---|---|
| **Unit** | Pure logic, DTOs, validators, mocked dependencies — no DB, no HTTP | `npm test` |
| **Integration** | Repository/service code against a **real** Postgres (via Docker Compose) | `npm run test:integration` |
| **E2E** | Full HTTP stack (Supertest) against a **real** Postgres | `npm run test:e2e` |

At this checkpoint: **112 unit / 44 integration / 64 e2e tests, all passing.** (Re-run the
commands above for current numbers if this file is read after further changes — these are not
hardcoded assumptions, they're the last verified count.)

Integration and e2e tests run with Jest's `--runInBand` (serial, not parallel-worker) because they
share one real Postgres database and use unscoped cleanup (`deleteMany()` with no `where`) between
tests — running spec files concurrently against that shared, stateful resource caused a real,
reproduced cross-file race (see `AI_WORKFLOW.md` mistake #6). Note this also means the perf
dataset (`docs/PERFORMANCE_NOTES.md`) and the integration/e2e suites cannot coexist in the same
database across a test run — running the suites wipes ALL `workout_entries`/`workout_sets` rows.

## Performance Verification

Full detail, methodology, and raw evidence: **[`docs/PERFORMANCE_NOTES.md`](docs/PERFORMANCE_NOTES.md)**.

Dataset: **50,000 workout entries / 199,999 workout sets** for one target user (`perf-user`), with
a deliberate worst-case 40% single-exercise concentration, plus isolation data for a second user —
generated deterministically via `scripts/seed-scale-test.ts`, not through the HTTP API.

Representative observations (all measured locally, once, on one developer machine — see the
caveat below):

- Normal history queries (base case, partial search, combined filter, muscle-group filter): **all
  sub-3ms**, going through an appropriate B-tree index in every case.
- Deep cursor pagination (~25,000 rows into one user's history): **~2.858ms** in the recorded run
  — cost grows with cursor depth (the OR-shaped cursor predicate is applied as a filter, not a
  direct index seek), but stays fast at this scale.
- Worst-case all-time PR query (one exercise with 20,000 entries / ~80,000 candidate sets):
  **~156ms**, dominated by three disk-spilling sorts (one per PR metric) over the candidate set —
  this is the direct evidence that PR-query cost scales with candidate-set size, exactly as
  `docs/ARCHITECTURE.md` §5.2 predicted, not O(1).
- The `pg_trgm` GIN index was **not** selected by the planner for the measured limited
  substring-history query (`LIMIT 20`, user-scoped) — it's used elsewhere (the PR query's
  exact-match lookup), a genuine, checked planner decision, not an assumption either way.

**These are local query-performance observations, not throughput/SLA claims.** No load test was
run, there is no concurrent-request measurement, and no number here should be read as "supports N
req/sec." No schema/index/query change was made as a result of this verification — every finding
either confirmed the existing design or was a sub-3ms characteristic not worth changing.

## Setup

**Prerequisites:** Docker + Docker Compose (recommended path), or Node.js >= 22.12 and a local
PostgreSQL 16 if running outside Docker.

### Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
```

This builds the API image, starts Postgres, waits for its healthcheck, then starts the API.
Prisma migrations are applied automatically. Verify:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Note the host↔container port mapping: Postgres is reachable from the **host** at
`localhost:5433` (not the default `5432`) — this avoids colliding with a pre-existing local
Postgres install; the API container talks to Postgres on the normal `5432` internally, since
Docker Compose's internal network is unaffected by the host remap.

**Optional: seed demo muscle-group data.** `exercise_muscle_groups` starts empty after a fresh
`docker compose up` — the API works fully without it (muscle-group filtering just matches nothing
until the table has rows; this is graceful, not an error). To populate it with a small demo set
(bench press → chest, squat → legs, etc.), run the seed script from the **host** (it connects to
the same Postgres via the host-exposed `localhost:5433` port from `.env`; the seed script needs
`ts-node`, a dev dependency not present in the production container, so it isn't run from inside
the `api` container):
```bash
npm install
npm run prisma:seed
```

### Local (non-Docker) setup

```bash
npm install                  # runs `prisma generate` via postinstall
cp .env.example .env         # adjust DATABASE_URL to point at your local Postgres
npm run prisma:migrate       # apply migrations (dev)
npm run prisma:seed          # seed exercise_muscle_groups with a small demo set
npm run start:dev            # http://localhost:3000
```

### Tests

```bash
npm test                     # unit
npm run test:integration     # integration (needs Postgres running — e.g. `docker compose up -d postgres`)
npm run test:e2e             # e2e (same requirement)
```

### Lint / build / format

```bash
npm run lint
npm run build
npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | pino log level |
| `DATABASE_URL` | — (required) | Postgres connection string, e.g. `postgresql://workout:workout@localhost:5433/workout_api?schema=public` |
| `DEFAULT_PAGE_SIZE` | `20` | `GET /workouts` page size when `limit` is omitted |
| `MAX_PAGE_SIZE` | `100` | Ceiling on `limit` |
| `MAX_BULK_ENTRIES` | `100` | Ceiling on `POST /workouts`'s `entries` array length |

No secrets beyond the dev-only `DATABASE_URL` credentials in `.env.example` (a local Docker
Compose Postgres user/password, not a real credential).

## Test Commands

```bash
npm test                                                    # unit
npm run test:integration                                    # integration, real Postgres, --runInBand
npm run test:e2e                                             # e2e, real Postgres, --runInBand
npm run lint                                                  # eslint
npm run build                                                 # nest build
npx prettier --check "src/**/*.ts" "test/**/*.ts"             # format check
```

## Performance Commands

```bash
npm run perf:seed      # generate the 50k-entry dataset (idempotent-guarded; ~11s)
npm run perf:explain   # run ANALYZE + EXPLAIN (ANALYZE, BUFFERS) for every benchmark scenario
npm run perf:clean     # remove the perf dataset (scoped to perf-user / perf-user-2 only)
```

These are separate from `npm test` and do not run in CI or as part of the normal test suite.

## Known Dependency Advisories

`npm audit` reports transitive advisories in two dependency chains, neither reachable by this
application's own code:

- **`multer`** (via `@nestjs/platform-express` on the NestJS 11.x line) — several DoS-class
  advisories, fixed only by upgrading to NestJS 12. This app has no file-upload endpoints and never
  wires up `multer`'s interceptors.
- **`mysql2`/`deepmerge-ts`** (via `prisma`'s own `@prisma/config` dependency) — MySQL-protocol
  advisories. This app exclusively uses `@prisma/adapter-pg`; it never connects to MySQL.

`prisma` (the CLI) is intentionally a `dependencies` entry, not `devDependencies` — the Docker
runtime image's `npm ci --omit=dev` still needs the `prisma` binary present so `prisma migrate
deploy` can run automatically on container startup (see [Setup](#setup)). `npm audit fix --force`
was deliberately not run: it would downgrade to `prisma@6.19.3`, a breaking change to the
driver-adapter/`prisma-client` generator architecture this project is built on, to fix an advisory
in code paths this app never executes.

## Assumptions / Trade-offs

- **Free-text exercise names** — no fixed enum of exercises; matching relies on
  `exerciseNameNormalized` (trim + lowercase + whitespace-collapse), not exact-string uniqueness.
- **Configurable muscle-group mapping** — a plain table + provider interface, not a hardcoded map
  in business logic.
- **Canonical kg** — every stored/compared weight normalizes through kg; display conversion is a
  pure read-boundary concern.
- **Relational sets, not JSONB** — chosen for PR-query indexability at scale (see
  [Database Design](#database-design)).
- **Prisma for normal CRUD/history, raw SQL for PR ranking** — Prisma's query builder covers
  entry/set creation and the history/filter/pagination query cleanly; the PR query needs
  `ROW_NUMBER() OVER (...)`, which Prisma's query builder doesn't express, so it's one hand-written
  parametrized `$queryRaw` query, isolated to `PersonalRecordsRepository`.
- **Cursor (keyset) pagination**, not `OFFSET` — see [Workout History](#workout-history).
- **No caching / no precomputed PRs (yet)** — the on-the-fly PR query is fast enough at the
  measured 50k-entry scale (see [Performance Verification](#performance-verification)); caching or
  a precomputed PR read-model is documented as a future-scale item, not built speculatively.

## Scaling to 10,000 Concurrent Coaches

**Current design is a single-instance take-home build**, sized and verified for one user's
50,000+ entries, not for concurrent load. Nothing below is claimed as required for the current
assignment — it's what would change, and why, if the actual measured workload demanded it.

- **Horizontal API scaling** — the API is already stateless (no in-process session/cache state),
  so running multiple instances behind a **load balancer** is mostly an orchestration change, not
  an application code change.
- **Managed PostgreSQL / connection pooling** — a connection pooler (e.g. PgBouncer, or a managed
  Postgres offering's built-in pooling) in front of Postgres, sized for the real concurrent
  connection count rather than assumed.
- **Read replicas** — only where measurement shows read load (history/PR queries) actually
  contends with write throughput on the primary; not added speculatively.
- **Caching** — only for reads a profiler actually shows are hot (e.g. PR lookups for very active
  users), invalidated on write for that `(userId, exerciseName)`. Premature caching risks
  staleness bugs for a feature where correctness (which set actually is the PR) matters more than
  shaving milliseconds.
- **Asynchronous processing** — a queue in front of writes only if write throughput genuinely
  exceeds single-primary capacity under real measured load; nothing in this assignment's scale
  indicates that today.
- **Observability** — metrics, tracing, and centralized log aggregation/alerting on top of the
  structured logging that already exists — an ops-layer addition, not an application rewrite.
- **Rate limiting / backpressure** — at the API layer, to protect the database from being
  overwhelmed by a traffic spike, sized against real traffic patterns.
- **Precomputed PR read-models** — only if profiling under real concurrent load shows the
  on-the-fly `ROW_NUMBER()` ranking query (§5 of `docs/ARCHITECTURE.md`) becoming an actual hot
  path, e.g. an updated-on-write summary row. Step 12's evidence (worst-case ~156ms for one
  exercise with 20,000 entries) doesn't currently justify this — it's a documented option, not a
  plan.

**The guiding principle throughout this project**: infrastructure changes should be driven by
measured workload and SLOs, not added speculatively "because scale" — the same evidence-first
standard applied to every index and query decision in this codebase (see
`docs/PERFORMANCE_NOTES.md`) applies here too.

## Architecture Deviations (from the original plan)

`docs/ARCHITECTURE.md` was written before implementation, and a few details changed during real
implementation — documented, not hidden, per this project's evidence-over-planning-documents
policy:

1. **Unit conversion**: the original plan described a `UnitConverter` interface with one class per
   unit (`IdentityConverter`, `PoundConverter`, ...). The actual, approved implementation is a
   flat `Record<string, number>` kg-per-unit factor table in `UnitConversionService` — simpler,
   and equally extensible (adding a unit is one table entry, not one new class).
2. **`POST /workouts` response shape** wasn't specified in the original architecture doc; see
   [API Documentation](#api-documentation) above for the actual shape.
3. **`GET /workouts` history** uses Prisma's query builder (`contains` for substring matching, an
   `OR`-based keyset predicate), not the raw SQL the original plan sketched — Prisma's builder
   turned out sufficient without a concrete benefit from raw SQL for this query shape.
4. **`GET /workouts/prs` PR ranking** does use raw SQL (`$queryRaw` with `ROW_NUMBER() OVER (...)`),
   matching the original plan — Prisma's query builder has no window-function equivalent.
5. **Node runtime** requirement is `>=22.12` (not `>=20` as in earlier drafts) — a real,
   externally-imposed requirement from `nestjs-pino` v5, discovered by reading the library's
   actual compatibility table before installing it, not a design choice revisited.

Full chronology of these decisions, including what was tried and corrected along the way, is in
`AI_WORKFLOW.md`.

## Time Estimate

**12 hours** — communicated to Everfit before implementation began, per the assignment's
deliverable #5 ("provide your time estimate before starting").

## Further Reading

- **`docs/ARCHITECTURE.md`** — the design rationale (Postgres vs. Mongo, Prisma vs. TypeORM,
  index/query strategy, transaction strategy), now synchronized with the implemented system.
- **`docs/PERFORMANCE_NOTES.md`** — full Step 12 performance evidence.
- **`AI_WORKFLOW.md`** — how AI was used throughout this project: real interaction log, real
  mistakes found and corrected, one real rejected AI suggestion.
- **`docs/CLARIFICATIONS.md`**, **`docs/IMPLEMENTATION_PLAN.md`** — original planning documents
  (historical; see the note at the top of each).
