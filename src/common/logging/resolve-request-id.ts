import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Reuses a client-supplied x-request-id when present (so a caller's own
// trace id survives into our logs), otherwise generates one — every
// response carries the resolved id via the same header so a caller can
// always correlate their request with server-side logs.
export function resolveRequestId(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const supplied = Array.isArray(header) ? header[0] : header;
  return supplied && supplied.trim().length > 0 ? supplied : randomUUID();
}
