# Implementation Plan — Workout Logging API

Builds directly on `docs/ARCHITECTURE.md` (approved). Each step below is a small, independently
reviewable vertical slice: it should leave the repo in a working, tested state, and map to one
(or occasionally two closely related) git commit(s). No step depends on a later step's decisions.

Order follows a bottom-up dependency chain: tooling → schema → pure domain logic (conversion) →
write path → read path (history) → aggregation path (PRs) → cross-cutting production concerns →
final verification. This mirrors the master prompt's example progression, adapted to this
project's actual module boundaries from `ARCHITECTURE.md` §13.

---

## Step 0 — Bootstrap NestJS project + tooling

**Files/modules:** repo root — `package.json`, `tsconfig.json` (strict mode), `.eslintrc`,
`.prettierrc`, `nest-cli.json`, `src/main.ts`, `src/app.module.ts`, `.env.example`,
`.gitignore`.

**Behavior:** Empty NestJS app boots (`GET /health` or Nest's default route), strict TypeScript,
lint/format scripts wired, Jest configured for both unit (`*.spec.ts`) and e2e (`test/*.e2e-spec.ts`).
`ConfigModule` (global, `@nestjs/config`) reads `.env` — `DATABASE_URL`, `PORT`, `LOG_LEVEL`,
`DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `MAX_BULK_ENTRIES` (Clarifications #16).

**Tests:** One smoke e2e test — app boots and a trivial `GET /health` returns 200.

**Commit:** `chore: bootstrap NestJS project and development tooling`

---

## Step 1 — Docker Compose dev environment

**Files/modules:** `Dockerfile` (multi-stage: build + slim runtime), `docker-compose.yml`
(API + Postgres 16 service, named volume, healthcheck), `.dockerignore`.

**Behavior:** `docker compose up` builds the API image and starts Postgres; API container waits
on Postgres healthcheck before starting. No app functionality yet beyond Step 0's health route.

**Tests:** Manual verification (`docker compose up`, curl `/health`) — recorded in README once
written (Step 12). No automated test added here; this step is infra-only.

**Commit:** `chore: add Docker Compose development environment`

---

## Step 2 — Database schema + Prisma setup

**Files/modules:** `prisma/schema.prisma` (models mirroring `ARCHITECTURE.md` §4.2:
`WorkoutEntry`, `WorkoutSet`, `ExerciseMuscleGroup`), `prisma/migrations/...` (initial migration:
tables, `CHECK` constraints, `UNIQUE (workout_entry_id, set_index)`, `pg_trgm` extension +
trigram GIN index, all indexes from §7), `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`.

**Behavior:** `prisma migrate dev` applies cleanly against the Compose Postgres instance;
`PrismaService` is injectable app-wide as a global module.

**Tests:** A minimal integration test that boots `PrismaService`, inserts one `WorkoutEntry` +
`WorkoutSet` pair directly, and reads it back — proves the schema/migration/client wiring works
before any business logic is built on top of it. Also a negative test asserting the
`UNIQUE (workout_entry_id, set_index)` constraint rejects a duplicate `set_index` insert.

**Commit:** `feat: add database schema and Prisma migration`

---

## Step 3 — Exercise → muscle group seed data + provider

**Files/modules:** `prisma/seed.ts` (seeds `exercise_muscle_groups` with a small curated list —
e.g. bench press → chest, squat → legs, deadlift → back, overhead press → shoulders, barbell
row → back, bicep curl → arms), `src/exercise-metadata/exercise-metadata.module.ts`,
`src/exercise-metadata/muscle-group-provider.interface.ts`,
`src/exercise-metadata/prisma-muscle-group.provider.ts`.

**Behavior:** `MuscleGroupProvider.getMuscleGroup(exerciseNameNormalized)` returns a muscle group
string or `null` if unmapped (Clarifications #14, Architecture §11). Provider is registered
behind the interface token so it's swappable via DI.

**Tests:** Unit tests for the provider — known exercise resolves, unknown exercise returns
`null`, normalization (case/whitespace) matches correctly (e.g. `"Bench Press"` and `"bench press"`
both resolve).

**Commit:** `feat: add configurable exercise-to-muscle-group mapping`

---

## Step 4 — Unit conversion abstraction

**Files/modules:** `src/unit-conversion/unit-converter.interface.ts`,
`src/unit-conversion/converters/kg.converter.ts`, `src/unit-conversion/converters/lb.converter.ts`,
`src/unit-conversion/unit-conversion.service.ts` (registry keyed by unit string),
`src/unit-conversion/unit-conversion.module.ts`.

**Behavior:** `UnitConversionService.toKg(value, unit)` / `.fromKg(kg, unit)` /
`.isSupported(unit)`. Pure, dependency-free domain logic — no DB, no HTTP.

**Tests (unit, from `ARCHITECTURE.md` §12 / master prompt §8):**
- kg → kg (identity)
- lb → kg (known conversion factor `0.45359237`)
- kg → lb (inverse)
- precision retained to `NUMERIC(10,4)`-equivalent scale, no premature rounding
- unsupported unit throws a typed domain error (caught later by the global filter)
- round-trip lb → kg → lb stays within expected tolerance (no compounding drift, since real
  conversions always originate from the canonical kg value per Clarifications #11)

**Commit:** `feat: add extensible unit conversion service` / `test: cover unit conversion edge cases`
(two commits: implementation, then tests written/verified — or one combined commit if tests are
written alongside; either is fine as long as both land before Step 5 depends on this module)

---

## Step 5 — Global error handling + DTO validation scaffolding

**Files/modules:** `src/common/filters/global-exception.filter.ts`,
`src/common/dto/` (base validation pipe config in `main.ts`), a `DomainError` base class
(e.g. `UnsupportedUnitError`, `ValidationFailedError`) that the filter maps to the structured
error shape from Clarifications #18.

**Behavior:** Any thrown `HttpException` or recognized `DomainError` is rendered as:
```json
{ "statusCode": ..., "error": ..., "message": ..., "details": [...], "timestamp": ..., "path": ... }
```
consistently across the app, before any real endpoint exists to exercise it end-to-end.

**Tests:** Unit test the filter directly (given a thrown error, assert the shaped response body).

**Commit:** `feat: add global structured error handling`

---

## Step 6 — Workout logging: DTOs + validation

**Files/modules:** `src/workouts/dto/create-workout-set.dto.ts`,
`src/workouts/dto/create-workout-entry.dto.ts`, `src/workouts/dto/bulk-create-workout.dto.ts`.

**Behavior:** `class-validator` rules matching Clarifications #19 and Requirement Analysis §3:
`date` must be `YYYY-MM-DD` (reject ISO datetime per Clarifications #2), `exerciseName`
non-empty trimmed string, `sets` non-empty array (max size sanity bound), each set: `reps`
integer ≥1, `weight` number ≥0, `unit` must be a currently-supported unit (delegates the
supported-set check to `UnitConversionService` via a custom validator so Step 4's registry stays
the single source of truth — no duplicated unit list). Bulk DTO: `entries` array, max length from
`MAX_BULK_ENTRIES` config (Clarifications #16).

**Tests:** Unit tests against the DTOs directly (via `class-validator`'s `validate()`) covering
every edge case from Requirement Analysis §3: unsupported unit, negative weight, negative/zero
reps, empty sets array, missing/null date, malformed date string, oversized bulk array.

**Commit:** `feat: add workout logging DTOs and validation rules`

---

## Step 7 — Workout logging: write path (single + bulk)

**Files/modules:** `src/workouts/workouts.repository.ts` (batch-insert entries + sets in one
Prisma `$transaction`, per Architecture §9), `src/workouts/workouts.service.ts` (orchestrates:
validate handled by DTOs already; convert each set's weight via `UnitConversionService`; call
repository), `src/workouts/workouts.controller.ts` (`POST /workouts`), `src/workouts/workouts.module.ts`
(wires in `PrismaModule`, `UnitConversionModule`).

**Behavior:** Single entry (`entries` array of length 1) and true bulk logging share one code
path. All-or-nothing transaction (Clarifications #5): any DTO validation failure returns 400
before any DB write; any DB-level failure rolls back the whole batch.

**Tests (integration/e2e, Supertest against a real test-DB via Compose or a dedicated test
container):**
- create one entry with one set → 201, `weightKg` correctly computed
- create one entry with multiple sets → all sets persisted in `set_index` order
- bulk-create multiple entries in one request → all persisted, each with correct `weightKg`
- invalid unit anywhere in the batch → whole request rejected 400, nothing persisted (assert via
  a follow-up history read or direct repository count)
- negative weight / reps, empty sets array, null date → 400 with structured error body
- concurrent bulk requests for the same user+exercise do not error or corrupt data (fire two
  requests concurrently, assert both persist independently — smoke-level concurrency test, not a
  full race-condition harness)

**Commit:** `feat: implement workout logging endpoint (single and bulk)` /
`test: add workout creation integration tests`

---

## Step 8 — Workout history: read path

**Files/modules:** extends `workouts.repository.ts` (keyset pagination query per Architecture
§8, exercise partial-match via trigram per §6, date range filter, muscle-group filter joining
`ExerciseMetadataModule`), `src/workouts/dto/history-query.dto.ts` (query param validation:
`userId` required, optional `exerciseName`, `from`/`to`, `muscleGroup`, `unit`, `cursor`, `limit`),
`workouts.service.ts` (assembles response, converts weights to requested unit via
`UnitConversionService`, builds the empty-result message per Clarifications #17), adds
`GET /workouts` to `workouts.controller.ts`.

**Behavior:** Returns paginated entries (with nested sets), each weight shown in the requested
unit (default kg) alongside the originally-logged `{weight, unit}`. `from > to` is a 400
validation error, not a silent empty result. No matches → 200 + empty `data` + `message`.

**Tests (integration/e2e):**
- list all entries for a user, default pagination
- filter by partial exercise name, case-insensitive (`"bench"` matches `"Bench Press"`)
- filter by date range (inclusive both ends, per Clarifications #9)
- filter by muscle group (via seeded mapping from Step 3); exercise with no mapping is excluded,
  not erroring
- `unit=lb` converts every returned weight correctly without mutating stored data
- pagination: first page, follow `nextCursor` to second page, assert no skipped/duplicated rows,
  last page returns `nextCursor: null`
- date range with no matching data → 200, empty array, message present (not an error)
- invalid `from > to` → 400

**Commit:** `feat: implement workout history endpoint with filtering and pagination` /
`test: add workout history integration tests`

---

## Step 9 — Personal records: calculation

**Files/modules:** `src/workouts/personal-records.repository.ts` (the windowed CTE query from
Architecture §5.3, including the `id ASC` tiebreak), `src/workouts/personal-records.service.ts`
(maps DB rows to the PR response shape, handles the `hasData: false` empty case), a small pure
function `calculateEpley1Rm(weightKg, reps)` extracted for direct unit testing,
`src/workouts/dto/pr-query.dto.ts`, `GET /workouts/prs` on the controller (or a dedicated
`PersonalRecordsController` per Architecture §13 — kept as the same controller here unless that
split proves awkward during implementation).

**Behavior:** Returns heaviest set, highest-volume set, best-1RM, each with achievement date, for
a `userId` + `exerciseName`, computed over normalized kg regardless of how each set was
originally logged, convertible to a requested display unit.

**Tests (unit, on the pure Epley function and the mapping logic; integration for the full
query):**
- Epley formula correctness for known inputs (e.g. 100kg × 5 reps → documented expected value)
- max weight / max volume selection across a small seeded mixed-kg/lb dataset — proves
  unit-independent comparison
- tie handling: two sets with equal weight on different dates → earlier date wins (per Architecture
  §5.3); two sets with equal weight **and** equal date → lower set id wins (the corrected
  tiebreak)
- empty dataset (no entries for that user+exercise) → `hasData: false`, no error
- requested display unit conversion applied only to the response, not to the underlying
  comparison

**Commit:** `feat: implement personal record calculations` / `test: add PR calculation tests`

---

## Step 10 — Personal records: range comparison

**Files/modules:** `src/workouts/dto/pr-compare-query.dto.ts` (two date ranges, validated
independently — each `from <= to`), extends `personal-records.service.ts` with a `compare()`
method that runs the Step 9 query twice (per Architecture §5.3's two-query decision) and computes
the `delta` block (absolute + % per metric), `GET /workouts/prs/compare` route.

**Behavior:** Returns `{ current, previous, delta }` per Clarifications #8. Either range may
independently have no data — each side reports `hasData: false` for itself; `delta` fields are
`null` when either side is missing data (documented, not silently computed as garbage).

**Tests (integration):**
- both ranges have data → correct current/previous/delta values
- one range empty → that side `hasData: false`, delta fields null, no error
- both ranges empty → both sides empty, no error
- ranges overlapping or non-adjacent (caller-supplied arbitrary ranges) → handled correctly since
  each range is queried independently

**Commit:** `feat: implement PR range comparison endpoint` / `test: add PR comparison tests`

---

## Step 11 — Structured logging

**Files/modules:** `src/common/logging/logging.module.ts` (`nestjs-pino` wired as the Nest
logger), request-id correlation via pino-http, log level from `ConfigModule`.

**Behavior:** Every request produces one structured JSON log line (method, path, status, latency,
correlation id); unhandled errors are logged with stack trace via the global exception filter
from Step 5 (wired to also log, not just respond).

**Tests:** Light — one test asserting the logger module boots and a request produces a log entry
(via a test transport/spy), since logging output format itself isn't business logic worth
heavy-testing.

**Commit:** `chore: add structured request logging`

---

## Step 12 — Seed script for scale testing + EXPLAIN ANALYZE verification

**Files/modules:** `scripts/seed-scale-test.ts` (generates 50,000+ `WorkoutEntry`/`WorkoutSet`
rows for one synthetic user across a realistic exercise-name distribution, including at least one
worst-case exercise concentration scenario per Architecture §5.2's corrected cost model), a
`docs/PERFORMANCE_NOTES.md` recording actual `EXPLAIN ANALYZE` output for: history list, exercise
filter, partial-match search, muscle-group filter, PR query, PR query under the worst-case
concentration scenario, and pagination at depth.

**Behavior:** Not an API feature — a verification step. Confirms or corrects the performance
claims made in `ARCHITECTURE.md` §5–§8 against real query plans rather than leaving them as
untested assertions, per Architecture's own "open items carried forward" note.

**Tests:** N/A (this step *is* the test, recorded as documentation). If `EXPLAIN ANALYZE` reveals
a claim in `ARCHITECTURE.md` was wrong (e.g. planner not using the trigram index at the seeded
data size), `ARCHITECTURE.md` is corrected in this same step rather than left inconsistent with
reality.

**Commit:** `test: verify query performance against seeded 50k-entry dataset`

---

## Step 13 — README + final documentation sync

**Files/modules:** root `README.md` (per master prompt §10's full checklist: overview,
architecture diagram, tech choices, project structure, schema, indexing, unit normalization,
timezone strategy, API docs with example requests/responses, error format, pagination/filtering
behavior, PR calculation explanation, setup, env vars, `docker compose up`, migration/seed
instructions, test/lint commands, design decisions, assumptions, trade-offs, concurrency
strategy, performance/scaling discussion, 10k-concurrent-coaches answer, limitations/future work).

**Behavior:** No code change. README is written from the now-implemented, now-tested reality —
cross-checked against `ARCHITECTURE.md` and `docs/PERFORMANCE_NOTES.md` rather than restating
pre-implementation assumptions verbatim.

**Tests:** N/A — documentation step. Manual verification: follow the README's own setup
instructions from a clean checkout to confirm they actually work.

**Commit:** `docs: add comprehensive README`

---

## Step 14 — Final adversarial self-review + cleanup

**Files/modules:** `docs/FINAL_REVIEW.md` (per master prompt §13), plus whatever fixes it
surfaces (touches whichever files the review flags — blockers and important issues only, not a
rewrite).

**Behavior:** Full pass over the finished implementation looking specifically for: incorrect
calculations, timezone bugs, weak validation, inconsistent errors, inefficient queries, missing
indexes, race conditions, bad pagination, precision bugs, untested paths, dead code, undocumented
assumptions. Fix blockers/important items; document nice-to-haves as future work rather than
scope-creeping them in.

**Tests:** Full suite re-run after any fixes from this step; no new tests added unless a fix
specifically needs one (e.g. a bug found here should get a regression test per master prompt
§16.13).

**Commit:** `fix: address findings from final self-review` (only if fixes are needed — otherwise
this step produces only `docs/FINAL_REVIEW.md` with a clean bill of health, no code commit).

---

## Explicitly deferred (not steps in this plan)

- `AI_WORKFLOW.md` and `VIDEO_WALKTHROUGH.md` are maintained continuously during Steps 0–14
  (per master prompt §11/§14), not as a separate step at the end — the log needs to reflect real
  interactions as they happen, not be reconstructed from memory afterward.
- Idempotency keys, read replicas, caching, precomputed PR models, table partitioning — all
  explicitly future-scale items per `ARCHITECTURE.md` §10, not built in this plan.

---

## Commit summary (for quick reference)

```
chore: bootstrap NestJS project and development tooling
chore: add Docker Compose development environment
feat: add database schema and Prisma migration
feat: add configurable exercise-to-muscle-group mapping
feat: add extensible unit conversion service
test: cover unit conversion edge cases
feat: add global structured error handling
feat: add workout logging DTOs and validation rules
feat: implement workout logging endpoint (single and bulk)
test: add workout creation integration tests
feat: implement workout history endpoint with filtering and pagination
test: add workout history integration tests
feat: implement personal record calculations
test: add PR calculation tests
feat: implement PR range comparison endpoint
test: add PR comparison tests
chore: add structured request logging
test: verify query performance against seeded 50k-entry dataset
docs: add comprehensive README
fix: address findings from final self-review   (conditional)
```

19–20 commits, each independently reviewable and each leaving the app in a working, tested state
— satisfying the assignment's "evidence of iterative development, not one giant commit"
requirement.
