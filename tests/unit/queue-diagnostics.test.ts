import { describe, expect, it } from 'vitest';
import { ApiError, readJson } from '../../web/src/lib/http';
import { classifyFailure, readSyncResult } from '../../web/src/lib/sync-result';

describe('queue diagnostics', () => {
  it.each([
    [401, 'unauthorized', 'auth'], [403, 'must_change_password', 'password'], [403, 'origin', 'denied'],
    [409, 'sheet_changed', 'sheet'], [409, 'schema_mismatch', 'schema'], [409, 'deleted_expense', 'conflict'],
    [429, 'rate_limit', 'rate'], [503, 'upstream', 'server'], [403, 'sheets_access', 'access'],
    [502, 'invalid_response', 'response'], [0, 'queue_busy', 'busy'],
  ] as const)('classifies %s %s without storing a response body', (status, code, kind) => {
    const result = classifyFailure(new ApiError(status, 'private response', false, code), true);
    expect(result.kind).toBe(kind);
    expect(JSON.stringify(result)).not.toContain('private response');
    expect(readSyncResult(JSON.stringify(result))).toEqual(result);
  });
  it('distinguishes offline, connection failure and request timeout', () => {
    expect(classifyFailure(new ReferenceError(), true).kind).toBe('client');
    expect(classifyFailure(new TypeError(), true).kind).toBe('network');
    expect(classifyFailure(new TypeError(), false).kind).toBe('offline');
    expect(classifyFailure(new DOMException('', 'AbortError'), true).kind).toBe('timeout');
  });
  it('recognizes an expired session even for a non-JSON HTTP 401', async () => {
    await expect(readJson(new Response('login', { status: 401 }))).rejects.toMatchObject({ status: 401, retryable: false });
  });
});
