import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { VIEWPORT } from './browser.js';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const digest = value => createHash('sha256').update(value).digest();

export function validateAction(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'click') return Number.isInteger(value.x) && Number.isInteger(value.y)
    && value.x >= 0 && value.x < VIEWPORT.width && value.y >= 0 && value.y < VIEWPORT.height;
  if (value.type === 'text') return typeof value.text === 'string'
    && value.text.length > 0 && value.text.length <= 200;
  if (value.type === 'key') return ['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'Space', 'Control+A'].includes(value.key);
  if (value.type === 'scroll') return Number.isInteger(value.delta) && Math.abs(value.delta) <= 800;
  return false;
}

export function createServer({ browser, password }) {
  if (typeof password !== 'string' || password.length < 20) {
    throw new Error('Set DASHBOARD_PASSWORD to a unique password of at least 20 characters');
  }
  const expected = digest(`solhero:${password}`);
  let pending = 0;
  return http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    const pathname = (req.url || '').split('?')[0];
    // Liveness only; deliberately reveals neither game status nor referral/session data.
    if (req.method === 'GET' && pathname === '/healthz') return send(200, { alive: true });
    const auth = req.headers.authorization || '';
    const supplied = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : '';
    if (!timingSafeEqual(digest(supplied), expected)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="SolHero private browser", charset="UTF-8"');
      return send(401, { error: 'Authentication required' });
    }
    if (req.method === 'POST') {
      let sameOrigin = false;
      try {
        const origin = new URL(req.headers.origin);
        sameOrigin = ['https:', 'http:'].includes(origin.protocol) && origin.host === req.headers.host;
      } catch { /* Missing or malformed Origin is not accepted. */ }
      if (!sameOrigin || req.headers['x-requested-with'] !== 'solhero-dashboard') {
        return send(403, { error: 'Same-origin dashboard requests only' });
      }
    }
    if (pending >= 4) return send(429, { error: 'Please wait for the current operation' });
    pending++;
    try {
      if (req.method === 'GET' && files.has(pathname)) {
        const [file, type] = files.get(pathname);
        return send(200, await readFile(new URL(`../public/${file}`, import.meta.url)), type);
      }
      if (req.method === 'GET' && pathname === '/api/status') return send(200, browser.status());
      if (req.method === 'GET' && pathname === '/api/screenshot') {
        return send(200, await browser.screenshot(), 'image/jpeg');
      }
      if (req.method === 'POST' && pathname === '/api/action') {
        if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) return send(413, { error: 'Request too large' });
          chunks.push(chunk);
        }
        let action;
        try { action = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); }
        if (!validateAction(action)) return send(400, { error: 'Invalid manual action' });
        await browser.action(action);
        return send(200, { ok: true });
      }
      return send(404, { error: 'Not found' });
    } catch {
      // Never leak page content, cookie values, URLs or Playwright traces to the client/log.
      return send(503, { error: 'Browser operation failed; check status and retry manually' });
    } finally { pending--; }
  });
}
