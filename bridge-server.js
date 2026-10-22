// ============ 工作台 · Agent 桥服务 ============
// 网页(localStorage) <-> 本机文件 <-> Hermes agent
// 仅监听 127.0.0.1（默认 5177，可通过 WORKBENCH_BRIDGE_PORT 配置）
// 控制：POST /control/stop 优雅退出（网页端「关闭」按钮调用）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const OUT_DIR = path.join(DATA_DIR, 'agent_out');
const portSetting = process.env.WORKBENCH_BRIDGE_PORT || '5177';
if (!/^[1-9]\d*$/.test(portSetting) || Number(portSetting) > 65535) {
  console.error('[bridge] WORKBENCH_BRIDGE_PORT must be an integer from 1 to 65535');
  process.exit(2);
}
const PORT = Number(portSetting);
// opencode 官网同步（用量数据来自 SSR 页面）
const OC_WS = 'wrk_01KYYZWQJJ6T3H5AWJGRE638TN';
const OC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
let ocCache = null, ocCacheAt = 0;
// opencode 实时用量 server fn（SolidStart _server，照抄浏览器成功请求）
const OC_SERVER_FN = '15702f3a12ff8bff357f8c2aa154a17e65b746d5f6b96adc9002c86ee0c15205'; // 月聚合（date+model+totalCost）
const OC_SERVER_FN_RECORDS = 'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c'; // 明细分页（usage.list）
const OC_HDRS = () => {
  const cookie = JSON.parse(fs.readFileSync(ocCookiePath(), 'utf8')).cookie;
  return {
    'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en-GB;q=0.8,en;q=0.7,en-US;q=0.6',
    'Content-Type': 'application/json', 'Cookie': cookie, 'Origin': 'https://opencode.ai',
    'Priority': 'u=1, i', 'Referer': 'https://opencode.ai/workspace/' + OC_WS + '/usage',
    'Sec-CH-UA': '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
    'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
    'User-Agent': OC_UA,
  };
};
async function ocServerCall(fnId, args) {
  const body = JSON.stringify({ t: { t: 9, i: 0, l: args.length, a: args.map(a => a.s !== undefined ? { t: 1, s: a.s } : { t: 0, s: a.n }), o: 0 }, f: 31, m: [] });
  const r = await fetch('https://opencode.ai/_server', {
    method: 'POST',
    headers: { ...OC_HDRS(), 'X-Server-Id': fnId, 'X-Server-Instance': 'server-fn:' + Date.now() },
    body,
  });
  const t = await r.text();
  if (!r.ok) throw new Error('OC server fn HTTP ' + r.status);
  return t;
}
async function ocServerUsage() {
  const now = new Date();
  const t = await ocServerCall(OC_SERVER_FN, [{ s: OC_WS }, { n: now.getFullYear() }, { n: now.getMonth() }, { s: '+08:00' }]);
  const usage = [];
  const re = /\{date:"(20\d\d-\d\d-\d\d)",model:"([^"]+)",totalCost:(\d+)/g;
  let m;
  while ((m = re.exec(t)) !== null) usage.push({ date: m[1], model: m[2], totalCost: Number(m[3]) });
  return usage;
}
async function ocRecords() {
  const t = await ocServerCall(OC_SERVER_FN_RECORDS, [{ s: OC_WS }, { n: 0 }]);
  const records = [];
  const re = /\{id:"usg_[A-Za-z0-9]+",workspaceID:"[^"]*",timeCreated:.*?new Date\("([^"]+)"\)\)?,timeUpdated:.*?,timeDeleted:(.*?),model:"([^"]+)",provider:"([^"]*)",inputTokens:(\d+),outputTokens:(\d+),reasoningTokens:(\d+),cacheReadTokens:(\d+),cacheWrite5mTokens:(\d+|null),cacheWrite1hTokens:(\d+|null),cost:(\d+),keyID:"[^"]*",sessionID:"[^"]*",enrichment:.*?\}/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    records.push({ time: m[1], model: m[3], provider: m[4], input: Number(m[5]), output: Number(m[6]), reasoning: Number(m[7]), cacheRead: Number(m[8]), cacheWrite5m: m[9] === 'null' ? 0 : Number(m[9]), cacheWrite1h: m[10] === 'null' ? 0 : Number(m[10]), cost: Number(m[11]) });
  }
  return records;
}

// ── Agent 桥（Hermes chat -q 一键提问，全工具+技能；--resume 续会话保上下文）──
const AGENT_PY = 'E:\\Agent\\hermes\\hermes-agent\\.venv\\Scripts\\python.exe';
const AGENT_CWD = 'E:\\Agent\\hermes';
const AGENT_SESSION_FILE = path.join(__dirname, 'data', 'agent_session.json');
let agentBusy = false;
function agentSession() {
  try { return JSON.parse(fs.readFileSync(AGENT_SESSION_FILE, 'utf8')).sessionId; } catch (e) { return null; }
}
function saveAgentSession(id) {
  try { fs.writeFileSync(AGENT_SESSION_FILE, JSON.stringify({ sessionId: id, updatedAt: Date.now() }), 'utf8'); } catch (e) {}
}
const AGENT_SCENES = {
  chat: '你是 读研工作台的 AI 助手（Hermes Agent）。请用中文简洁、务实地回答，不要长篇大论；需要时可以调用工具或技能。\n\n用户消息：',
  analysis: '你是 读研工作台的文献分析助手（Hermes Agent）。请对以下文献内容做深度分析，输出：研究主题、核心方法、创新点、局限、对你研究的可借鉴之处（方向：你的研究领域）。用中文，条理清晰。\n\n文献内容：',
  report: '你是科研助手。根据下面的本周工作记录（日期/时长/标签/内容），生成一份简洁周报：**本周概况**（总时长、有效天数）、**主要工作**（按标签归类要点）、**本周成果与亮点**、**下周建议**（1-2 条）。客观简洁，中文输出，可直接粘贴到组会汇报。\n\n本周工作记录：\n',
  writing: '你是学术写作助手。用户会指定任务：①论文大纲 ②文本润色/改写 ③投稿 cover letter。按用户指令执行，输出规范、可直接使用的完整文本（中文），不要多余解释。\n',
  import_lit: '你是 读研工作台的文献录入助手（Hermes Agent）。请完整读取用户提供的本地文献文件（PDF/文本，read_file 或 pdf 工具），提取元数据：title(标题)、authors(作者，逗号分隔)、year(年份)、journal(期刊/会议，未知填 Unknown)、doi(可空)、abstract(摘要，截取前 500 字)、url(原文链接，可空)。然后把该文件复制一份到 ./papers/ 目录（文件名保持原样）。最后把元数据写入 JSON 文件 ./data/agent_out/lit_<当前时间戳YYYYMMDD_HHMMSS>.json，结构：{"type":"literature","title":"Agent 文献发现 · <标题>","time":"<当前时间>","payload":[{title,authors,year,journal,doi,abstract,url,file}]}（file 字段=复制后的文件相对路径，如 papers/文件名.pdf；严格 JSON，用 UTF-8 写入）。文件路径：',
};

// Zotero 同步（官方 API；key 存 data/zotero_key.json；本地 23119 仅用于状态检测）
function zoteroKeyPath() { return path.join(DATA_DIR, 'zotero_key.json'); }
function zoteroKey() { try { return JSON.parse(fs.readFileSync(zoteroKeyPath(), 'utf8')).key || null; } catch (e) { return null; } }
function zoteroUid() { try { return JSON.parse(fs.readFileSync(zoteroKeyPath(), 'utf8')).uid || null; } catch (e) { return null; } }
function zoteroLocalAlive() {
  return new Promise(res => {
    const http = require('http');
    const req = http.get('http://localhost:23119/connector/ping', r => { r.resume(); res(true); });
    req.on('error', () => res(false));
    req.setTimeout(1500, () => { req.destroy(); res(false); });
  });
}
async function zoteroCreateItem(key, uid, meta) {
  const item = [{
    itemType: 'journalArticle',
    title: meta.title,
    creators: (meta.authors || '').split(/[,;，；]/).map(s => s.trim()).filter(Boolean).map((n, i) => {
      const parts = n.split(/\s+/);
      return { creatorType: 'author', firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] || n };
    }).slice(0, 20),
    date: meta.year || '',
    publicationTitle: meta.journal || '',
    DOI: meta.doi || '',
    abstractNote: (meta.abstract || '').slice(0, 3000),
    url: meta.url || '',
    collections: [], tags: [], relations: {},
  }];
  const r = await fetch('https://api.zotero.org/users/' + uid + '/items', {
    method: 'POST', headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3', 'Content-Type': 'application/json' }, body: JSON.stringify(item),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error('创建条目失败: ' + (d && d.message ? d.message : ('HTTP ' + r.status)));
  const success = Array.isArray(d) ? d.filter(x => x && x.successful).map(x => x.key) : (d && d.successful ? [d.key] : []);
  return success[0] || (d && d.key) || null;
}
async function zoteroUploadAttachment(key, uid, itemKey, filePath, fileName) {
  const fs2 = require('fs');
  const content = fs2.readFileSync(filePath);
  const ext = (fileName.split('.').pop() || 'pdf').toLowerCase();
  const mimes = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' };
  const fd = new FormData();
  fd.append('filename', fileName);
  fd.append('content', new Blob([content]), fileName);
  fd.append('contentType', mimes[ext] || 'application/octet-stream');
  fd.append('parentItem', itemKey);
  const r = await fetch('https://api.zotero.org/users/' + uid + '/items', {
    method: 'POST', headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' }, body: fd,
  });
  if (!r.ok) throw new Error('上传附件失败: HTTP ' + r.status);
  return true;
}

// DeepSeek 官网（platform.deepseek.com，Bearer token 存 data/deepseek_token.json）
const DS_BASE = 'https://platform.deepseek.com';
let dsCache = null, dsCacheAt = 0;
function dsTokenPath() { return path.join(DATA_DIR, 'deepseek_token.json'); }
function dsHdrs() {
  let token = null;
  try { token = JSON.parse(fs.readFileSync(dsTokenPath(), 'utf8')).token; } catch (e) {}
  return {
    'User-Agent': OC_UA,
    'Accept': 'application/json',
    'Referer': DS_BASE + '/usage',
    'Origin': DS_BASE,
    'x-client-bundle-id': 'com.deepseek.chat',
    'x-client-locale': 'zh_CN',
    'x-client-platform': 'web',
    'x-client-timezone-offset': '28800',
    'x-client-version': '1.0.0',
    ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
  };
}
function dsGet(path, query) {
  const url = DS_BASE + path + (query ? '?' + new URLSearchParams(query).toString() : '');
  return fetch(url, { headers: dsHdrs() }).then(async r => {
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
    if (!r.ok) throw new Error('DS ' + r.status + ': ' + (j.msg || j.detail || t.slice(0, 80)));
    if (j.code && j.code !== 200) throw new Error('DS ' + j.code + ': ' + (j.msg || ''));
    return j;
  });
}
function ocCookiePath() { return path.join(DATA_DIR, 'opencode_cookie.json'); }
function arTokenPath() { return path.join(__dirname, 'data', 'agentrouter_token.json'); }
function snTokenPath() { return path.join(__dirname, 'data', 'sensenova_token.json'); }
function snJwtExp(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return p.exp ? new Date(p.exp * 1000).toISOString() : '';
  } catch (e) { return ''; }
}
function parseOCGo(html) {
  const g = (name) => {
    const m = html.match(new RegExp(name + ':\\$R\\[\\d+\\]=\\{([^}]*)\\}'));
    if (!m) return null;
    const o = {};
    m[1].split(',').forEach(kv => { const i = kv.indexOf(':'); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1).replace(/^"|"$/g, ''); });
    return o;
  };
  return {
    rolling: g('rollingUsage'), weekly: g('weeklyUsage'), monthly: g('monthlyUsage'),
    balance: (html.match(/balance:(-?\d+),reload:/) || [])[1],
    reloadAmount: (html.match(/reloadAmount:(\d+)/) || [])[1],
    reloadTrigger: (html.match(/reloadTrigger:(\d+),/) || [])[1],
    useBalance: (html.match(/useBalance:(!0|!1)/) || [])[1] === '!0',
  };
}
function parseOCUsagePage(html) {
  const num = (v) => (v === null || v === undefined || v === 'null') ? 0 : Number(v);
  const records = [];
  // SSR hydration 数据：普通引号；cacheWrite* 可能是 null
  const re = /\{id:"(usg_[A-Za-z0-9]+)",workspaceID:"[^"]*",timeCreated:(.*?),timeUpdated:(.*?),timeDeleted:(.*?),model:"([^"]*)",provider:"([^"]*)",inputTokens:(\d+|null),outputTokens:(\d+|null),reasoningTokens:(\d+|null),cacheReadTokens:(\d+|null),cacheWrite5mTokens:(\d+|null),cacheWrite1hTokens:(\d+|null),cost:(\d+|null),keyID:"[^"]*",sessionID:"[^"]*"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const dateOf = (s) => { const d = s.match(/new Date\("([^"]+)"\)/); return d ? d[1].replace('T', ' ').slice(0, 16) : ''; };
    records.push({
      id: m[1], created: dateOf(m[2]), updated: dateOf(m[3]),
      model: m[5], provider: m[6],
      input: num(m[7]), output: num(m[8]), reasoning: num(m[9]),
      cacheRead: num(m[10]), cacheWrite5m: num(m[11]), cacheWrite1h: num(m[12]),
      cost: num(m[13]),
    });
  }
  // 汇总
  const byModel = {};
  let cost = 0, input = 0, output = 0, reasoning = 0, cacheRead = 0;
  records.forEach(r => {
    cost += r.cost; input += r.input; output += r.output; reasoning += r.reasoning; cacheRead += r.cacheRead;
    const k = r.model || '未知';
    byModel[k] = byModel[k] || { model: k, count: 0, cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0 };
    const b = byModel[k];
    b.count++; b.cost += r.cost; b.input += r.input; b.output += r.output; b.reasoning += r.reasoning; b.cacheRead += r.cacheRead;
  });
  return {
    records: records.slice(0, 50),
    summary: {
      count: records.length, cost, input, output, reasoning, cacheRead,
      costUsd: cost / 1e6,
      byModel: Object.values(byModel).sort((a, b) => b.cost - a.cost),
    },
  };
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 文件名白名单：字母数字 _ - . 无路径穿越
const NAME_RE = /^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$/;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function safeName(raw) {
  try {
    const name = decodeURIComponent(raw);
    return NAME_RE.test(name) ? name : null;
  } catch (e) { return null; }
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && parts[0] === 'control' && parts[1] === 'stop') {
    send(res, 200, { ok: true, message: 'stopping' });
    setTimeout(shutdown, 100);
    return;
  }
  if (req.method === 'GET' && parts[0] === 'health') {
    return send(res, 200, { ok: true, dir: DATA_DIR, out: OUT_DIR,
      service: 'grad-workbench-bridge', pid: process.pid,
      instance: process.env.WORKBENCH_INSTANCE_ID || null });
  }
  if (req.method === 'GET' && parts[0] === 'list' && parts[1]) {
    if (parts[1] !== 'agent_out') return send(res, 400, { error: 'only agent_out' });
    try {
      const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'));
      return send(res, 200, { files });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'GET' && parts[0] === 'read' && parts[1] === 'agent_out' && parts[2]) {
    const name = safeName(parts[2]);
    if (!name) return send(res, 400, { error: 'bad name' });
    const fp = path.join(OUT_DIR, name);
    try {
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'not found' });
      const text = fs.readFileSync(fp, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(text);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'GET' && parts[0] === 'wordbooks' && parts[1]) {
    const name = safeName(parts[1]);
    if (!name || !name.endsWith('.json')) return send(res, 400, { error: 'bad name' });
    const fp = path.join(__dirname, 'wordbooks', name);
    try {
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'not found' });
      const text = fs.readFileSync(fp, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(text);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && parts[0] === 'opencode' && parts[1] === 'cookie') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const ck = String(j.cookie || '').trim();
        if (!ck || !ck.includes('auth=')) return send(res, 400, { error: 'cookie 里没有 auth= 字段' });
        fs.writeFileSync(ocCookiePath(), JSON.stringify({ cookie: ck, savedAt: new Date().toISOString() }), 'utf8');
        ocCache = null;
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'opencode' && parts[1] === 'usage') {
    (async () => {
      if (ocCache && Date.now() - ocCacheAt < 15000) return send(res, 200, ocCache);
      let ckFile;
      try { ckFile = JSON.parse(fs.readFileSync(ocCookiePath(), 'utf8')); }
      catch (e) { return send(res, 400, { error: 'no_cookie', needCookie: true }); }
      const hdrs = { 'User-Agent': OC_UA, Cookie: ckFile.cookie, Accept: 'text/html' };
      const [goR, usR] = await Promise.all([
        fetch('https://opencode.ai/workspace/' + OC_WS + '/go', { headers: hdrs }),
        fetch('https://opencode.ai/workspace/' + OC_WS + '/usage', { headers: hdrs }),
      ]);
      if (!goR.ok && !usR.ok) return send(res, 502, { error: '官网返回 ' + goR.status, needCookie: goR.status === 403 });
      const [goHtml, usHtml] = await Promise.all([goR.ok ? goR.text() : '', usR.ok ? usR.text() : '']);
      const d = Object.assign(goHtml ? parseOCGo(goHtml) : {}, usHtml ? parseOCUsagePage(usHtml) : {});
      let monthUsage = [], records = [];
      try { monthUsage = await ocServerUsage(); } catch (e) { monthUsage = []; }
      try { records = await ocRecords(); } catch (e) { records = []; }
      ocCache = Object.assign({}, d, { fetchedAt: Date.now(), monthUsage, records });
      ocCacheAt = Date.now();
      send(res, 200, ocCache);
    })().catch(e => send(res, 500, { error: e.message }));
    return;
  }
  if (req.method === 'POST' && parts[0] === 'deepseek' && parts[1] === 'token') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const tok = String(j.token || '').trim();
        if (!tok) return send(res, 400, { error: 'token 为空' });
        fs.writeFileSync(dsTokenPath(), JSON.stringify({ token: tok, savedAt: new Date().toISOString() }), 'utf8');
        dsCache = null;
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'deepseek' && parts[1] === 'summary') {
    (async () => {
      if (dsCache && Date.now() - dsCacheAt < 15000) return send(res, 200, dsCache);
      if (!fs.existsSync(dsTokenPath())) return send(res, 400, { error: 'no_token', needToken: true });
      const j = await dsGet('/api/v0/users/get_user_summary');
      const biz = (j.data && j.data.biz_data) || {};
      const norm = (biz.normal_wallets || [])[0] || {};
      const bonus = (biz.bonus_wallets || [])[0] || {};
      const cost = (biz.total_costs || [])[0] || {};
      dsCache = {
        fetchedAt: Date.now(),
        balance: norm.balance != null ? Number(norm.balance) : null,
        currency: norm.currency || 'CNY',
        bonusBalance: bonus.balance != null ? Number(bonus.balance) : 0,
        totalCost: cost.amount != null ? Number(cost.amount) : 0,
        tokenEstimation: norm.token_estimation != null ? Number(norm.token_estimation) : 0,
      };
      dsCacheAt = Date.now();
      send(res, 200, dsCache);
    })().catch(e => send(res, 502, { error: e.message, needToken: /token|401|403/i.test(e.message) }));
    return;
  }
  if (req.method === 'GET' && parts[0] === 'deepseek' && parts[1] === 'keys') {
    (async () => {
      if (!fs.existsSync(dsTokenPath())) return send(res, 400, { error: 'no_token', needToken: true });
      const j = await dsGet('/api/v0/users/get_api_keys');
      send(res, 200, j.data || []);
    })().catch(e => send(res, 502, { error: e.message, needToken: /token|401|403/i.test(e.message) }));
    return;
  }
  if (req.method === 'GET' && parts[0] === 'deepseek' && parts[1] === 'usage') {
    (async () => {
      if (!fs.existsSync(dsTokenPath())) return send(res, 400, { error: 'no_token', needToken: true });
      // start/end 必须是 UTC 天边界（0 点），tz 必须为 0（平台限制，-480 等会 INVALID_PARAM）
      const now = new Date();
      const end = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000);
      const start = end - 30 * 86400;
      const q = { start, end, tz: 0 };
      const [costJ, amountJ] = await Promise.all([
        dsGet('/api/v0/usage/by_api_key/cost', q),
        dsGet('/api/v0/usage/by_api_key/amount', q),
      ]);
      send(res, 200, { fetchedAt: Date.now(), cost: costJ.data || {}, amount: amountJ.data || {} });
    })().catch(e => send(res, 502, { error: e.message, needToken: /token|401|403/i.test(e.message) }));
    return;
  }
  if (req.method === 'POST' && parts[0] === 'tokenrhythm' && parts[1] === 'cookie') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j.cookie) return send(res, 400, { error: 'cookie 为空' });
        fs.writeFileSync(path.join(DATA_DIR, 'tokenrhythm_cookie.json'), JSON.stringify({ cookie: String(j.cookie).trim(), updatedAt: new Date().toISOString() }, null, 2));
        send(res, 200, { ok: true });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'tokenrhythm' && parts[1] === 'usage') {
    (async () => {
      const fp = path.join(DATA_DIR, 'tokenrhythm_cookie.json');
      if (!fs.existsSync(fp)) return send(res, 400, { error: 'no_cookie', needCookie: true });
      const ck = JSON.parse(fs.readFileSync(fp, 'utf8')).cookie || '';
      if (!ck) return send(res, 400, { error: 'no_cookie', needCookie: true });
      const hdrs = { 'Accept': '*/*', 'Referer': 'https://tokenrhythm.studio/account/usage', 'Cookie': ck,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Edg/151.0.0.0' };
      const [balR, panelR] = await Promise.all([
        fetch('https://tokenrhythm.studio/api/usage-summary', { headers: hdrs }),
        fetch('https://tokenrhythm.studio/api/usage/panel?page=1&pageSize=10', { headers: hdrs }),
      ]);
      const balT = await balR.text();
      const panelT = await panelR.text();
      const balJ = JSON.parse(balT);
      const panelJ = JSON.parse(panelT);
      if (balJ.code !== 0) return send(res, 200, { needLogin: true, msg: balJ.message || '登录失效' });
      send(res, 200, { fetchedAt: Date.now(), data: { bal: balJ.data || {}, usage: panelJ.data || {} } });
    })().catch(e => send(res, 502, { error: e.message }));
    return;
  }
  // AI 转发代理：网页直调 API 的 CORS 桥（仅本地转发，不经 agent）
  if (req.method === 'POST' && parts[0] === 'ai' && parts[1] === 'chat') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const base = String(j.base || '').replace(/\/+$/, '');
        if (!/^https:\/\//.test(base)) return send(res, 400, { error: 'base 必须 https' });
        if (!j.key) return send(res, 400, { error: '缺少 key' });
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + j.key },
          body: JSON.stringify({ model: j.model || 'deepseek-chat', messages: j.messages || [], temperature: 0.7 }),
        });
        const t = await r.text();
        res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(t);
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'gen_examples') {
    // 为单词生成例句+中文翻译（生成今日单词时调用）
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const words = Array.isArray(j.words) ? j.words.slice(0, 20) : [];
        if (!words.length) return send(res, 400, { error: 'empty words' });
        let base = '', key = '', model = '';
        try {
          const apis = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sync.json'), 'utf8')).gradwb_apis_v1;
          const arr = typeof apis === 'string' ? JSON.parse(apis) : apis;
          for (const a of arr || []) {
            if (a && a.base && a.key) { base = String(a.base).replace(/\/+$/, ''); key = String(a.key); model = String(a.model || 'deepseek-chat'); break; }
          }
        } catch (e) {}
        if (!base || !key) return send(res, 400, { error: '未配置 API（API 管理页添加）' });
        let mdl = String(model || 'deepseek-chat').toLowerCase();
        if (mdl.includes('flash')) mdl = 'deepseek-v4-flash';
        else if (mdl.includes('pro') || mdl.includes('max')) mdl = 'deepseek-v4-pro';
        else mdl = 'deepseek-chat';
        const sys = '你是英语例句生成助手。为每个单词生成一个自然贴切的英文例句（用该词原形），并给出简洁自然的中文翻译。只输出 JSON 数组，每项 {"i":序号,"ex":"英文例句","ex_cn":"中文翻译"}，不要任何其他文字或解释。';
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: mdl, temperature: 0.6, messages: [
            { role: 'system', content: sys },
            { role: 'user', content: JSON.stringify(words.map((w, i) => ({ i: i, w: w.w, cn: w.cn }))) }
          ] }),
        });
        const t = await r.text();
        if (!r.ok) return send(res, r.status, { error: '上游 ' + r.status + ': ' + t.slice(0, 120) });
        let content = '';
        try { content = JSON.parse(t).choices[0].message.content || ''; } catch (e) { return send(res, 502, { error: '解析上游响应失败' }); }
        const m = content.match(/\[[\s\S]*\]/);
        const arr2 = JSON.parse(m ? m[0] : content);
        const out = {};
        (Array.isArray(arr2) ? arr2 : []).forEach(x => {
          if (x && typeof x.i === 'number' && x.ex) out[x.i] = { ex: String(x.ex), ex_cn: String(x.ex_cn || '') };
        });
        send(res, 200, { ex: out });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'translate') {
    // 例句翻译：读用户 API 配置，批量翻译英文例句为中文
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const sentences = Array.isArray(j.sentences) ? j.sentences.slice(0, 80) : [];
        if (!sentences.length) return send(res, 400, { error: 'empty sentences' });
        // 从 sync.json 的 API 配置里取第一个可用 key
        let base = '', key = '', model = '';
        try {
          const apis = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sync.json'), 'utf8')).gradwb_apis_v1;
          const arr = typeof apis === 'string' ? JSON.parse(apis) : apis;
          for (const a of arr || []) {
            if (a && a.base && a.key) { base = String(a.base).replace(/\/+$/, ''); key = String(a.key); model = String(a.model || 'deepseek-chat'); break; }
          }
        } catch (e) {}
        if (!base || !key) return send(res, 400, { error: '未配置 API（API 管理页添加）' });
        // model 规范化：用户配置的是显示名（Deepseek-V4-Flash），API 要 deepseek-v4-flash
        let mdl = String(model || 'deepseek-chat').toLowerCase();
        if (mdl.includes('flash')) mdl = 'deepseek-v4-flash';
        else if (mdl.includes('pro') || mdl.includes('max')) mdl = 'deepseek-v4-pro';
        else mdl = 'deepseek-chat';
        const sys = '你是翻译助手。把用户给出的英文例句逐句翻译成简洁自然的中文（学术语境）。只输出 JSON 数组，每项 {"i":序号,"cn":"中文翻译"}，不要任何其他文字或解释。';
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: mdl, temperature: 0.2, messages: [
            { role: 'system', content: sys },
            { role: 'user', content: JSON.stringify(sentences.map((s, i) => ({ i: i, s: s }))) }
          ] }),
        });
        const t = await r.text();
        if (!r.ok) return send(res, r.status, { error: '上游 ' + r.status + ': ' + t.slice(0, 120) });
        let content = '';
        try { content = JSON.parse(t).choices[0].message.content || ''; } catch (e) { return send(res, 502, { error: '解析上游响应失败' }); }
        const m = content.match(/\[[\s\S]*\]/);
        const arr2 = JSON.parse(m ? m[0] : content);
        const out = {};
        (Array.isArray(arr2) ? arr2 : []).forEach(x => { if (x && typeof x.i === 'number' && x.cn) out[x.i] = String(x.cn); });
        send(res, 200, { cn: out });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'agentrouter' && parts[1] === 'token') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const t = String(j.token || '').trim();
        if (!t) return send(res, 400, { error: '令牌为空' });
        fs.writeFileSync(arTokenPath(), JSON.stringify({ token: t, savedAt: new Date().toISOString() }), 'utf8');
        send(res, 200, { ok: true });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'agentrouter' && parts[1] === 'usage') {
    (async () => {
      try {
        let cfg;
        try { cfg = JSON.parse(fs.readFileSync(arTokenPath(), 'utf8')); }
        catch (e) { return send(res, 401, { needToken: true, error: '未配置访问令牌' }); }
        if (!cfg.token && !cfg.cookie) return send(res, 401, { needToken: true, error: '未配置访问凭证' });
        const proxy = cfg.proxy || 'socks5h://127.0.0.1:10808';
        const base = cfg.base || 'https://agentrouter.org';
        const headers = ['-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0', '-H', 'Accept: application/json'];
        if (cfg.token) headers.push('-H', 'Authorization: Bearer ' + cfg.token);
        if (cfg.cookie) headers.push('-H', 'Cookie: ' + cfg.cookie);
        if (cfg.userId) headers.push('-H', 'New-API-User: ' + cfg.userId);
        const fetchAr = (p) => new Promise((resolve) => {
          const args = ['-s', '--max-time', '25', '-x', proxy, ...headers, base + p];
          execFile('curl', args, { encoding: 'utf8', maxBuffer: 4e6 }, (err, stdout) => {
            if (err) return resolve({ err: err.message });
            try { resolve({ data: JSON.parse(stdout) }); } catch (e) { resolve({ err: '解析失败: ' + stdout.slice(0, 100) }); }
          });
        });
        const self = await fetchAr('/api/user/self');
        if (self.err) return send(res, 502, { error: self.err });
        if (!self.data || self.data.success === false) {
          const msg = (self.data && self.data.message) || '认证失败';
          return send(res, 401, { needToken: /token|登录|无权/i.test(msg), error: msg });
        }
        const u = self.data.data || self.data;
        const qpu = Number(u.quota_per_unit) || 500000;
        const tokens = await fetchAr('/api/token/?p=0&size=100');
        let items = [];
        if (tokens.data && tokens.data.success !== false && Array.isArray(tokens.data.data)) {
          items = tokens.data.data.map(t => ({
            name: t.name, status: t.status,
            remain: (Number(t.remain_quota) || 0) / qpu,
            used: (Number(t.used_quota) || 0) / qpu,
            unlimited: !!t.unlimited_quota,
            requests: Number(t.request_count) || 0,
          }));
        }
        send(res, 200, {
          username: u.username || '',
          quota: u.quota != null ? Number(u.quota) / qpu : null,
          used: u.used_quota != null ? Number(u.used_quota) / qpu : null,
          requests: Number(u.request_count) || 0,
          tokens: items,
          fetchedAt: new Date().toISOString(),
        });
      } catch (e) { send(res, 500, { error: e.message }); }
    })();
    return;
  }
  if (req.method === 'POST' && parts[0] === 'supxin' && parts[1] === 'cookie') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const ck = String(j.cookie || '').trim();
        if (!ck) return send(res, 400, { error: 'Cookie 为空' });
        fs.writeFileSync(path.join(DATA_DIR, 'supxin_cookie.json'), JSON.stringify({ cookie: ck, savedAt: new Date().toISOString() }), 'utf8');
        send(res, 200, { ok: true });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'supxin' && parts[1] === 'usage') {
    (async () => {
      try {
        const fp = path.join(DATA_DIR, 'supxin_cookie.json');
        if (!fs.existsSync(fp)) return send(res, 401, { needCookie: true, error: '未配置登录 Cookie' });
        const ck = JSON.parse(fs.readFileSync(fp, 'utf8')).cookie || '';
        const hdrs = { 'Accept': '*/*', 'Cookie': ck, 'Referer': 'https://free.supxh.xin/dashboard/invite',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0' };
        const [meR, quR] = await Promise.all([
          fetch('https://free.supxh.xin/api/auth/me', { headers: hdrs }),
          fetch('https://free.supxh.xin/api/user/quota/sync?force=1', { headers: hdrs }),
        ]);
        const me = await meR.json();
        const qu = await quR.json();
        if (!me.success) return send(res, 401, { needCookie: true, error: (me.message || '登录失效') });
        const m = me.data || {};
        const q = (qu.data || {});
        send(res, 200, {
          username: m.username || '',
          quota: Number(m.quota) || 0,
          permanent: Number(m.permanentQuota) || 0,
          daily: Number(m.dailyQuota) || 0,
          isVip: !!m.isVip,
          apiKey: m.apiKey || '',
          inviteCode: m.inviteCode || '',
          inviteCount: Number(m.inviteCount) || 0,
          inviteRewards: Number(m.inviteRewards) || 0,
          weekReward: m.inviteWeekReward || null,
          rawRemain: Number(q.rawRemainQuota) || null,
          rawUsed: Number(q.rawUsedQuota) || null,
          fetchedAt: new Date().toISOString(),
        });
      } catch (e) { send(res, 502, { error: e.message }); }
    })();
    return;
  }
  // SenseNova 商汤：token 保存 / 用量查询（coding-plan 剩余% + 按天调用次数）
  if (parts[0] === 'sensenova' && parts[1] === 'token' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        const jwt = String(b.jwt || '').trim();
        if (!jwt) return send(res, 400, { ok: false, error: '缺少 JWT' });
        fs.writeFileSync(snTokenPath(), JSON.stringify({ jwt, cookie: String(b.cookie || '').trim(), savedAt: new Date().toISOString() }, null, 2));
        send(res, 200, { ok: true });
      } catch (e) { send(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }
  if (parts[0] === 'sensenova' && parts[1] === 'usage' && req.method === 'GET') {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(snTokenPath(), 'utf8')); } catch (e) { return send(res, 200, { needLogin: true, error: '未配置商汤登录' }); }
    if (!cfg.jwt) return send(res, 200, { needLogin: true, error: '未配置商汤登录' });
    // 自动续期：JWT 剩余不足 2 小时 → 跑 sn-refresh.js 换新 token（约 15s）
    const tryFetch = () => {
      let cfg2;
      try { cfg2 = JSON.parse(fs.readFileSync(snTokenPath(), 'utf8')); } catch (e) { return send(res, 200, { needLogin: true, error: '未配置商汤登录' }); }
      const hdrs = ['-H', 'Accept: application/json', '-H', 'Authorization: Bearer ' + cfg2.jwt, '-H', 'User-Agent: Mozilla/5.0'];
      if (cfg2.cookie) hdrs.push('-H', 'Cookie: ' + cfg2.cookie);
      const base = 'https://platform.sensenova.cn/lite/console/v1';
      let acc = '';
      try {
        const p = JSON.parse(Buffer.from(cfg2.jwt.split('.')[1], 'base64url').toString('utf8'));
        acc = (p.ext && (p.ext.tenant_id || p.ext.principal_id)) || p.tenant_id || p.principal_id || '';
      } catch (e) {}
      execFile('curl', ['-s', '--max-time', '15', base + '/user/coding-plan/usages?account_id=' + encodeURIComponent(acc), ...hdrs], (e1, s1) => {
        if (e1 || !s1) return send(res, 200, { needLogin: true, error: '商汤接口请求失败' });
        let rem = {};
        try { const d = JSON.parse(s1); rem = d.model_remaining_percent || {}; } catch (e) {}
        const usageByModel = {};
        const models = ['sensenova-6.8-flash-lite', 'sensenova-u1-fast', 'deepseek-v4-flash', 'glm-5.2'];
        let left = models.length;
        const done = () => {
          if (--left > 0) return;
          send(res, 200, {
            account: '', remaining: rem, usages: usageByModel,
            fetchedAt: new Date().toISOString(), jwtExp: snJwtExp(cfg2.jwt)
          });
        };
        if (!acc) { usageByModel.err = '无 account_id（JWT 解析失败）'; return done(); }
        const end = new Date(); const start = new Date(Date.now() - 7 * 864e5);
        const f = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
        for (const m of models) {
          const q = `?account_id=${encodeURIComponent(acc)}&model_name=${encodeURIComponent(m)}&granularity=DAY&start_time=${encodeURIComponent(f(start))}&end_time=${encodeURIComponent(f(end))}`;
          execFile('curl', ['-s', '--max-time', '12', base + '/user/token/usages' + q, ...hdrs], (e2, s2) => {
            try {
              const d = JSON.parse(s2 || '{}');
              const pts = ((d.metrics || {}).COUNTER_CALL_COUNT || {}).data || [];
              usageByModel[m] = pts.map(p => ({ t: (p.start_time || '').slice(0, 10), n: Number(p.count) || 0 }));
            } catch (e) { usageByModel[m] = []; }
            done();
          });
        }
      });
    };
    const expMs = new Date(snJwtExp(cfg.jwt) || 0).getTime();
    if (expMs && expMs - Date.now() < 2 * 36e5) {
      execFile('node', [path.join(__dirname, 'sn-refresh.js')], { timeout: 60000 }, () => tryFetch());
    } else {
      tryFetch();
    }
    return;
  }
  // Zotero：状态 / 保存 / 配置 key
  if (req.method === 'GET' && parts[0] === 'zotero' && parts[1] === 'status') {
    zoteroLocalAlive().then(local => {
      send(res, 200, { zoteroLocal: local, keyConfigured: !!zoteroKey(), uid: zoteroUid() });
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'zotero' && parts[1] === 'key') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const key = String(j.key || '').trim();
        if (!key) return send(res, 400, { error: '请填写 Zotero API Key' });
        // 用 key 换取 userID（GET /keys/current）
        fetch('https://api.zotero.org/keys/current', { headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' } })
          .then(async r => {
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || !d.userID) throw new Error('Key 无效：' + (d && d.message ? d.message : ('HTTP ' + r.status)));
            fs.writeFileSync(zoteroKeyPath(), JSON.stringify({ key: key, uid: d.userID, name: d.access && d.access.user ? d.access.user.username : '' }));
            send(res, 200, { ok: true, uid: d.userID, name: d.access && d.access.user ? d.access.user.username : '' });
          })
          .catch(e => send(res, 400, { error: e.message }));
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && parts[0] === 'zotero' && parts[1] === 'save') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const key = zoteroKey(), uid = zoteroUid();
        if (!key || !uid) return send(res, 400, { error: '尚未配置 Zotero API Key（Zotero → 设置 → 高级 → 重置 API key）' });
        if (!j.title) return send(res, 400, { error: '缺少标题' });
        const meta = { title: String(j.title), authors: String(j.authors || ''), year: String(j.year || ''), journal: String(j.journal || ''), doi: String(j.doi || ''), abstract: String(j.abstract || ''), url: String(j.url || '') };
        let itemKey = await zoteroCreateItem(key, uid, meta);
        let fileSaved = false;
        if (j.filePath) {
          const fp = path.join(__dirname, String(j.filePath));
          if (fs.existsSync(fp)) {
            const name = path.basename(fp);
            await zoteroUploadAttachment(key, uid, itemKey, fp, name);
            fileSaved = true;
          }
        }
        send(res, 200, { ok: true, itemKey: itemKey, fileSaved: fileSaved, url: 'https://www.zotero.org/users/' + uid + '/items/' + itemKey });
      } catch (e) { send(res, 500, { error: 'Zotero 保存失败：' + e.message }); }
    });
    return;
  }
  // 文件上传（网页 → 桥 → data/uploads/，供 agent 读取分析）
  if (req.method === 'POST' && parts[0] === 'upload') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30 * 1024 * 1024) { body = ''; req.destroy(); } });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        if (!j || !j.name || !j.data) return send(res, 400, { error: '参数缺失' });
        const dir = path.join(DATA_DIR, 'uploads');
        await fs.promises.mkdir(dir, { recursive: true });
        const b64 = String(j.data).includes(',') ? String(j.data).split(',')[1] : String(j.data);
        const buf = Buffer.from(b64, 'base64');
        const safe = path.basename(String(j.name)).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120) || 'file.bin';
        const rel = path.join('uploads', safe);
        await fs.promises.writeFile(path.join(DATA_DIR, rel), buf);
        console.log('[bridge] upload:', safe, buf.length + 'B');
        send(res, 200, { ok: true, name: safe, path: rel });
      } catch (e) { console.error('[upload error]', e); send(res, 500, { error: '上传失败：' + e.message }); }
    });
    return;
  }
  // Agent 聊天/分析：spawn Hermes chat -q（同步等待，互斥）
  if (req.method === 'POST' && parts[0] === 'agent' && parts[1] === 'chat') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      let j;
      try { j = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'JSON 解析失败' }); }
      const text = String(j.text || '').trim();
      if (!text && !j.file) return send(res, 400, { error: '消息为空' });
      const scene = AGENT_SCENES[j.scene] ? j.scene : 'chat';
      if (agentBusy) return send(res, 429, { error: '上一个 Agent 请求还在处理中，请稍候' });
      agentBusy = true;
      const { spawn } = require('child_process');
      const prev = agentSession();
      // 附加待分析文件（data/uploads/ 下的相对路径 → 绝对路径提示 agent 读取）
      let prompt = text;
      if (j.file) {
        const abs = path.join(DATA_DIR, String(j.file).replace(/^uploads[\\/]/, 'uploads/'));
        prompt = (text ? text + '\n\n' : '') +
          '【待分析文献文件】' + abs.replace(/\\/g, '/') +
          '\n请先完整读取该文件内容（PDF 可用 read_file 或 pdf 工具），再按用户要求分析。';
      }
      // 查询写入临时文件（UTF-8），Python 包装脚本执行（避免 Windows argv 中文编码损坏）
      const qfile = path.join(__dirname, 'data', 'agent_q_' + Date.now() + '.txt');
      try { fs.writeFileSync(qfile, prompt, 'utf8'); } catch (e) { agentBusy = false; return send(res, 500, { error: '写查询文件失败: ' + e.message }); }
      const runner = path.join(__dirname, 'agent_runner.py');
      const args = [runner, qfile, scene];
      if (prev) args.push(prev);
      const proc = spawn(AGENT_PY, args, {
        cwd: AGENT_CWD,
        env: Object.assign({}, process.env, { HERMES_HOME: AGENT_CWD, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
        windowsHide: true,
      });
      let out = '', err = '';
      const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, 490000);
      proc.stdout.on('data', d => { out += d; if (out.length > 2e6) proc.kill(); });
      proc.stderr.on('data', d => { err += d; });
      proc.on('error', e => {
        clearTimeout(timer); agentBusy = false;
        try { fs.unlinkSync(qfile); } catch (e2) {}
        send(res, 500, { error: '启动 Hermes 失败: ' + e.message });
      });
      proc.on('close', code => {
        clearTimeout(timer); agentBusy = false;
        try { fs.unlinkSync(qfile); } catch (e2) {}
        let d = {};
        try { d = JSON.parse(out.trim() || '{}'); } catch (e) {}
        if (code !== 0 || d.code !== 0) {
          return send(res, 500, { error: d.error || ('Hermes 异常退出(' + code + ')') + (err ? ' ' + err.slice(-150) : '') });
        }
        if (d.sessionId) saveAgentSession(d.sessionId);
        send(res, 200, { reply: d.reply || '', sessionId: d.sessionId || prev || null });
      });
    });
    return;
  }
  if (req.method === 'GET' && parts[0] === 'sync') {
    const fp = path.join(DATA_DIR, 'sync.json');
    try {
      if (!fs.existsSync(fp)) return send(res, 200, {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(fs.readFileSync(fp, 'utf8'));
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && parts[0] === 'sync') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        JSON.parse(body); // 校验是合法 JSON
        const fp = path.join(DATA_DIR, 'sync.json');
        // 写入前自动备份旧快照（防丢：sync.json 被覆盖前留底，保留最近 20 份）
        if (fs.existsSync(fp)) {
          const bakDir = path.join(DATA_DIR, 'backups');
          fs.mkdirSync(bakDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          fs.copyFileSync(fp, path.join(bakDir, 'sync_' + ts + '.json'));
          try {
            const olds = fs.readdirSync(bakDir).filter(f => f.startsWith('sync_') && f.endsWith('.json')).sort();
            while (olds.length > 20) fs.unlinkSync(path.join(bakDir, olds.shift()));
          } catch (e) {}
        }
        fs.writeFileSync(fp, body, 'utf8');
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { error: 'invalid json' }); }
    });
    return;
  }
  send(res, 404, { error: 'not found' });
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  if (server.closeIdleConnections) server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', error => {
  console.error('[bridge] listen failed:', error.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('[bridge] listening on http://127.0.0.1:' + PORT);
});
