import path from 'node:path';
import { GuestBrowser } from './browser.js';
import { createServer } from './server.js';

process.umask(0o077);
const referralCode = process.env.REFERRAL_CODE || 'RAN7TJA';
if (!/^[A-Z0-9]{7}$/.test(referralCode)) throw new Error('Invalid REFERRAL_CODE');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const browser = new GuestBrowser(path.resolve(process.env.DATA_DIR || './data'), referralCode);
// Validate dashboard credentials BEFORE launching a browser.
const server = createServer({ browser, password: process.env.DASHBOARD_PASSWORD });
server.listen(port, '0.0.0.0', () => console.log(`Private guest browser listening on port ${port}`));
server.on('error', () => { console.error('HTTP server failed'); void shutdown(1); });

let stopping = false;
let timer;
async function maintain() {
  if (stopping) return;
  await browser.recover();
  if (!stopping) timer = setTimeout(maintain, Math.min(120_000, 5000 * 2 ** Math.min(browser.retries, 5)));
}
async function boot() {
  try { await browser.start(); } catch { /* start() records safe diagnostics for logs and dashboard. */ }
  if (!stopping) timer = setTimeout(maintain, 5000);
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  const deadline = setTimeout(() => process.exit(1), 12_000);
  deadline.unref();
  server.close();
  server.closeIdleConnections();
  await browser.close();
  process.exit(code);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
void boot();
