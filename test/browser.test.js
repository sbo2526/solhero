import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GuestBrowser } from '../src/browser.js';

function fakeLauncher({ navigationFails = false, launchError = null, httpStatus = 200 } = {}) {
  const visits = [];
  const profiles = [];
  const launcher = { async launchPersistentContext(profile) {
    profiles.push(profile);
    if (launchError) throw launchError;
    const context = new EventEmitter();
    const page = new EventEmitter();
    const mainFrame = {};
    page.mainFrame = () => mainFrame;
    page.goto = async url => {
      visits.push(url);
      if (navigationFails) throw new Error('offline');
      return { ok: () => httpStatus < 400, status: () => httpStatus };
    };
    page.isClosed = () => false;
    context.pages = () => [page];
    context.route = async () => {};
    context.close = async () => context.emit('close');
    return context;
  } };
  return { launcher, visits, profiles };
}
async function folder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'solhero-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('first visit carries the invitation, restart reuses profile without another referral', async t => {
  const dir = await folder(t);
  const fake = fakeLauncher();
  const first = new GuestBrowser(dir, 'RAN7TJA', fake.launcher);
  await first.start();
  assert.equal(fake.visits[0], 'https://play.playsolhero.com/?ref=RAN7TJA');
  assert.equal(first.status().referralConfirmed, false);
  await first.close();
  const second = new GuestBrowser(dir, 'RAN7TJA', fake.launcher);
  await second.start();
  assert.equal(fake.visits[1], 'https://play.playsolhero.com/');
  assert.equal(fake.profiles[0], fake.profiles[1]);
  const marker = JSON.parse(await readFile(path.join(dir, 'initial-navigation.json'), 'utf8'));
  assert.equal(marker.referralCode, 'RAN7TJA');
  assert.equal(marker.referralConfirmed, false);
  await second.close();
});
test('failed navigation does not mark referral delivered', async t => {
  const dir = await folder(t);
  const fake = fakeLauncher({ navigationFails: true });
  const browser = new GuestBrowser(dir, 'RAN7TJA', fake.launcher);
  await assert.rejects(browser.start(), /offline/);
  await assert.rejects(access(path.join(dir, 'initial-navigation.json')));
  assert.equal(browser.state, 'retrying');
  assert.equal(browser.status().lastError.phase, 'navigation');
  assert.equal(browser.retries, 1);
  await browser.close();
});
test('operations are serialized even after an operation fails', async t => {
  const browser = new GuestBrowser(await folder(t), 'RAN7TJA');
  const order = [];
  const first = browser.exclusive(async () => { order.push(1); throw new Error('expected'); });
  const second = browser.exclusive(async () => { order.push(2); });
  await assert.rejects(first);
  await second;
  assert.deepEqual(order, [1, 2]);
});

test('launch failure is recorded once and recovery clears the error on the same profile', async t => {
  const dir = await folder(t);
  const failed = fakeLauncher({ launchError: new Error("Executable doesn't exist: secret-path") });
  const browser = new GuestBrowser(dir, 'RAN7TJA', failed.launcher);
  await assert.rejects(browser.start());
  assert.equal(browser.state, 'retrying');
  assert.equal(browser.retries, 1);
  assert.equal(browser.status().lastError.code, 'CHROMIUM_MISSING');
  assert.equal(browser.status().lastError.phase, 'launch');
  assert.ok(!JSON.stringify(browser.status()).includes('secret-path'));
  const good = fakeLauncher();
  browser.launcher = good.launcher;
  await browser.recover();
  assert.equal(browser.state, 'page-open');
  assert.equal(browser.retries, 0);
  assert.equal(browser.status().lastError, null);
  assert.equal(good.profiles[0], failed.profiles[0]);
  await browser.close();
});

test('HTTP refusal is diagnosed without marking the referral delivered', async t => {
  const dir = await folder(t);
  const fake = fakeLauncher({ httpStatus: 403 });
  const browser = new GuestBrowser(dir, 'RAN7TJA', fake.launcher);
  await assert.rejects(browser.start());
  assert.equal(browser.status().lastError.code, 'GAME_HTTP_403');
  assert.equal(browser.status().lastError.phase, 'navigation');
  await assert.rejects(access(path.join(dir, 'initial-navigation.json')));
  assert.equal(browser.context, null);
  await browser.close();
});

test('storage failure is diagnosed before Chromium is launched', async t => {
  const dir = await folder(t);
  const { writeFile } = await import('node:fs/promises');
  const blocked = path.join(dir, 'not-a-directory');
  await writeFile(blocked, 'placeholder');
  const fake = fakeLauncher();
  const browser = new GuestBrowser(blocked, 'RAN7TJA', fake.launcher);
  await assert.rejects(browser.start());
  assert.equal(browser.status().lastError.phase, 'storage');
  assert.equal(browser.retries, 1);
  assert.equal(fake.profiles.length, 0);
  await browser.close();
});
