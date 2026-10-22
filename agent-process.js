'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');

function killTree(proc) {
  if (!proc.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 2000 }, () => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      });
    });
  }
  try { process.kill(-proc.pid, 'SIGKILL'); }
  catch { try { proc.kill('SIGKILL'); } catch {} }
  return Promise.resolve();
}

function runAgent(config, { root, queryFile, scene, session }) {
  return new Promise((resolve, reject) => {
    const args = [path.join(root, 'agent_runner.py'), queryFile, scene];
    if (session) args.push(session);
    const options = {
      cwd: config.home,
      env: { ...process.env, HERMES_HOME: config.home, HERMES_PYTHON: config.python,
        HERMES_TIMEOUT_SECONDS: String(config.timeoutSeconds), GRAD_WORKBENCH_ROOT: root,
        PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
      detached: process.platform !== 'win32',
    };
    const startError = error => new Error('启动 Hermes 失败: ' + error.message + '；请检查 HERMES_PYTHON 和 HERMES_HOME');
    let proc;
    try { proc = spawn(config.python, args, options); }
    catch (error) { reject(startError(error)); return; }
    let out = '', err = '', failure = null, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const stop = error => {
      if (failure || settled) return;
      failure = error;
      killTree(proc).then(() => finish(error));
    };
    // Give the runner time to return its structured timeout before the watchdog.
    const timer = setTimeout(() => stop(new Error('Agent 超时；已终止 Hermes 进程，请检查 HERMES_TIMEOUT_SECONDS')), config.timeoutSeconds * 1000 + 2000);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      out += chunk;
      if (out.length > 2e6) stop(new Error('Agent 输出超过 2 MB 限制，已终止调用'));
    });
    proc.stderr.on('data', chunk => { err = (err + chunk).slice(-2000); });
    proc.on('error', error => finish(startError(error)));
    proc.on('close', code => {
      if (failure || settled) return;
      let result;
      try { result = JSON.parse(out.trim()); }
      catch { return finish(new Error('Hermes 运行器未返回合法 JSON（退出码 ' + code + '）；请检查 Python 环境和运行器文件')); }
      if (code !== 0 || !result || result.code !== 0) {
        return finish(new Error(result?.error || ('Hermes 异常退出(' + (result?.code ?? code) + ')；请检查 Hermes 安装和配置' + (err ? '（运行器有错误输出）' : ''))));
      }
      if (typeof result.reply !== 'string' || (result.sessionId != null && typeof result.sessionId !== 'string')) {
        return finish(new Error('Hermes 运行器返回的数据格式不正确'));
      }
      finish(null, result);
    });
  });
}

module.exports = { runAgent };
