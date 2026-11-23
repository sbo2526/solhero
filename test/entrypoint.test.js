import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const entrypoint = new URL('../docker-entrypoint.sh', import.meta.url).pathname;

// Simulate privileged OS utilities. These tests never chown/chmod the host's /data.
async function fixture(t) {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'solhero-entrypoint-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const log = path.join(bin, 'commands');
  await writeFile(log, '');
  const scripts = {
    id: 'printf "%s\\n" "${MOCK_UID:-0}"',
    mkdir: 'printf "mkdir %s\\n" "$*" >> "$BOOT_LOG"',
    chown: 'printf "chown %s\\n" "$*" >> "$BOOT_LOG"; exit "${FAIL_CHOWN:-0}"',
    chmod: 'printf "chmod %s\\n" "$*" >> "$BOOT_LOG"',
    gosu: 'printf "gosu %s\\n" "$*" >> "$BOOT_LOG"',
  };
  for (const [name, script] of Object.entries(scripts)) {
    await writeFile(path.join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  }
  const run = (extra = {}, args = ['node', 'src/index.js']) => spawnSync('/bin/sh', [entrypoint, ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOOT_LOG: log, DATA_DIR: '/data', ...extra },
    encoding: 'utf8',
  });
  return { log, run };
}

test('entrypoint has valid shell syntax', () => {
  const result = spawnSync('/bin/sh', ['-n', entrypoint], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('privileged startup repairs only /data then drops privileges', async t => {
  const { log, run } = await fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const commands = await readFile(log, 'utf8');
  assert.equal(commands, 'mkdir -p /data\nchown -hR node:node /data\nchmod 700 /data\ngosu node env HOME=/home/node USER=node LOGNAME=node node src/index.js\n');
  assert.match(result.stdout, /starting application as non-root/);
});
test('failed ownership repair stops instead of running browser as root', async t => {
  const { log, run } = await fixture(t);
  const result = run({ FAIL_CHOWN: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No profile was deleted/);
  assert.ok(!(await readFile(log, 'utf8')).includes('gosu'));
});
test('privileged repair refuses arbitrary DATA_DIR paths', async t => {
  const { log, run } = await fixture(t);
  for (const dir of ['/app', '/', '/etc', '/data/../etc', '/data/profile']) {
    const result = run({ DATA_DIR: dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires DATA_DIR=\/data/);
  }
  assert.equal(await readFile(log, 'utf8'), '');
});
test('non-root override delegates without trying privileged operations', async t => {
  const { log, run } = await fixture(t);
  const result = run({ MOCK_UID: '1000' }, [process.execPath, '-e', 'process.stdout.write("delegated")']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'delegated');
  assert.equal(await readFile(log, 'utf8'), '');
});
test('missing application command fails safely', async t => {
  const { log, run } = await fixture(t);
  const result = run({}, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /command is missing/);
  assert.equal(await readFile(log, 'utf8'), '');
});
