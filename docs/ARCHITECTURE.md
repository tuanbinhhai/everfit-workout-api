# Architecture — Workout Logging API

Builds on `docs/REQUIREMENT_ANALYSIS.md` and `docs/CLARIFICATIONS.md` (assumptions #1–#20, as
revised). This document is the Phase 3 deliverable: stack justification, data model, indexing
strategy, query patterns, concurrency/transaction strategy, and the necessary-now vs.
future-at-scale split. No production code is written yet.

---

## 1. Stack decision

| Layer | Choice | Alternative considered |
|---|---|---|
| Runtime/framework | **NestJS** (TypeScript) | Express/Fastify raw — rejected: NestJS's module/DI system directly satisfies the assignment's "separation of concerns, dependency injection, extensibility" evaluation criteria with far less hand-rolled boilerplate (guards, pipes, global exception filters, `class-validator` DTO integration all come built in). |
| Database | **PostgreSQL** | MongoDB — see §2 |
| ORM / query layer | **Prisma** | TypeORM — see §3 |
| Validation | `class-validator` + `class-transformer` (NestJS `ValidationPipe`) | Zod — either is fine; Prisma + `class-validator` is the more common NestJS pairing and keeps DTOs declarative |
| Logging | `nestjs-pino` (structured JSON logs, request-scoped) | Winston — pino chosen for lower overhead and NestJS-native request context |
| Containerization | Docker Compose (API + Postgres) | — |
| Testing | Jest (unit) + Supertest via Nest's e2e testing module (integration) | — |

---

## 2. PostgreSQL vs MongoDB — decision for this assignment

The assignment permits either; the decision has to be justified against **this** domain, not
generic database theory.

**What the workload actually looks like:**
- A `WorkoutEntry` has a small, fixed-shape collection of `WorkoutSet`s (typically 1–10). This is
  a textbook one-to-many relationship with a bounded child count — not a case for unbounded
  nested arrays or document growth.
- The two read-heavy operations are **filtered/paginated history** and **PR aggregation**
  (`MAX`, per-set arithmetic, ranking by computed 1RM/volume, grouped by date range). These are
  exactly the query shapes relational engines with mature planners, composite B-tree indexes, and
  window functions are built for.
- Muscle-group filtering is an explicit **join against a small, independently-updated mapping
  table** (§7) — a relational join is the natural fit; in Mongo this would mean either an
  application-side lookup per page of results or a denormalized copy that fights the
  "configurable mapping, resolved consistently" requirement (Clarifications §14).
- Bulk logging needs **all-or-nothing multi-row transactional writes** across two related
  collections/tables (entries + sets). Postgres gives this natively via standard ACID
  transactions. MongoDB multi-document transactions exist but are heavier operationally (require
  a replica set even in dev) for a feature that maps directly onto what a relational transaction
  already does well.
- Partial exercise-name search needs efficient substring matching at 50k+ rows/user — Postgres's
  `pg_trgm` extension gives this a proper index (§6); MongoDB's text index is optimized for
  tokenized/word search, not arbitrary substrings, and would likely fall back to a collection
  scan for the same query shape.

**Where MongoDB would have won:** if `sets` were unbounded/highly variable in shape per exercise
(e.g., arbitrary custom metrics per set), or if the dominant access pattern were "fetch one
whole workout document by id" with no cross-entry aggregation — neither describes this
assignment's PR/history-aggregation-heavy workload.

**Conclusion:** PostgreSQL, with a normalized relational schema (§4).

---

## 3. ORM: Prisma vs TypeORM

| | Prisma | TypeORM |
|---|---|---|
| Migrations | Schema-first, generated SQL migrations, strong diffing | Also supports migrations, more manual |
| Type safety | Generated client is fully typed from schema | Decorator-based entities, typed but more boilerplate |
| Raw SQL for complex queries | `$queryRaw` / `$queryRawUnsafe` with typed results | `.query()` / `QueryBuilder` |
| NestJS integration | Community pattern (`PrismaService` as a provider) is simple and well-documented | First-party `@nestjs/typeorm` module, Repository pattern baked in |

This project needs **hand-written SQL for the non-trivial parts** — keyset pagination (§8),
multi-metric PR ranking with window functions (§5.3), and trigram search (§6). Both ORMs support
raw SQL escape hatches; Prisma's is chosen because its generated client covers all the simple
CRUD paths (entry/set creation, basic lookups) with strong typing and low boilerplate, while its
`$queryRaw` (tagged-template, parameterized — safe from SQL injection by construction) handles
the aggregation-heavy queries cleanly. TypeORM's Repository/QueryBuilder is also a defensible
choice here (in fact somewhat closer to the assignment's "Repository/data-access layer" module
language) but was not picked to avoid mixing two different query-building idioms in one
service — one clear escape hatch (Prisma raw SQL) is simpler to review than combining
QueryBuilder and manual `.query()`.

---

## 4. Data model

### 4.1 WorkoutEntry vs WorkoutSet — relational split

A workout entry (one exercise logged on one date) has many sets. Sets are **not** stored as a
JSONB blob on the entry — they are separate rows.

**Why not JSONB sets:**
- PR calculation operates **at the individual-set level** (max weight of any single set, max
  volume of any single set) across potentially thousands of entries per user/exercise. Doing
  this with JSONB would mean either `jsonb_array_elements()` unnesting on every PR query (no
  index support for ranking inside the array) or maintaining a shadow relational table anyway —
  at which point JSONB adds no value.
  Postgres cannot index "the max of an expression across elements of a JSONB array" the way it
  can index a plain numeric column, so JSONB would directly work against the assignment's own
  50k-entries/user performance requirement.
- Sets have a **fixed, known shape** (`reps`, `weight`, `unit`, derived `weightKg`) — there's no
  schema-flexibility benefit to JSONB here, only an aggregation-cost penalty.
- Relational rows let a **composite index carry the query** for both history filtering and PR
  ranking (§5, §7), which a JSONB array cannot participate in the same way.

**Trade-off accepted:** an extra table + join versus a single-document read. At the modeled
scale (≤10 sets per entry) this join is cheap and is exactly what a `workout_entry_id` foreign
key + index is for (§7).

### 4.2 Schema (PostgreSQL DDL, conceptual — final column names may be adjusted 1:1 in Prisma schema)

```sql
CREATE TABLE workout_entries (
    id                      BIGSERIAL PRIMARY KEY,
    user_id                 TEXT NOT NULL,
    exercise_name           TEXT NOT NULL,               -- as typed by the client, trimmed
    exercise_name_normalized TEXT NOT NULL,               -- lower(trim(exercise_name)), used for search + muscle-group join
    date                    DATE NOT NULL,                -- business calendar date; see Clarifications #2/#3 — NOT converted through UTC
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workout_sets (
    id                BIGSERIAL PRIMARY KEY,
    workout_entry_id  BIGINT NOT NULL REFERENCES workout_entries(id) ON DELETE CASCADE,
    set_index         SMALLINT NOT NULL,                  -- 0-based position within the entry, for stable display order
    reps              INTEGER NOT NULL CHECK (reps >= 1),
    weight            NUMERIC(10,4) NOT NULL CHECK (weight >= 0),  -- original value, as entered
    unit              TEXT NOT NULL,                       -- 'kg' | 'lb' | future units
    weight_kg         NUMERIC(10,4) NOT NULL CHECK (weight_kg >= 0), -- normalized, full precision (Clarifications #11)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workout_entry_id, set_index)                   -- set_index is the stable position of a set within its entry;
                                                             -- DTO validation should already guarantee this, DB enforces it as defense in depth
);

-- Configurable exercise -> muscle group mapping (see §7). Independent of workout data.
CREATE TABLE exercise_muscle_groups (
    exercise_name_normalized TEXT PRIMARY KEY,
    muscle_group              TEXT NOT NULL
);
```

`weight` and `weight_kg` both use `NUMERIC(10,4)`:
- `NUMERIC` (not `FLOAT`/`DOUBLE PRECISION`) avoids binary floating-point representation error —
  important because PR/volume/1RM comparisons must be exact enough not to flip a ranking due to
  rounding noise.
- Scale of 4 decimal places comfortably absorbs the repeating-decimal remainder from `lb → kg`
  conversion (`0.45359237` truncated/rounded to 4dp is already sub-gram precision) without
  accumulating visible drift across chained calculations (Clarifications #11).
- Precision of 10 (i.e., up to 999999.9999) is far beyond any realistic single-set weight,
  leaving headroom with no realistic overflow risk.

`reps` is `INTEGER` with a `CHECK (reps >= 1)` — zero/negative reps rejected at the DB level as a
defense-in-depth backstop behind the DTO validation layer (Clarifications #19). `weight >= 0`
allows legitimate 0kg bodyweight entries while rejecting negative values.

### 4.3 Why `userId` and `exerciseName` live on `workout_entries`, not `workout_sets`

PR and history queries filter by `(user_id, exercise_name, date range)` — all entry-level
attributes. Duplicating them onto every set row would bloat storage (up to 10x per entry) for no
query benefit, since every access path joins entry → sets, never queries sets in isolation.

---

## 5. PR query efficiency

### 5.1 What "efficient" means here

A PR query for one `(userId, exerciseName)` pair must find, across that user's full history:
- the set with max `weight_kg`
- the set with max `(reps * weight_kg)` (volume)
- the set with max `(weight_kg * (1 + reps / 30.0))` (Epley 1RM)
— each with its achievement date — **without scanning the user's entire 50k-entry history**,
and without scanning other users' or other exercises' data.

### 5.2 Why this is bounded, even though it is not free, at 50k entries/user

50,000 entries/user is the **total across all exercises**. The composite index
`(user_id, exercise_name_normalized, date, id)` (§7) guarantees the query never scans other
users' data or other exercises' entries for this user — it is not a full-table or full-user scan.
It does **not** guarantee the matched subset is small: the assignment does not specify a
distribution of entries across exercises, so a user could plausibly concentrate a large share of
their 50,000 entries on a single exercise. The honest cost model is: the index makes the query
**O(number of sets for that specific user + exercise + date range)**, not O(1) and not O(total
user entries) — it prevents scanning *unrelated* data, it does not cap the size of the *related*
data.

At the assignment's stated scale (50,000 entries/user, ≤10 sets/entry), even a worst case where
one exercise absorbs most of a user's history stays in the tens-of-thousands-of-rows range for a
single index-scoped scan plus an in-memory `ROW_NUMBER()` sort — acceptable for the initial
target, but a claim to be **verified with `EXPLAIN ANALYZE`** against seeded worst-case data
during the Phase 9 performance review, not assumed correct here. If profiling identifies this as
an actual hot path (e.g., a user with tens of thousands of entries on one exercise and frequent
PR reads), a precomputed/materialized PR read-model (§5.4) is the documented future optimization —
not built now, since it's unjustified without a measured bottleneck.

This scoping is still the key reason JSONB (§4.1) would have been the wrong call: JSONB would
force scanning every entry's array on every PR query with no index support at all, whereas the
relational + composite-index design at least bounds the scan to the relevant subset even in the
worst case above.

### 5.3 Query shape

Computed in a single round trip using window functions, rather than three separate queries or a
naive `GROUP BY` + application-side max-finding:

```sql
WITH scoped_sets AS (
    SELECT
        s.id, s.reps, s.weight_kg, e.date,
        s.weight_kg                                    AS max_weight_metric,
        (s.reps * s.weight_kg)                          AS volume_metric,
        (s.weight_kg * (1 + s.reps / 30.0))             AS epley_1rm_metric
    FROM workout_sets s
    JOIN workout_entries e ON e.id = s.workout_entry_id
    WHERE e.user_id = $1
      AND e.exercise_name_normalized = $2
      AND e.date BETWEEN $3 AND $4        -- range is the whole history for the plain PR endpoint,
                                            -- or one comparison bucket for the compare endpoint
)
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (ORDER BY max_weight_metric DESC, date ASC, id ASC) AS rn_weight,
              ROW_NUMBER() OVER (ORDER BY volume_metric DESC, date ASC, id ASC)     AS rn_volume,
              ROW_NUMBER() OVER (ORDER BY epley_1rm_metric DESC, date ASC, id ASC)  AS rn_1rm
    FROM scoped_sets
) ranked
WHERE rn_weight = 1 OR rn_volume = 1 OR rn_1rm = 1;
```

`ORDER BY metric DESC, date ASC, id ASC` makes tie-breaking **fully** deterministic: earliest
date wins a tie on the metric, and if two sets share both the same metric value *and* the same
date, the lower `id` (the earlier-inserted set) wins. Without the `id` tiebreak, two equal-PR sets
logged on the same date would have an undefined winner (Postgres does not guarantee a stable
order among rows with the same `ORDER BY` key), which would make test assertions and the reported
"achievement date/set" flaky. The query returns at most 3 rows (or 1 if the same set happens to
hold multiple PRs), from which the service picks the row per `rn_* = 1`.

**Comparison endpoint** (`current` vs `previous` range) runs this same parametrized query twice —
once per range — rather than one combined query with a `CASE WHEN` range bucket. Ranges are
caller-supplied and not necessarily adjacent or equal-length (Clarifications #8), so two simple,
independently-cacheable queries are easier to reason about and test than one query encoding
range-bucketing logic. The extra round trip is negligible against the already-small scoped row
count from §5.2.

**No PR data:** if `scoped_sets` is empty, the query returns zero rows — the service maps this
to the `hasData: false` empty-result shape (Clarifications #17), not an error.

### 5.4 Deferred: precomputed/materialized PRs

Not implemented now — the composite-index-scoped query above is fast enough at the assignment's
stated 50k-entries/user scale. Precomputing/caching PRs is listed as a future-scale item (§10).

---

## 6. Case-insensitive partial exercise search

Requirement: partial match, case-insensitive (Clarifications #13), performant at 50k+ rows/user.

A plain `WHERE exercise_name ILIKE '%bench%'` cannot use a standard B-tree index (leading
wildcard defeats prefix matching), forcing a sequential scan. Instead:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_entries_exercise_trgm
    ON workout_entries USING gin (exercise_name_normalized gin_trgm_ops);
```

Filter query then does `WHERE exercise_name_normalized ILIKE '%' || $term || '%'`, matched
against the already-lowercased `exercise_name_normalized` column (normalization done once at
write time, not per query) — the trigram GIN index supports this substring pattern directly, and
Postgres's planner will pick it once the table has enough rows to make a scan more expensive than
the index (verified during the Phase 9 performance review with `EXPLAIN ANALYZE` once real data
is seeded — noted here as a claim to verify, not assumed).

---

## 7. PostgreSQL index strategy (by actual query pattern)

| Query pattern | Index | Notes |
|---|---|---|
| History list for a user, default order, paginated | `idx_entries_user_date ON workout_entries (user_id, date DESC, id DESC)` | Also the base index cursor pagination keys off (§8) |
| History filtered by exercise (+ optionally date range) | `idx_entries_user_exercise_date ON workout_entries (user_id, exercise_name_normalized, date DESC, id DESC)` | Same index serves PR queries' scoping join (§5.2) |
| Partial exercise-name search | `idx_entries_exercise_trgm` (GIN, trigram) — §6 | Only needed when `exerciseName` filter is a substring, not exact |
| Muscle-group filter | Join to `exercise_muscle_groups` on its `PRIMARY KEY (exercise_name_normalized)` | Mapping table is small (hundreds of rows) — no extra index needed beyond its PK; the join is driven by whichever entry index the other filters already selected |
| Set lookup for an entry (history response assembly, PR join) | `idx_sets_entry ON workout_sets (workout_entry_id)` | Also serves as the FK's supporting index (Postgres does not auto-create one) |
| PR ranking within scoped sets | No separate index — ranking happens over the row set returned by `idx_entries_user_exercise_date` (§5.2), which is bounded to the user+exercise but not guaranteed small | Adding expression indexes on `(reps*weight_kg)` etc. is a **future** optimization if profiling (`EXPLAIN ANALYZE`, §5.2) identifies a specific exercise as disproportionately hot (§10) |

**Write-cost trade-off:** five indexes on `workout_entries`/`workout_sets` combined (two B-tree
composites, one GIN trigram, plus PKs/FK-support index) means five index updates per insert
instead of one. This is accepted because the workload is read-heavy for history/PR lookups
relative to per-set write frequency, and because bulk writes are batched (§9), amortizing index
maintenance cost across a single transaction rather than per-row round trips.

---

## 8. Cursor pagination — stable `(date, id)` ordering

**Why not `OFFSET N`:** at 50k+ rows/user, `OFFSET 40000 LIMIT 20` still requires Postgres to walk
and discard the first 40,000 matching rows on every request — cost grows linearly with page
depth. It's also unstable under concurrent inserts (a new row landing before the offset point
shifts every subsequent page by one, causing skipped or duplicated rows for a client paging
through).

**Keyset (cursor) pagination**, ordered consistently by `(date DESC, id DESC)` in both cases, but
backed by **two different indexes depending on which filters are active** — not the same index:

- **Base history** (no exercise filter, or only a date-range filter): backed by
  `idx_entries_user_date ON workout_entries (user_id, date DESC, id DESC)` (§7).
- **Exercise-filtered history** (`exerciseName` filter present, exact or partial): backed by
  `idx_entries_user_exercise_date ON workout_entries (user_id, exercise_name_normalized, date DESC, id DESC)` (§7)
  — this is a **different, more specific composite index**; it is a coincidence of shared design
  intent that both end in `(date DESC, id DESC)`, not the same physical index being reused.

```sql
-- first page, base history (uses idx_entries_user_date)
SELECT * FROM workout_entries
WHERE user_id = $1
ORDER BY date DESC, id DESC
LIMIT $2;

-- first page, exercise-filtered history (uses idx_entries_user_exercise_date)
SELECT * FROM workout_entries
WHERE user_id = $1
  AND exercise_name_normalized = $exerciseFilter
ORDER BY date DESC, id DESC
LIMIT $2;

-- subsequent page (either case), cursor = (lastDate, lastId) from the previous page's final row
SELECT * FROM workout_entries
WHERE user_id = $1
  [AND exercise_name_normalized = $exerciseFilter]   -- only when an exercise filter is active
  AND (date, id) < ($lastDate, $lastId)   -- row-wise comparison: strictly "before" the cursor in (date DESC, id DESC) order
ORDER BY date DESC, id DESC
LIMIT $2;
```

`id` (an auto-incrementing `BIGSERIAL`) is the tie-breaker because `date` alone is not unique —
many entries can share a date. Without a deterministic tie-breaker, keyset pagination can skip or
repeat rows that share the boundary date. The cursor is opaque to the client: base64-encoded
JSON `{"date":"2026-09-10","id":48213}`, returned as `nextCursor` and echoed back on the next
request; `nextCursor: null` signals the last page. Note that a **partial-match** exercise filter
(`ILIKE '%term%'`, §6) does not benefit from either B-tree index's `exercise_name_normalized`
column ordering and instead relies on the trigram GIN index — in that case the `(date, id)`
keyset comparison still applies for ordering/pagination, but the initial row selection is driven
by the trigram index rather than `idx_entries_user_exercise_date`.

---

## 9. Transaction strategy for bulk writes

Per Clarifications #5, bulk logging is **all-or-nothing**. Implementation:

1. **Validate all entries in the request before opening a transaction.** DTO validation
   (`class-validator`) runs over the full `entries[]` array first; if any entry fails, return 400
   immediately with per-index error details — no DB round trip is spent on a request that's
   already known to fail.
2. **Open a single Postgres transaction** (default `READ COMMITTED` isolation — sufficient here;
   see below for why a stricter level isn't needed).
3. **Batch-insert entries** with a single multi-row `INSERT ... VALUES (...), (...), ... RETURNING id`
   rather than one `INSERT` per entry, to bound round trips regardless of batch size (capped at
   100 entries/request per Clarifications #16).
4. Using the returned ids, **batch-insert all sets** for all entries with one multi-row `INSERT`.
5. **Commit.** Any constraint violation (e.g., a `CHECK` failing despite DTO validation, as a
   defense-in-depth backstop) rolls back the entire transaction — nothing is partially persisted.

**Why `READ COMMITTED` is sufficient, not `SERIALIZABLE`:** this workload is pure **append** —
no request reads a row and then writes back a modified version of it (no shared counters, no
"increment PR count" style read-modify-write). Two concurrent bulk-insert transactions for the
same user, even for the same exercise at the same instant, do not conflict with each other at the
row level; each inserts its own new rows. Postgres's `BIGSERIAL` sequence generates distinct ids
under concurrent transactions safely by design (this is what sequences are for), including the
case where one of the concurrent transactions later rolls back — no special locking is needed for
correctness here. `SERIALIZABLE` would only be justified if a future feature introduced
read-then-write logic over shared state (e.g., a server-maintained PR summary row updated
in place) — noted as a design constraint to revisit if that's ever added (see §5.4).

**No unique constraint / dedup at the DB level:** per Clarifications #4, duplicate-looking
concurrent submissions are treated as legitimate independent data, not an error condition — so no
`UNIQUE (user_id, exercise_name, date, ...)` constraint is added that would reject them.

---

## 10. Necessary now (50k entries/user) vs. future scaling

The assignment's stated scale target is 50,000+ entries **per user**. Everything in §4–§9 is
sized for that target and is being built now. The video walkthrough's "10,000 concurrent coaches"
question is a different axis (overall system throughput/concurrency, not one user's data volume)
— addressed here as explicitly **future**, not built now, to avoid over-engineering the
take-home beyond what it asks for.

**Necessary now:**
- Composite B-tree indexes scoped to `(user_id, ...)` (§7) — keeps every query bounded to one
  user's slice regardless of total table size.
- Keyset pagination (§8) — flat cost per page regardless of depth.
- Trigram index for substring search (§6).
- Batched multi-row inserts for bulk writes (§9).
- Connection pooling (Prisma's built-in pool / `pgbouncer` in front of Postgres if the container
  count grows) — sized via config, not hardcoded.
- `EXPLAIN ANALYZE` verification of the above once real data is seeded (Phase 9 performance
  review, after implementation — not claimed as done here).

**Future, at much larger scale (e.g., 10,000 concurrent coaches, documented but not built):**
- **Read replicas** for history/PR reads, keeping the primary focused on writes.
- **Precomputed/materialized PR rows**, updated incrementally on write (trigger or async job),
  only if profiling shows the on-the-fly ranking query (§5) becoming a hot path under heavy
  concurrent read load — not assumed necessary up front.
- **Caching** (e.g., Redis) for PR results, invalidated on new writes for that
  `(userId, exerciseName)` — only justified once cache-hit economics are measured; premature
  caching risks staleness bugs for a feature (PRs) where correctness matters more than latency.
- **Table partitioning** (e.g., by date range) if total row count across all users grows into the
  range where vacuum/index maintenance becomes a bottleneck — not a concern at 50k/user with a
  modest user base.
- **Horizontal API scaling**: NestJS instances are stateless behind a load balancer — no
  in-process state to worry about, so this is mostly an ops/Docker Compose → orchestrator
  concern, not an application code change.
- **Idempotency keys** (Clarifications #4) if client retry behavior under load starts producing
  real duplicate-submission complaints.
- **Async/event-driven ingestion** (queue in front of writes) only if write throughput genuinely
  exceeds single-primary capacity — not indicated by anything in this assignment's stated scale.
- **Observability**: slow-query logging, APM, structured log aggregation — logging is structured
  now (pino), but centralized aggregation/alerting is an ops concern beyond this repo's scope.

---

## 11. Configurable exercise → muscle group mapping

Satisfies "should be configurable (not hardcoded in business logic)" directly, not just in spirit:

- `exercise_muscle_groups` is a **plain table** (§4.2), not a constant/enum in code. Seeded via a
  migration seed script with common exercises, editable via direct DB update (or a future
  admin endpoint — out of scope now) without touching any service code.
- Access is behind an interface, e.g. `MuscleGroupProvider.getMuscleGroup(exerciseNameNormalized): Promise<string | null>`,
  implemented by a Prisma-backed repository. Services depend on the interface via NestJS DI, not
  the concrete table — so swapping the backing store (e.g., to a config file or external service)
  later is a provider-level change only.
- Resolution happens **at query time** by joining on the normalized exercise name
  (Clarifications #14) — editing the mapping changes future query results consistently; no
  denormalized copy is stored per entry to go stale.
- Exercises with no mapping row are simply excluded from muscle-group-filtered results (not an
  error) — documented as a known limitation in the README rather than silently guessed at.

---

## 12. Unit conversion abstraction

Satisfies "adding a new unit type (e.g. stone) should require minimal code changes":

- A `UnitConverter` interface: `toKg(value: number): number` / `fromKg(kg: number): number`.
- A small registry/map keyed by unit string (`'kg' → IdentityConverter`, `'lb' → PoundConverter`),
  injected as a single `UnitConversionService` used by both the write path (computing
  `weight_kg` at creation) and the read path (converting stored `weight_kg` to the caller's
  requested display unit).
- Adding `stone` means: one new class implementing `UnitConverter`, one registry entry, one
  addition to the DTO's allowed-unit enum/validator. No service, controller, or query code
  changes — the registry is the single seam.
- Unsupported units are rejected by the DTO validator before reaching the service layer
  (structured 400, per Clarifications #18).

---

## 13. Module breakdown

```
AppModule
├── ConfigModule (global, env-driven: DB URL, port, pagination defaults, log level)
├── PrismaModule (PrismaService — single connection-pooled client, injected everywhere)
├── UnitConversionModule
│   └── UnitConversionService (registry of UnitConverter implementations — §12)
├── ExerciseMetadataModule
│   └── MuscleGroupProvider (interface) + PrismaMuscleGroupProvider (implementation — §11)
├── WorkoutModule
│   ├── WorkoutsController        (POST /workouts, GET /workouts)
│   ├── PersonalRecordsController (GET /workouts/prs, GET /workouts/prs/compare)
│   ├── WorkoutsService           (validation orchestration, delegates conversion + persistence)
│   ├── PersonalRecordsService    (PR query orchestration, delegates to repository — §5)
│   └── WorkoutsRepository        (Prisma client calls + raw SQL for pagination/PR/search — §5, §6, §8)
└── Common
    ├── DTOs (class-validator) — CreateWorkoutEntryDto, BulkCreateWorkoutDto, HistoryQueryDto, PrQueryDto, PrCompareQueryDto
    ├── GlobalExceptionFilter (structured error envelope — Clarifications #18)
    └── LoggingModule (nestjs-pino, request-scoped structured logs)
```

`WorkoutsRepository` is the single seam between business logic and SQL — services never construct
queries directly, satisfying the assignment's "Repository/data-access layer" architecture
criterion and keeping the raw-SQL-vs-Prisma-client split (§3) contained to one place.

---

## 14. Concurrency summary (cross-reference)

Already covered in depth in §9 (bulk write transactions) and Clarifications #4 (no dedup by
design). Single-entry creation is just the batch-of-one case of the same transactional path — no
separate code path or separate concurrency behavior.

---

## Open items carried forward

- §5.4 and §10 precomputed-PR/caching are explicitly deferred — will be revisited only if the
  Phase 9 performance review (post-implementation, with real `EXPLAIN ANALYZE` output) shows the
  on-the-fly query underperforming, not before.
- Trigram index performance (§6) is a claim to verify with real seeded data during Phase 9, not
  assumed here.
