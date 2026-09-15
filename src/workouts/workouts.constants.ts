// Mirrors the MAX_BULK_ENTRIES env default (docs/CLARIFICATIONS.md #16).
// class-validator decorators are evaluated at class-definition time, so this
// is a static ceiling rather than wired to runtime ConfigService — keeping
// DTO validation free of DI complexity, per the approved design.
export const MAX_BULK_ENTRIES = 100;
