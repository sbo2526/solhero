import test from 'node:test';
import assert from 'node:assert/strict';
import { browserDiagnostic } from '../src/diagnostics.js';

const cases = [
  [new Error('EACCES: permission denied /private/path'), 'launch', 'DATA_PERMISSION'],
  [Object.assign(new Error('write failed'), { code: 'ENOSPC' }), 'persist', 'DISK_FULL'],
  [Object.assign(new Error('write failed'), { code: 'EROFS' }), 'storage', 'DATA_READ_ONLY'],
  [new Error('ProcessSingleton SingletonLock'), 'launch', 'PROFILE_IN_USE'],
  [new Error("Executable doesn't exist; run playwright install"), 'launch', 'CHROMIUM_MISSING'],
  [new Error('error while loading shared libraries: libfoo.so'), 'launch', 'CHROMIUM_DEPENDENCIES'],
  [Object.assign(new Error('failed'), { httpStatus: 403 }), 'navigation', 'GAME_HTTP_403'],
  [new Error('net::ERR_NAME_NOT_RESOLVED'), 'navigation', 'GAME_DNS'],
  [new Error('net::ERR_CERT_AUTHORITY_INVALID'), 'navigation', 'GAME_TLS'],
  [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'navigation', 'GAME_TIMEOUT'],
  [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'launch', 'BROWSER_TIMEOUT'],
  [new Error('net::ERR_CONNECTION_RESET'), 'navigation', 'GAME_NETWORK'],
  [new Error('Target page, context or browser has been closed'), 'launch', 'CHROMIUM_EXITED'],
];
for (const [error, phase, expected] of cases) {
  test(`sanitized diagnosis: ${expected}`, () => {
    const result = browserDiagnostic(error, phase);
    assert.equal(result.code, expected);
    assert.equal(result.phase, phase);
    assert.ok(result.message.length > 0);
    assert.ok(Number.isFinite(Date.parse(result.at)));
  });
}
test('unknown errors and phases never leak arbitrary input', () => {
  const secret = 'sensitive-session-value';
  const result = browserDiagnostic(new Error(`https://example.test/?token=${secret}`), secret);
  assert.equal(result.code, 'BROWSER_START_FAILED');
  assert.equal(result.phase, 'unknown');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('example.test'));
});
