'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');
const readline = require('readline');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
function cleanEnv(extra = {}) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extra };
}
function findPython() {
  const candidates = process.env.TEST_PYTHON ? [process.env.TEST_PYTHON] : ['python', 'python3'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import sys; print(sys.executable)'], {
      env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error('离线测试需要 Python 3.10+；请将 TEST_PYTHON 设置为可执行文件的完整路径');
}
const PYTHON = findPython();

function tempDirectory(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gradwb-offline-'));
  t.after(() => {
    assert.ok(path.resolve(temp).startsWith(path.join(os.tmpdir(), 'gradwb-offline-')));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return temp;
}

async function bridgeFixture(t, options = {}) {
  // Cleanup runs after the bridge has stopped, even if an assertion fails.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gradwb-offline-'));
  const root = path.join(temp, '工作台 with spaces');
  const home = path.join(temp, 'Hermes 安装 with spaces');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(home, 'hermes_cli'), { recursive: true });
  fs.writeFileSync(path.join(home, 'hermes_cli', '__init__.py'), '');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake_hermes.py'), path.join(home, 'hermes_cli', 'main.py'));
  let python = PYTHON;
  if (options.venv) {
    const venv = path.join(home, 'hermes-agent', '.venv');
    const created = spawnSync(PYTHON, ['-m', 'venv', '--without-pip', venv], {
      env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.equal(created.status, 0, created.stderr);
    python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  }
  const sources = ['bridge-server.js', 'hermes-config.js', 'agent-process.js', 'agent_runner.py', 'hermes_config.py'];
  for (const name of sources) fs.copyFileSync(path.join(ROOT, name), path.join(root, name));
  const defaults = { HERMES_HOME: home, HERMES_PYTHON: options.venv ? null : python, HERMES_TIMEOUT_SECONDS: 3 };
  const config = patch => fs.writeFileSync(path.join(root, 'hermes.local.json'), JSON.stringify({ ...defaults, ...patch }));
  config(options.config);
  if (options.runner) fs.writeFileSync(path.join(root, 'agent_runner.py'), options.runner);
  const child = spawn(process.execPath, ['-e',
    "const server = require(process.argv[1]); server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port})));",
    path.join(root, 'bridge-server.js')], { env: cleanEnv(options.env), windowsHide: true });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    assert.ok(path.resolve(temp).startsWith(path.join(os.tmpdir(), 'gradwb-offline-')));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge startup timeout: ' + errors)), 10000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.port) { clearTimeout(timer); resolve(value.port); }
      } catch {}
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Bridge exited ' + code + ': ' + errors)); });
  });
  const request = async (url, body) => {
    const response = await fetch('http://127.0.0.1:' + port + url, body === undefined
      ? { signal: AbortSignal.timeout(10000) }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json() };
  };
  return { root, home, python, config, request, errors: () => errors,
    capture: () => JSON.parse(fs.readFileSync(path.join(home, 'capture.json'), 'utf8')),
    behavior: mode => fs.writeFileSync(path.join(home, 'behavior.json'), JSON.stringify({ mode })),
    queries: () => fs.readdirSync(path.join(root, 'data')).filter(name => name.startsWith('agent_q_')) };
}

module.exports = { ROOT, PYTHON, cleanEnv, tempDirectory, bridgeFixture };
