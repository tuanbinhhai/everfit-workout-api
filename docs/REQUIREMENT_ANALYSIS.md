# Requirement Analysis — Workout Logging API

Source of truth: `Everfit_Test for Backend Engineer.pdf` (referred to as "the assignment" below).
Workflow reference: `CLAUDE_EVERFIT_MASTER_PROMPT.md`.

This document enumerates what the assignment explicitly asks for. It does not resolve ambiguity —
open questions and assumptions are in `docs/CLARIFICATIONS.md`.

---

## 1. Functional requirements

### 1.1 Log a workout entry

- [ ] Create a workout entry with: `userId`, `date`, `exerciseName`, `sets` (array of `{ reps, weight, unit }`)
- [ ] Supported weight units at launch: `kg`, `lb`
- [ ] Each set stores the original `{weight, unit}` **and** a normalized `weightKg` value
- [ ] Support **bulk logging**: multiple exercises (i.e. multiple workout entries) in a single request

### 1.2 Get workout history

- [ ] List workout entries for a given `userId`
- [ ] Filter by exercise name, **partial match** supported
- [ ] Filter by date range
- [ ] Filter by muscle group, *if exercise metadata is available*
- [ ] Response weights are returned in a **unit the caller specifies**, converting stored values as needed
- [ ] Results are **paginated** — cursor-based or offset-based (assignment allows either)

### 1.3 Get personal records (PRs)

For a given `userId` + `exerciseName`, return:

- [ ] Heaviest single set (max weight across all sets)
- [ ] Highest volume set (max of `reps × weight` for a single set)
- [ ] Best estimated 1RM using Epley formula: `weight × (1 + reps / 30)`
- [ ] The **date each PR was achieved**, for each of the three metrics above
- [ ] Support **comparing PRs across a time range** (e.g. "PR this month vs last month")

---

## 2. Non-functional requirements

| Area | Requirement |
|---|---|
| Scale | Endpoints must perform well with **50,000+ workout entries per user** |
| Concurrency | Must handle same user logging same exercise at the same time without corruption |
| Timezone | Strategy must be documented; **UTC storage recommended**, trade-offs to be explained |
| Extensibility — units | Adding a new unit (e.g. `stone`) should require **minimal code changes** |
| Extensibility — muscle groups | Exercise → muscle group mapping must be **configurable**, not hardcoded in business logic |
| Stack | NodeJS; **NestJS recommended** (justify if different) |
| Database | MongoDB **or** PostgreSQL, with justification, schema design, and indexing strategy |
| Auth | None — `userId` passed as a plain parameter |
| Errors | Structured, graceful error responses (see §3) |
| Testing | Unit tests for calculations, integration tests for endpoints; **test design valued over coverage %** |
| Production readiness | Docker setup, structured logging, configuration management, demonstrated performance awareness |
| AI workflow | Must produce `AI_WORKFLOW.md` documenting tool usage, ≥2 corrected AI mistakes, ≥1 rejected AI suggestion, prompting strategy |
| Git history | Iterative commits with meaningful messages, showing review of AI-generated code |

---

## 3. Edge cases & error handling (explicitly named in the assignment)

- [ ] Invalid or unsupported weight unit
- [ ] Missing or malformed request fields: null date, negative weight, negative reps, empty `sets` array
- [ ] Date range with no matching data → **empty result with a message, not an error** (i.e. still HTTP 200)
- [ ] Timezone handling documented (UTC storage recommended)
- [ ] Concurrent writes: same user logging same exercise at the same time
- [ ] Large datasets: 50,000+ entries per user, endpoints must stay performant

### Additional edge cases implied by the above (to cover for completeness)

- [ ] Zero reps / zero weight — valid or invalid?
- [ ] Non-integer reps, non-numeric weight
- [ ] Duplicate sets within one request
- [ ] Bulk request where one exercise entry is invalid — reject whole batch or partial success?
- [ ] Exercise name casing/whitespace in partial match (`"bench"` vs `"Bench Press"`)
- [ ] Exercise with no muscle-group mapping configured
- [ ] Date range where `from > to`
- [ ] Pagination cursor/offset out of bounds
- [ ] Very large `sets` array in a single entry (abuse/perf)
- [ ] Floating point precision when converting kg ↔ lb repeatedly

---

## 4. Architecture & extensibility requirements (explicit)

- [ ] Unit conversion must be abstracted so a new unit type requires minimal changes (not `if/else` scattered across services)
- [ ] Exercise → muscle group mapping must be configurable (e.g. a data table / config provider), not hardcoded in service logic

---

## 5. Technical constraints (explicit)

- [ ] NodeJS runtime
- [ ] NestJS recommended; another framework requires justification
- [ ] Database: PostgreSQL or MongoDB, justified
- [ ] AI coding tools encouraged and must be documented
- [ ] No authentication; `userId` passed as a parameter (query param, path param, or body field depending on endpoint)

---

## 6. Deliverables (explicit)

1. GitHub repository, clean iterative commit history
2. `README.md`: architecture overview (+diagram), setup (`docker compose up` or clear steps), API docs, DB schema + design decisions, trade-offs / what changes at scale
3. `AI_WORKFLOW.md`: tools + purpose, ≥2 corrected AI mistakes, ≥1 rejected suggestion, prompting strategy
4. Video walkthrough (15–20 min, English): architecture, full API demo incl. edge cases, AI workflow walkthrough, line-by-line explanation of one AI-generated piece, scaling discussion for 10,000 concurrent coaches
5. Time estimate provided **before** starting implementation

---

## 7. Acceptance criteria (testable)

### Workout logging
- AC1: `POST` with valid single entry (userId, date, exerciseName, ≥1 set) returns 201 with the created entry, including `weightKg` computed per set.
- AC2: `POST` with multiple entries in one request (bulk) creates all of them and returns all created entries.
- AC3: `POST` with an unsupported unit (e.g. `"stone"` before it's added) returns a 400 with a structured error identifying the invalid field.
- AC4: `POST` with negative weight or negative reps returns 400.
- AC5: `POST` with empty `sets` array returns 400.
- AC6: `POST` with null/missing `date` returns 400.
- AC7: Two identical requests for the same user/exercise/time sent concurrently both persist correctly (no lost update, no crash, no duplicate corruption) — exact semantics documented in CLARIFICATIONS.

### Workout history
- AC8: `GET` history for a user returns entries sorted by date (documented order), paginated.
- AC9: Filtering by partial exercise name (case-insensitive) returns only matching entries.
- AC10: Filtering by date range returns only entries within `[from, to]`.
- AC11: Filtering by muscle group returns only entries whose exercise maps to that muscle group.
- AC12: Requesting `unit=lb` converts all returned weights to lb (from stored kg) without mutating stored data.
- AC13: A date range with no matching entries returns HTTP 200 with an empty array and no error.
- AC14: Pagination parameters (cursor or offset+limit) behave correctly at boundaries (first page, last page, beyond last page).
- AC15: History endpoint stays responsive (documented target, e.g. < 200ms server-side) against a seeded dataset of 50,000+ entries for one user.

### Personal records
- AC16: PR endpoint for user+exercise returns max weight, max volume, best 1RM, each with the date achieved.
- AC17: PR calculations use normalized kg internally so mixed-unit history (some sets logged in lb, some in kg) produces unit-correct results.
- AC18: PR response can be converted to a requested display unit.
- AC19: PR comparison across two time ranges (e.g. this month vs last month) returns both ranges' PRs (or a delta — see CLARIFICATIONS) in one response.
- AC20: PR request for a user/exercise with no data returns a 200 with an explicit "no data" shape, not an error.

### Extensibility
- AC21: Adding a new unit (e.g. `stone`) requires changes in one conversion module only (documented in README), not across controllers/services.
- AC22: Exercise → muscle group mapping can be changed (e.g. edit a config/table) without modifying any service/controller code.

### Production readiness
- AC23: `docker compose up` brings up the API and database with no manual steps beyond documented env vars.
- AC24: Errors follow one consistent JSON error shape across all endpoints.
- AC25: Structured (JSON) logs are emitted for requests and errors.

---

## 8. Explicitly out of scope (per assignment)

- Authentication / authorization (userId passed as plain parameter)
- Anything not named in Core Features, Edge Cases, Architecture & Extensibility, or Technical Constraints sections of the assignment — treated as ambiguous and deferred to `docs/CLARIFICATIONS.md` rather than assumed silently.
