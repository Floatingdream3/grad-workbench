'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadHermesConfig, validateRunner } = require('../hermes-config');
const { ROOT, PYTHON, cleanEnv, tempDirectory } = require('./helpers');

function pythonConfig(root, env) {
  const result = spawnSync(PYTHON, ['-c',
    'import json,sys; from pathlib import Path; from hermes_config import load_hermes_config; print(json.dumps(load_hermes_config(Path(sys.argv[1]))))', root],
  { cwd: ROOT, env: cleanEnv(env), encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Node and Python resolve file paths relative to the config, with spaces/Unicode and BOM', t => {
  const root = tempDirectory(t);
  const configDir = path.join(root, '本地 配置');
  const home = path.join(root, 'Hermes 安装');
  fs.mkdirSync(configDir);
  fs.mkdirSync(home);
  const configFile = path.join(configDir, 'machine.json');
  fs.writeFileSync(configFile, '\uFEFF' + JSON.stringify({ HERMES_HOME: '../Hermes 安装', HERMES_PYTHON: PYTHON, HERMES_TIMEOUT_SECONDS: 2.5 }));
  const env = { HERMES_CONFIG: '本地 配置/machine.json' };
  const config = loadHermesConfig(root, env);
  assert.deepEqual(config, { home, python: PYTHON, timeoutSeconds: 2.5 });
  assert.deepEqual(pythonConfig(root, env), config);
});

test('environment takes precedence; its relative paths use the workbench root', t => {
  const root = tempDirectory(t);
  const home = path.join(root, 'Env Hermes');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'hermes.local.json'), JSON.stringify({ HERMES_HOME: 'missing', HERMES_PYTHON: 'missing.exe', HERMES_TIMEOUT_SECONDS: 60 }));
  const env = { HERMES_HOME: 'Env Hermes', HERMES_PYTHON: PYTHON, HERMES_TIMEOUT_SECONDS: '0.5' };
  const config = loadHermesConfig(root, env);
  assert.deepEqual(config, { home, python: PYTHON, timeoutSeconds: 0.5 });
  assert.deepEqual(pythonConfig(root, env), config);
});

test('omitted interpreter supports nested and direct virtualenv layouts; blank env falls back to file', t => {
  const root = tempDirectory(t);
  const home = path.join(root, 'Hermes');
  const executable = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const direct = path.join(home, '.venv', ...executable);
  const nested = path.join(home, 'hermes-agent', '.venv', ...executable);
  fs.mkdirSync(path.dirname(direct), { recursive: true });
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(direct, 'offline placeholder', { mode: 0o755 });
  fs.writeFileSync(nested, 'offline placeholder', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'hermes.local.json'), JSON.stringify({ HERMES_HOME: 'Hermes' }));
  const env = { HERMES_HOME: ' ', HERMES_PYTHON: '' };
  for (const expected of [nested, direct]) {
    const config = loadHermesConfig(root, env);
    assert.equal(config.python, expected);
    assert.equal(config.timeoutSeconds, 470);
    assert.deepEqual(pythonConfig(root, env), config);
    fs.unlinkSync(expected);
  }
});

test('preflight reports missing home, interpreter, runner, and explicit config', t => {
  const root = tempDirectory(t);
  assert.throws(() => loadHermesConfig(root, {}), /未配置 HERMES_HOME/);
  assert.throws(() => loadHermesConfig(root, { HERMES_HOME: path.join(root, 'absent') }), /HERMES_HOME.*不存在/);
  assert.throws(() => loadHermesConfig(root, { HERMES_HOME: root, HERMES_PYTHON: 'missing.exe' }), /HERMES_PYTHON.*不存在/);
  assert.throws(() => loadHermesConfig(root, { HERMES_HOME: root }), /HERMES_PYTHON.*不存在/);
  assert.throws(() => loadHermesConfig(root, { HERMES_CONFIG: 'absent.json' }), /无法读取.*配置文件/);
  assert.throws(() => validateRunner(root), /agent_runner.py/);
  fs.writeFileSync(path.join(root, 'agent_runner.py'), '');
  assert.throws(() => validateRunner(root), /hermes_config.py/);
  fs.writeFileSync(path.join(root, 'hermes_config.py'), '');
  assert.doesNotThrow(() => validateRunner(root));
});

test('malformed JSON, wrong field types, and invalid timeout cannot reach spawn', t => {
  const root = tempDirectory(t);
  const file = path.join(root, 'hermes.local.json');
  for (const invalid of ['{broken', '[]', 'null', '{"extra": NaN}']) {
    fs.writeFileSync(file, invalid);
    assert.throws(() => loadHermesConfig(root, {}), /配置文件/);
  }
  fs.writeFileSync(file, JSON.stringify({ HERMES_HOME: 42 }));
  assert.throws(() => loadHermesConfig(root, {}), /HERMES_HOME.*字符串/);
  for (const timeout of [0, -1, 'NaN', 'Infinity', 86401, true, {}, '0x10', '١']) {
    fs.writeFileSync(file, JSON.stringify({ HERMES_HOME: root, HERMES_PYTHON: PYTHON, HERMES_TIMEOUT_SECONDS: timeout }));
    assert.throws(() => loadHermesConfig(root, {}), /HERMES_TIMEOUT_SECONDS/);
  }
});

test('small decimal timeouts survive normalization before being passed to Python', t => {
  const root = tempDirectory(t);
  const env = { HERMES_HOME: root, HERMES_PYTHON: PYTHON, HERMES_TIMEOUT_SECONDS: '0.0000001' };
  const config = loadHermesConfig(root, env);
  assert.deepEqual(pythonConfig(root, env), config);
  assert.deepEqual(pythonConfig(root, { ...env, HERMES_TIMEOUT_SECONDS: String(config.timeoutSeconds) }), config);
});
