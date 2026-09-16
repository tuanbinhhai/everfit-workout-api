import type { IncomingMessage } from 'http';
import { resolveRequestId } from './resolve-request-id';

function fakeRequest(headers: Record<string, string | string[] | undefined>) {
  return { headers } as unknown as IncomingMessage;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('resolveRequestId', () => {
  it('reuses a client-supplied x-request-id header', () => {
    const id = resolveRequestId(
      fakeRequest({ 'x-request-id': 'client-supplied-id-123' }),
    );
    expect(id).toBe('client-supplied-id-123');
  });

  it('generates a new id when no header is present', () => {
    const id = resolveRequestId(fakeRequest({}));
    expect(id).toMatch(UUID_PATTERN);
  });

  it('generates a new id when the header is an empty string', () => {
    const id = resolveRequestId(fakeRequest({ 'x-request-id': '' }));
    expect(id).toMatch(UUID_PATTERN);
  });

  it('generates a new id when the header is only whitespace', () => {
    const id = resolveRequestId(fakeRequest({ 'x-request-id': '   ' }));
    expect(id).toMatch(UUID_PATTERN);
  });

  it('takes the first value when the header is supplied multiple times', () => {
    const id = resolveRequestId(
      fakeRequest({ 'x-request-id': ['first-id', 'second-id'] }),
    );
    expect(id).toBe('first-id');
  });

  it('generates a different id on each call when none is supplied', () => {
    const first = resolveRequestId(fakeRequest({}));
    const second = resolveRequestId(fakeRequest({}));
    expect(first).not.toBe(second);
  });
});
