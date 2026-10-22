'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Execute the actual initialization and recovery code with an empty synthetic browser.
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const defaults = fs.readFileSync(path.join(root, 'workbench-config.js'), 'utf8');
const initialization = app.slice(0, app.indexOf('let bridgeOnline = false;'));
const recoveryStart = app.indexOf('(function () {', app.indexOf('/* ============ 数据恢复'));
const recovery = app.slice(recoveryStart, app.indexOf('})();', recoveryStart) + 5);
assert.ok(initialization.length > 0 && recovery.startsWith('(function () {'));

for (const test of [
  { config: null, expected: 5177 },
  { config: { bridgePort: 25431 }, expected: 25431 },
  { config: { bridgePort: '25431' }, expected: 5177 },
  { config: { bridgePort: 0 }, expected: 5177 },
  { config: { bridgePort: 65536 }, expected: 5177 },
]) {
  const requests = [];
  const context = vm.createContext({
    window: { addEventListener() {} },
    location: { protocol: 'http:' },
    fetch(url) {
      requests.push(url);
      return Promise.resolve({ json: () => Promise.resolve({}) });
    },
  });
  vm.runInContext(defaults, context);
  if (test.config) context.window.WORKBENCH_CONFIG = test.config;
  vm.runInContext(initialization, context);
  const expected = `http://127.0.0.1:${test.expected}`;
  assert.equal(vm.runInContext('BRIDGE', context), expected);
  vm.runInContext(recovery, context);
  assert.deepEqual(requests, [expected + '/sync']);
}
