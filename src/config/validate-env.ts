export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const port = Number(env.PORT ?? 3000);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${String(env.PORT)}`);
  }

  const defaultPageSize = Number(env.DEFAULT_PAGE_SIZE ?? 20);
  const maxPageSize = Number(env.MAX_PAGE_SIZE ?? 100);
  if (
    Number.isNaN(defaultPageSize) ||
    Number.isNaN(maxPageSize) ||
    defaultPageSize <= 0 ||
    maxPageSize <= 0 ||
    defaultPageSize > maxPageSize
  ) {
    throw new Error(
      'DEFAULT_PAGE_SIZE must be a positive number not exceeding MAX_PAGE_SIZE',
    );
  }

  const maxBulkEntries = Number(env.MAX_BULK_ENTRIES ?? 100);
  if (Number.isNaN(maxBulkEntries) || maxBulkEntries <= 0) {
    throw new Error('MAX_BULK_ENTRIES must be a positive number');
  }

  return env;
}
