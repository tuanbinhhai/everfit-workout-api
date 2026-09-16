// Mirrors the MAX_BULK_ENTRIES/MAX_PAGE_SIZE env defaults
// (docs/CLARIFICATIONS.md #16). class-validator decorators are evaluated at
// class-definition time, so these are static ceilings rather than wired to
// runtime ConfigService — keeping DTO validation free of DI complexity, per
// the approved design. The actual default page size (as opposed to this
// ceiling) is read from ConfigService in WorkoutsService, since that's a
// plain service, not a validator.
export const MAX_BULK_ENTRIES = 100;
export const MAX_PAGE_SIZE = 100;
