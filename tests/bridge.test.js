'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setTimeout: delay } = require('timers/promises');
const { ROOT, bridgeFixture } = require('./helpers');

test('chat uses the same Python/home in both processes, including a real offline venv in a Unicode path', async t => {
  const f = await bridgeFixture(t, { venv: true });
  const result = await f.request('/agent/chat', { text: '你好，科研助手', scene: 'chat', session: null });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(Object.keys(result.data).sort(), ['reply', 'sessionId']);
  assert.match(result.data.reply, /你好，科研助手/);
  assert.equal(result.data.sessionId, 'offline-session');
  const capture = f.capture();
  assert.equal(capture.cwd, f.home);
  assert.equal(capture.home, f.home);
  assert.equal(capture.python, f.python);
  assert.equal(capture.executable.toLowerCase(), f.python.toLowerCase());
  assert.deepEqual(f.queries(), []);
});

test('explicit conversation sessions, explicit null, and omitted legacy resume retain their formats', async t => {
  const f = await bridgeFixture(t);
  assert.equal((await f.request('/agent/chat', { text: '新对话', session: null })).status, 200);
  assert.equal(f.capture().session, null);
  assert.equal((await f.request('/agent/chat', { text: '恢复 B', session: 'conversation-B' })).data.sessionId, 'conversation-B');
  assert.equal(f.capture().session, 'conversation-B');
  f.behavior('no-session');
  assert.equal((await f.request('/agent/chat', { text: '旧客户端恢复' })).data.sessionId, 'conversation-B');
  assert.equal(f.capture().session, 'conversation-B');
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'data', 'agent_session.json'), 'utf8'));
  assert.equal(saved.sessionId, 'conversation-B');
  assert.equal(typeof saved.updatedAt, 'number');
  const fresh = await f.request('/agent/chat', { text: '另一个新对话', session: null });
  assert.equal(f.capture().session, null);
  assert.equal(fresh.data.sessionId, null);
  assert.equal((await f.request('/agent/chat', { text: 'bad', session: {} })).status, 400);
});

test('uploaded literature analysis preserves UTF-8 and points to the actual workbench upload', async t => {
  const f = await bridgeFixture(t);
  const upload = await f.request('/upload', { name: '论文样本.txt', data: Buffer.from('测试论文原文').toString('base64') });
  assert.equal(upload.status, 200);
  const result = await f.request('/agent/chat', { text: '请分析创新点', scene: 'analysis', file: upload.data.path });
  assert.equal(result.status, 200);
  const prompt = f.capture().prompt;
  assert.match(prompt, /文献分析助手/);
  assert.match(prompt, /请分析创新点/);
  assert.ok(prompt.includes(path.join(f.root, 'data', upload.data.path).replace(/\\/g, '/')));
  assert.deepEqual(f.queries(), []);
});

test('import writes to workbench output/papers; existing frontend consumes and deduplicates the unchanged JSON', async t => {
  const f = await bridgeFixture(t);
  const source = path.join(f.home, '文献 样本.txt');
  fs.writeFileSync(source, '离线论文文件');
  const result = await f.request('/agent/chat', { text: source, scene: 'import_lit' });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const files = (await f.request('/list/agent_out')).data.files;
  assert.deepEqual(files, ['lit_20261022_000001.json']);
  const item = (await f.request('/read/agent_out/' + files[0])).data;
  assert.deepEqual(Object.keys(item).sort(), ['payload', 'time', 'title', 'type']);
  assert.equal(item.type, 'literature');
  assert.deepEqual(Object.keys(item.payload[0]).sort(), ['abstract', 'authors', 'doi', 'file', 'journal', 'title', 'url', 'year']);
  assert.equal(item.payload[0].file, 'papers/文献 样本.txt');
  assert.equal(fs.readFileSync(path.join(f.root, item.payload[0].file), 'utf8'), '离线论文文件');
  assert.equal(fs.existsSync(path.join(f.home, 'data', 'agent_out')), false);

  const sourceCode = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = sourceCode.indexOf('function handleAgentOut(item) {');
  const end = sourceCode.indexOf('/* --- opencode 官网用量同步', start);
  assert.ok(start > 0 && end > start);
  let library = [];
  const context = vm.createContext({ loadLibrary: () => library, saveLibrary: value => { library = value; },
    uid: () => 'offline-id', todayKey: () => '2026-10-22', renderLibrary() {}, showPage() {}, toast() {},
    zotConfig: { keyConfigured: false } });
  vm.runInContext(sourceCode.slice(start, end), context);
  context.handleAgentOut(item);
  context.handleAgentOut(item);
  assert.equal(library.length, 1);
  assert.equal(library[0].title, '离线论文');
  assert.equal(library[0].status, '未读');
  assert.equal(library[0].authors, 'Test Author');
});

test('report/writing scenes reach their prompts and unknown scenes fall back to chat', async t => {
  const f = await bridgeFixture(t);
  for (const [scene, prompt] of [['report', '本周工作记录'], ['writing', '学术写作助手'], ['unknown', 'AI 助手']]) {
    assert.equal((await f.request('/agent/chat', { text: '离线测试', scene })).status, 200);
    assert.ok(f.capture().prompt.includes(prompt));
  }
});

test('missing interpreter/home/runner and bad config give clear errors; health and subsequent calls still work', async t => {
  const f = await bridgeFixture(t);
  for (const [patch, message] of [
    [{ HERMES_PYTHON: path.join(f.root, '不存在的 python.exe') }, /HERMES_PYTHON.*不存在/],
    [{ HERMES_HOME: path.join(f.root, '不存在的目录') }, /HERMES_HOME.*不存在/],
  ]) {
    f.config(patch);
    const failed = await f.request('/agent/chat', { text: 'hello' });
    assert.equal(failed.status, 500);
    assert.match(failed.data.error, message);
    assert.deepEqual(f.queries(), []);
  }
  f.config();
  const runner = path.join(f.root, 'agent_runner.py');
  fs.renameSync(runner, runner + '.saved');
  assert.match((await f.request('/agent/chat', { text: 'hello' })).data.error, /缺少 Agent 运行文件/);
  fs.renameSync(runner + '.saved', runner);
  fs.writeFileSync(path.join(f.root, 'hermes.local.json'), '{bad json');
  assert.match((await f.request('/agent/chat', { text: 'hello' })).data.error, /配置文件/);
  assert.equal((await f.request('/health')).status, 200);
  f.config();
  assert.equal((await f.request('/agent/chat', { text: 'fixed' })).status, 200);
});

test('an existing but invalid executable fails once; bridge remains alive and releases the lock', async t => {
  const f = await bridgeFixture(t);
  const badPython = path.join(f.home, 'invalid python.exe');
  fs.writeFileSync(badPython, 'not an executable', { mode: 0o755 });
  f.config({ HERMES_PYTHON: badPython });
  const failed = await f.request('/agent/chat', { text: 'hello' });
  assert.equal(failed.status, 500);
  assert.match(failed.data.error, /启动 Hermes 失败|未返回合法 JSON/);
  f.config();
  assert.equal((await f.request('/agent/chat', { text: 'fixed' })).status, 200);
  assert.deepEqual(f.queries(), []);
  assert.doesNotMatch(f.errors(), /ERR_HTTP_HEADERS_SENT|Unhandled/);
});

test('CLI failures and missing module keep the old session and allow retries', async t => {
  const f = await bridgeFixture(t);
  await f.request('/agent/chat', { text: 'before', session: 'keep-session' });
  f.behavior('fail');
  const failed = await f.request('/agent/chat', { text: 'fail', session: 'other-session' });
  assert.equal(failed.status, 500);
  assert.match(failed.data.error, /异常退出\(7\)/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'data', 'agent_session.json'))).sessionId, 'keep-session');
  f.behavior('ok');
  const module = path.join(f.home, 'hermes_cli');
  fs.renameSync(module, module + '_hidden');
  assert.match((await f.request('/agent/chat', { text: 'missing module' })).data.error, /缺少模块/);
  fs.renameSync(module + '_hidden', module);
  assert.equal((await f.request('/agent/chat', { text: 'fixed' })).status, 200);
  assert.deepEqual(f.queries(), []);
});

test('runner timeout kills the offline CLI, releases the busy lock, and removes query files', async t => {
  const f = await bridgeFixture(t, { config: { HERMES_TIMEOUT_SECONDS: 0.5 } });
  f.behavior('sleep');
  const pending = f.request('/agent/chat', { text: 'timeout' });
  for (let i = 0; i < 100 && !fs.existsSync(path.join(f.home, 'capture.json')); i++) await delay(10);
  const pid = f.capture().pid;
  const busy = await f.request('/agent/chat', { text: 'second request' });
  assert.equal(busy.status, 429);
  const failed = await pending;
  assert.equal(failed.status, 500);
  assert.match(failed.data.error, /Agent 超时/);
  assert.throws(() => process.kill(pid, 0));
  f.behavior('ok');
  f.config();
  assert.equal((await f.request('/agent/chat', { text: 'retry' })).status, 200);
  assert.deepEqual(f.queries(), []);
});

test('bridge watchdog terminates a stuck runner and its child', async t => {
  const runner = "import json, os, subprocess, sys, time\nfrom pathlib import Path\nchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\nPath(os.environ['HERMES_HOME'], 'child.json').write_text(json.dumps({'pid': child.pid}))\ntime.sleep(60)\n";
  const f = await bridgeFixture(t, { runner, config: { HERMES_TIMEOUT_SECONDS: 0.1 } });
  const failed = await f.request('/agent/chat', { text: 'stuck' });
  assert.equal(failed.status, 500);
  assert.match(failed.data.error, /Agent 超时/);
  const { pid } = JSON.parse(fs.readFileSync(path.join(f.home, 'child.json')));
  assert.throws(() => process.kill(pid, 0));
  fs.copyFileSync(path.join(ROOT, 'agent_runner.py'), path.join(f.root, 'agent_runner.py'));
  f.config();
  assert.equal((await f.request('/agent/chat', { text: 'retry' })).status, 200);
  assert.deepEqual(f.queries(), []);
});

test('invalid runner output returns an error without changing the HTTP response format', async t => {
  const f = await bridgeFixture(t, { runner: "print('invalid json')\n" });
  const failed = await f.request('/agent/chat', { text: 'hello' });
  assert.equal(failed.status, 500);
  assert.deepEqual(Object.keys(failed.data), ['error']);
  assert.match(failed.data.error, /未返回合法 JSON/);
  assert.deepEqual(f.queries(), []);
});
