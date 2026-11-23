import { chromium } from 'playwright';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { browserDiagnostic } from './diagnostics.js';

export const VIEWPORT = { width: 1280, height: 800 };
export const GAME_ORIGIN = 'https://play.playsolhero.com';

export class GuestBrowser {
  constructor(dataDir, referralCode, launcher = chromium) {
    this.launcher = launcher;
    this.dataDir = dataDir;
    this.referralCode = referralCode;
    this.context = null;
    this.page = null;
    this.queue = Promise.resolve();
    this.closed = false;
    this.state = 'starting';
    this.phase = 'storage';
    this.retries = 0;
    this.lastError = null;
  }

  // Only one screenshot or manual operation at a time.
  exclusive(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  recordFailure(error, phase) {
    this.lastError = browserDiagnostic(error, phase);
    this.state = 'retrying';
    this.retries += 1;
    console.error(`Guest browser: ${JSON.stringify(this.lastError)}`);
  }

  async start() {
    return this.exclusive(async () => {
      if (this.closed) return;
      this.state = 'starting';
      try {
        this.phase = 'storage';
        await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        await access(this.dataDir, constants.W_OK);
        const marker = path.join(this.dataDir, 'initial-navigation.json');
        let firstVisit = false;
        try { await access(marker); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          firstVisit = true;
        }
        this.phase = 'launch';
        const context = await this.launcher.launchPersistentContext(path.join(this.dataDir, 'profile'), {
          headless: true,
          viewport: VIEWPORT,
          args: ['--disable-dev-shm-usage'],
          // Playwright's default Chromium sandbox is disabled; isolate this container.
          acceptDownloads: false,
          timeout: 60_000,
        });
        this.context = context;
        context.on('close', () => {
          if (this.context === context) {
            this.context = null;
            this.page = null;
            if (this.closed) this.state = 'stopped';
            else if (this.state === 'page-open') this.recordFailure(new Error('Browser closed'), 'running');
          }
        });
        this.phase = 'setup';
        const page = context.pages()[0] || await context.newPage();
        this.page = page;
        for (const other of context.pages()) if (other !== page) await other.close();
        context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
        page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
        const interrupted = () => {
          if (!this.closed && this.state === 'page-open') this.recordFailure(new Error('Page crashed or browser closed'), 'running');
        };
        page.on('close', interrupted);
        page.on('crash', interrupted);
        // No arbitrary remote browsing, new tabs, wallet extensions or downloads.
        await context.route('**/*', async route => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            if (new URL(request.url()).origin !== GAME_ORIGIN) return route.abort();
          }
          return route.continue();
        });
        const url = new URL('/', GAME_ORIGIN);
        if (firstVisit) url.searchParams.set('ref', this.referralCode);
        this.phase = 'navigation';
        const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        if (!response || !response.ok()) {
          const error = new Error('Game navigation failed');
          if (response) error.httpStatus = response.status();
          throw error;
        }
        this.phase = 'persist';
        // Records delivery of the URL, NOT successful referral/account registration.
        if (firstVisit) await writeFile(marker, JSON.stringify({
          referralCode: this.referralCode, openedAt: new Date().toISOString(),
          referralConfirmed: false,
        }, null, 2), { mode: 0o600, flag: 'wx' });
        this.state = 'page-open';
        this.phase = 'running';
        this.retries = 0;
        this.lastError = null;
      } catch (error) {
        const phase = this.phase;
        await this.context?.close().catch(() => {});
        if (!this.closed) this.recordFailure(error, phase);
        throw error;
      }
    });
  }

  status() {
    return { state: this.state, referralCode: this.referralCode, referralConfirmed: false,
      mode: 'manual', viewport: VIEWPORT, phase: this.phase, retries: this.retries,
      lastError: this.lastError };
  }

  async screenshot() {
    return this.exclusive(async () => {
      this.requirePage();
      return this.page.screenshot({ type: 'jpeg', quality: 65, timeout: 10_000 });
    });
  }

  requirePage() {
    if (this.state !== 'page-open' || !this.page || this.page.isClosed()) {
      throw new Error('Browser unavailable');
    }
  }

  async action(action) {
    return this.exclusive(async () => {
      this.requirePage();
      if (action.type === 'click') await this.page.mouse.click(action.x, action.y);
      if (action.type === 'text') await this.page.keyboard.insertText(action.text);
      if (action.type === 'key') await this.page.keyboard.press(action.key);
      if (action.type === 'scroll') await this.page.mouse.wheel(0, action.delta);
    });
  }

  async recover() {
    if (this.closed || this.state === 'page-open' || this.state === 'starting') return;
    await this.context?.close().catch(() => {});
    try { await this.start(); } catch { /* start() records only sanitized diagnostics. */ }
  }

  async close() {
    this.closed = true;
    // Close immediately to interrupt any outstanding navigation or screenshot.
    await this.context?.close().catch(() => {});
    this.state = 'stopped';
  }
}
