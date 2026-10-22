'use strict';

const fs = require('fs');
const path = require('path');

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

// Keep these rules in sync with hermes_config.py; tests compare both resolvers.
function loadHermesConfig(root = __dirname, env = process.env) {
  root = path.resolve(root);
  const explicitConfig = (env.HERMES_CONFIG || '').trim();
  const configFile = path.resolve(root, explicitConfig || 'hermes.local.json');
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT' || explicitConfig) {
      throw new Error('无法读取 Hermes 配置文件: ' + configFile + '；请检查文件是否存在、可读且为合法 JSON');
    }
  }
  if (!local || typeof local !== 'object' || Array.isArray(local)) {
    throw new Error('Hermes 配置文件必须是 JSON 对象: ' + configFile);
  }
  function setting(name) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return { value: value.trim(), base: root };
    return { value: local[name], base: path.dirname(configFile) };
  }
  function filePath(name, required = false) {
    const { value, base } = setting(name);
    if (value == null || (typeof value === 'string' && !value.trim())) {
      if (required) throw new Error('未配置 ' + name + '；请设置环境变量或填写 ' + configFile);
      return null;
    }
    if (typeof value !== 'string') throw new Error(name + ' 必须是路径字符串');
    return path.resolve(base, value.trim());
  }

  const home = filePath('HERMES_HOME', true);
  let homeExists = false;
  try { homeExists = fs.statSync(home).isDirectory(); } catch {}
  if (!homeExists) throw new Error('HERMES_HOME 工作目录不存在或不是目录: ' + home);

  const venvPython = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const candidates = [
    path.join(home, 'hermes-agent', '.venv', ...venvPython),
    path.join(home, '.venv', ...venvPython),
  ];
  const python = filePath('HERMES_PYTHON') || candidates.find(isFile);
  if (!python || !isFile(python)) {
    throw new Error('HERMES_PYTHON 解释器文件不存在: ' + (python || candidates.join(' 或 ')) + '；请指定 Python 可执行文件的完整路径');
  }
  if (process.platform !== 'win32') {
    try { fs.accessSync(python, fs.constants.X_OK); }
    catch { throw new Error('HERMES_PYTHON 解释器不可执行: ' + python); }
  }
  const rawTimeout = setting('HERMES_TIMEOUT_SECONDS').value;
  const timeout = rawTimeout == null || rawTimeout === '' ? 470 : rawTimeout;
  if (!['string', 'number'].includes(typeof timeout) || !/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(String(timeout)) ||
      !Number.isFinite(Number(timeout)) || Number(timeout) <= 0 || Number(timeout) > 86400) {
    throw new Error('HERMES_TIMEOUT_SECONDS 必须是大于 0 且不超过 86400 的秒数');
  }
  return { home, python, timeoutSeconds: Number(timeout) };
}

function validateRunner(root = __dirname) {
  for (const name of ['agent_runner.py', 'hermes_config.py']) {
    if (!isFile(path.join(root, name))) throw new Error('缺少 Agent 运行文件: ' + path.join(root, name) + '；请恢复工作台文件');
  }
}

module.exports = { loadHermesConfig, validateRunner };
