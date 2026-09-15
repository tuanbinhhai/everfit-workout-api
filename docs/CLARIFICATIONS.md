# Clarifications & Assumptions — Workout Logging API

The assignment does not fully specify every behavior. Rather than block on these, each item below
records the question, why it matters, the options considered, and the **recommended assumption**
that implementation will proceed with. All assumptions are chosen to be simple, defensible, and
easy to explain in the video walkthrough. If any assumption should change, ping before Phase 3
(architecture) is finalized — changing them later is more expensive.

Legend: 🅰 = assumption locked in for implementation unless corrected.

---

## 1. REST endpoint design

**Question:** What are the exact routes/methods?

**Why it matters:** Sets the shape of controllers, DTOs, and the README API docs.

**Options:** Resource-per-concern (`/workouts`, `/workouts/history`, `/workouts/prs`) vs. nesting under user (`/users/:userId/workouts`).

🅰 **Assumption:** `userId` is passed as a query/body parameter (per assignment: "no auth required — pass userId as a parameter"), not as a path segment implying ownership/auth. Routes:
- `POST /workouts` — create one or bulk (body distinguishes single object vs `{ entries: [...] }`, see §6)
- `GET /workouts?userId=...&exerciseName=...&from=...&to=...&muscleGroup=...&unit=...&cursor=...&limit=...`
- `GET /workouts/prs?userId=...&exerciseName=...&unit=...`
- `GET /workouts/prs/compare?userId=...&exerciseName=...&currentFrom=...&currentTo=...&previousFrom=...&previousTo=...`

**Impact if wrong:** Route/DTO rename only — low cost to change later.

**Status:** Confirmed as-is. Routes stay as listed unless `docs/ARCHITECTURE.md` surfaces a compelling technical reason to change them — naming churn for its own sake is avoided.

---

## 2. Meaning of `date` — calendar day or timestamp?

**Why it matters:** Affects schema type (`date` vs `timestamptz`), date-range filter inclusivity, and timezone handling.

**Options:**
(a) `date` is a calendar day the workout happened on (no time-of-day semantics), client sends `YYYY-MM-DD`.
(b) `date` is a full timestamp of when the workout was logged/performed.

🅰 **Assumption (revised):** `date` is a **business calendar date**, not an instant in time.
- Accepted request format: `YYYY-MM-DD` only. An ISO datetime (e.g. `2026-09-15T23:00:00-05:00`) is **rejected as a validation error**, not silently truncated/converted — silently converting through UTC could shift the date the user actually intended to log (e.g. a datetime with an offset could round to the wrong calendar day). If the client wants "the current day," it must compute that day itself and send the plain date.
- Storage: PostgreSQL `DATE` column. No timezone conversion is applied to this field at all — it is stored and compared exactly as received.
- `createdAt` / `updatedAt` (record metadata, not business data) remain `timestamptz`, stored and generated in UTC by the database, since they represent actual instants and are not what the user is reasoning about.
- Documented as a known limitation: this model assumes "workout day" is unambiguous once the client has decided it, with no per-user timezone stored. If exact workout time-of-day and user-local timezone become real requirements, the future extension is a `performedAt timestamptz` field **plus** a stored user timezone, added alongside (not replacing) `date`.

This matches how fitness apps typically track "workout day" rather than exact logging time, and avoids ambiguous same-day-but-different-time PR ties.

**Impact if wrong:** If exact time-of-day matters (e.g., two sessions same day), the `performedAt` + user-timezone extension described above would be added. Moderate cost — additive, doesn't require redefining `date`.

---

## 3. Timezone strategy

**Why it matters:** Explicitly called out in the assignment as requiring documentation.

**Options:**
(a) Treat `date` as a pure business calendar date with no timezone conversion; only record-metadata timestamps (`createdAt`/`updatedAt`) are UTC instants.
(b) Store and filter workout `date` itself in UTC, converting any client-supplied offset server-side.
(c) Accept a client timezone/offset and shift server-side.

🅰 **Assumption (revised):** **(a)** — the workout `date` field and the "UTC storage" strategy are two different concerns, kept separate:
- **Business date (`date`)**: no UTC conversion. Accepted as `YYYY-MM-DD`, stored as `DATE`, compared as plain calendar dates. The assignment's "UTC storage recommended" guidance is applied to *timestamps*, not to a field that was never a timestamp to begin with — converting a calendar date through a timezone is what introduces the off-by-one-day bug, so it's deliberately avoided.
- **Instants (`createdAt`, `updatedAt`)**: stored as `timestamptz` in UTC, per the assignment's recommendation, since these genuinely are points in time (when the row was written/modified).
- Filtering: `from`/`to` for history queries are plain calendar dates, range inclusive on both ends, compared directly against the `DATE` column — no timezone math involved.
- Response: `date` returned as `YYYY-MM-DD`; `createdAt`/`updatedAt` returned as ISO-8601 UTC instants.
- **Trade-off documented in README:** without a stored user timezone, "today" is defined by whatever calendar date the client sends — the API has no independent way to validate that a submitted date matches the user's actual local day. This is intentional simplicity for this assignment's scope; the `performedAt` + user-timezone extension (§2) is the documented upgrade path if that guarantee is later required.

**Impact if wrong:** Low-moderate — the business-date/instant split is a clean boundary; adding user-timezone-aware validation later is additive on top of it, not a rework.

---

## 4. Duplicate logging / idempotency

**Why it matters:** Assignment calls out "concurrent writes: same user logging same exercise at same time" as a required edge case.

**Options:**
(a) No deduplication — every POST creates a new row; concurrency is only about not corrupting data (DB handles concurrent inserts natively), not about detecting "duplicate" business events.
(b) Idempotency key required per request to dedupe retries.

🅰 **Assumption:** **(a)** — concurrent identical requests are treated as legitimate concurrent writes (e.g., two separate sets logged coincidentally at the same moment are valid data, not a bug). The system guarantees correctness (no lost updates, no partial rows, DB-level atomicity per entry/bulk request) but does **not** attempt to detect or reject "duplicate" business-level requests. Idempotency-key support is documented in README as a **future production enhancement** (e.g., client-supplied `Idempotency-Key` header + dedup table), out of scope for this assignment.

**Impact if wrong:** If dedup is actually required, this needs an idempotency-key mechanism — additive, doesn't break existing design.

---

## 5. Bulk request atomicity

**Why it matters:** "Support bulk logging: multiple exercises in a single request" doesn't say what happens if one exercise in the batch is invalid.

**Options:**
(a) All-or-nothing: whole request rejected (400) if any entry fails validation.
(b) Partial success: valid entries are created, invalid ones reported individually (207-style or 201 + per-item errors).

🅰 **Assumption:** **(a) All-or-nothing**, executed as a single DB transaction. This is simpler to reason about, avoids partial-state confusion for the coach ("did my 3 valid exercises save or not?"), and is easier to make correct under the assignment's time constraints. The 400 response lists validation errors per array index so the client can pinpoint the bad entry.

**Impact if wrong:** If partial-success is actually desired, this is a moderate rework of the bulk endpoint's transaction handling and response shape.

---

## 6. Bulk vs single endpoint shape

**Why it matters:** Whether `POST /workouts` always takes an array, or there's a separate `POST /workouts/bulk`.

🅰 **Assumption:** Single endpoint `POST /workouts` accepts `{ entries: WorkoutEntryInput[] }` (an array, even for one entry). This avoids maintaining two parallel code paths/DTOs for what is functionally the same operation, and matches "support bulk logging" as the general case. README documents that a single log is just `entries` with length 1.

**Impact if wrong:** Low — could add a convenience single-entry alias endpoint later without breaking the bulk one.

---

## 7. Definition of "single set" for max weight / volume

**Why it matters:** PR calculation must operate over the correct granularity.

🅰 **Assumption:** A "set" is one `{reps, weight, unit}` element within one workout entry's `sets` array. Max weight = max `weightKg` across all sets ever logged for that user+exercise. Max volume = max `(reps × weightKg)` for a single set (not summed across a whole session). This matches standard strength-training PR definitions and the assignment's explicit "heaviest single set" / "highest volume set" wording.

**Impact if wrong:** Low — calculation function is isolated and unit-tested; redefinition is a small change.

---

## 8. PR comparison response shape

**Why it matters:** "Support comparing PRs across a time range" is described only by example ("this month vs last month"), not by exact response shape.

**Options:**
(a) Return the full PR object computed independently for each range, side by side.
(b) Return (a) plus a computed delta (absolute + %) between the two ranges' PRs.

🅰 **Assumption:** **(a) + delta** — response includes `current` (PR object for range 1), `previous` (PR object for range 2), and `delta` (difference in kg and % for each metric: maxWeight, maxVolume, best1RM). This directly answers "PR this month vs last month" without forcing the client to compute deltas itself, while still keeping both raw PR objects for transparency. Date ranges are caller-supplied (not hardcoded to calendar month), so "this month vs last month" is just one instance of a general two-range comparison.

**Impact if wrong:** Low — additive field, doesn't break either present component.

---

## 9. Date range inclusivity

🅰 **Assumption:** `from` and `to` are both **inclusive**. Matches typical user expectation of "show me workouts from Jan 1 to Jan 31" including both endpoints.

**Impact if wrong:** Trivial one-line query change.

---

## 10. Output unit parameter behavior

**Why it matters:** History and PR endpoints must "return in the unit the user specifies."

🅰 **Assumption:** Optional `unit` query param (`kg` or `lb`). If omitted, defaults to `kg` (the normalized/canonical unit) rather than the unit each entry was originally logged in — this keeps a list response internally consistent (all rows in the same unit) rather than mixed. If provided, all weight fields in the response are converted to that unit; the **original** logged `{weight, unit}` is still included per set for transparency/audit.

**Impact if wrong:** Low — conversion is applied at the response-mapping layer, not stored.

---

## 11. Precision / rounding strategy

**Why it matters:** kg↔lb conversion is not exact; repeated conversion can drift; assignment lists this implicitly under "invalid or unsupported weight units" / data correctness.

🅰 **Assumption (revised):**
- Conversion factor: `1 lb = 0.45359237 kg` (exact international avoirdupois pound).
- Stored `weightKg` is **not rounded to 2 decimal places**. It is stored at full precision using `NUMERIC(10,4)` in PostgreSQL — justified in `docs/ARCHITECTURE.md` (4 decimal places comfortably absorbs the repeating-decimal error from lb→kg conversion, e.g. `1 lb = 0.4536 kg` to 4dp, without accumulating visible drift across repeated PR/volume calculations; `NUMERIC` rather than `FLOAT`/`DOUBLE` avoids binary floating-point rounding error entirely).
- Conversions are always computed **from the stored canonical kg value**, never lb→lb via a round trip, to avoid drift.
- PR / volume / 1RM calculations are performed using the full-precision stored value, not a display-rounded one, so aggregated results (max, sum, comparisons) aren't skewed by early rounding.
- Rounding to 2 decimal places happens **only at the API response/display boundary**, applied to whatever unit is being returned (kg or lb) — stored precision is never touched.

**Impact if wrong:** Low — isolated in the conversion module and the response-mapping layer; only the column's numeric scale would need adjusting.

---

## 12. Exercise identity — free text vs canonical entity

**Why it matters:** Determines whether `exerciseName` is just a string column or a foreign key to an `exercises` table, which affects muscle-group filtering and partial-match search.

**Options:**
(a) `exerciseName` stored as free-text string on the workout entry; muscle group resolved via a separate lookup/config keyed by normalized exercise name (best-effort match).
(b) `exerciseName` is a required foreign key to a canonical `exercises` table; muscle group is always known.

🅰 **Assumption:** **(a)** — the assignment explicitly says muscle-group filtering applies "if exercise metadata is available," implying free-text names are expected and metadata coverage is partial/best-effort. `exerciseName` is stored as-is (trimmed) on the entry. A separate configurable `exercise_muscle_group` mapping table (seeded with common exercises) is consulted for muscle-group filtering; unmapped exercises are simply excluded from muscle-group-filtered results (not an error) and are noted in README as a known limitation. This directly satisfies "exercise → muscle group mapping should be configurable (not hardcoded)."

**Impact if wrong:** Moderate — if a canonical entity is actually required (e.g. FK constraint, exercise CRUD), this becomes a bigger schema change. Flagged as the single biggest structural assumption in this document.

---

## 13. Partial-match case sensitivity

🅰 **Assumption:** Partial match on `exerciseName` is **case-insensitive substring match** (e.g. `bench` matches `Bench Press`, `Incline Bench Press`). This is the expected UX for a search box and is simple with `ILIKE`/`LOWER()` (Postgres) or a case-insensitive regex/text index (Mongo).

**Impact if wrong:** Trivial query change.

---

## 14. Muscle-group filtering against historical data if mapping changes

**Why it matters:** If the muscle-group config is edited later, should past entries "retroactively" reflect the new mapping?

🅰 **Assumption:** Muscle-group mapping is **resolved at query time**, not stored per entry. So yes — editing the config changes how historical entries are classified going forward, consistently. This is the natural consequence of keeping the mapping external/configurable (§12) rather than denormalizing it onto each entry, and it's explicitly what "configurable, not hardcoded" implies.

**Impact if wrong:** If point-in-time mapping snapshots are required instead, this needs a denormalized `muscleGroup` field captured at write time — moderate change.

---

## 15. Pagination style: offset vs cursor

**Why it matters:** Assignment allows either; needs to perform at 50,000+ entries per user.

🅰 **Assumption:** **Cursor-based pagination** for the history endpoint (opaque cursor encoding `(date, id)` of the last row seen), because it performs consistently at scale (no `OFFSET N` scan cost as N grows) and avoids skipped/duplicated rows under concurrent inserts. `limit` is client-supplied, capped server-side (default 20, max 100). README documents this choice explicitly since the assignment allows offset too.

**Impact if wrong:** Moderate — offset pagination is simpler to swap to if reviewers prefer it, but cursor is the more defensible "production readiness" choice, so this is treated as a firm default.

---

## 16. Maximum page size / bulk size

🅰 **Assumption:**
- History pagination: `limit` default 20, max 100 (reject/clamp above that).
- Bulk logging: cap of 100 entries per request (documented, returns 400 if exceeded) to bound request size and transaction duration.

**Impact if wrong:** Trivial constant change.

---

## 17. Empty-result response shape

**Why it matters:** Assignment explicitly requires "return empty result with appropriate message, not an error."

🅰 **Assumption (revised):** HTTP 200 with the normal response envelope, an empty `data` array, pagination metadata (`nextCursor: null`, `hasMore: false`), **and** a concise `message` field explaining the empty result, per the assignment's explicit wording. Example:
```json
{
  "data": [],
  "pagination": { "nextCursor": null, "hasMore": false },
  "message": "No workout entries found for the specified criteria."
}
```
For the PR endpoint specifically (single-object response, not a list), a `hasData: false` flag with null metric fields is returned, paired with a similar message (e.g. `"No workout data found for this user and exercise."`). Never returned as an HTTP error status.

**Impact if wrong:** Trivial response-shape tweak.

---

## 18. Error response schema

🅰 **Assumption:** Consistent structured error body across all endpoints:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Human-readable summary",
  "details": [
    { "field": "entries[0].sets[1].weight", "issue": "must be a positive number" }
  ],
  "timestamp": "2026-09-15T12:00:00.000Z",
  "path": "/workouts"
}
```
Implemented via a single NestJS global exception filter + `class-validator` DTOs, so every endpoint gets this shape for free rather than hand-rolled per-controller error handling.

**Impact if wrong:** Low — filter is centralized, easy to reshape.

---

## 19. Zero reps / zero weight validity

🅰 **Assumption:** `reps` must be a **positive integer** (≥1); `weight` must be a **non-negative number** (≥0, allowing bodyweight-style 0kg entries for e.g. bodyweight squats logged as 0 external weight, but rejecting negative values). Both are explicitly required by the assignment's "negative weight/reps" edge case; zero-reps is rejected as meaningless (a set with 0 reps didn't happen), zero-weight is allowed as a legitimate bodyweight case.

**Impact if wrong:** Trivial validator constant change.

---

## 20. Database choice: PostgreSQL vs MongoDB

**Why it matters:** Assignment requires justification either way; affects entire schema/index design (deferred in full to `docs/ARCHITECTURE.md`).

🅰 **Assumption (preliminary, expanded in ARCHITECTURE.md):** **PostgreSQL.** Rationale to be fully justified in Phase 3, but the short version: workout entries + sets are naturally relational (one-to-many, fixed shape), PR aggregation is a numeric aggregation query (`MAX`, computed `1RM`) that benefits from mature SQL aggregate/window function support and B-tree/composite indexes, and strong consistency for concurrent writes to the same user's history is simpler to reason about with ACID transactions than with MongoDB's eventual-consistency-flavored patterns (though Mongo now supports multi-document transactions too). This is a preliminary assumption pending the full comparison in `docs/ARCHITECTURE.md`.

**Impact if wrong:** High — this is a foundational choice. It is being flagged now, before Phase 3, specifically so it can be revisited before schema work begins.

---

## Summary table

| # | Topic | Assumption | Risk if wrong |
|---|---|---|---|
| 1 | Routes | userId as query/body param, resource-based routes — **confirmed** | Low |
| 2 | `date` meaning | Business calendar date, no UTC conversion — **revised** | Low |
| 3 | Timezone | `date` untouched; only `createdAt`/`updatedAt` are UTC `timestamptz` — **revised** | Low-Moderate |
| 4 | Idempotency | None; documented as future work | Low |
| 5 | Bulk atomicity | All-or-nothing transaction | Moderate |
| 6 | Bulk shape | Single `POST /workouts` with `entries[]` | Low |
| 7 | "Single set" | One array element; max volume per-set not per-session | Low |
| 8 | PR comparison shape | current + previous + delta | Low |
| 9 | Date range inclusivity | Inclusive both ends | Trivial |
| 10 | Output unit default | kg if unspecified | Low |
| 11 | Precision | Full precision `NUMERIC(10,4)` stored, no rounding until response — **revised** | Low |
| 12 | Exercise identity | Free text + external mapping table | **Moderate–High** |
| 13 | Partial match | Case-insensitive substring | Trivial |
| 14 | Muscle group history | Resolved at query time (not snapshotted) | Moderate |
| 15 | Pagination | Cursor-based | Moderate |
| 16 | Page/bulk size caps | 20/100 history, 100 bulk | Trivial |
| 17 | Empty result shape | 200 + empty array + explicit `message` — **revised** | Trivial |
| 18 | Error shape | Standard structured error envelope | Low |
| 19 | Zero reps/weight | reps ≥1, weight ≥0 | Trivial |
| 20 | Database | PostgreSQL (full justification in ARCHITECTURE.md) | High |

Items #12 and #20 remain the two most structurally significant assumptions. Items #2, #3, #11, #17 were revised per explicit review before Phase 3; #1 was reviewed and confirmed unchanged.
