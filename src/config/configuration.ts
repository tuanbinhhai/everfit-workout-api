export interface AppConfig {
  port: number;
  logLevel: string;
  databaseUrl: string;
  pagination: {
    defaultPageSize: number;
    maxPageSize: number;
  };
  maxBulkEntries: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? '',
  pagination: {
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE ?? '20', 10),
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE ?? '100', 10),
  },
  maxBulkEntries: parseInt(process.env.MAX_BULK_ENTRIES ?? '100', 10),
});
