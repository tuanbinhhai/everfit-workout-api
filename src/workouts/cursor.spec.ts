import { decodeCursor, encodeCursor, InvalidCursorError } from './cursor';

describe('cursor', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a valid cursor', () => {
      const cursor = { date: '2026-09-15', id: '123' };
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    });

    it('produces a URL-safe opaque string with no padding characters', () => {
      const encoded = encodeCursor({ date: '2026-09-15', id: '123' });
      expect(encoded).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor error handling', () => {
    it('rejects malformed base64/garbage input', () => {
      expect(() => decodeCursor('not-a-valid-cursor!!!')).toThrow(
        InvalidCursorError,
      );
    });

    it('rejects a base64-valid but non-JSON payload', () => {
      const notJson = Buffer.from('this is not json', 'utf8').toString(
        'base64url',
      );
      expect(() => decodeCursor(notJson)).toThrow(InvalidCursorError);
    });

    it('rejects a payload missing date', () => {
      const encoded = Buffer.from(
        JSON.stringify({ id: '123' }),
        'utf8',
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(InvalidCursorError);
    });

    it('rejects a payload missing id', () => {
      const encoded = Buffer.from(
        JSON.stringify({ date: '2026-09-15' }),
        'utf8',
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(InvalidCursorError);
    });

    it('rejects an invalid date in an otherwise well-formed payload', () => {
      const encoded = Buffer.from(
        JSON.stringify({ date: '2026-02-30', id: '123' }),
        'utf8',
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(InvalidCursorError);
    });

    it('rejects a non-numeric id', () => {
      const encoded = Buffer.from(
        JSON.stringify({ date: '2026-09-15', id: 'abc' }),
        'utf8',
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(InvalidCursorError);
    });

    it('rejects a JSON array instead of an object', () => {
      const encoded = Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString(
        'base64url',
      );
      expect(() => decodeCursor(encoded)).toThrow(InvalidCursorError);
    });

    it('does not leak parser internals in the error message', () => {
      expect(() => decodeCursor('not-a-valid-cursor!!!')).toThrow(
        'Invalid pagination cursor',
      );
    });
  });
});
