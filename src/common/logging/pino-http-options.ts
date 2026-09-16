import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER, resolveRequestId } from './resolve-request-id';

// Deliberately minimal serializers: only method/url and statusCode are ever
// logged for a request — never headers, query params, or bodies. This is a
// stronger guarantee against leaking sensitive data than a redact list,
// since there is nothing else in the serialized shape to redact.
export function createPinoHttpOptions(config: ConfigService): Params {
  return {
    pinoHttp: {
      level: config.get<string>('logLevel', 'info'),
      genReqId: (req, res) => {
        const id = resolveRequestId(req);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      serializers: {
        // `req.id` is bound by pino-http from genReqId above — must be
        // included explicitly here, since providing a custom `req`
        // serializer replaces pino-http's default shape (which normally
        // includes it) rather than extending it.
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({
          statusCode: res.statusCode,
        }),
      },
    },
  };
}
