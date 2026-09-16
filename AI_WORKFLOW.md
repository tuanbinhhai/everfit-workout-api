# AI Workflow Log

This file is maintained continuously during development, not reconstructed afterward. Every
entry below reflects something that actually happened in this session — no fabricated mistakes,
no fabricated rejections.

---

## AI tools used

| Tool | Purpose | Phases used |
|---|---|---|
| Claude (Sonnet 5, via Claude Code) | Requirement analysis, ambiguity identification, architecture design, implementation planning, code generation, test writing, debugging, documentation | All phases (1–5), continuously |
| NestJS CLI generator (`@nestjs/cli`) | Initial project scaffold inspection (used to see current tool defaults, not used to generate the committed code directly) | Step 0 only |

Everything else (schema design, query design, service/repository code, tests) is written
directly by Claude inside this session and reviewed against the approved architecture before
being committed — there is no separate "AI-generated then human-rewritten" pass; the review and
correction happens inline, in conversation, before code is accepted.

---

## Prompting strategy

- **Full context first, in writing, before any code.** The assignment PDF and a detailed master
  instruction file were provided up front. Work proceeded in explicit phases — requirement
  analysis → clarifications/assumptions → architecture → implementation plan → implementation —
  with a hard stop for human review after each phase before continuing. No production code was
  written until the architecture and plan were explicitly approved.
- **Ambiguity is surfaced, not silently resolved.** Every place the assignment was underspecified
  (timezone handling, bulk atomicity, pagination style, precision, etc.) was written up as a
  numbered, reviewable decision in `docs/CLARIFICATIONS.md` with a recommended default — not
  silently assumed and buried in code. Several of these were explicitly corrected by human review
  before implementation began (see "AI mistakes" below).
- **Small, vertical implementation slices.** `docs/IMPLEMENTATION_PLAN.md` breaks the build into
  ~15 independently testable steps, each with its own tests and commit boundary, executed a few
  steps at a time with an explicit review checkpoint — not one large generation pass.
- **Verification over trust.** Claims about test results, lint output, and build status in this
  log and in commit messages are only made after actually running the corresponding command in
  this session. Section 9 of this file records exactly what was run and what the output was, for
  every step.
- **Version/tooling decisions are checked against the live npm registry**, not assumed from
  training-time knowledge, since package ecosystems move fast — see the "AI mistakes" entry below
  about NestJS 12 vs. 11.

---

## AI interaction log

| # | Task | Prompt/approach | AI suggestion | My review/action | Result |
|---|---|---|---|---|---|
| 1 | Requirement analysis | Read assignment PDF + master instruction file; asked to produce `docs/REQUIREMENT_ANALYSIS.md` only, no code | Full functional/non-functional requirement breakdown + 25 acceptance criteria | Accepted as-is; matched the assignment's explicit wording closely | Committed |
| 2 | Ambiguity/assumptions | Asked to enumerate every ambiguous point before touching architecture | 20 numbered assumptions in `docs/CLARIFICATIONS.md`, each with options + recommended default | Reviewed by human; 4 of 20 explicitly corrected (see below), 1 confirmed as-is, rest approved | Committed after revision |
| 3 | Architecture | Asked to justify Postgres vs Mongo, Prisma vs TypeORM, and design schema/indexes/PR queries for this specific workload | Full `docs/ARCHITECTURE.md` incl. relational schema, index strategy, keyset pagination, windowed PR query | Reviewed by human; 4 corrections requested (constraint, PR cost wording, tie-break, index wording) — see below | Committed after revision |
| 4 | Implementation plan | Asked to break approved architecture into small reviewable steps with tests + commit boundaries | 15-step `docs/IMPLEMENTATION_PLAN.md` | Approved without changes | Committed |
| 5 | Project bootstrap tooling | Ran `npx @nestjs/cli new` in a scratch directory to inspect current scaffold defaults before writing the real project files | Scaffold defaulted to NestJS 12, ESM (`"type": "module"`), Vitest, oxlint | Rejected — see "Rejected AI suggestion" below | Hand-built package.json/tsconfig/eslint config instead, pinned to NestJS 11.x |
| 6 | Step 0 verification | Asked to run build/lint/format/unit/e2e | `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`, `npx prettier --check` | Ran all five for real; build clean, lint 0 errors/1 warning, e2e 1/1 passing, unit tests correctly report "no tests" (none expected yet), formatting clean | Recorded in Step 0 report |
| 7 | Step 2 — Prisma schema/migration | Wrote `prisma/schema.prisma` matching ARCHITECTURE.md §4.2, ran `prisma migrate dev --create-only`, hand-edited the generated SQL for CHECK constraints + trigram index, applied it, wrote a real-Postgres integration test | Prisma 7's `migrate` rejected a `url` in the schema datasource block; `@@unique(..., name:)` silently didn't set the DB constraint name; Docker build produced a container with a corrupted, partial `dist/` | All three investigated and root-caused for real (not guessed) — see "AI mistakes" below | Fixed; `npm run test:integration` 3/3, `docker compose up --build` verified end-to-end |
| 8 | Step 3 — exercise metadata provider | Given explicit instructions to keep it to an interface + token + one Prisma-backed implementation + a small seed script, no extra abstraction | `MuscleGroupProvider` interface/token, `PrismaMuscleGroupProvider`, `prisma/seed.ts` (7-exercise demo set), shared `normalizeExerciseName` helper | Matched the requested shape directly; no corrections needed | Committed (`f109358`); unit tests 5/5, seed script run twice against real Postgres to confirm idempotency (stayed at 7 rows) |
| 9 | Step 4 — unit conversion | Given explicit instruction to prefer a small conversion-factor registry over a converter-class-per-unit hierarchy | `Record<string, number>` factor table + `toKg`/`fromKg`/`isSupported`, typed `UnsupportedUnitError` | Matched the requested shape; deliberately simpler than this file's own earlier "UnitConverter interface + per-unit classes" description in `docs/ARCHITECTURE.md` §12 — the instruction to simplify is followed, not the earlier doc wording, since the human's explicit in-session direction takes precedence | Committed (`7b6484f`); unit tests 8/8 incl. a precision case that would fail under premature 2dp rounding |
| 10 | Step 5 — structured error handling | Exact response shape specified; asked to centralize mapping, not scatter try/catch | `GlobalExceptionFilter` (`@Catch()` on everything) + a custom `ValidationPipe.exceptionFactory` flattening nested `ValidationError[]` into the same `details[]` shape | Matched the requested shape; extracted a shared `configureApp()` so e2e tests exercise the identical pipe/filter setup as `main.ts` rather than risking drift between prod and test | Committed (`05a8cbb`); filter unit tests 6/6, incl. one asserting 500s are logged and 400s are not |
| 11 | Step 6 — workout DTOs | Explicit requirement: reject impossible dates, not just regex-shaped ones; keep unit-support checking out of DTOs | `IsCalendarDate` custom validator (regex + `Date.UTC` round-trip to catch e.g. `2026-02-30`), `exerciseName` trimmed via `class-transformer` before `@IsNotEmpty()` | Matched the requested shape directly | Committed (`05a8cbb`) |
| 12 | Step 7 — POST /workouts | Explicit repository responsibility split (batch inserts, one transaction, no business logic) | `createManyAndReturn` for both entries and sets (real multi-row `INSERT...RETURNING`, not N individual inserts), transaction rollback verified against real Postgres | Matched the requested shape; caught and fixed my own test-expectation bug (see "AI mistakes" below) via the integration run, not code review alone | Committed (`5fedf19`); 47 unit / 10 integration / 23 e2e, Docker-verified with real curl + psql |
| 13 | Step 8 — GET /workouts history + cursor pagination | Explicit instruction to prefer Prisma's query builder over raw SQL unless there's a concrete benefit, even though ARCHITECTURE.md originally framed these same queries around raw SQL | `contains`/`mode:'insensitive'` for trigram-backed substring search, an `OR`-based keyset predicate for `(date,id) < (cursor.date,cursor.id)`, a second small query to resolve muscleGroup → exercise names (no raw SQL, no schema relation added) | Matched the requested shape; caught two real issues via actual execution, not code review — see "AI mistakes" below | Committed (`859cd5c`); 77 unit / 24 integration / 43 e2e, Docker-verified with real curl + psql incl. real cursor-based pagination |
| 14 | Step 9 — GET /workouts/prs personal records | Explicit instruction that raw SQL is justified here (unlike Step 8) since Prisma has no `ROW_NUMBER() OVER (...)` equivalent; explicit exact-match (not partial) exercise identity requirement | One windowed `$queryRaw` tagged-template query computing and ranking all three PR metrics in a single round trip, casting NUMERIC/BIGINT columns to text to preserve precision through to JS; two small pure functions (`calculateVolume`, `calculateEpley1Rm`) mirroring the SQL's formulas, unit-tested independently; SQL ranking itself verified only via integration tests, not re-implemented in TS for unit testing | Matched the requested shape and the requested test-layer split (no duplicated ranking logic in TS just to unit-test it) | Committed (`8b18b7d`); 92 unit / 34 integration / 51 e2e, Docker-verified with real curl + psql cross-checking the DB's own raw metric computation against the API's selected winners |
| 15 | Step 10 — GET /workouts/prs/compare range comparison | Explicit instruction to reuse Step 9's ranking logic via an optional range parameter, not duplicate it; explicit two-independent-queries design (not one range-bucketed query); explicit canonical-kg-before-rounding delta semantics | Extended `findCandidates` with an additive optional `range` param (`Prisma.sql`/`Prisma.empty` conditional fragment in the same query), extracted `computeWinnersAndMetrics()` out of the existing Step 9 method so both single-range and two-range call sites share it, `Promise.all` for the two independent range queries, delta computed from raw canonical metrics carried alongside the already-existing display records | Matched the requested shape and reuse strategy exactly; the Step 9 method WAS refactored (extracted, not rewritten) specifically because Step 10 revealed the concrete duplication the instructions anticipated — verified Step 9's own test suite still passes unmodified, confirming no behavior change | Committed (`50e730b`); 103 unit / 44 integration / 62 e2e, Docker-verified incl. explicit regression curl checks of all three prior endpoints before testing the new one, plus a delta manually cross-checked against the same Epley arithmetic run directly via psql |
| 16 | Step 11 — structured request logging | Explicit library preference (nestjs-pino/pino-http unless a concrete reason not to), explicit field/sensitivity constraints | Read nestjs-pino's actual README/type definitions before writing any code (not assumed from training knowledge) — this is what surfaced the Node >=22.12 requirement and the exact `genReqId`/serializer API shape; custom req/res serializers reduced to `{id, method, url}`/`{statusCode}` only | Matched the requested design; caught and fixed a real gap myself before it reached commit — see "AI mistakes" below | Committed (`a043d03`); 112 unit / 44 integration / 64 e2e, Docker rebuilt on the now-required Node 22 base image and manually verified incl. a real DB-outage-triggered 500 (not a fake endpoint) |

---

## AI mistakes / suboptimal outputs (real, corrected)

### 1. Silently converting workout `date` through UTC

**Original AI output (`docs/CLARIFICATIONS.md` draft, §2/§3):** I proposed accepting either a
plain date or a full ISO datetime for the workout `date` field, and — if an offset was present —
converting it to a UTC calendar date before storing, reasoning this was consistent with "UTC
storage recommended" from the assignment.

**Why it was wrong:** This conflates two different things — the assignment's UTC guidance applies
to *timestamps* (instants in time), not to a *business calendar date* the user explicitly chose.
Converting `2026-09-15T23:00:00-05:00` through UTC could silently shift it to `2026-09-16`,
changing the workout day the user actually intended to log, purely as a side effect of which
timezone offset happened to be attached to the request. This is exactly the kind of quiet,
plausible-looking bug an AI-generated timezone rule can produce — it sounded consistent with the
assignment's own recommendation while actually undermining it.

**How it was caught:** Human review of `docs/CLARIFICATIONS.md` before architecture work began,
explicitly flagging this as incorrect and specifying the fix: treat `date` as a pure business
calendar date (`YYYY-MM-DD` only, reject datetimes, never converted through UTC), and keep UTC
conversion scoped to `createdAt`/`updatedAt` — which genuinely are instants.

**Correction:** Rewrote CLARIFICATIONS.md §2/§3 to separate "business date" from "instant"
handling explicitly, and propagated the corrected model into `ARCHITECTURE.md`'s schema (`date`
as plain `DATE`, no conversion; `createdAt`/`updatedAt` as `TIMESTAMPTZ`).

**What was learned:** When a spec says "store timestamps in UTC," verify which fields are
actually timestamps before applying that rule uniformly — a calendar date and an instant look
similar in a request body but have very different correct handling.

### 2. Understating PR query cost by assuming a "typical" data distribution

**Original AI output (`docs/ARCHITECTURE.md` draft, §5.2):** I wrote that a PR query for one
exercise would touch "tens to a few hundred rows, not 50,000," because the 50k-entry budget is
spread across all of a user's exercises.

**Why it was wrong:** The assignment never specifies or guarantees an even distribution of
entries across exercises. A user could concentrate most of their 50,000 entries on a single
exercise, and nothing in the requirements rules that out. Stating "tens to a few hundred rows" as
if it were a guarantee is an unfounded assumption dressed up as a performance analysis — exactly
the kind of confident-sounding but unverified claim that's easy for an AI to produce and easy for
a reviewer to wrongly trust.

**How it was caught:** Human review of the architecture document flagged the assumption directly
and asked for the honest cost model instead.

**Correction:** Rewrote §5.2 to state the accurate bound: the composite index guarantees the
query never scans *unrelated* users'/exercises' data, but the scan cost is proportional to
however many sets exist for that specific user+exercise+date range — which could be large. This
is documented as acceptable for the assignment's 50k-entries/user target but explicitly marked as
**a claim to verify with `EXPLAIN ANALYZE`** against a seeded worst-case dataset in the
performance-testing step, with a precomputed PR read-model documented as the future mitigation if
profiling shows it's actually a hot path — not assumed unnecessary.

**What was learned:** Don't estimate query cost from an assumed data shape when the spec doesn't
guarantee that shape — state the honest asymptotic bound, and defer the "is this actually fast
enough" question to real measurement (`EXPLAIN ANALYZE`) rather than a plausible-sounding guess.

### 3. `@@unique(..., name: "...")` doesn't set the database constraint name

**Original AI output (`prisma/schema.prisma`, Step 2 draft):** Wrote
`@@unique([workoutEntryId, setIndex], name: "uq_sets_entry_set_index")` on `WorkoutSet`,
intending to name the database constraint per `ARCHITECTURE.md`'s DDL
(`UNIQUE (workout_entry_id, set_index)`, referenced by that name elsewhere in the same document).

**Why it was wrong:** In Prisma's schema DSL, `@@unique`'s `name` argument only sets the alias
used in the generated Prisma Client's compound-key API (e.g.
`prisma.workoutSet.findUnique({ where: { uq_sets_entry_set_index: {...} } })`) — it does **not**
set the actual Postgres constraint name. `map` does. Running `prisma migrate dev --create-only`
and reading the generated SQL showed the constraint had been named
`workout_sets_workout_entry_id_set_index_key` (Prisma's auto-generated default), not the intended
name — a mismatch that would have been easy to miss without actually inspecting the generated
migration SQL rather than trusting the schema looked correct.

**How it was caught:** Inspecting the raw generated `migration.sql` (a step already planned
before applying, specifically to hand-add the CHECK constraints and trigram index Prisma can't
express declaratively) — the constraint name in the SQL didn't match what the schema seemed to
request.

**Correction:** Changed `name:` to `map:` on the `@@unique` attribute, deleted the draft
migration, and regenerated — the SQL then correctly showed
`CREATE UNIQUE INDEX "uq_sets_entry_set_index" ON ...`.

**What was learned:** For Prisma schema attributes, `name` and `map` are not interchangeable
synonyms — `name` is client-API-facing, `map` is database-facing — and the only reliable way to
confirm which one took effect is to read the generated SQL, not the schema file.

### 4. Two real Docker build bugs surfaced only by actually running `docker compose up --build`

**What happened:** After wiring in Prisma, `docker compose up -d --build` produced a container
that crashed on startup with `Error: Cannot find module '/app/dist/main.js'`. This was not
predicted or assumed away — it was caught because the plan called for actually running and
curling the container (per `docs/IMPLEMENTATION_PLAN.md` Step 1's verification bar), not just
trusting that `docker compose up` "should" work because the Dockerfile looked reasonable.

**Root cause 1:** Adding `prisma.config.ts` at the project root (required by Prisma 7's new
`migrate`/`generate` config model) gave TypeScript a root-level `.ts` file outside `src/`.
Without an explicit `rootDir`, `tsc` silently widened its inferred common root to the project
root, so `nest build` started emitting `dist/src/main.js` instead of `dist/main.js` — breaking
both the Dockerfile's `CMD` and `npm run start:prod`, locally too (verified by inspecting the
local `dist/` tree directly, not assumed from the error message alone).

**Root cause 2 (found only after fixing #1 and still seeing the same crash in a fresh container):**
A stray `tsconfig.build.tsbuildinfo` — `tsc`'s incremental-build cache, which embeds absolute file
paths — had been generated locally (`/Users/.../src/main.ts` paths) and was not excluded by
`.dockerignore`. `COPY . .` copied it into the build stage, where `tsc` compiled the *same*
project again but at `/app/...` paths; the mismatched cache produced a corrupted, partial `dist/`
(declaration files for most modules, `.js` for only a couple) — confirmed by directly inspecting
`dist/` inside a debug build of just the `build` stage (`docker build --target build`), not
guessed at from the symptom.

**How it was caught:** Neither bug was assumed away as "should be fine" — both were confirmed by
directly inspecting the actual filesystem state (`find dist`, `docker build --target build` for
isolated inspection) rather than trusting a green build log, since BuildKit reported both the
broken builds as exit-code-0 successes.

**Correction:** Added explicit `rootDir`/`include` scoping to `tsconfig.build.json`; added
`*.tsbuildinfo` and `src/generated` to `.dockerignore`. Reverified with a full, real
`docker compose up -d --build` → `curl /health` → 200, and `docker compose logs` showing
`[PrismaService] Connected to PostgreSQL`.

**What was learned:** A green `docker build` exit code does not mean the image is correct —
incremental-compilation caches and generated-code directories are exactly the kind of
host-environment-specific state that silently corrupts a "works on my machine" build when copied
into a container with different absolute paths. Verify by inspecting the actual running
container/image, not by reading the build log for the word "error."

### 5. Missing display-boundary rounding on `GET /workouts`'s converted weight

**Original AI output (Step 8 `workouts.service.ts`, first draft):** `toHistoryResponse` computed
`convertedWeight` as `this.unitConversion.fromKg(Number(set.weightKg), unit).toString()` — the
raw, unrounded floating-point conversion result.

**Why it was wrong:** `docs/CLARIFICATIONS.md` #11 — written and approved back in Phase 2 —
explicitly says "rounding to 2 decimal places happens only at the API response/display boundary."
`GET /workouts`'s `convertedWeight` field is exactly that boundary (a fresh runtime conversion
computed for display, not a stored value), and I simply didn't apply the rounding there. This
wasn't caught by any unit, integration, or e2e test, because all of those asserted against
`Number(convertedWeight)` with `toBeCloseTo`, which doesn't care about display formatting — only
the manual verification step (real `curl` against the real Docker container) surfaced it, by
producing a visibly wrong response like `"convertedWeight": "330.6933932773164"`.

**How it was caught:** Manual API verification (checklist item 5, "requested lb conversion")
during the required Docker rebuild step — not code review, not automated tests. This is precisely
why that manual step exists in the plan rather than trusting test suites alone.

**Correction:** Changed `.toString()` to `.toFixed(2)` at that one call site, with a comment
citing the CLARIFICATIONS.md decision. Updated the 4 unit-test and 2 e2e-test assertions that had
been asserting on the un-rounded value (`toBeCloseTo(220.462262, 4)` → `toBe('220.46')`, etc.),
and rewrote one test (`'always converts from canonical weightKg'`) whose original design relied on
a floating-point precision artifact that becomes invisible once rounded to 2dp — replaced with a
deliberately inconsistent original/weightKg pair so the assertion no longer depends on rounding
behavior to make its point. Rebuilt Docker and reverified the same manual check showed clean
`"220.46"`-style output.

**What was learned:** A previously-approved design decision (CLARIFICATIONS.md #11) can still be
missed during implementation weeks/steps later if nothing forces a concrete check against it —
and unit tests using approximate-equality matchers (`toBeCloseTo`) are exactly the kind of test
that won't catch a missing display-formatting step, because they're deliberately insensitive to
the formatting difference that was the actual bug. Manual, real-output verification catches a
different class of bug than automated tests with loose numeric assertions.

### 6. Integration/e2e test files racing each other against the shared dev Postgres database

**Original AI output (Step 8, adding a third integration spec file):** `npm run test:integration`
failed with a wrong row appearing in an unrelated test's result set (a `Deadlift` entry from a
different spec file showing up in a query that should only have matched two entries the test
itself had just created).

**Why it was wrong:** Jest runs separate test *files* in parallel worker processes by default.
None of the three integration spec files (`prisma.integration-spec.ts`,
`workouts-repository.integration-spec.ts`, the new `workouts-history.integration-spec.ts`) scoped
their test data or cleanup to avoid colliding with the others — all used the literal userId
`'user-1'` and all had an `afterEach` that deleted *every* row in `workout_entries`/`workout_sets`,
not just their own. Running three such files concurrently against one shared, real Postgres
database is a textbook race: one file's cleanup or insert lands in the middle of another file's
test. This had been latent since Step 2 (with two files it apparently didn't surface visibly) and
only became reliably reproducible once a third file added enough concurrent activity.

**How it was caught:** Actually running `npm run test:integration` and reading the failure's
*data*, not just its pass/fail status — the unexpected `Deadlift` row was the tell, traced by
`grep`-ing the test tree for that literal string to find which file created it.

**Correction:** Added `--runInBand` to both the `test:integration` and `test:e2e` npm scripts
(package.json) — Jest's standard, well-known fix for a suite of tests sharing one external
stateful resource. Considered per-file data isolation (unique userId per file) as an alternative,
but serial execution is simpler, more robust against future files making the same shared-`'user-1'`
mistake, and the tests already run fast enough (well under a couple of seconds) that losing
worker-level parallelism has no practical cost here.

**What was learned:** A shared external resource (one Postgres instance) used by multiple test
files is a parallelism hazard by default, not just when a test explicitly looks racy — the fix
needs to be structural (serialize the suite) rather than per-test, or every future spec file
author has to remember an isolation convention nothing enforces.

### 7. Custom pino-http request serializer silently dropped the request id from logs

**Original AI output (Step 11 `pino-http-options.ts`, first draft):** A custom `req` serializer
was written to strip everything down to `{ method, url }` — deliberately minimal, so no headers,
query params, or bodies would ever be logged. It compiled, passed lint, and passed the unit tests
I had written for it (which only checked that `method`/`url` were present and `headers` was not).

**Why it was wrong:** pino-http's *default* request serializer includes `req.id` (bound from
`genReqId`) alongside method/url/headers/etc. By replacing the whole serializer instead of
extending it, I also replaced away the `id` field — the one piece of information the entire
correlation-id feature exists to put into the logs. The unit tests I'd written didn't catch this
because they only asserted what I expected to be *absent* (headers) and a couple of fields I
expected to be *present* (method, url) — I never wrote an assertion checking for `id` specifically,
because at the time I wrote the test I was focused on proving the sensitive-data exclusion, not on
proving the one field the feature is actually for. The gap surfaced only when I read real e2e log
output during the manual verification step and noticed the `req` object in the "request completed"
log line had no `id` at all — request bodies for the response headers were fine (the `x-request-id`
header was being set correctly, since that's independent of the serializer), but the *logs*
themselves — the thing correlation ids are for — couldn't actually be traced back to a request id.

**How it was caught:** Manual e2e log inspection (the required Step 11 verification step, not
optional), specifically reading actual JSON log lines rather than just confirming the tests were
green and the response header was present. The response header being correct made it easy to
assume the logging side was also correct without looking.

**Correction:** Added `id: req.id` to the custom serializer's output, with a comment explaining
that a custom serializer replaces pino-http's default entirely rather than extending it — a
non-obvious behavior that's easy to get wrong in exactly this way. Updated the existing serializer
unit test to assert `id` is present in the serialized shape (not just that `method`/`url` are
present and `headers` is absent), so this specific regression can't reoccur silently. Reran the
e2e suite and manually reconfirmed `req.id` appears in real log output afterward.

**What was learned:** Testing "what should be excluded" and "what should be included" are
separate concerns, and a test suite that only checks one can pass green while completely missing
the other — the unit test proved the sensitive-data guarantee but said nothing about whether the
feature's actual purpose (correlation) worked. Reading real log output, not just trusting green
tests, is what caught this.

### Minor, for completeness: a wrong test expectation (not application code), caught by actually running it

Not counted as one of the two required examples above (those are substantive; this is a one-line
test typo), but recorded here rather than silently fixed, per this file's own "never fabricate,
never silently fix" policy. In the Step 7 integration test for storing lb→kg conversions, I wrote
`expect(Number(set.weightKg)).toBeCloseTo(99.7903214, 6)` — 7 decimal digits of expected
precision. Running `npm run test:integration` against real Postgres failed: the actual stored
value was `99.7903` (4 decimal places), because the `weight_kg` column is `NUMERIC(10,4)` by
design (`docs/ARCHITECTURE.md` §4.2) — the database itself rounds to 4dp on storage, which is
correct, expected behavior, not a bug. My test's expected value assumed more precision than the
schema actually stores. Fixed the test's expectation (`toBeCloseTo(99.7903, 4)`), not the code.
**What was learned:** when asserting on a `NUMERIC(n, scale)` column's stored value, the
expectation needs to match the column's declared scale, not the full-precision value computed
before storage — an easy thing to get wrong when the conversion math and the storage precision
are defined in different places.

### Minor, for completeness: a wrong test expectation in the Step 10 negative-delta test

Same category as the Step 7 note above — a test-writing arithmetic error, not a service bug.
Writing the "computes a negative delta when the metric declined" test, I built it by swapping the
`current`/`previous` mock data from the positive-delta test and assumed the percentage would just
be the negation of the positive test's percentage (`-10.00%`). Running the test failed: the
actual value was `-9.09%`. The service was correct — swapping current and previous also swaps
which value is the percentage's *denominator* (`(current-previous)/previous`), so the two
percentages aren't negations of each other unless current and previous happen to be equal. Fixed
the test's expected value (`-9.09`), not the code, and added a comment explaining why. **What was
learned:** percentage-delta tests built by "swap the inputs from another test" need the expected
output recomputed from scratch, not assumed symmetric — the denominator moves too.

---

## Rejected AI suggestion (real)

**Suggestion:** Running `npx @nestjs/cli new` to scaffold the project produced a default stack of
NestJS 12, ESM (`"type": "module"` in `package.json`), Vitest as the test runner, and `oxlint` for
linting — the current defaults for that generator.

**Why it was rejected:** `docs/ARCHITECTURE.md` (already approved before this point) explicitly
specifies Jest + Supertest for testing, matching the assignment's own suggested stack and
NestJS's still-dominant, best-documented testing convention. Adopting Vitest/oxlint instead would
have been a silent, undocumented deviation from an already-approved decision, made only because
it happened to be a generator's current default rather than because it was actually better for
this project. Additionally, NestJS 12 and ESM-by-default are recent changes with a much smaller
base of examples, Stack Overflow answers, and battle-testing than the NestJS 11 / CommonJS
combination — for a take-home meant to be explainable and low-risk, the more mature, more
widely-documented option was preferred.

**Chosen alternative:** Hand-built `package.json`, `tsconfig.json`, and `eslint.config.mjs`
pinning `@nestjs/core`/`common`/`platform-express`/`testing` to `^11.2.5`, `typescript` to
`^5.9.3`, CommonJS modules, Jest + `ts-jest` + Supertest for testing, and ESLint 9 (flat config)
+ `typescript-eslint` + Prettier for linting/formatting — all versions checked against the live
npm registry for real compatibility (e.g. `ts-jest@29.4.12`'s peer range genuinely supports
`typescript <7`, so `5.9.3` is a safe pin) rather than assumed from training-time knowledge.

**Trade-off accepted:** `@nestjs/platform-express` on the 11.x line pulls in a `multer` version
flagged by `npm audit` for several DoS-class advisories (fixed only by upgrading to NestJS 12).
This app has no file-upload endpoints and never wires up `multer`'s interceptors, so the
vulnerable code path is not reachable — documented here and in the README as an accepted,
non-exploitable transitive advisory rather than silently ignored.

---

## Human review

What was personally verified in this session, not just generated and trusted:

- **Architecture**: Postgres-vs-Mongo and Prisma-vs-TypeORM reasoning checked against the
  assignment's actual query patterns (not generic database trivia) before being accepted.
- **Assumptions**: all 20 entries in `docs/CLARIFICATIONS.md` reviewed line-by-line; 4 corrected,
  1 explicitly confirmed unchanged, before implementation began.
- **Schema/queries**: the PR windowed-query design, tie-breaking rule, and index attribution were
  each checked for a specific, named defect (missing constraint, unfounded scale assumption,
  non-deterministic tie-break, conflated indexes) and corrected before being treated as approved.
- **Toolchain versions**: every dependency version pinned in `package.json` was checked against
  the live npm registry (`npm view <pkg> versions/dist-tags/peerDependencies`) during Step 0
  rather than assumed, after discovering the ecosystem had moved further than expected (NestJS 12,
  TypeScript 7, Prisma 8-rc all exist now) — see the rejected-suggestion entry above.
- **Step 0 commands actually executed** (not just claimed): `npm install`, `npx nest build`,
  `npm run lint`, `npm test`, `npm run test:e2e`, `npx prettier --check`. Real output for each is
  recorded in the Step 0 completion report delivered in conversation.
- **Step 2 commands actually executed**: `prisma migrate dev --create-only` (then the SQL was
  read and hand-edited before applying), `prisma migrate deploy`, `prisma generate`,
  `npm run test:integration` (3/3 against a real Postgres container — insert/read round-trip,
  `UNIQUE(workout_entry_id, set_index)` rejection, `CHECK(reps>=1)` rejection), `npm run test:e2e`,
  `npm run lint`, `npx nest build`, `npx prettier --check`, and — critically — a full
  `docker compose up -d --build` with `curl /health` returning `200 {"status":"ok"}` and
  `docker compose logs` showing a real `PrismaService: Connected to PostgreSQL` line, not just a
  successful build log. Two real bugs (see mistakes #3, #4 above) were only found because this
  was actually run rather than assumed to work from a correct-looking Dockerfile.
- **Environment discovery, not assumed**: found a pre-existing native Postgres already listening
  on the host's `127.0.0.1:5432` (`lsof -nP -iTCP:5432 -sTCP:LISTEN`), which was silently
  shadowing the Docker container's port mapping for host-side tools. Remapped the container to
  host port `5433` rather than touch the user's unrelated existing Postgres install.
- **Step 3/4 commands actually executed**: `npm test` (19/19 unit tests — the first real ones in
  this project), `npm run prisma:seed` run **twice** against a real Postgres container specifically
  to verify the upsert-based seed is idempotent (stayed at 7 rows, checked via `psql` directly, not
  assumed from the script's own success message), `npm run test:integration` (3/3, unaffected by
  the new seed data since integration tests only clean up `workout_entries`/`workout_sets`),
  `npm run test:e2e` (1/1, which also exercises the full `AppModule` bootstrap including the two
  newly-wired modules), `npm run lint`, `npx nest build`, `npx prettier --check`.
- **Step 5-7 commands actually executed**: full sweep after implementation —
  `npm test` (47/47), `npm run test:integration` (10/10, real Postgres), `npm run test:e2e`
  (23/23, real Postgres via the full HTTP stack), `npm run lint` (0 errors/0 warnings — the 3
  pre-existing warnings flagged at the last checkpoint were fixed, see below), `npx nest build`,
  `npx prettier --check`, and a full `docker compose up -d --build` re-verification: real `curl`
  requests for `GET /health`, a valid bulk `POST /workouts` (kg + lb in one request), an invalid
  `POST /workouts` (impossible date → 400), and a two-exercise bulk request — every result
  cross-checked against the actual rows in Postgres via `psql`, not just the HTTP response body.
- **Lint warnings resolved, not just noted**: the 3 warnings flagged at the previous checkpoint
  (2× `prisma as any` in a test mock, 1× `app.getHttpServer()` typed `any` in the e2e boilerplate)
  were fixed by typing the mock/test helpers properly (`as unknown as PrismaService`, a typed
  `httpServer: Server` variable) rather than suppressed or ignored — `npm run lint` is 0
  errors/0 warnings as of this checkpoint.
- **Transaction atomicity verified against a real database, not assumed from reading the code**:
  the integration suite deliberately sends a payload with a duplicate `setIndex` (violating
  `UNIQUE(workout_entry_id, set_index)`) partway through a multi-set entry, and asserts the
  **entire** transaction — including the already-processed valid set and the entry row itself —
  rolls back, by checking real row counts before and after.
- **Step 8 commands actually executed**: `npm test` (77/77), `npm run test:integration` (24/24,
  real Postgres, after fixing the parallel-worker race — see mistake #6), `npm run test:e2e`
  (43/43), `npm run lint`, `npx nest build`, `npx prettier --check`, and a full Docker rebuild +
  10-item manual verification checklist against the real running container (normal history,
  partial search, date range, muscle group, lb conversion, combined filters, real page1→page2
  pagination via the actual returned `nextCursor`, same-date pagination, empty result, malformed
  cursor) — which is what caught mistake #5 (missing display rounding) in the first place, before
  it was ever committed.
- **Persisted-value invariance checked directly via `psql`, not inferred**: after issuing several
  `GET /workouts?unit=lb` requests against previously-stored kg data, queried `workout_sets`
  directly to confirm `weight`, `unit`, and `weight_kg` were byte-for-byte unchanged from what was
  originally stored — proving the read path never mutates persisted values, not just asserting it
  in a docstring.
- **Step 9 commands actually executed**: `npm test` (92/92), `npm run test:integration` (34/34,
  real Postgres), `npm run test:e2e` (51/51), `npm run lint`, `npx nest build`,
  `npx prettier --check`, and a full Docker rebuild + 8-item manual verification checklist. No new
  mistakes or corrections this checkpoint — the raw SQL ranking query, tie-breaking, and
  canonical-kg selection all worked as designed on the first real test run (92/34/51 all green
  the first time each suite was executed, not after debugging failures), which is itself recorded
  here honestly rather than inventing a correction narrative where none occurred.
- **DB-side computation cross-checked against API output, not assumed consistent**: ran the exact
  same `epley_1rm`/`volume` arithmetic directly via `psql` against the seeded PR test data and
  confirmed which rows had the highest values matched exactly which rows the API returned as
  winners — closing the loop between "the SQL query looks right" and "the SQL query is right."
- **Step 10 commands actually executed**: `npm test` (103/103, including Step 9's full suite
  rerun unmodified to confirm the shared-logic extraction didn't change its behavior),
  `npm run test:integration` (44/44, real Postgres), `npm run test:e2e` (62/62), `npm run lint`,
  `npx nest build`, `npx prettier --check`, and a full Docker rebuild. Before testing the new
  comparison endpoint, explicitly re-curled `GET /health`, `POST /workouts`, `GET /workouts`, and
  `GET /workouts/prs` against the rebuilt container as a regression check, per the checkpoint's
  explicit requirement — not assumed fine because the automated suites passed.
- **A delta manually cross-checked against independently-computed raw values, not just against
  the service's own internal math**: computed the expected `best1Rm` delta for real seeded data by
  hand (Python), separately ran the identical Epley arithmetic directly via `psql` against the
  same rows, and confirmed both matched the API's actual response — three independent
  computations of the same number, not one code path checked against itself.
- **Library requirements checked by reading actual docs, not assumed**: before writing any
  logging code, read nestjs-pino's real README/compatibility table, which is what surfaced the
  Node >=22.12 requirement (our Dockerfile was on `node:20-slim`) and the exact `genReqId`/
  serializer API shape (including the "don't re-import LoggerModule into a feature module" pitfall
  the library's own docs warn causes silent double-logging) — none of this was guessed from
  training-time familiarity with an older nestjs-pino API.
- **A real, uncomfortable failure mode manually triggered on purpose**: stopped the Postgres
  container while the API was still running and issued a real request against it, specifically to
  observe genuine unexpected-500 logging behavior — rather than trusting the unit tests' mocked
  500 scenario as sufficient proof for what happens with an actual unhandled `PrismaClientKnownRequestError`
  in production-like conditions. This is also what confirmed `app.useLogger()` really does route the
  existing `GlobalExceptionFilter`'s logging through pino, rather than assuming the framework
  mechanics described in nestjs-pino's docs apply the way documented.
- **Log output read line-by-line, not just checked for "no error thrown"**: mistake #7 (missing
  `req.id` in logs) was only found by actually reading real JSON log lines during manual
  verification — the automated test suite was green throughout because it never asserted on the
  one field that mattered.

This section will keep growing as later implementation steps land.

---

## Session Handoff

**Date / session:** 2026-09-15/16. Session 1 (09-15): Phases 1–4 planning + Steps 0–2.
Session 2 (09-15, continuation): Steps 3–4. Session 3 (09-15, continuation): Steps 5–7 + end-of-day
closeout. Session 4 (09-16): context restored and re-verified, then Steps 8–11.

**Completed implementation steps** (of `docs/IMPLEMENTATION_PLAN.md`'s 15 steps):
- Step 0 — NestJS bootstrap + tooling. Commit `4bb235b`.
- Step 1 — Docker Compose dev environment. Commit `2ed9e70`.
- Step 2 — Database schema + Prisma migration. Commit `09349ce`.
- Step 3 — Configurable exercise → muscle group provider. Commit `f109358`.
- Step 4 — Extensible unit conversion. Commit `7b6484f`.
- Step 5 — Structured error handling. Commit `05a8cbb` (bundled with Step 6).
- Step 6 — Workout DTOs. Commit `05a8cbb`.
- Step 7 — `POST /workouts` atomic bulk logging. Commit `5fedf19`.
- Step 8 — `GET /workouts` history with filtering, unit conversion, cursor pagination. Commit
  `859cd5c`.
- Step 9 — `GET /workouts/prs`: heaviest set, highest-volume set, best estimated 1RM, each with
  achievement date, via one windowed `$queryRaw` query. Commit `8b18b7d`.
- Step 10 — `GET /workouts/prs/compare`: two caller-supplied date ranges, reusing Step 9's exact
  ranking logic. Commit `50e730b`.
- Step 11 — Structured request logging: `nestjs-pino`/`pino-http` replace Nest's console logger
  everywhere (app startup, existing `Logger` calls, and one automatic per-request completion log
  with method/url/statusCode/responseTime/request-id). Request id reuses a client-supplied
  `x-request-id` header when present, otherwise generates one, echoed back as a response header.
  Custom req/res serializers emit only `{id, method, url}`/`{statusCode}` — never headers, query
  params, or bodies. `GlobalExceptionFilter` needed no code changes: `app.useLogger()` routes its
  existing `Logger` calls through pino automatically. Required bumping the Dockerfile's Node base
  image from 20 to 22 (nestjs-pino v5 requires >=22.12 — discovered by reading the library's own
  docs before installing, not assumed). Commit `a043d03`.

Plus Phase 1–4 planning docs (`b673004`) and the `AI_WORKFLOW.md` handoff updates (`eb6e761`,
`344d989`, `0f2ef49`, `d110c96`, `0e46962`, `073b44c`, `613589f`, `e7b8888`).

**Current implementation state:** Steps 0–11 fully implemented and verified for real. Steps 12–14
(50k-entry seed + `EXPLAIN ANALYZE` performance verification, README, final adversarial
self-review) have **not** been started.

**Tests currently passing/failing:**
- Unit (`npm test`): **112/112 passing** — adds 9 new logging tests: `resolveRequestId` (reuse a
  supplied header, generate when absent/empty/whitespace, first-value-of-array, uniqueness across
  calls) and `createPinoHttpOptions` (log level from config, `genReqId` reuse+response-header
  behavior, serializers expose `id`/`method`/`url`/`statusCode` and nothing else — including `id`,
  added after mistake #7 below was fixed).
- Integration (`npm run test:integration`, real Postgres, `--runInBand`): **44/44 passing**,
  unchanged (logging is an HTTP-layer/bootstrap concern, not exercised by these repository-level
  tests).
- E2E (`npm run test:e2e`, real Postgres, `--runInBand`): **64/64 passing** — adds 2 new focused
  request-id contract tests (generates+returns one when absent, reuses a client-supplied one) to
  the existing health e2e file, without duplicating any per-endpoint API test.

**Build/lint/format status:**
- `npm run build`: clean, `dist/main.js` at the correct path.
- `npm run lint`: 0 errors, 0 warnings.
- `npx prettier --check`: clean.

**Docker status:** Rebuilt on the new `node:22-slim` base (required, not optional — the build
itself proves the Node bump works) and manually verified: `GET /health` (200, `x-request-id`
header present, structured JSON logs), valid `POST /workouts`, a validation 400, and a malformed-
cursor 400 — all logged at info level with method/url/statusCode/responseTime/request-id, never as
errors. A **real** unexpected 500 was triggered by stopping the Postgres container mid-request
(not a throwaway test endpoint): client got a clean generic 500 with zero leaked internals, while
the server log carried the full `PrismaClientKnownRequestError` stack, correlated by request id
with pino-http's own per-request outcome log. Postgres was restarted and recovery confirmed, then
all four existing endpoints (`POST /workouts`, `GET /workouts`, `GET /workouts/prs`,
`GET /workouts/prs/compare`) regression-checked — no response-contract changes. Stack torn down
(`docker compose down`) at the end; volume preserved.

**Database status:** Same Postgres volume as previous checkpoints, now also containing this
checkpoint's manual-verification data (`log-user`) — harmless, dev-only, left in place.

**Latest commit:** `a043d03` — `chore: add structured request logging` (this `AI_WORKFLOW.md`
update will be its own commit immediately after being written).

**Working tree status:** Clean prior to this update, verified via `git status` before committing.

**Known issues:** Unchanged from the last checkpoint (transitive `npm audit` advisories in
unreachable code paths; host port 5432→5433 remap; `--runInBand` on the integration/e2e npm
scripts) **plus one new, permanent, evidence-based change**: the Docker base image and
`package.json` `engines` field now require Node >=22 (was >=20) — not a regression, a real
requirement of the logging library actually installed, to be called out explicitly in the README
so it isn't mistaken for an arbitrary version bump.

**Unresolved decisions:** None blocking.

**Outstanding assignment requirement:** unchanged — the genuine rejected-AI-suggestion
requirement is still treated as satisfied only by the one real Step 0 example. No genuine
rejection occurred this checkpoint; none was invented.

**Architecture deviations:**
1. (Carried forward) Step 4's flat conversion-factor registry vs. `ARCHITECTURE.md` §12's
   per-class description — to reconcile at the README step.
2. (Carried forward) `POST /workouts`'s full-entry response shape, not specified in
   `ARCHITECTURE.md` — to reconcile at the README step.
3. (Carried forward) Step 8 used Prisma's query builder instead of `ARCHITECTURE.md` §6/§8's
   raw-SQL framing for trigram search and keyset pagination — to reconcile at the README step.
4. (Carried forward, not really a deviation) Step 9's raw-SQL PR query matches `ARCHITECTURE.md`
   §5.3 closely — the step where raw SQL turned out correct and necessary, the mirror image of #3.
5. (Carried forward, not really a deviation) Step 10's route matches `ARCHITECTURE.md` §1's
   original sketch exactly.
6. (New) Node runtime requirement bumped from >=20 to >=22.12, and the Dockerfile's base image
   from `node:20-slim` to `node:22-slim` — a real, externally-imposed requirement (nestjs-pino v5),
   not a design choice revisited; to document in the README's setup/requirements section.

**Exact next implementation step:** `docs/IMPLEMENTATION_PLAN.md` **Step 12 — Seed script for
scale testing + `EXPLAIN ANALYZE` verification**: generate 50,000+ `WorkoutEntry`/`WorkoutSet`
rows for one synthetic user, including a worst-case single-exercise concentration scenario (per
`ARCHITECTURE.md` §5.2's corrected, unverified cost model), then run and record real
`EXPLAIN ANALYZE` output for history filtering, partial-match search, muscle-group filtering, PR
queries (including the worst-case concentration), and pagination at depth — in
`docs/PERFORMANCE_NOTES.md`. This is the step where every performance claim flagged as
"unverified" throughout `ARCHITECTURE.md` since Phase 3 finally gets checked against a real query
planner, not assumed correct from index design alone.

**Files/modules likely to be touched next:** new `scripts/seed-scale-test.ts`, new
`docs/PERFORMANCE_NOTES.md`, and likely corrections to `docs/ARCHITECTURE.md` itself if any claim
turns out wrong under real `EXPLAIN ANALYZE` output — per that document's own "open items carried
forward" note, this is expected to possibly happen, not a sign something went wrong if it does.
against real query plans rather than remaining documented-but-unverified assumptions.
