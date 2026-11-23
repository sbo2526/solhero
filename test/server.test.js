import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, validateAction } from '../src/server.js';

const password = 'test-only-very-long-password-123';
const auth = `Basic ${Buffer.from(`solhero:${password}`).toString('base64')}`;
async function fixture(t) {
  const actions = [];
  const browser = {
    status: () => ({ state: 'page-open', referralCode: 'RAN7TJA', referralConfirmed: false }),
    screenshot: async () => Buffer.from('fake-jpeg'),
    action: async action => { actions.push(action); },
  };
  const server = createServer({ browser, password });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = action => fetch(`${url}/api/action`, {
    method: 'POST', headers: { Authorization: auth, Origin: url,
      'X-Requested-With': 'solhero-dashboard', 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  return { server, url, browser, actions, post };
}

test('requires a strong dashboard password before startup', () => {
  for (const value of [undefined, '', 'short']) {
    assert.throws(() => createServer({ browser: {}, password: value }), /DASHBOARD_PASSWORD/);
  }
});
test('public health endpoint does not reveal session data', async t => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { alive: true });
});
test('dashboard, status, images and actions require authentication', async t => {
  const { url } = await fixture(t);
  for (const route of ['/', '/app.js', '/api/status', '/api/screenshot']) {
    const response = await fetch(`${url}${route}`);
    assert.equal(response.status, 401);
    assert.ok(response.headers.get('www-authenticate'));
  }
});
test('status distinguishes page opening from successful registration', async t => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/status`, { headers: { Authorization: auth } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).referralConfirmed, false);
});
test('rejects cross-origin manual actions and missing CSRF header', async t => {
  const { url, actions } = await fixture(t);
  for (const headers of [
    { Origin: 'https://evil.example', 'X-Requested-With': 'solhero-dashboard' },
    { Origin: url },
    { 'X-Requested-With': 'solhero-dashboard' },
  ]) {
    const response = await fetch(`${url}/api/action`, { method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...headers },
      body: '{"type":"key","key":"Enter"}' });
    assert.equal(response.status, 403);
  }
  assert.equal(actions.length, 0);
});
test('only explicit validated manual actions are forwarded, including Persian text', async t => {
  const { post, actions } = await fixture(t);
  for (const action of [{ type: 'click', x: 100, y: 200 }, { type: 'text', text: 'قهرمان' },
    { type: 'key', key: 'Enter' }, { type: 'scroll', delta: 500 }]) {
    assert.equal((await post(action)).status, 200);
  }
  assert.equal(actions.length, 4);
  assert.equal(actions[1].text, 'قهرمان');
  for (const action of [{ type: 'navigate', url: 'https://evil.example' },
    { type: 'click', x: 1280, y: 0 }, { type: 'text', text: 'x'.repeat(201) }]) {
    assert.equal((await post(action)).status, 400);
  }
  assert.equal(actions.length, 4);
});
test('does not expose internal browser errors', async t => {
  const { browser, url } = await fixture(t);
  browser.screenshot = async () => { throw new Error('secret-session-token'); };
  const response = await fetch(`${url}/api/screenshot`, { headers: { Authorization: auth } });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret-session-token'));
});
test('serves private dashboard with frame protection', async t => {
  const { url } = await fixture(t);
  const response = await fetch(url, { headers: { Authorization: auth } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(await response.text(), /RAN7TJA/);
});
test('rejects malformed values and unsupported keys', () => {
  for (const value of [null, [], {}, { type: 'key', key: 'F12' },
    { type: 'scroll', delta: Infinity }, { type: 'click', x: -1, y: 10 },
    { type: 'click', x: 1.1, y: 10 }, { type: 'text', text: '' }]) {
    assert.equal(validateAction(value), false);
  }
});
