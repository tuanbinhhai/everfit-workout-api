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

This section will keep growing as later implementation steps land.
