/* ============ 防白屏：全局错误捕获（任何运行时报错显示红色提示条） ============ */
(function () {
  function showFatal(msg) {
    try {
      var box = document.getElementById('fatalErr');
      if (!box) {
        box = document.createElement('div');
        box.id = 'fatalErr';
        box.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:999999;background:#dc3545;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:92vw;cursor:pointer';
        box.title = '点击关闭';
        box.addEventListener('click', function () { box.style.display = 'none'; });
        document.body.appendChild(box);
      }
      box.textContent = '⚠️ 页面出错了：' + msg;
      box.style.display = 'block';
    } catch (e) { /* 什么都做不了 */ }
  }
  window.addEventListener('error', function (e) { showFatal(e.message); });
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e.reason && e.reason.message) ? e.reason.message : String(e.reason || 'Promise 异常');
    showFatal(m);
  });
})();
// ============ 读研工作台 V1.0 正式版 ============

/* ---------- 工具 ---------- */
const WEEK = ['日','一','二','三','四','五','六'];
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtCN(k) { const [y, m, d] = k.split('-'); return `${y}年${+m}月${+d}日`; }
function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } }
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  scheduleSync();
}
/* ============ Agent 桥（本地服务 127.0.0.1:5177，自动同步到 data/sync.json） ============ */
const BRIDGE = 'http://127.0.0.1:5177';
let bridgeOnline = false;
let bridgeSyncTimer = null;
function bridgeCheck() {
  fetch(BRIDGE + '/health', { mode: 'cors' })
    .then(r => r.json()).then(() => { bridgeOnline = true; pushSync(); updateBridgeUI(); loadFullWordBooks(); })
    .catch(() => { bridgeOnline = false; updateBridgeUI(); });
}
/* --- 完整词库：桥在线时从 wordbooks/ 目录加载（替代内置核心版） --- */
let fullBooksLoaded = false;
async function loadFullWordBooks() {
  if (!bridgeOnline || fullBooksLoaded) return;
  const map = { '六级核心': 'cet6.json', '考研核心': 'kaoyan.json', '雅思核心': 'ielts.json' };
  const books = loadWordBooks();
  let changed = false;
  for (const [bookName, fname] of Object.entries(map)) {
    try {
      const r = await fetch(BRIDGE + '/wordbooks/' + fname, { mode: 'cors' });
      if (!r.ok) continue;
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length || arr.length < 100) continue;
      const seen = new Set(arr.map(w => String(w.word || '').toLowerCase()));
      const merged = arr.map(w => ({ word: String(w.word || '').trim(), ipa: w.ipa || '', cn: w.cn || '', ex: w.ex || '' }));
      (books[bookName] || []).forEach(w => { if (w.word && !seen.has(w.word.toLowerCase())) merged.push(w); });
      books[bookName] = merged;
      changed = true;
    } catch (e) {}
  }
  if (changed) { saveWordBooks(books); renderEnglish(); }
  fullBooksLoaded = true;
}
function updateBridgeUI() {
  const st = document.getElementById('agentStatus');
  if (st) {
    const on = !!bridgeOnline;
    st.classList.toggle('off', !on);
    st.querySelector('.as-text').textContent = on ? '桥已连接' : '桥未连接';
  }
  const el = document.getElementById('bridgeInd');
  if (el) {
    el.textContent = bridgeOnline ? '⏹ 关闭桥服务' : '🔌 桥已关闭（点击开启）';
    el.className = 'bridge-ind ' + (bridgeOnline ? 'on' : 'off');
  }
}
document.getElementById('bridgeInd').addEventListener('click', () => {
  if (bridgeOnline) {
    myConfirm('关闭 Agent 桥服务？\n关闭后网页与 Agent 的数据同步暂停（已同步的数据不丢失）。\n下次需要时：双击桌面「开启工作台桥」，或对 Hermes 说「开桥」。', () => {
      fetch(BRIDGE + '/control/stop', { method: 'POST', mode: 'cors' })
        .then(() => { bridgeOnline = false; updateBridgeUI(); toast('✅ 桥服务已关闭，内存已释放。'); })
        .catch(() => { bridgeOnline = false; updateBridgeUI(); toast('桥服务已关闭。'); });
    });
  } else {
    toast('开启 Agent 桥的两种方式：\n① 双击桌面「开启工作台桥」图标\n② 在 Hermes 对话里说「开桥」，我会帮你启动');
  }
});
/* ============ 数据恢复：新环境（localStorage 空）自动从桥端 sync.json 拉回缺失数据 ============ */
(function () {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  try {
    fetch('http://127.0.0.1:5177/sync')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || typeof d !== 'object') return;
        var need = false;
        Object.keys(d).forEach(function (k) {
          if (k.indexOf('gradwb_') === 0 && localStorage.getItem(k) === null && d[k] != null) {
            localStorage.setItem(k, String(d[k]));
            need = true;
          }
        });
        if (need) location.reload();
      })
      .catch(function () {});
  } catch (e) {}
})();

function scheduleSync() {
  if (!bridgeOnline) return;
  clearTimeout(bridgeSyncTimer);
  bridgeSyncTimer = setTimeout(pushSync, 1500);
}
function pushSync() {
  if (!bridgeOnline) return;
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('gradwb_')) data[k] = localStorage.getItem(k);
  }
  fetch(BRIDGE + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .catch(() => {});
}
/* 启动后主动同步一次：本环境数据推到桥端快照（供换环境/换浏览器时恢复） */
setTimeout(function () {
  try {
    if (typeof bridgeOnline !== 'undefined' && bridgeOnline) pushSync();
  } catch (e) {}
}, 4000);

/* --- 轮询 agent 结果并导入 --- */
let agentPending = [];
function checkAgentOut() {
  if (!bridgeOnline) return;
  fetch(BRIDGE + '/list/agent_out', { mode: 'cors' })
    .then(r => r.json())
    .then(d => {
      if (!d.files || !d.files.length) return;
      const done = JSON.parse(localStorage.getItem('gradwb_bridge_done') || '[]');
      const fresh = d.files.filter(f => !done.includes(f));
      if (fresh.length) { agentPending = fresh; showAgentToast(fresh.length); }
    })
    .catch(() => {});
}
function showAgentToast(n) {
  const el = document.getElementById('agentToast');
  if (el) {
    el.classList.add('show');
    el.querySelector('.agent-toast-text').textContent = `📥 Agent 完成了 ${n} 项任务（文献分析 / 词库生成…）`;
  }
}
function hideAgentToast() {
  const el = document.getElementById('agentToast');
  if (el) el.classList.remove('show');
}
async function importAgentResults() {
  const files = agentPending.slice();
  for (const f of files) {
    try {
      const r = await fetch(BRIDGE + '/read/agent_out/' + encodeURIComponent(f), { mode: 'cors' });
      const item = await r.json();
      handleAgentOut(item);
      const done = JSON.parse(localStorage.getItem('gradwb_bridge_done') || '[]');
      done.push(f);
      localStorage.setItem('gradwb_bridge_done', JSON.stringify(done));
    } catch (e) {}
  }
  agentPending = [];
  hideAgentToast();
  toast('✅ 已导入 Agent 的结果');
}
function handleAgentOut(item) {
  if (!item || !item.type) return;
  if (item.type === 'analysis' && item.payload) {
    const list = loadAnalyses();
    list.unshift({ id: uid(), input: item.title || 'Agent 深度分析', result: item.payload, time: item.time || new Date().toLocaleString('zh-CN'), api: 'Hermes Agent' });
    saveAnalyses(list);
    renderAnalysisHistory();
    // 弹出结果详情
    const box = document.getElementById('analysisResult');
    if (box) box.innerHTML = `<div class="res-p" style="white-space:pre-wrap">${esc(item.payload)}</div>`;
    showPage('analysis');
  } else if (item.type === 'wordbook' && Array.isArray(item.payload)) {
    const books = loadWordBooks();
    const existing = books['光计算'] || [];
    const seen = new Set(existing.map(w => w.word.toLowerCase()));
    item.payload.forEach(w => {
      if (!w || !w.word || seen.has(w.word.toLowerCase())) return;
      seen.add(w.word.toLowerCase());
      existing.push({ word: w.word, ipa: w.ipa || '', cn: w.cn || '', ex: w.ex || '' });
    });
    books['光计算'] = existing;
    saveWordBooks(books);
    setCurBook('光计算');
    renderEnglish();
  } else if (item.type === 'radar' && Array.isArray(item.payload)) {
    const r = loadRadar();
    r.recs = item.payload;
    saveRadar(r);
    renderRadar();
  } else if (item.type === 'literature' && Array.isArray(item.payload)) {
    // Agent 文献发现：批量入库（去重）
    const list = loadLibrary();
    const seen = new Set(list.map(x => (x.title || '').toLowerCase()));
    let added = 0;
    item.payload.forEach(p => {
      if (!p || !p.title || seen.has(String(p.title).toLowerCase())) return;
      seen.add(String(p.title).toLowerCase());
      list.push({
        id: uid(), title: String(p.title).slice(0, 300),
        authors: p.authors || '', year: p.year || '',
        journal: p.journal || 'arXiv', doi: p.doi || '',
        abstract: (p.abstract || '').slice(0, 2000), url: p.url || '',
        status: '未读', addedAt: todayKey(),
      });
      added++;
    });
    saveLibrary(list);
    renderLibrary();
    showPage('library');
    toast(`✅ Agent 为你发现并入库 ${added} 篇新文献（已去重）`);
    // 若带文件且配置了 Zotero → 自动同步（不阻塞）
    const withFile = item.payload.find(p => p.file);
    if (withFile && withFile.file && zotConfig && zotConfig.keyConfigured) {
      fetch(BRIDGE + '/zotero/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: withFile.title, authors: withFile.authors, year: withFile.year, journal: withFile.journal, doi: withFile.doi, abstract: withFile.abstract, url: withFile.url, filePath: withFile.file }),
      }).catch(() => { /* 同步失败不阻塞 */ });
    }
  } else if (item.type === 'message') {
    toast('📩 Agent 消息：' + (item.payload || item.title || ''));
  }
}
/* --- opencode 官网用量同步（经桥代理，key/cookie 不出本机） --- */
function formatReset(sec) {
  if (sec <= 0) return '';
  if (sec < 3600) return `· ${Math.ceil(sec / 60)} 分钟后重置`;
  if (sec < 86400) return `· ${Math.round(sec / 3600)} 小时后重置`;
  return `· ${Math.round(sec / 86400)} 天后重置`;
}
function renderOCUsage() {
  const box = document.getElementById('ocUsage');
  const hint = document.getElementById('ocSyncHint');
  if (!box) return;
  if (!bridgeOnline) {
    box.innerHTML = `<div class="mini-empty">桥未连接，无法同步官网数据<br><span class="mini-hint">开启桥服务（侧边栏按钮）后自动显示真实用量</span></div>`;
    if (hint) hint.textContent = '';
    return;
  }
  if (hint) hint.textContent = '正在同步…';
  fetch(BRIDGE + '/opencode/usage', { mode: 'cors' })
    .then(r => r.json())
    .then(d => {
      if (hint) hint.textContent = '';
      const stOC = document.getElementById('apiStatOC');
      const stSync = document.getElementById('apiStatSync');
      if (d.error) {
        if (d.needCookie) box.innerHTML = `<div class="mini-empty">⚠️ 官网登录已失效或未配置<br><span class="mini-hint">点「🔑 更新官网登录」粘贴 Cookie 后自动同步</span></div>`;
        else box.innerHTML = `<div class="mini-empty">同步失败：${esc(d.error)}</div>`;
        if (stOC) stOC.textContent = '—';
        return;
      }
      if (stOC) stOC.textContent = (d.weekly && d.weekly.usagePercent != null ? d.weekly.usagePercent + '%' : '—');
      if (stSync) stSync.textContent = new Date(d.fetchedAt).toLocaleTimeString('zh-CN');
      const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
      const resetOf = (u) => u ? formatReset(Number(u.resetInSec) || 0) : '';
      const colorOf = (p) => p >= 90 ? '#e5484d' : p >= 60 ? '#e8a33d' : '#2f9e6e';
      const miniBar = (p) => `<div class="oc-minibar"><div class="oc-minifill" style="width:${p}%;background:${colorOf(p)}"></div></div>`;
      const bal = d.useBalance ? (Number(d.balance) || 0) : null;
      const usd = (c2) => { const v = Number(c2) / 1e8; return '$' + (v >= 0.005 ? v.toFixed(2) : v.toFixed(4)); };
      const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
      const card = (n, l, s) => `<div class="jy-card"><div class="jy-num">${n}</div><div class="jy-label">${l}</div>${s ? `<div class="jy-sub">${s}</div>` : ''}</div>`;
      const recs = Array.isArray(d.records) ? d.records : [];
      const wp = pct(d.weekly && d.weekly.usagePercent);
      let rows = `<div class="ds-bal-row">`;
      rows += `<div class="ds-bal-card"><div class="ds-bal-label">充值余额</div><div class="ds-bal-num">${bal === null ? '未启用' : '¥' + bal}</div><div class="ds-bal-sub">${d.reloadAmount ? `低于 ¥${d.reloadTrigger} 自动充值 ¥${d.reloadAmount}` : '订阅制（余额可选充值）'}</div></div>`;
      rows += `<div class="ds-bal-card"><div class="ds-bal-label">每周用量</div><div class="ds-bal-num">${wp}%</div>${miniBar(wp)}<div class="ds-bal-sub" style="margin-top:6px">${resetOf(d.weekly) ? resetOf(d.weekly) + ' 后重置' : ''}</div></div>`;
      rows += `</div>`;
      rows += `<div class="jy-cards">` +
        card(pct(d.rolling && d.rolling.usagePercent) + '%', '滚动用量', resetOf(d.rolling) ? resetOf(d.rolling) + ' 后重置' : '') +
        card(pct(d.monthly && d.monthly.usagePercent) + '%', '每月用量', resetOf(d.monthly) ? resetOf(d.monthly) + ' 后重置' : '') +
        `</div>`;
      if (recs.length) {
        const byModel = {};
        recs.forEach(r => {
          const b = (byModel[r.model] = byModel[r.model] || { count: 0, input: 0, output: 0, cacheRead: 0, cost: 0 });
          b.count++; b.input += r.input; b.output += r.output; b.cacheRead += r.cacheRead; b.cost += r.cost;
        });
        const totalCost = recs.reduce((a, r) => a + (r.cost || 0), 0);
        const totalTokens = recs.reduce((a, r) => a + (r.input || 0) + (r.output || 0) + (r.reasoning || 0) + (r.cacheRead || 0), 0);
        rows += `<div class="jy-cards">` +
          card(usd(totalCost), '近期总费用', '官网口径') +
          card(fmt(totalTokens), '总 Tokens', '近期合计') +
          card(recs.length, '请求次数', '近期') +
          card(Object.keys(byModel).length, '模型数', '近期') +
          `</div>`;
        const mTotal = totalTokens || 1;
        const modelCards = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, b]) => {
          const toks = b.input + b.output + b.cacheRead;
          const pctM = (toks / mTotal * 100).toFixed(1);
          return `<div class="jy-model-card">
            <div class="jy-model-head"><b>${esc(model)}</b><span class="jy-model-tag">模型</span></div>
            <div class="jy-pct">${pctM}%</div>
            <div class="jy-model-row"><span>次数</span><b>${b.count}</b></div>
            <div class="jy-model-row"><span>输入</span><b>${fmt(b.input)}</b></div>
            <div class="jy-model-row"><span>输出</span><b>${fmt(b.output)}</b></div>
            <div class="jy-model-row"><span>缓存读</span><b>${fmt(b.cacheRead)}</b></div>
            <div class="jy-model-row"><span>费用</span><b>${usd(b.cost)}</b></div>
          </div>`;
        }).join('');
        rows += `<div class="jy-model-title">📊 按模型统计 <span class="mini-hint">近期调用、Token 与费用</span></div><div class="jy-model-grid">${modelCards}</div>`;
        const tfmt = (iso) => { const t = new Date(iso); return isNaN(t) ? (iso || '') : t.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
        const recRows = recs.slice(0, 10).map(r => `<tr><td>${tfmt(r.time || r.updated || r.created)}</td><td>${esc(r.model)}</td><td>${fmt(r.input)}/${fmt(r.output)}</td><td>${fmt(r.cacheRead)}</td><td>${usd(r.cost)}</td></tr>`).join('');
        rows += `<div class="oc-detail"><div class="oc-tbl-title">最近调用明细</div><table class="oc-tbl"><tr><th>时间</th><th>模型</th><th>输入/输出</th><th>缓存读</th><th>费用</th></tr>${recRows}</table></div>`;
      }
      rows += `<div class="jy-foot">同步于 ${new Date(d.fetchedAt).toLocaleTimeString('zh-CN')} <span class="mini-hint">来源：opencode 官网</span></div>` + renderOCMonth(d.monthUsage);
      box.innerHTML = rows;
    })
    .catch(() => { if (hint) hint.textContent = ''; box.innerHTML = `<div class="mini-empty">同步失败：桥服务无响应</div>`; });
}
document.getElementById('ocRefreshBtn').addEventListener('click', renderOCUsage);
document.getElementById('ocCookieBtn').addEventListener('click', () => openModal('ocCookieModal'));
document.getElementById('ocCookieSave').addEventListener('click', () => {
  const v = document.getElementById('ocCookieInput').value.trim();
  if (!v) { toast('请先粘贴 Cookie'); return; }
  fetch(BRIDGE + '/opencode/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: v }) })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        closeModal('ocCookieModal');
        document.getElementById('ocCookieInput').value = '';
        toast('✅ 官网登录已更新');
        renderOCUsage();
      } else toast('保存失败：' + (d.error || '未知错误'));
    })
    .catch(() => toast('保存失败：桥服务无响应'));
});
function renderOCMonth(mu) {
  if (!Array.isArray(mu) || !mu.length) return `<div class="oc-detail"><div class="oc-detail-head">📊 本月按模型用量</div><div class="mini-empty">本月暂无记录</div></div>`;
  const byModel = {};
  let tot = 0;
  mu.forEach(u => {
    byModel[u.model] = (byModel[u.model] || 0) + (Number(u.totalCost) || 0);
    tot += Number(u.totalCost) || 0;
  });
  const rows2 = Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([model, c]) =>
    `<tr><td>${esc(model)}</td><td style="text-align:right">$${(c / 1e8).toFixed(2)}</td></tr>`).join('');
  // 按天明细（点击展开）
  const byDay = {};
  mu.forEach(u => {
    (byDay[u.date] = byDay[u.date] || { cost: 0, items: [] }).cost += Number(u.totalCost) || 0;
    byDay[u.date].items.push(u);
  });
  const daysHtml = Object.keys(byDay).sort().reverse().slice(0, 5).map(date => {
    const d = byDay[date];
    const items = d.items.sort((a, b) => b.totalCost - a.totalCost)
      .map(u => `<tr class="oc-day-item"><td>${esc(u.model)}</td><td style="text-align:right">$${(u.totalCost / 1e8).toFixed(2)}</td></tr>`).join('');
    return `<tr class="oc-day-head"><td>📅 ${date}</td><td style="text-align:right">${d.items.length} 个模型 · $${(d.cost / 1e8).toFixed(2)}</td></tr>${items}`;
  }).join('');
  return `<div class="oc-detail">
    <div class="oc-detail-head">📊 本月按模型用量 <span class="mini-hint">实时 · 合计 $${(tot / 1e8).toFixed(2)}</span></div>
    <table class="oc-tbl"><tr><th>模型</th><th style="text-align:right">费用</th></tr>${rows2}</table>
    <details class="oc-days"><summary>📅 按天明细（点击展开）</summary>
      <table class="oc-tbl oc-tbl-day"><tbody>${daysHtml}</tbody></table>
    </details>
  </div>`;
}
/* --- DeepSeek 官网用量 + 多密钥 --- */
function renderDSUsage() {
  const box = document.getElementById('dsUsage');
  const hint = document.getElementById('dsSyncHint');
  if (!box) return;
  if (!bridgeOnline) {
    box.innerHTML = `<div class="mini-empty">桥未连接，无法同步官网数据<br><span class="mini-hint">开启桥服务（侧边栏按钮）后自动显示</span></div>`;
    return;
  }
  if (hint) hint.textContent = '正在同步…';
  Promise.all([
    fetch(BRIDGE + '/deepseek/summary', { mode: 'cors' }).then(r => r.json()),
    fetch(BRIDGE + '/deepseek/usage', { mode: 'cors' }).then(r => r.json()),
  ]).then(([sum, use]) => {
    if (hint) hint.textContent = '';
    const stDS = document.getElementById('apiStatDS');
    if (sum.error || use.error) {
      const need = sum.needToken || use.needToken;
      if (need) box.innerHTML = `<div class="mini-empty">⚠️ 未配置 DeepSeek 官网登录<br><span class="mini-hint">点「🔑 更新官网登录」粘贴 Token 后自动同步</span></div>`;
      else box.innerHTML = `<div class="mini-empty">同步失败：${esc(sum.error || use.error || '未知错误')}</div>`;
      if (stDS) stDS.textContent = '—';
      return;
    }
    const sym = (sum.currency === 'USD' ? '$' : '¥');
    const bal = sum.balance != null ? sym + Number(sum.balance).toFixed(2) : '—';
    if (stDS) stDS.textContent = bal;
    const fmt = n => sym + Number(n || 0).toFixed(2);
    const fmtTok = n => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
    // 聚合近30天用量
    const cData = ((use.cost || {}).biz_data) || {};
    const aData = ((use.amount || {}).biz_data) || {};
    const dayCost = {}, dayReq = {}, dayTok = {};
    let totalCost = 0, totalReq = 0, totalTok = 0;
    (((cData.data || [])[0] || {}).series || []).forEach(s => (s.buckets || []).forEach(b => {
      const v = Number(b.cost || 0);
      totalCost += v; dayCost[b.time] = (dayCost[b.time] || 0) + v;
    }));
    (aData.series || []).forEach(s => (s.buckets || []).forEach(b => {
      const u = b.usage || {};
      const req = Number(u.REQUEST || 0);
      const tok = Number(u.RESPONSE_TOKEN || 0) + Number(u.PROMPT_TOKEN || 0) + Number(u.PROMPT_CACHE_HIT_TOKENS || 0) + Number(u.PROMPT_CACHE_MISS_TOKENS || 0);
      totalReq += req; totalTok += tok;
      dayReq[b.time] = (dayReq[b.time] || 0) + req;
      dayTok[b.time] = (dayTok[b.time] || 0) + tok;
    }));
    const bucket = cData.bucket || 86400;
    const endT = cData.end || Math.floor(Date.now() / 1000);
    const card = (n, l, s) => `<div class="jy-card"><div class="jy-num">${n}</div><div class="jy-label">${l}</div>${s ? `<div class="jy-sub">${s}</div>` : ''}</div>`;
    let rows = `<div class="ds-bal-row">`;
    rows += `<div class="ds-bal-card"><div class="ds-bal-label">充值余额 <span class="hint-text" title="充值金额 - 已消费金额">ⓘ</span></div><div class="ds-bal-num">${bal} <span class="ds-cur">${sum.currency || 'CNY'}</span></div><div class="ds-bal-sub">赠送余额 ${fmt(sum.bonusBalance)}</div><a class="ds-btn" href="https://platform.deepseek.com/top_up" target="_blank" rel="noopener">去充值</a></div>`;
    rows += `<div class="ds-bal-card"><div class="ds-bal-label">累计消费金额</div><div class="ds-bal-num">${fmt(sum.totalCost)} <span class="ds-cur">${sum.currency || 'CNY'}</span></div><div class="ds-bal-sub">全部历史累计</div></div>`;
    rows += `</div>`;
    rows += `<div class="jy-cards">` +
      card(fmt(totalCost), '消费金额', '近 30 天') +
      card(Number(totalReq), 'API 请求次数', '近 30 天') +
      card(fmtTok(totalTok), 'Tokens', '近 30 天') +
      `</div>`;
    // 近30天消费柱状图（官网风）
    const days = [];
    for (let i = 30; i >= 1; i--) { const t = endT - i * bucket; days.push({ t, v: dayCost[t] || 0 }); }
    const max = Math.max(...days.map(d => d.v), 0.001);
    const lastT = days[days.length - 1].t;
    rows += `<div class="ds-chart-box"><div class="ds-chart-title">消费金额（${sum.currency || 'CNY'}）${fmt(totalCost)}</div><div class="ds-chart">`;
    rows += days.map(d => {
      const h = Math.max(3, d.v / max * 100);
      return `<div class="ds-col" title="${fmt(d.v)}"><div class="ds-bar ${d.t === lastT ? 'today' : ''}" style="height:${h}%"></div><div class="ds-day">${new Date(d.t * 1000).getDate()}</div></div>`;
    }).join('');
    rows += `</div><div class="ds-chart-tags"><span>30 天前</span><span>今天</span></div></div>`;
    rows += `<div class="jy-foot">同步于 ${new Date(sum.fetchedAt || Date.now()).toLocaleTimeString('zh-CN')} <span class="mini-hint">来源：platform.deepseek.com</span></div>`;
    box.innerHTML = rows;
  }).catch(() => { if (hint) hint.textContent = ''; box.innerHTML = `<div class="mini-empty">同步失败：桥服务无响应</div>`; });
}
document.getElementById('dsRefreshBtn').addEventListener('click', renderDSUsage);
document.getElementById('dsTokenBtn').addEventListener('click', () => openModal('dsTokenModal'));
document.getElementById('dsTokenSave').addEventListener('click', () => {
  const v = document.getElementById('dsTokenInput').value.trim();
  if (!v) { toast('请先粘贴 Token'); return; }
  fetch(BRIDGE + '/deepseek/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: v }) })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        closeModal('dsTokenModal');
        document.getElementById('dsTokenInput').value = '';
        toast('✅ DeepSeek 官网登录已更新');
        renderDSUsage();
      } else toast('保存失败：' + (d.error || '未知错误'));
    })
    .catch(() => toast('保存失败：桥服务无响应'));
});

function renderJyUsage() {
  const box = document.getElementById('jyUsage');
  const hint = document.getElementById('jySyncHint');
  if (!box) return;
  if (!bridgeOnline) {
    box.innerHTML = `<div class="mini-empty">桥未连接，无法同步官网数据<br><span class="mini-hint">开启桥服务后自动显示</span></div>`;
    return;
  }
  if (hint) hint.textContent = '正在同步…';
  fetch(BRIDGE + '/tokenrhythm/usage', { mode: 'cors' })
    .then(r => r.json())
    .then(d => {
      if (hint) hint.textContent = '';
      const stJY = document.getElementById('apiStatJY');
      if (d.error || d.needLogin) {
        const need = d.needCookie || d.needLogin;
        if (need) box.innerHTML = `<div class="mini-empty">⚠️ 未配置基元律动官网登录<br><span class="mini-hint">点「🔑 更新官网登录」粘贴 Cookie 后自动同步</span></div>`;
        else box.innerHTML = `<div class="mini-empty">同步失败：${esc(d.error || d.msg || '登录失效')}</div>`;
        if (stJY) stJY.textContent = '—';
        return;
      }
      const b = (d.data && d.data.bal) || {};
      const usage = (d.data && d.data.usage) || {};
      const us = usage.summary || {};
      const bal = b.balanceCny != null ? b.balanceCny : null;
      const sym = '¥';
      if (stJY) stJY.textContent = bal === null ? '—' : sym + Number(bal).toFixed(2);
      const fmt = n => sym + Number(n || 0).toFixed(2);
      const fmtTok = n => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
      const expiry = b.nextExpiryAt ? new Date(b.nextExpiryAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—';
      const card = (n, l, s) => `<div class="jy-card"><div class="jy-num">${n}</div><div class="jy-label">${l}</div>${s ? `<div class="jy-sub">${s}</div>` : ''}</div>`;
      let rows = `<div class="jy-cards">` +
        card(bal === null ? '—' : fmt(bal), '账户余额', b.currency || 'CNY') +
        card(fmt(b.availableBalanceCny), '可用额度', '账户可用余额') +
        card(fmt(b.frozenBalanceCny), '冻结额度', '待结算占用') +
        card(expiry, '余额到期', b.expiringBalanceCny ? `${fmt(b.expiringBalanceCny)} 将到期` : '') +
        `</div><div class="jy-cards">` +
        card(Number(us.calls || b.calls || 0), '累计调用', `成功 ${Number(us.successCalls || 0)} / 错误 ${Number(us.errorCalls || 0)}`) +
        card(fmt(us.costCny != null ? us.costCny : b.costCny), '累计成本', '已产生费用') +
        card(fmtTok(us.totalTokens != null ? us.totalTokens : (Number(b.inputTokens || 0) + Number(b.outputTokens || 0))), 'Token 总数', '全部会话合计') +
        card(fmtTok(us.cacheReadTokens), '缓存读', '命中缓存节省成本') +
        `</div>`;
      rows += `<div class="jy-foot">同步于 ${new Date(d.fetchedAt).toLocaleTimeString('zh-CN')} <span class="mini-hint">来源：tokenrhythm.studio</span></div>`;
      // 按模型统计（官网卡片风）
      const byModel = usage.byModel || [];
      if (byModel.length) {
        const mTotal = Number(us.totalTokens || 0) || 1;
        rows += `<div class="jy-model-title">📊 按模型统计 <span class="mini-hint">按当前时间范围统计模型调用、Token 与成本</span></div>`;
        rows += `<div class="jy-model-grid">` + byModel.map(m => {
          const pct = (Number(m.totalTokens || 0) / mTotal * 100).toFixed(1);
          return `<div class="jy-model-card">
            <div class="jy-model-head"><b>${esc(m.model)}</b><span class="jy-model-tag">模型</span></div>
            <div class="jy-pct">${pct}%</div>
            <div class="jy-model-row"><span>Token</span><b>${fmtTok(m.totalTokens)}</b></div>
            <div class="jy-model-row"><span>输入</span><b>${fmtTok(m.inputTokens)}</b></div>
            <div class="jy-model-row"><span>输出</span><b>${fmtTok(m.outputTokens)}</b></div>
            <div class="jy-model-row"><span>缓存读</span><b>${fmtTok(m.cacheReadTokens)}</b></div>
            <div class="jy-model-row"><span>缓存写</span><b>${m.cacheCreationTokens != null ? fmtTok(m.cacheCreationTokens) : '—'}</b></div>
            <div class="jy-model-row"><span>会话</span><b>${Number(m.calls || 0)}</b></div>
            <div class="jy-model-row"><span>成本</span><b>${fmt(m.costCny)}</b></div>
          </div>`;
        }).join('') + `</div>`;
      }
      box.innerHTML = rows;
    })
    .catch(() => {
      if (hint) hint.textContent = '';
      box.innerHTML = `<div class="mini-empty">同步失败：桥服务无响应</div>`;
    });
}
document.getElementById('jyRefreshBtn').addEventListener('click', renderJyUsage);
document.getElementById('jyCookieBtn').addEventListener('click', () => openModal('jyCookieModal'));
document.getElementById('jyCookieSave').addEventListener('click', () => {
  const v = document.getElementById('jyCookieInput').value.trim();
  if (!v) { toast('请先粘贴 Cookie'); return; }
  fetch(BRIDGE + '/tokenrhythm/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: v }) })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        closeModal('jyCookieModal');
        document.getElementById('jyCookieInput').value = '';
        toast('✅ 基元律动官网登录已更新');
        renderJyUsage();
      } else toast('保存失败：' + (d.error || '未知错误'));
    })
    .catch(() => toast('保存失败：桥服务无响应'));
});

/* --- API 页 tab 切换 --- */
function switchApiTab(tab) {
  document.getElementById('apiTabOc').hidden = tab !== 'oc';
  document.getElementById('apiTabDs').hidden = tab !== 'ds';
  document.getElementById('apiTabJy').hidden = tab !== 'jy';
  document.getElementById('apiTabAr').hidden = tab !== 'ar';
  document.getElementById('apiTabFy').hidden = tab !== 'fy';
  document.getElementById('apiTabSx').hidden = tab !== 'sx';
  document.getElementById('apiTabSn').hidden = tab !== 'sn';
  document.getElementById('apiTabZot').hidden = tab !== 'zot';
  document.getElementById('apiTabOcBtn').classList.toggle('active', tab === 'oc');
  document.getElementById('apiTabDsBtn').classList.toggle('active', tab === 'ds');
  document.getElementById('apiTabJyBtn').classList.toggle('active', tab === 'jy');
  document.getElementById('apiTabArBtn').classList.toggle('active', tab === 'ar');
  document.getElementById('apiTabFyBtn').classList.toggle('active', tab === 'fy');
  document.getElementById('apiTabSxBtn').classList.toggle('active', tab === 'sx');
  document.getElementById('apiTabSnBtn').classList.toggle('active', tab === 'sn');
  document.getElementById('apiTabZotBtn').classList.toggle('active', tab === 'zot');
  if (tab === 'ds') renderDSUsage();
  else if (tab === 'oc') renderOCUsage();
  else if (tab === 'jy') renderJyUsage();
  else if (tab === 'ar') renderGySites();
  else if (tab === 'fy') renderFySites();
  else if (tab === 'sx') renderSxUsage();
  else if (tab === 'sn') renderSnUsage();
  else if (tab === 'zot') checkZotStatus();
}
document.getElementById('apiTabOcBtn').addEventListener('click', () => switchApiTab('oc'));
document.getElementById('apiTabDsBtn').addEventListener('click', () => switchApiTab('ds'));
document.getElementById('apiTabJyBtn').addEventListener('click', () => switchApiTab('jy'));
document.getElementById('apiTabArBtn').addEventListener('click', () => switchApiTab('ar'));
document.getElementById('apiTabFyBtn').addEventListener('click', () => switchApiTab('fy'));
document.getElementById('apiTabSxBtn').addEventListener('click', () => switchApiTab('sx'));
document.getElementById('apiTabSnBtn').addEventListener('click', () => switchApiTab('sn'));
document.getElementById('apiTabZotBtn').addEventListener('click', () => switchApiTab('zot'));

/* --- SenseNova 商汤 Token Plan：剩余% + 7 天调用次数（JWT 存桥端） --- */
function renderSnUsage() {
  const box = document.getElementById('snUsage');
  const hint = document.getElementById('snSyncHint');
  if (!box) return;
  if (!bridgeOnline) {
    box.innerHTML = `<div class="mini-empty">桥未连接，无法查询<br><span class="mini-hint">开启桥服务后自动显示</span></div>`;
    if (hint) hint.textContent = '';
    return;
  }
  if (hint) hint.textContent = '正在查询…';
  fetch(BRIDGE + '/sensenova/usage', { mode: 'cors' })
    .then(r => r.json())
    .then(d => {
      if (hint) hint.textContent = '';
      const stSN = document.getElementById('apiStatSN');
      if (d.error || d.needLogin) {
        box.innerHTML = `<div class="mini-empty">⚠️ ${esc(d.error || '登录已失效')}<br><span class="mini-hint">点「🔑 更新登录」粘贴新 Token</span></div>`;
        if (stSN) stSN.textContent = '—';
        return;
      }
      const rem = d.remaining || {};
      const names = { 'sensenova-6.8-flash-lite': '6.8 Flash Lite', 'sensenova-u1-fast': 'U1 Fast', 'deepseek-v4-flash': 'DeepSeek V4 Flash', 'glm-5.2': 'GLM-5.2' };
      const vals = Object.values(rem).filter(v => typeof v === 'number');
      const minPct = vals.length ? Math.min(...vals) : null;
      if (stSN) stSN.textContent = minPct == null ? '—' : minPct.toFixed(0) + '%';
      let rows = `<div class="oc-usage-title">当前 5 小时窗口剩余额度</div><div class="jy-cards">`;
      for (const [k, v] of Object.entries(rem)) {
        const pct = Math.max(0, Math.min(100, Number(v)));
        const color = pct <= 30 ? '#e05252' : pct <= 60 ? '#e8912d' : '#2f9e6e';
        rows += `<div class="jy-card" style="min-width:180px">
          <div class="jy-label">${esc(names[k] || k)}</div>
          <div class="jy-num" style="font-size:20px;color:${color}">${pct.toFixed(1)}%</div>
          <div class="oc-minibar" style="width:100%;margin-top:6px"><div class="oc-minifill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
      }
      rows += `</div>`;
      const usages = d.usages || {};
      let total7 = 0;
      for (const arr of Object.values(usages)) if (Array.isArray(arr)) total7 += arr.reduce((s, p) => s + p.n, 0);
      rows += `<div class="oc-detail"><div class="oc-tbl-title">📊 近 7 天调用次数（共 ${total7} 次）</div>`;
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const dd = new Date(Date.now() - i * 864e5);
        days.push(dd.toISOString().slice(0, 10));
      }
      for (const day of days) {
        let cnt = 0, parts = [];
        for (const [m, arr] of Object.entries(usages)) {
          if (!Array.isArray(arr)) continue;
          const p = arr.find(x => x.t === day);
          if (p && p.n > 0) { cnt += p.n; parts.push(`${names[m] || m} ${p.n}`); }
        }
        rows += `<div class="sn-day-row"><span class="sn-day-label">${day}</span><span class="sn-day-bar"><span class="sn-day-fill" style="width:${Math.min(100, cnt * 6)}%"></span></span><span class="sn-day-num">${cnt} 次</span>${parts.length ? `<span class="mini-hint">（${esc(parts.join('，'))}）</span>` : ''}</div>`;
      }
      rows += `</div>`;
      if (d.jwtExp) {
        const exp = new Date(d.jwtExp);
        const hLeft = Math.round((exp - Date.now()) / 36e5);
        rows += `<div class="jy-foot">同步于 ${new Date(d.fetchedAt).toLocaleTimeString('zh-CN')} · 登录 Token ${hLeft > 0 ? hLeft + ' 小时后过期' : '已过期（点更新登录）'} <span class="mini-hint">来源：platform.sensenova.cn</span></div>`;
      }
      box.innerHTML = rows;
    })
    .catch(() => { if (hint) hint.textContent = ''; box.innerHTML = `<div class="mini-empty">查询失败：桥服务无响应</div>`; });
}
document.getElementById('snRefreshBtn').addEventListener('click', renderSnUsage);
document.getElementById('snLoginBtn').addEventListener('click', () => openModal('snLoginModal'));
document.getElementById('snLoginSave').addEventListener('click', () => {
  const v = document.getElementById('snJwtInput').value.trim().replace(/^Bearer\s+/i, '');
  if (!v) { toast('请先粘贴 Token'); return; }
  fetch(BRIDGE + '/sensenova/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt: v }) })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        closeModal('snLoginModal');
        document.getElementById('snJwtInput').value = '';
        toast('✅ 商汤登录已更新');
        renderSnUsage();
      } else toast('保存失败：' + (d.error || '未知错误'));
    })
    .catch(() => toast('保存失败：桥服务无响应'));
});

/* --- 肖恩AI（supxh）额度：/api/auth/me + /api/user/quota/sync，cookie 存桥端 --- */
function renderSxUsage() {
  const box = document.getElementById('sxUsage');
  const hint = document.getElementById('sxSyncHint');
  if (!box) return;
  if (!bridgeOnline) {
    box.innerHTML = `<div class="mini-empty">桥未连接，无法查询<br><span class="mini-hint">开启桥服务后自动显示</span></div>`;
    if (hint) hint.textContent = '';
    return;
  }
  if (hint) hint.textContent = '正在查询…';
  fetch(BRIDGE + '/supxin/usage', { mode: 'cors' })
    .then(r => r.json())
    .then(d => {
      if (hint) hint.textContent = '';
      const stSX = document.getElementById('apiStatSX');
      if (d.error) {
        if (d.needCookie) box.innerHTML = `<div class="mini-empty">⚠️ 登录已失效或未配置<br><span class="mini-hint">点「🔑 更新登录」粘贴 Cookie 后自动查询</span></div>`;
        else box.innerHTML = `<div class="mini-empty">查询失败：${esc(d.error)}</div>`;
        if (stSX) stSX.textContent = '—';
        return;
      }
      const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
      if (stSX) stSX.textContent = fmt(d.quota);
      if (d.apiKey) lastSxApiKey = d.apiKey;
      let rows = `<div class="ds-bal-row">`;
      rows += `<div class="ds-bal-card"><div class="ds-bal-label">总额度</div><div class="ds-bal-num">${fmt(d.quota)}</div><div class="ds-bal-sub">${d.username ? esc(d.username) + (d.isVip ? ' · VIP' : '') : ''}</div></div>`;
      rows += `<div class="ds-bal-card"><div class="ds-bal-label">每日额度</div><div class="ds-bal-num">${fmt(d.daily)}</div><div class="ds-bal-sub">永久额度 ${fmt(d.permanent)}</div></div>`;
      rows += `</div>`;
      rows += `<div class="jy-cards">`;
      rows += `<div class="jy-card"><div class="jy-num">${fmt(d.inviteCount)}</div><div class="jy-label">已邀请人数</div></div>`;
      rows += `<div class="jy-card"><div class="jy-num">${fmt(d.inviteRewards)}</div><div class="jy-label">邀请奖励额度</div></div>`;
      rows += `<div class="jy-card"><div class="jy-num">${esc(d.inviteCode || '—')}</div><div class="jy-label">邀请码</div></div>`;
      rows += `</div>`;
      if (d.weekReward && d.weekReward.threshold) {
        const w = d.weekReward;
        const pctW = Math.max(0, Math.min(100, (w.current || 0) / w.threshold * 100));
        rows += `<div class="oc-detail"><div class="oc-tbl-title">🎯 邀请周卡进度 <span class="mini-hint">${esc(w.message || '')}</span></div>
          <div class="oc-minibar"><div class="oc-minifill" style="width:${pctW}%;background:#2f7fe8"></div></div>
          <div class="mini-hint" style="margin-top:6px">${w.current} / ${w.threshold} 人（还差 ${w.remaining} 人）</div></div>`;
      }
      rows += `<div class="jy-foot">同步于 ${new Date(d.fetchedAt).toLocaleTimeString('zh-CN')} <span class="mini-hint">来源：free.supxh.xin</span></div>`;
      box.innerHTML = rows;
    })
    .catch(() => { if (hint) hint.textContent = ''; box.innerHTML = `<div class="mini-empty">查询失败：桥服务无响应</div>`; });
}
document.getElementById('sxRefreshBtn').addEventListener('click', renderSxUsage);
document.getElementById('sxCookieBtn').addEventListener('click', () => openModal('sxCookieModal'));
document.getElementById('sxCookieSave').addEventListener('click', () => {
  const v = document.getElementById('sxCookieInput').value.trim();
  if (!v) { toast('请先粘贴 Cookie'); return; }
  fetch(BRIDGE + '/supxin/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: v }) })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        closeModal('sxCookieModal');
        document.getElementById('sxCookieInput').value = '';
        toast('✅ 肖恩AI登录已更新');
        renderSxUsage();
      } else toast('保存失败：' + (d.error || '未知错误'));
    })
    .catch(() => toast('保存失败：桥服务无响应'));
});

/* --- 密钥记录（AgentRouter / 肖恩AI，localStorage 管理） --- */
function loadKeyNotes() {
  try {
    const s = JSON.parse(localStorage.getItem('gradwb_key_notes'));
    if (Array.isArray(s)) return s;
  } catch (e) {}
  return [];
}
function saveKeyNotes(list) { saveJSON('gradwb_key_notes', list); }
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 12) return k.slice(0, 3) + '****' + k.slice(-2);
  return k.slice(0, 6) + '****' + k.slice(-4);
}
function renderKeyNotes() {
  const list = loadKeyNotes();
  const row = (n) => `<div class="api-item">
    <div class="api-item-info">
      <b>${esc(n.name || '未命名')}</b>
      <span class="mini-hint">${esc(n.base || '')}${n.note ? ' · ' + esc(n.note) : ''}</span>
      <span class="key-mask" title="${esc(n.key || '')}">${esc(maskKey(n.key))}</span>
    </div>
    <div class="api-item-ops">
      <button class="mini-btn" onclick="copyText(${JSON.stringify(n.key || '')})" title="复制完整密钥">📋</button>
      <button class="mini-btn" onclick="openKeyNoteModal('${n.provider}', '${n.id}')" title="编辑">✎</button>
      <button class="mini-btn" onclick="delKeyNote('${n.id}')" title="删除">🗑</button>
    </div>
  </div>`;
  const boxes = { ar: 'gyKey_ar', sx: 'sxKeyList', lb: 'gyKey_lb', af: 'gyKey_af' };
  for (const [prov, boxId] of Object.entries(boxes)) {
    const el = document.getElementById(boxId);
    if (!el) continue;
    const items = list.filter(n => n.provider === prov);
    el.innerHTML = items.length ? items.map(row).join('') : `<div class="mini-empty">暂无密钥 <button class="mini-btn" onclick="openKeyNoteModal('${prov}')">＋ 记录</button></div>`;
  }
  for (const s of [...GY_SITES, ...loadGyExtras()]) {
    const el = document.getElementById('gyKey_' + s.id);
    if (el) {
      const items = list.filter(n => n.provider === s.id);
      el.innerHTML = items.length ? items.map(row).join('') : `<div class="mini-empty">暂无密钥 <button class="mini-btn" onclick="openKeyNoteModal('${s.id}')">＋ 记录</button></div>`;
    }
  }
  for (const s of [...FY_SITES, ...loadFyExtras()]) {
    const el = document.getElementById('fyKey_' + s.id);
    if (el) {
      const items = list.filter(n => n.provider === s.id);
      el.innerHTML = items.length ? items.map(row).join('') : `<div class="mini-empty">暂无密钥 <button class="mini-btn" onclick="openKeyNoteModal('${s.id}')">＋ 记录</button></div>`;
    }
  }
}
function copyText(t) {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
    () => toast('已复制到剪贴板'),
    () => toast('复制失败')
  );
}
function delKeyNote(id) {
  const list = loadKeyNotes().filter(n => n.id !== id);
  saveKeyNotes(list);
  renderKeyNotes();
  toast('已删除');
}
function openKeyNoteModal(provider, id) {
  const list = loadKeyNotes();
  const n = id ? list.find(x => x.id === id) : null;
  const PROVIDER_NAMES = { ar: 'AgentRouter', sx: '肖恩AI', lb: 'LightBoat', af: 'ArityFlow', any: 'AnyRouter', fy_gemai: '哈基米', fy_jumeng: '聚梦 AI', fy_gemai_pro: '哈基米 Pro', fy_zl: '宅恋', fy_juzi: '橘子汽水', fy_shufu: '舒芙蕾' };
  const PROVIDER_BASES = { ar: 'https://agentrouter.org', sx: 'https://api.supxh.xin', lb: 'https://lightboat.dpdns.org', af: 'https://www.arityflow.top', any: 'https://anyrouter.top', fy_gemai: 'https://api.gemai.cc', fy_jumeng: 'https://api.jumengai.net', fy_gemai_pro: 'https://pro.gemai.cc', fy_zl: 'https://az.zlapi.pro', fy_juzi: 'https://juziqishui.net', fy_shufu: 'https://shufulei.net' };
  document.getElementById('knId').value = n ? n.id : '';
  document.getElementById('knProvider').value = provider;
  document.getElementById('knName').value = n ? (n.name || '') : '';
  document.getElementById('knKey').value = n ? (n.key || '') : '';
  document.getElementById('knBase').value = n ? (n.base || '') : (PROVIDER_BASES[provider] || '');
  document.getElementById('knNote').value = n ? (n.note || '') : '';
  document.getElementById('knTitle').textContent = (n ? '✎ 编辑' : '＋ 添加') + '密钥记录（' + (PROVIDER_NAMES[provider] || provider) + '）';
  openModal('keyNoteModal');
}
document.getElementById('knSave').addEventListener('click', () => {
  const id = document.getElementById('knId').value;
  const provider = document.getElementById('knProvider').value;
  const name = document.getElementById('knName').value.trim();
  const key = document.getElementById('knKey').value.trim();
  const base = document.getElementById('knBase').value.trim();
  const note = document.getElementById('knNote').value.trim();
  if (!key) { toast('密钥不能为空'); return; }
  const list = loadKeyNotes();
  if (id) {
    const n = list.find(x => x.id === id);
    if (n) Object.assign(n, { name, key, base, note });
  } else {
    list.push({ id: 'kn_' + Date.now(), provider, name, key, base, note });
  }
  saveKeyNotes(list);
  closeModal('keyNoteModal');
  renderKeyNotes();
  toast('✅ 已保存');
});
/* 首次加载：自动记入已知密钥（AgentRouter 的 sk- key / 肖恩AI 的 apiKey） */
function ensureKnownKeys() {
  const list = loadKeyNotes();
  let changed = false;
  if (!list.some(n => n.provider === 'ar' && n.key.startsWith('sk-'))) {
    changed = true;
  }
  if (changed) { saveKeyNotes(list); renderKeyNotes(); }
}
/* 肖恩AI：把当前 apiKey 一键记入 */
let lastSxApiKey = '';
/* SenseNova 商汤：自动补进 API 列表和网站索引（幂等） */
function fixSensenovaBase() {
  try {
    const apis = loadAPIs();
    let changed = false;
    apis.forEach(a => {
      if (/sensenova/i.test((a.base || '') + (a.name || '')) && !/token\.sensenova\.cn/.test(a.base || '')) {
        a.base = 'https://token.sensenova.cn/v1';
        a.model = 'sensenova-6.8-flash-lite';
        changed = true;
      }
    });
    if (changed) saveAPIs(apis);
  } catch (e) {}
}
fixSensenovaBase();
function ensureSensenova() {
  try {
    const apis = loadAPIs();
    if (!apis.some(a => /sensenova/i.test((a.base || '') + (a.name || '')))) {
      apis.push({ id: uid(), name: 'SenseNova 商汤', base: 'https://token.sensenova.cn/v1', key: '', model: 'sensenova-6.8-flash-lite' });
      saveAPIs(apis);
    }
    const sites = loadSites();
    if (!sites.some(s => /sensenova/i.test((s.url || '') + (s.name || '')))) {
      sites.push({ name: 'SenseNova', url: 'https://platform.sensenova.cn/console/keys', icon: '🌌' });
      saveSites(sites);
    }
  } catch (e) {}
}
ensureSensenova();
document.getElementById('sxKeyRecordBtn').addEventListener('click', () => {
  if (!lastSxApiKey) { toast('暂无 API Key（先刷新额度数据）'); return; }
  const list = loadKeyNotes();
  if (list.some(n => n.provider === 'sx' && n.key === lastSxApiKey)) { toast('已记录过这个 Key'); return; }
  list.push({ id: 'kn_' + Date.now(), provider: 'sx', name: '肖恩AI Key', key: lastSxApiKey, base: 'https://api.supxh.xin', note: '' });
  saveKeyNotes(list);
  renderKeyNotes();
  toast('✅ 已记录当前 API Key');
});

/* --- 公益站：入口 + 密钥管理（不做额度监控） --- */
const GY_SITES = [
  { id: 'ar', name: 'AgentRouter', url: 'https://agentrouter.org', icon: '<img class="brand-ico" src="assets/agentrouter.png" alt="" onerror="this.outerHTML=\'📡\'">', desc: '中转网关' },
  { id: 'lb', name: 'LightBoat', url: 'https://lightboat.dpdns.org/dashboard', icon: '🚤', desc: '公益中转站' },
  { id: 'af', name: 'ArityFlow', url: 'https://www.arityflow.top/dashboard/overview', icon: '🌊', desc: '公益中转站' },
  { id: 'any', name: 'AnyRouter', url: 'https://anyrouter.top/console', icon: '🧭', desc: '公益中转站' },
];
function loadGyExtras() {
  try { return JSON.parse(localStorage.getItem('gradwb_gy_sites') || '[]'); } catch (e) { return []; }
}
function saveGyExtras(list) { localStorage.setItem('gradwb_gy_sites', JSON.stringify(list)); }
function renderGySites() {
  const box = document.getElementById('gySites');
  const st = document.getElementById('apiStatGY');
  if (!box) return;
  const all = [...GY_SITES, ...loadGyExtras()];
  if (st) st.textContent = all.length + ' 站';
  box.innerHTML = all.map(s => `<div class="gy-card">
    <div class="gy-head">
      <span class="gy-icon">${s.icon}</span>
      <div class="gy-meta"><b>${esc(s.name)}</b><div class="mini-hint">${esc(s.desc || '')} · <span class="gy-url">${esc(s.url)}</span></div></div>
      <span style="flex:1"></span>
      <a class="panel-btn" href="${esc(s.url)}" target="_blank" rel="noopener">↗ 打开</a>
    </div>
    <div class="api-list" id="gyKey_${s.id}" style="margin-top:8px"><div class="mini-empty">—</div></div>
  </div>`).join('');
  renderKeyNotes();
}
document.getElementById('gyAddBtn').addEventListener('click', () => {
  const name = prompt('站点名称：');
  if (!name || !name.trim()) return;
  const url = prompt('站点地址（https://...）：');
  if (!url || !url.trim()) return;
  const list = loadGyExtras();
  list.push({ id: 'gy_' + Date.now().toString(36), name: name.trim(), url: url.trim(), icon: '🌐', desc: '自定义站点' });
  saveGyExtras(list);
  renderGySites();
  renderFySites();
  toast('✅ 站点已添加');
});

/* --- 付费站：入口 + 密钥管理（同公益站模式） --- */
const FY_SITES = [
  { id: 'fy_gemai', name: '哈基米', url: 'https://api.gemai.cc/dashboard/overview', icon: '🎤', desc: '付费中转' },
  { id: 'fy_jumeng', name: '聚梦 AI', url: 'https://api.jumengai.net/dashboard/overview', icon: '💭', desc: '付费中转' },
  { id: 'fy_gemai_pro', name: '哈基米 Pro', url: 'https://pro.gemai.cc/dashboard/overview', icon: '🎧', desc: '付费中转' },
  { id: 'fy_zl', name: '宅恋', url: 'https://az.zlapi.pro/console', icon: '🐉', desc: '付费中转' },
  { id: 'fy_juzi', name: '橘子汽水', url: 'https://juziqishui.net/console', icon: '🍊', desc: '付费中转' },
  { id: 'fy_shufu', name: '舒芙蕾', url: 'https://shufulei.net/console', icon: '🧮', desc: '付费中转' },
];
function loadFyExtras() {
  try { return JSON.parse(localStorage.getItem('gradwb_fy_sites') || '[]'); } catch (e) { return []; }
}
function saveFyExtras(list) { localStorage.setItem('gradwb_fy_sites', JSON.stringify(list)); }
function renderFySites() {
  const box = document.getElementById('fySites');
  const st = document.getElementById('apiStatFY');
  if (!box) return;
  const all = [...FY_SITES, ...loadFyExtras()];
  if (st) st.textContent = all.length + ' 站';
  box.innerHTML = all.map(s => `<div class="gy-card">
    <div class="gy-head">
      <span class="gy-icon">${s.icon}</span>
      <div class="gy-meta"><b>${esc(s.name)}</b><div class="mini-hint">${esc(s.desc || '')} · <span class="gy-url">${esc(s.url)}</span></div></div>
      <span style="flex:1"></span>
      <a class="panel-btn" href="${esc(s.url)}" target="_blank" rel="noopener">↗ 打开</a>
    </div>
    <div class="api-list" id="fyKey_${s.id}" style="margin-top:8px"><div class="mini-empty">—</div></div>
  </div>`).join('');
  renderKeyNotes();
}
document.getElementById('fyAddBtn').addEventListener('click', () => {
  const name = prompt('站点名称：');
  if (!name || !name.trim()) return;
  const url = prompt('站点地址（https://...）：');
  if (!url || !url.trim()) return;
  const list = loadFyExtras();
  list.push({ id: 'fy_' + Date.now().toString(36), name: name.trim(), url: url.trim(), icon: '💰', desc: '自定义站点' });
  saveFyExtras(list);
  renderFySites();
  toast('✅ 站点已添加');
});

/* --- Zotero 同步 --- */
let zotConfig = null;
async function checkZotStatus() {
  const state = document.getElementById('zotState');
  try {
    const r = await fetch(BRIDGE + '/zotero/status', { mode: 'cors' });
    const d = await r.json().catch(() => ({}));
    zotConfig = d;
    const local = d.zoteroLocal ? 'Zotero 桌面端在线' : 'Zotero 桌面端未运行';
    const key = d.keyConfigured ? '✅ 已配置（' + (d.uid || '') + '）' : '⚠️ 未配置 Key';
    state.textContent = local + ' ｜ ' + key;
    const row = document.getElementById('zotUidRow');
    row.hidden = !d.uid;
    if (d.uid) document.getElementById('zotUid').textContent = d.uid;
    const keyState = document.getElementById('zotKeyState');
    if (keyState) keyState.textContent = d.keyConfigured ? '✅ 已配置' : '⚠️ 未配置（需在 zotero.org 生成）';
  } catch (e) {
    state.textContent = '桥未开启';
  }
}

setInterval(checkAgentOut, 30000);
setInterval(bridgeCheck, 60000);
bridgeCheck();
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* --- 全局 toast 轻提示（替换 alert，右下角自动消失） --- */
function toast(msg, type, ms) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.textContent = msg;
  const bg = type === 'ok' ? 'linear-gradient(135deg,#16a34a,#15803d)' : type === 'err' ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'linear-gradient(135deg,#1f2937,#111827)';
  el.style.cssText = 'background:' + bg + ';color:#fff;padding:9px 15px;border-radius:10px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.18);opacity:0;transform:translateY(8px);transition:all .25s ease;max-width:340px;line-height:1.5;';
  wrap.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, ms || 2600);
}
window.toast = toast;

/* --- 🌗 主题切换（auto 跟随系统 / light / dark） --- */
function applyTheme(mode) {
  const html = document.documentElement;
  if (mode === 'dark') html.setAttribute('data-theme', 'dark');
  else if (mode === 'light') html.setAttribute('data-theme', 'light');
  else html.removeAttribute('data-theme');
}
function getTheme() { return localStorage.getItem('gradwb_theme') || 'auto'; }
const THEME_NAMES = { auto: '跟随系统', light: '浅色', dark: '深色' };
function updateThemeMenu() {
  const cur = getTheme();
  document.querySelectorAll('#hamburgerMenu [data-theme-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.themeMode === cur);
  });
}
function initHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const menu = document.getElementById('hamburgerMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.classList.toggle('show');
    updateThemeMenu();
  });
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.remove('show');
  });
  menu.addEventListener('click', e => {
    const tm = e.target.closest('[data-theme-mode]');
    if (tm) {
      localStorage.setItem('gradwb_theme', tm.dataset.themeMode);
      applyTheme(tm.dataset.themeMode);
      updateThemeMenu();
      toast('🌗 主题已切换：' + THEME_NAMES[tm.dataset.themeMode]);
      menu.classList.remove('show');
      return;
    }
    const hm = e.target.closest('[data-hm]');
    if (!hm) return;
    menu.classList.remove('show');
    const act = hm.dataset.hm;
    if (act === 'search') { openModal('searchModal'); setTimeout(() => document.getElementById('searchInput') && document.getElementById('searchInput').focus(), 60); }
    else if (act === 'backup') backupExport();
    else if (act === 'cmd') openCommandModal();
  });
}
applyTheme(getTheme());
initHamburger();

/* --- 📖 文献精读模板 --- */
let deepLibId = null;
function openDeepNote(id) {
  const it = loadLibrary().find(x => x.id === id);
  if (!it) return;
  deepLibId = id;
  document.getElementById('deepTitle').textContent = it.title;
  const rd = it.rd || {};
  document.getElementById('deepQ').value = rd.q || '';
  document.getElementById('deepM').value = rd.m || '';
  document.getElementById('deepI').value = rd.i || '';
  document.getElementById('deepL').value = rd.l || '';
  document.getElementById('deepT').value = rd.t || '';
  openModal('deepModal');
}
document.getElementById('deepSaveBtn').addEventListener('click', () => {
  const list = loadLibrary();
  const it = list.find(x => x.id === deepLibId);
  if (!it) { closeModal('deepModal'); return; }
  it.rd = {
    q: document.getElementById('deepQ').value.trim(),
    m: document.getElementById('deepM').value.trim(),
    i: document.getElementById('deepI').value.trim(),
    l: document.getElementById('deepL').value.trim(),
    t: document.getElementById('deepT').value.trim(),
  };
  saveLibrary(list);
  closeModal('deepModal');
  toast('✅ 精读笔记已保存');
});
/* --- CSV 导出（Excel 可打开，带 BOM 防中文乱码） --- */
function exportCSV(headers, rows, fname) {
  const escv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '\ufeff' + [headers, ...rows].map(r => r.map(escv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('✅ 已导出 ' + fname);
}
document.getElementById('libCsvBtn').addEventListener('click', () => {
  const list = loadLibrary();
  if (!list.length) { toast('文献库为空'); return; }
  exportCSV(['标题', '作者', '期刊/会议', '年份', '状态', '分类', '标签', 'DOI', '摘要', '阅读笔记'],
    list.map(x => [x.title, x.authors, x.journal, x.year, x.status, x.cat, (x.tags || []).join(';'), x.doi, x.abstract, x.notes]),
    '文献库_' + new Date().toISOString().slice(0, 10) + '.csv');
});
document.getElementById('sumCsvBtn').addEventListener('click', () => {
  const list = loadSummaries();
  if (!list.length) { toast('暂无工作记录'); return; }
  exportCSV(['日期', '时长(小时)', '标签', '内容'],
    list.map(x => [x.date, x.hours, x.tags, x.note]),
    '工作总结_' + new Date().toISOString().slice(0, 10) + '.csv');
});
document.getElementById('fitCsvBtn').addEventListener('click', () => {
  const list = (loadFitness().records || []);
  if (!list.length) { toast('暂无健身记录'); return; }
  exportCSV(['日期', '类型', '时长(分钟)', '备注'],
    list.map(x => [x.date, x.type, x.minutes, x.note]),
    '健身记录_' + new Date().toISOString().slice(0, 10) + '.csv');
});
/* ======================================================
   📄 论文写作进度 + 📊 图表管理
   ====================================================== */
const WRITE_CHAPTERS = ['摘要', '引言', '方法', '结果', '讨论', '结论'];
function loadWriting() { return loadJSON('gradwb_writing') || []; }
function saveWriting(l) { saveJSON('gradwb_writing', l); }


/* ======================================================
   📝 研究笔记 / 灵感速记
   ====================================================== */
function loadNotes() { return loadJSON('gradwb_notes') || []; }
function saveNotes(l) { saveJSON('gradwb_notes', l); }
let noteEditId = null;
let notePin = false;
function renderNotes() {
  const kw = document.getElementById('noteSearch').value.trim().toLowerCase();
  let notes = loadNotes();
  if (kw) notes = notes.filter(n => (n.title || '').toLowerCase().includes(kw) || (n.content || '').toLowerCase().includes(kw) || (n.tags || []).join(' ').toLowerCase().includes(kw));
  notes.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
  const box = document.getElementById('noteList');
  if (!box) return;
  if (!notes.length) { box.style.display = 'block'; box.innerHTML = '<div class="mini-empty">还没有笔记<br><span class="mini-hint">点「＋ 新笔记」记录灵感、推导思路、待查问题…</span></div>'; return; }
  box.style.display = 'grid';
  const timeStr = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  box.innerHTML = notes.map(n => `<div class="note-card" data-nid="${n.id}">
    <div class="note-card-title">${n.pin ? '<span class="note-pin">📌</span> ' : ''}${esc(n.title || '无标题')}</div>
    <div class="note-card-content">${esc((n.content || '').slice(0, 200))}</div>
    <div class="note-card-meta"><span>${timeStr(n.ts)}</span>${(n.tags || []).map(t => `<span class="note-tag">${esc(t)}</span>`).join('')}<span style="flex:1"></span><span style="cursor:pointer" data-ndel="${n.id}">🗑️</span></div>
  </div>`).join('');
  box.querySelectorAll('.note-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.dataset.ndel) return;
    openNoteEdit(card.dataset.nid);
  }));
  box.querySelectorAll('[data-ndel]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    myConfirm('删除这条笔记？', () => { saveNotes(loadNotes().filter(n => n.id !== el.dataset.ndel)); renderNotes(); });
  }));
}
function openNoteAdd() {
  noteEditId = null; notePin = false;
  document.getElementById('noteModalTitle').textContent = '📝 新笔记';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteTags').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('notePinBtn').textContent = '📌 不置顶';
  openModal('noteModal');
  setTimeout(() => document.getElementById('noteTitle').focus(), 60);
}
function openNoteEdit(id) {
  const n = loadNotes().find(x => x.id === id);
  if (!n) return;
  noteEditId = id; notePin = !!n.pin;
  document.getElementById('noteModalTitle').textContent = '✏️ 编辑笔记';
  document.getElementById('noteTitle').value = n.title || '';
  document.getElementById('noteTags').value = (n.tags || []).join(',');
  document.getElementById('noteContent').value = n.content || '';
  document.getElementById('notePinBtn').textContent = n.pin ? '📌 已置顶' : '📌 不置顶';
  openModal('noteModal');
}
document.getElementById('noteAddBtn').addEventListener('click', openNoteAdd);
document.getElementById('notePinBtn').addEventListener('click', () => {
  notePin = !notePin;
  document.getElementById('notePinBtn').textContent = notePin ? '📌 已置顶' : '📌 不置顶';
});
document.getElementById('noteSaveBtn').addEventListener('click', () => {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  if (!title && !content) { toast('笔记标题或内容至少填一项'); return; }
  const data = { title: title || '未命名笔记', content, tags: document.getElementById('noteTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean), pin: notePin, ts: Date.now() };
  const list = loadNotes();
  if (noteEditId) { const n = list.find(x => x.id === noteEditId); if (n) Object.assign(n, data); }
  else list.push({ id: uid(), ...data });
  saveNotes(list);
  closeModal('noteModal');
  renderNotes();
  toast('✅ 笔记已保存');
});
document.getElementById('noteSearch').addEventListener('input', renderNotes);
document.getElementById('noteCsvBtn').addEventListener('click', () => {
  const list = loadNotes();
  if (!list.length) { toast('没有笔记'); return; }
  exportCSV(['标题', '内容', '标签', '置顶', '时间'], list.map(n => [n.title, n.content, (n.tags || []).join(';'), n.pin ? '是' : '否', new Date(n.ts || 0).toLocaleString('zh-CN')]), '研究笔记_' + new Date().toISOString().slice(0, 10) + '.csv');
});

/* ======================================================
   🔖 文件收藏
   ====================================================== */
function loadFiles() { return loadJSON('gradwb_files') || []; }
function saveFiles(l) { saveJSON('gradwb_files', l); }
function renderFileList() {
  const box = document.getElementById('fileFavList');
  if (!box) return;
  const list = loadFiles();
  if (!list.length) { box.innerHTML = '<div class="mini-hint" style="text-align:center;padding:10px">还没有收藏<br>添加常用文件/文件夹路径，一键复制</div>'; return; }
  box.innerHTML = list.map(f => `<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:8px 10px">
    <span>📁</span>
    <div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--text);font-weight:600">${esc(f.name)}</div><div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.path || '')}</div></div>
    <button class="panel-btn" data-fcopy="${f.id}" style="font-size:11px">📋 复制</button>
    <button class="panel-btn" data-fdel="${f.id}" style="font-size:11px">🗑️</button>
  </div>`).join('');
  box.querySelectorAll('[data-fcopy]').forEach(b => b.addEventListener('click', () => {
    const f = loadFiles().find(x => x.id === b.dataset.fcopy);
    if (!f) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(f.path || '').then(() => toast('✅ 路径已复制'));
    else toast('路径：' + (f.path || ''));
  }));
  box.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => {
    myConfirm('删除这个收藏？', () => { saveFiles(loadFiles().filter(x => x.id !== b.dataset.fdel)); renderFileList(); });
  }));
}
document.getElementById('fileAddBtn').addEventListener('click', () => {
  const name = document.getElementById('fileName').value.trim();
  const path = document.getElementById('filePath').value.trim();
  if (!name || !path) { toast('请填写名称和路径'); return; }
  const list = loadFiles();
  list.push({ id: uid(), name, path, ts: Date.now() });
  saveFiles(list);
  document.getElementById('fileName').value = '';
  document.getElementById('filePath').value = '';
  renderFileList();
  toast('✅ 已收藏');
});
renderFileList();
/* ======================================================
   📅 截稿 / 会议日历
   ====================================================== */
function loadDls() { return loadJSON('gradwb_dls') || []; }
function saveDls(l) { saveJSON('gradwb_dls', l); }
function dlDaysLeft(date) {
  if (!date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}
function renderDlList() {
  const box = document.getElementById('dlList');
  if (!box) return;
  const list = loadDls();
  list.sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  if (!list.length) { box.innerHTML = '<div class="mini-hint" style="text-align:center;padding:8px">暂无截稿/会议<br>添加投稿截止、会议 deadline、奖学金申请…</div>'; return; }
  box.innerHTML = list.map(d => {
    const days = dlDaysLeft(d.date);
    let label = '';
    if (days === null) label = '';
    else if (days < 0) label = `<span class="due-warn">已过 ${-days} 天</span>`;
    else if (days === 0) label = `<span class="due-warn">今天截止！</span>`;
    else if (days <= 7) label = `<span class="due-warn">剩 ${days} 天</span>`;
    else label = `<span class="task-due">剩 ${days} 天</span>`;
    const icon = d.type === '投稿截止' ? '📮' : d.type === '会议' ? '🎤' : d.type === '申请' ? '🏆' : '📌';
    return `<div style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12px">
      <span>${icon}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${esc(d.title)}</span>
      <span class="task-due">${d.date || ''}</span>${label}
      <button class="panel-btn" data-ddel="${d.id}" style="font-size:10px;padding:1px 5px">✕</button>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-ddel]').forEach(b => b.addEventListener('click', () => {
    saveDls(loadDls().filter(x => x.id !== b.dataset.ddel));
    renderDlList(); renderCalendar();
  }));
}
document.getElementById('dlAddBtn').addEventListener('click', () => {
  const title = document.getElementById('dlTitle').value.trim();
  const date = document.getElementById('dlDate').value;
  if (!title || !date) { toast('请填写事项和日期'); return; }
  const list = loadDls();
  list.push({ id: uid(), title, date, type: document.getElementById('dlType').value, createdAt: todayKey() });
  saveDls(list);
  document.getElementById('dlTitle').value = '';
  renderDlList(); renderCalendar();
  toast('✅ 已添加截稿');
});
/* ======================================================
   ✅ 任务清单 + 🎯 目标管理
   ====================================================== */
function loadTasks() { return loadJSON('gradwb_tasks') || []; }
function saveTasks(l) { saveJSON('gradwb_tasks', l); }
function loadGoals() { return loadJSON('gradwb_goals') || []; }
function saveGoals(l) { saveJSON('gradwb_goals', l); }
let taskEditId = null;
let goalEditId = null;

function dueLabel(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return '⏰ 已逾期 ' + (-diff) + ' 天';
  if (diff === 0) return '⏰ 今天截止';
  if (diff === 1) return '⏰ 明天截止';
  if (diff <= 7) return '⏳ ' + diff + ' 天后';
  return '📅 ' + String(d.getMonth() + 1) + '/' + String(d.getDate()).padStart(2, '0');
}
function renderTasks() {
  const tasks = loadTasks();
  const openN = tasks.filter(t => t.status !== '已完成').length;
  const doneN = tasks.length - openN;
  const dueN = tasks.filter(t => t.status !== '已完成' && t.due && dueLabel(t.due).startsWith('⏰')).length;
  document.getElementById('taskTotal').textContent = tasks.length;
  document.getElementById('taskOpen').textContent = openN;
  document.getElementById('taskDue').textContent = dueN;
  document.getElementById('taskDone').textContent = doneN;
  const st = document.getElementById('taskFilter').value;
  const prio = document.getElementById('taskPrioFilter').value;
  let list = tasks;
  if (st) list = list.filter(t => t.status === st);
  if (prio) list = list.filter(t => t.prio === prio);
  list.sort((a, b) => {
    if ((a.status === '已完成') !== (b.status === '已完成')) return a.status === '已完成' ? 1 : -1;
    const p = { '高': 0, '中': 1, '低': 2 };
    return (p[a.prio] ?? 1) - (p[b.prio] ?? 1);
  });
  const box = document.getElementById('taskList');
  if (!list.length) { box.innerHTML = '<div class="mini-empty">没有任务<br><span class="mini-hint">点右上角「＋ 新建任务」开始规划</span></div>'; return; }
  box.innerHTML = list.map(t => `<div class="task-item ${t.status === '已完成' ? 'done' : ''}" data-id="${t.id}">
    <button class="task-check ${t.status === '已完成' ? 'checked' : ''}" data-check="${t.id}" title="标记完成/未完成">${t.status === '已完成' ? '✓' : ''}</button>
    <div class="task-main">
      <div class="task-title-row"><span class="task-title ${t.prio === '高' ? 'prio-high' : ''}">${esc(t.title)}</span>
        ${t.prio ? `<span class="task-prio prio-${t.prio}">${t.prio}</span>` : ''}
        ${(t.tags || []).map(x => `<span class="task-tag">${esc(x)}</span>`).join('')}
        ${t.due ? `<span class="task-due ${dueLabel(t.due).startsWith('⏰') ? 'due-warn' : ''}">${dueLabel(t.due)}</span>` : ''}
        <span class="task-status">${t.status}</span>
      </div>
      ${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ''}
    </div>
    <select class="task-st-sel" data-st="${t.id}">${['待办', '进行中', '已完成'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <button class="task-edit" data-edit="${t.id}" title="编辑">✏️</button>
    <button class="task-del" data-del="${t.id}" title="删除">🗑️</button>
  </div>`).join('');
  box.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
    const list2 = loadTasks();
    const t = list2.find(x => x.id === b.dataset.check);
    if (t) { t.status = t.status === '已完成' ? '待办' : '已完成'; t.doneAt = t.status === '已完成' ? todayKey() : ''; }
    saveTasks(list2); renderTasks();
  }));
  box.querySelectorAll('.task-st-sel').forEach(sel => sel.addEventListener('change', () => {
    const list2 = loadTasks();
    const t = list2.find(x => x.id === sel.dataset.st);
    if (t) { t.status = sel.value; t.doneAt = sel.value === '已完成' ? todayKey() : ''; }
    saveTasks(list2); renderTasks();
  }));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTaskEdit(b.dataset.edit)));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    myConfirm('删除这个任务？', () => { saveTasks(loadTasks().filter(x => x.id !== b.dataset.del)); renderTasks(); });
  }));
  renderGoals();
}
function openTaskAdd() {
  taskEditId = null;
  document.getElementById('taskModalTitle').textContent = '＋ 新建任务';
  ['taskTitle', 'taskDue', 'taskTags', 'taskNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('taskPrio').value = '中';
  document.getElementById('taskStatus').value = '待办';
  openModal('taskModal');
}
function openTaskEdit(id) {
  const t = loadTasks().find(x => x.id === id);
  if (!t) return;
  taskEditId = id;
  document.getElementById('taskModalTitle').textContent = '✏️ 编辑任务';
  document.getElementById('taskTitle').value = t.title || '';
  document.getElementById('taskPrio').value = t.prio || '中';
  document.getElementById('taskStatus').value = t.status || '待办';
  document.getElementById('taskDue').value = t.due || '';
  document.getElementById('taskTags').value = (t.tags || []).join(',');
  document.getElementById('taskNote').value = t.note || '';
  openModal('taskModal');
}
document.getElementById('taskAddBtn').addEventListener('click', openTaskAdd);
document.getElementById('taskSaveBtn').addEventListener('click', () => {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('请填写任务标题'); return; }
  const data = {
    title,
    prio: document.getElementById('taskPrio').value,
    status: document.getElementById('taskStatus').value,
    due: document.getElementById('taskDue').value,
    tags: document.getElementById('taskTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    note: document.getElementById('taskNote').value.trim(),
  };
  const list = loadTasks();
  if (taskEditId) {
    const t = list.find(x => x.id === taskEditId);
    if (t) Object.assign(t, data);
  } else {
    list.push({ id: uid(), ...data, createdAt: todayKey() });
  }
  saveTasks(list);
  closeModal('taskModal');
  renderTasks();
  toast('✅ 任务已保存');
});
document.getElementById('taskFilter').addEventListener('change', renderTasks);
document.getElementById('taskPrioFilter').addEventListener('change', renderTasks);
document.getElementById('taskCsvBtn').addEventListener('click', () => {
  const list = loadTasks();
  if (!list.length) { toast('没有任务'); return; }
  exportCSV(['标题', '优先级', '状态', '截止日期', '标签', '备注'], list.map(t => [t.title, t.prio, t.status, t.due, (t.tags || []).join(';'), t.note]), '任务清单_' + new Date().toISOString().slice(0, 10) + '.csv');
});

/* 🎯 目标管理 */
function renderGoals() {
  const goals = loadGoals();
  const box = document.getElementById('goalList');
  if (!box) return;
  if (!goals.length) { box.innerHTML = '<div class="mini-empty">还没有目标<br><span class="mini-hint">点「＋ 新目标」设定学期/月度目标</span></div>'; return; }
  box.innerHTML = goals.map(g => `<div class="goal-item">
    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
      <span class="goal-title">${esc(g.title)}</span>
      ${g.deadline ? `<span class="task-due ${dueLabel(g.deadline).startsWith('⏰') ? 'due-warn' : ''}">${dueLabel(g.deadline)}</span>` : ''}
      <span class="goal-pct">${g.pct || 0}%</span>
    </div>
    <div class="goal-track"><div class="goal-bar ${(g.pct || 0) >= 100 ? 'full' : ''}" style="width:${Math.min(100, g.pct || 0)}%"></div></div>
    <div style="display:flex;gap:6px">
      <button class="panel-btn" data-gedit="${g.id}" style="font-size:12px">✏️</button>
      <button class="panel-btn" data-gdel="${g.id}" style="font-size:12px">🗑️</button>
    </div>
  </div>`).join('');
  box.querySelectorAll('[data-gedit]').forEach(b => b.addEventListener('click', () => openGoalEdit(b.dataset.gedit)));
  box.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', () => {
    myConfirm('删除这个目标？', () => { saveGoals(loadGoals().filter(x => x.id !== b.dataset.gdel)); renderGoals(); });
  }));
}
function openGoalAdd() {
  goalEditId = null;
  document.getElementById('goalModalTitle').textContent = '🎯 新目标';
  ['goalTitle', 'goalDeadline', 'goalPct', 'goalNote'].forEach(id => document.getElementById(id).value = '');
  openModal('goalModal');
}
function openGoalEdit(id) {
  const g = loadGoals().find(x => x.id === id);
  if (!g) return;
  goalEditId = id;
  document.getElementById('goalModalTitle').textContent = '✏️ 编辑目标';
  document.getElementById('goalTitle').value = g.title || '';
  document.getElementById('goalDeadline').value = g.deadline || '';
  document.getElementById('goalPct').value = g.pct || 0;
  document.getElementById('goalNote').value = g.note || '';
  openModal('goalModal');
}
document.getElementById('goalAddBtn').addEventListener('click', openGoalAdd);
document.getElementById('goalSaveBtn').addEventListener('click', () => {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) { toast('请填写目标标题'); return; }
  const pct = Math.min(100, Math.max(0, Number(document.getElementById('goalPct').value) || 0));
  const data = { title, pct, deadline: document.getElementById('goalDeadline').value, note: document.getElementById('goalNote').value.trim() };
  const list = loadGoals();
  if (goalEditId) { const g = list.find(x => x.id === goalEditId); if (g) Object.assign(g, data); }
  else list.push({ id: uid(), ...data, createdAt: todayKey() });
  saveGoals(list);
  closeModal('goalModal');
  renderGoals();
  toast('✅ 目标已保存');
});
/* --- 🔔 日程提醒（开始前 30 分钟浏览器通知） --- */
function initReminder() {
  const btn = document.getElementById('remindBtn');
  if (!btn) return;
  const updateBtn = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      btn.textContent = '🔔 提醒已开启';
      btn.style.color = '#14966e';
    }
  };
  btn.addEventListener('click', () => {
    if (typeof Notification === 'undefined') { toast('当前环境不支持系统通知（预览面板受限），页面内会用轻提示代替'); return; }
    Notification.requestPermission().then(p => {
      if (p === 'granted') { toast('✅ 日程提醒已开启：开始前 30 分钟通知'); updateBtn(); }
      else toast('提醒未授权，浏览器通知不可用');
    });
  });
  updateBtn();
  // 每 2 分钟检查一次今天带时间的日程
  setInterval(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const events = loadEvents();
    const today = todayKey();
    const reminded = JSON.parse(localStorage.getItem('gradwb_reminded') || '[]');
    const fresh = [];
    const now = new Date();
    events.forEach(ev => {
      if (ev.date !== today || !ev.time || !ev.title) return;
      const m = String(ev.time).match(/^(\d{1,2}):(\d{2})/);
      if (!m) return;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
      const diff = (start - now) / 60000;
      if (diff >= 25 && diff <= 30 && !reminded.includes(ev.id)) {
        fresh.push(ev);
        new Notification('⏰ 日程提醒：' + ev.title, { body: '开始时间 ' + ev.time + (ev.note ? ' — ' + ev.note : '') });
        toast('⏰ 30 分钟后：「' + ev.title + '」(' + ev.time + ')');
      }
    });
    if (fresh.length) {
      localStorage.setItem('gradwb_reminded', JSON.stringify([...reminded, ...fresh.map(e => e.id)]));
    }
  }, 120000);
}
initReminder();

/* --- 📝 英语听写测验（错题进错题本） --- */
let quizWords = [];
document.getElementById('quizBtn').addEventListener('click', startQuiz);
function startQuiz() {
  const eng = loadEnglish();
  const book = eng.book || '六级核心';
  const words = loadWordBooks();
  const list = words[book] || [];
  if (!list.length) { toast('当前词书没有单词，请先加载词库'); return; }
  // 错题优先
  let wrong = [];
  try { wrong = JSON.parse(localStorage.getItem('gradwb_eng_wrong') || '[]'); } catch (e) {}
  const wrongWords = list.filter(w => wrong.includes(w.w));
  const pool = wrongWords.length >= 5 ? wrongWords : list;
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);
  quizWords = picked;
  document.getElementById('quizInfo').textContent = `随机 10 词 · ${book}${wrongWords.length >= 5 ? '（含错题）' : ''}`;
  document.getElementById('quizList').innerHTML = picked.map((w, i) => `
    <div class="quiz-row"><span class="quiz-idx">${i + 1}.</span><span class="quiz-cn">${esc(w.cn)}</span>
    <input class="quiz-input" data-i="${i}" placeholder="输入英文单词…" autocomplete="off"></div>`).join('');
  document.getElementById('quizResult').innerHTML = '';
  document.getElementById('quizSubmit').hidden = false;
  document.getElementById('quizReset').hidden = true;
  openModal('quizModal');
  setTimeout(() => { const inp = document.querySelector('.quiz-input'); if (inp) inp.focus(); }, 60);
}
document.getElementById('quizSubmit').addEventListener('click', () => {
  let score = 0;
  const rows = [];
  const wrong = [];
  quizWords.forEach((w, i) => {
    const inp = document.querySelector(`.quiz-input[data-i="${i}"]`);
    const ans = (inp ? inp.value : '').trim().toLowerCase();
    const ok = ans && w.w.toLowerCase() === ans;
    if (ok) score++;
    else wrong.push(w.w);
    rows.push(`<div class="quiz-res-row">${i + 1}. ${esc(w.w)} <span class="${ok ? 'quiz-ok' : 'quiz-bad'}">${ok ? '✓' : '✗ 你答：' + esc(ans || '（空）')}</span> <span class="quiz-cn">${esc(w.cn)}</span></div>`);
  });
  if (wrong.length) {
    try {
      const all = JSON.parse(localStorage.getItem('gradwb_eng_wrong') || '[]');
      localStorage.setItem('gradwb_eng_wrong', JSON.stringify([...new Set([...all, ...wrong])]));
    } catch (e) {}
  }
  document.getElementById('quizResult').innerHTML = `<div class="quiz-score">得分 <b>${score}</b> / ${quizWords.length}${score === quizWords.length ? ' 🎉 全对！' : wrong.length ? `（${wrong.length} 个错题已加入错题本）` : ''}</div>` + rows.join('');
  document.getElementById('quizSubmit').hidden = true;
  document.getElementById('quizReset').hidden = false;
});
document.getElementById('quizReset').addEventListener('click', startQuiz);
/* --- Agent 动态记录（首页显示最近活动） --- */
function logAgentAct(text) {
  try {
    const acts = JSON.parse(localStorage.getItem('gradwb_agent_acts') || '[]');
    acts.unshift({ t: text, ts: Date.now() });
    localStorage.setItem('gradwb_agent_acts', JSON.stringify(acts.slice(0, 10)));
  } catch (e) {}
}
function renderAgentFeed() {
  const box = document.getElementById('agentFeedBox');
  if (!box) return;
  let acts = [];
  try { acts = JSON.parse(localStorage.getItem('gradwb_agent_acts') || '[]'); } catch (e) {}
  if (!acts.length) { box.hidden = true; return; }
  box.hidden = false;
  const feed = document.getElementById('agentFeed');
  const timeStr = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  feed.innerHTML = acts.slice(0, 4).map(a => `<span class="agent-act-chip" title="${timeStr(a.ts)}">🤖 ${esc(a.t)}</span>`).join('');
}
/* 全局缓存（必须用 var 或提前声明：renderHomeAggregate 顶层调用 loadLibrary，let 会 TDZ 报错） */
let libCache = null;   // 文献数据缓存
const DEFAULT_SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', icon: '🤖' },
  { name: 'Gemini', url: 'https://gemini.google.com', icon: '✨' },
  { name: 'Google 学术', url: 'https://scholar.google.com', icon: '🎓' },
  { name: 'arXiv', url: 'https://arxiv.org', icon: '📄' },
  { name: 'DeepL', url: 'https://www.deepl.com/translator', icon: '🔤' },
  { name: 'Google 翻译', url: 'https://translate.google.com', icon: '🌐' },
  { name: '知乎', url: 'https://www.zhihu.com', icon: '🧠' },
  { name: 'B站', url: 'https://www.bilibili.com', icon: '📺' },
  { name: '知网', url: 'https://www.cnki.net', icon: '📚' },
  { name: 'Google', url: 'https://www.google.com', icon: '🔍' },
  { name: '基元律动', url: 'https://tokenrhythm.studio/', icon: '💠' },
];
let libShow = 40;      // 文献列表分页

/* ---------- 页面切换 ---------- */
const PAGES = ['home','summary','calendar','radar','library','analysis','submission','articles','english','fitness','sites','task','notes','api','agent'];
const RENDER_ON_SHOW = {
  summary: renderSummary, calendar: renderCalendar, radar: renderRadar,
  library: renderLibrary, analysis: renderAnalysisPage, submission: renderSubmission,
  articles: renderArticles,
  task: renderTasks, notes: renderNotes,
  english: renderEnglish, fitness: renderFitness, sites: renderSites, api: renderAPIs
};
function showPage(name) {
  if (!name) return;
  const el = document.getElementById(name);
  if (!el) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
  history.replaceState(null, '', '#' + name);
  document.querySelector('.main').scrollTop = 0;
  if (RENDER_ON_SHOW[name]) RENDER_ON_SHOW[name]();
}
// 仅给声明了 data-page 的元素绑定页面切换（panel-btn 等其他按钮不受影响）
document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => showPage(el.dataset.page)));
const initial = location.hash.slice(1);
if (PAGES.includes(initial)) showPage(initial);

/* ======================================================
   首页：时钟 / 语录 / 天气 / 快记 / 柱状图 / 里程碑 / 聚合
   ====================================================== */
function tick() {
  const now = new Date();
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  const clock = document.getElementById('clock');
  const clockDate = document.getElementById('clockDate');
  const heroDate = document.getElementById('heroDate');
  if (clock) clock.textContent = `${hh}:${mm}:${ss}`;
  if (clockDate) clockDate.textContent = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} 周${WEEK[now.getDay()]}`;
  if (heroDate) heroDate.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`;
  const secs = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
  const pct = (secs / 86400 * 100);
  const dayPct = document.getElementById('dayPct');
  const dayFill = document.getElementById('dayFill');
  if (dayPct) dayPct.textContent = pct.toFixed(1) + '%';
  if (dayFill) dayFill.style.width = pct.toFixed(1) + '%';
  const h = now.getHours();
  let greet, icon;
  if (h >= 5 && h < 11) greet = ['早上好','🌅']; else if (h >= 11 && h < 13) greet = ['中午好','☀️'];
  else if (h >= 13 && h < 18) greet = ['下午好','🌤️']; else if (h >= 18 && h < 23) greet = ['晚上好','🌙'];
  else greet = ['夜深了','🌌'];
  const gw = document.getElementById('greetWord');
  const gi = document.getElementById('greetIcon');
  if (gw) gw.textContent = greet[0];
  if (gi) gi.textContent = greet[1];
}
tick();
setInterval(tick, 1000);

const QUOTES = [
  { text: 'In the long run, we are all dead. But in the short run, we publish.', src: '学术圈改编' },
  { text: 'If you are not failing, you are probably not doing anything important.', src: '学术圈' },
  { text: 'Reading makes a full man; writing makes an exact man.', src: 'Francis Bacon 改编' },
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', src: '谚语' },
  { text: 'Research is formalized curiosity. It is poking and prying with a purpose.', src: 'Zora Neale Hurston' },
  { text: 'Science is organized knowledge. Wisdom is organized life.', src: 'Immanuel Kant' },
  { text: 'The important thing is not to stop questioning.', src: 'Albert Einstein' },
  { text: 'It always seems impossible until it is done.', src: 'Nelson Mandela' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', src: 'Thomas Edison' },
  { text: 'I have not failed. I have just found 10,000 ways that will not work.', src: 'Thomas Edison' },
  { text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', src: 'Winston Churchill' },
  { text: 'The only way to do great work is to love what you do.', src: 'Steve Jobs' },
  { text: 'Stay hungry, stay foolish.', src: 'Steve Jobs' },
  { text: 'Nothing in life is to be feared, it is only to be understood.', src: 'Marie Curie' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', src: 'Aristotle' },
  { text: 'If I have seen further it is by standing on the shoulders of giants.', src: 'Isaac Newton' },
  { text: 'The scientist is not a person who gives the right answers, one who asks the right questions.', src: 'Claude Lévi-Strauss' },
  { text: 'A goal without a plan is just a wish.', src: 'Antoine de Saint-Exupéry' },
  { text: 'The secret of getting ahead is getting started.', src: 'Mark Twain' },
  { text: 'What we know is a drop, what we do not know is an ocean.', src: 'Isaac Newton' },
  { text: 'In the middle of difficulty lies opportunity.', src: 'Albert Einstein' },
  { text: 'Theory is when everyone knows everything but nothing works. Practice is when everything works but no one knows why.', src: '学术圈' },
  { text: 'The journey of a thousand miles begins with a single step.', src: 'Lao Tzu' },
  { text: 'Do not pray for an easy life, pray for the strength to endure a difficult one.', src: 'Bruce Lee' },
  { text: 'The greatest enemy of knowledge is not ignorance, it is the illusion of knowledge.', src: 'Stephen Hawking' },
];
let quoteIdx = -1;
(function renderQuote() {
  const el = document.getElementById('heroQuote');
  if (!el) return;
  let i;
  do { i = Math.floor(Math.random() * QUOTES.length); } while (i === quoteIdx && QUOTES.length > 1);
  quoteIdx = i;
  const q = QUOTES[i];
  el.innerHTML = `"${q.text}" <span class="quote-src">— ${q.src}</span>`;
})();
setInterval(function () {
  const el = document.getElementById('heroQuote');
  if (el) renderQuote();
}, 5 * 60 * 1000);

/* --- 天气 --- */
function savedCity() {
  try {
    const c = JSON.parse(localStorage.getItem('gradwb_city'));
    if (c && c.name && c.lat && c.lon) return c;
  } catch (e) {}
  return null;
}
const DEFAULT_CITY = { name: '大同 · 云州区', lat: 40.04, lon: 113.61 };
const WMO = {
  0:['晴','☀️'],1:['基本晴','🌤️'],2:['多云','⛅'],3:['阴','☁️'],45:['雾','🌫️'],48:['雾凇','🌫️'],
  51:['毛毛雨','🌦️'],53:['毛毛雨','🌦️'],55:['毛毛雨','🌦️'],56:['冻毛毛雨','🌧️'],57:['冻毛毛雨','🌧️'],
  61:['小雨','🌧️'],63:['中雨','🌧️'],65:['大雨','🌧️'],66:['冻雨','🌧️'],67:['冻雨','🌧️'],
  71:['小雪','❄️'],73:['中雪','❄️'],75:['大雪','❄️'],77:['雪粒','❄️'],
  80:['阵雨','🌦️'],81:['阵雨','🌦️'],82:['强阵雨','⛈️'],85:['阵雪','❄️'],86:['阵雪','❄️'],
  95:['雷暴','⛈️'],96:['雷暴+冰雹','⛈️'],99:['雷暴+冰雹','⛈️']
};
// GPS 坐标 → 地名反查（bigdatacloud 中文精确到区县，国内可达；photon 兜底）
async function reverseGeo(lat, lon) {
  // 1) bigdatacloud（localityLanguage=zh，返回省/市/区县中文）
  try {
    const ctl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl });
    const d = await r.json();
    if (d.city || d.principalSubdivision) {
      const strip = (s) => String(s || '')
        .replace(/维吾尔自治区$/, '').replace(/壮族自治区$/, '').replace(/回族自治区$/, '')
        .replace(/特别行政区$/, '').replace(/自治区$/, '').replace(/省$/, '').replace(/市$/, '');
      const t2s = (s2) => { const M = { '蘭': '兰', '縣': '县', '雲': '云', '龍': '龙', '陽': '阳', '寧': '宁', '島': '岛', '灣': '湾', '廣': '广', '華': '华', '蘇': '苏', '會': '会', '區': '区', '濟': '济', '鄭': '郑', '臺': '台', '東': '东', '豐': '丰', '澤': '泽', '厳': '严', '興': '兴' }; return String(s2).split('').map(c => M[c] || c).join(''); };
      const parts = [t2s(strip(d.principalSubdivision)), t2s(strip(d.city)), t2s(d.locality)].filter(Boolean);
      return parts.slice(0, 3).join(' · ');
    }
  } catch (e) { /* 继续 */ }
  // 2) photon 兜底
  try {
    const ctl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl });
    const d = await r.json();
    const p = d.features && d.features[0] && d.features[0].properties;
    if (!p) return null;
    const strip = (s) => String(s || '').replace(/省$/, '').replace(/市$/, '');
    const parts = [strip(p.state), strip(p.city), p.district].filter(Boolean);
    return parts.slice(0, 3).join(' · ');
  } catch (e) { return null; }
}
async function detectCity(forceGps) {
  // 0) 用户手动指定的城市（优先级最高，设置一次永久生效）
  const sc = savedCity();
  if (sc && !forceGps) return { lat: sc.lat, lon: sc.lon, cityName: sc.name };
  // 1) 浏览器 GPS 定位（最精确，能到云州区/乡镇级）+ 坐标反查地名
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 60000 }));
    const name = await reverseGeo(pos.coords.latitude, pos.coords.longitude);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, cityName: name || 'GPS 定位' };
  } catch (e) { /* GPS 不可用（沙箱拦截/未授权），继续 */ }
  // 2) IP 定位（国内可达：ip-api.com 含省市县，ipinfo.io https 兜底）
  const ipApis = ['http://ip-api.com/json/?lang=zh-CN', 'https://ipinfo.io/json'];
  for (const u of ipApis) {
    try {
      const ctl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl });
      const d = await r.json();
      if (u.includes('ip-api')) {
        if (d.status === 'success' && d.lat && d.lon) {
          const name = (d.regionName || '') + (d.city ? ' · ' + d.city : '');
          return { lat: d.lat, lon: d.lon, cityName: name || '当前位置' };
        }
      } else if (d.loc) {
        const [la, lo] = String(d.loc).split(',');
        if (la && lo) return { lat: +la, lon: +lo, cityName: (d.region || '') + (d.city ? ' · ' + d.city : '') || '当前位置' };
      }
    } catch (e) { /* 下一个 */ }
  }
  // 3) 默认城市（大同 · 云州区）
  return { lat: DEFAULT_CITY.lat, lon: DEFAULT_CITY.lon, cityName: DEFAULT_CITY.name };
}
async function loadWeather(forceGps) {
  const wIcon = document.getElementById('wIcon');
  const wText = document.getElementById('wText');
  let lat, lon, cityName;
  try {
    const c = await detectCity(forceGps);
    lat = c.lat; lon = c.lon; cityName = c.cityName;
  } catch (e) {
    lat = DEFAULT_CITY.lat; lon = DEFAULT_CITY.lon; cityName = DEFAULT_CITY.name;
  }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia%2FShanghai`);
    const d = await r.json();
    const cw = d.current_weather;
    const [desc, icon] = WMO[cw.weathercode] || ['未知', '🌡️'];
    wIcon.textContent = (cw.weathercode === 0 && cw.is_day === 0) ? '🌙' : icon;
    wText.textContent = `${cityName} · ${Math.round(cw.temperature)}°C ${desc} · 风速 ${Math.round(cw.windspeed)}km/h`;
  } catch (e) {
    wIcon.textContent = '⚠️';
    wText.textContent = '天气获取失败，点击 🔄 重试';
  }
}
document.getElementById('wLocate').addEventListener('click', async () => {
  wIcon.textContent = '⏳';
  wText.textContent = '定位中…';
  const c = await detectCity(true);
  if (c.cityName === 'GPS 定位' && c.lat && c.lon) {
    // GPS 成功：记录坐标但用「GPS 定位」表述，提示可手动指定
    wText.textContent = 'GPS 已定位 · 点击 📌 可手动指定城市';
    await loadWeather(true);
  } else {
    await loadWeather(true);
  }
});
document.getElementById('wPin').addEventListener('click', () => {
  openModal('cityModal');
});
document.getElementById('citySave').addEventListener('click', () => {
  const name = document.getElementById('cityName').value.trim();
  const lat = parseFloat(document.getElementById('cityLat').value);
  const lon = parseFloat(document.getElementById('cityLon').value);
  if (!name || isNaN(lat) || isNaN(lon)) { toast('请填写城市名和经纬度'); return; }
  localStorage.setItem('gradwb_city', JSON.stringify({ name, lat, lon }));
  closeModal('cityModal');
  loadWeather();
  toast('✅ 已设为 ' + name + '，天气将固定显示该城市');
});
document.querySelectorAll('[data-city-preset]').forEach(btn => btn.addEventListener('click', () => {
  const [name, lat, lon] = btn.dataset.cityPreset.split('|');
  document.getElementById('cityName').value = name;
  document.getElementById('cityLat').value = lat;
  document.getElementById('cityLon').value = lon;
}));
document.getElementById('wRefresh').addEventListener('click', loadWeather);

/* --- 本周工作时长柱状图（两个实例） --- */
function researchHoursMap() {
  const sum = loadJSON('gradwb_summaries') || [];
  const map = {};
  sum.forEach(s => { map[s.date] = (map[s.date] || 0) + (Number(s.hours) || 0); });
  return map;
}
function renderBarChart(chartId, totalId) {
  const chart = document.getElementById(chartId);
  const total = document.getElementById(totalId);
  if (!chart) return;
  const hours = researchHoursMap();
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayIdx);
  let weekSum = 0;
  const values = Array.from({length: 7}, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const v = hours[dateKey(d)] || 0;
    weekSum += v;
    return v;
  });
  const maxV = Math.max(3, ...values);
  chart.innerHTML = values.map((v, i) => {
    const pct = Math.max(v / maxV * 100, v > 0 ? 12 : 4);
    const isToday = i === dayIdx;
    const valHtml = v > 0 ? `<span class="wb-val">${v}</span>` : '';
    return `<div class="wb-col">
      <div class="wb-track"><div class="wb-bar-wrap" style="height:${pct}%">${valHtml}<div class="wb-bar ${v > 0 ? 'active' : 'zero'} ${isToday ? 'today' : ''}"></div></div></div>
      <div class="wb-label ${isToday ? 'today' : ''}">${'一二三四五六日'[i]}${isToday ? '<i>今</i>' : ''}</div></div>`;
  }).join('');
  total.textContent = `本周合计 ${weekSum} 小时`;
}
renderBarChart('barChart', 'barTotal');
renderBarChart('barChart2', 'barTotal2');

/* --- 🤖 一键周报（Agent 读本周记录生成） --- */
let weekReportBusy = false;
function genWeekReport() {
  if (weekReportBusy) return;
  const summaries = loadSummaries();
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayIdx);
  const weekStart = dateKey(monday);
  const records = summaries.filter(r => r.date && r.date >= weekStart);
  const box = document.getElementById('weekReportBox');
  const hint = document.getElementById('weekReportHint');
  const copyBtn = document.getElementById('weekReportCopy');
  const content = document.getElementById('weekReportContent');
  box.hidden = false;
  copyBtn.hidden = true;
  if (!records.length) {
    hint.textContent = '';
    content.innerHTML = '<div class="mini-empty">本周还没有工作记录<br><span class="mini-hint">先在下面记一条，再生成周报</span></div>';
    return;
  }
  weekReportBusy = true;
  hint.textContent = '🤖 Agent 生成中…（10~60 秒）';
  content.innerHTML = '';
  const lines = records.map(r => `- ${r.date}（${r.hours || 0}小时${r.tags ? '，' + r.tags : ''}）：${r.note || ''}`).join('\n');
  fetch(BRIDGE + '/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines, scene: 'report' }),
  })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; })
    .then(d => {
      content.innerHTML = mdToHtml(d.reply || '（空回复）');
      copyBtn.hidden = false;
      hint.textContent = '✅ 生成完成';
    })
    .catch(e => { content.innerHTML = '<div class="mini-empty">⚠️ ' + esc(e.message) + '</div>'; hint.textContent = ''; })
    .finally(() => { weekReportBusy = false; });
}
document.getElementById('weekReportBtn').addEventListener('click', genWeekReport);
document.getElementById('weekReportCopy').addEventListener('click', () => {
  const txt = document.getElementById('weekReportContent').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('✅ 周报已复制'));
  else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('✅ 周报已复制'); }
});

/* --- 里程碑 --- */
const BACK_DATE = new Date('2026-08-12T00:00:00');
const SEM_START = new Date('2026-09-01T00:00:00');
const SEM_END = new Date('2027-01-15T00:00:00');
function renderMilestones() {
  const now = new Date();
  const daysToBack = Math.ceil((BACK_DATE - now) / 86400000);
  const backCount = document.getElementById('backCount');
  const backSub = document.getElementById('backSub');
  if (daysToBack > 0) { backCount.textContent = daysToBack; backSub.textContent = '2026-08-12 · 兰州'; }
  else { backCount.textContent = '🎉'; backSub.textContent = '已返校，新学期加油'; }
  const semFill = document.getElementById('semFill');
  const semText = document.getElementById('semText');
  if (now < SEM_START) {
    const days = Math.ceil((SEM_START - now) / 86400000);
    semFill.style.width = '0%';
    semText.textContent = `距 2026-09-01 开学还有 ${days} 天`;
  } else if (now > SEM_END) { semFill.style.width = '100%'; semText.textContent = '秋季学期已结束'; }
  else {
    const pct = (now - SEM_START) / (SEM_END - SEM_START) * 100;
    semFill.style.width = pct.toFixed(1) + '%';
    semText.textContent = `学期进度 ${pct.toFixed(1)}%`;
  }
}
renderMilestones();

/* --- 首页聚合 --- */
function fitWeekCount(fit) {
  if (!fit || !fit.records) return 0;
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayIdx);
  return fit.records.filter(r => r.date >= dateKey(monday)).length;
}
const HOME_CARDS = [
  { page: 'summary',   icon: '📝', name: '工作总结',   get: () => { const s = loadSummaries(); const today = s.filter(r => r.date === todayKey()); const h = today.reduce((x, r) => x + (Number(r.duration) || 0), 0); return h ? `今日工作 ${h} 小时` : (s.length ? `累计 ${s.length} 条记录` : '记录工作、复盘进展'); } },
  { page: 'calendar',  icon: '🗓️', name: '今日日程',   get: () => { const evs = (loadJSON('gradwb_events') || []).filter(e => e.date === todayKey()); return evs.length ? `今日 ${evs.length} 个日程` : '规划今天要做的事'; } },
  { page: 'calendar',  icon: '📅', name: '工作日历',   get: () => { const evs = loadJSON('gradwb_events') || []; return evs.length ? `累计 ${evs.length} 条日程` : '月视图、日记、切年月'; } },
  { page: 'radar',     icon: '📡', name: '文献雷达',   get: () => { const r = loadJSON('gradwb_radar'); const n = (r && r.recs) ? r.recs.length : 0; return n ? `推荐 ${n} 篇待看` : '期刊 + 学者自动搜索'; } },
  { page: 'library',   icon: '📚', name: '我的文献库', get: () => { const n = loadLibrary().length; return n ? `已收录 ${n} 篇文献` : '导入 Zotero 文献'; } },
  { page: 'analysis',  icon: '🔬', name: '文献分析',   get: () => { const n = loadAnalyses().length; return n ? `已分析 ${n} 篇` : 'AI 精读、创新点提炼'; } },
  { page: 'submission', icon: '✉️', name: '投稿管理', get: () => { const l = loadJSON('gradwb_submissions') || []; const a = l.filter(s => !['已录用','已拒稿','已撤稿'].includes(s.status)).length; return a ? `${a} 篇投稿进行中` : '跟踪投稿进度'; } },
  { page: 'articles',  icon: '🗂️', name: '文章管理',   get: () => { const a = loadJSON('gradwb_articles'); let n = 0; if (a) for (const c of Object.keys(a)) for (const p of (a[c].parts || [])) n += (p.files || []).length; return n ? `共 ${n} 个文件` : '存论文、资料、图片'; } },
  { page: 'english',   icon: '🌐', name: '英语学习',   get: () => { const e = loadJSON('gradwb_english'); const wb = loadJSON('gradwb_wordbooks'); let total = 0, done = 0; if (wb) { const prog = loadJSON('gradwb_wb_progress') || {}; for (const k of Object.keys(wb)) { total += (wb[k] || []).length; done += (prog[k] || []).length; } } return e && e.streak ? `连续打卡 ${e.streak} 天 · 掌握 ${done}/${total} 词` : '背单词、发音、复习'; } },
  { page: 'fitness',   icon: '💪', name: '健身记录',   get: () => { const f = loadJSON('gradwb_fitness'); const w = fitWeekCount(f); return w ? `本周已训练 ${w} 次` : '记录每次运动'; } },
  { page: 'sites',     icon: '🔗', name: '网站索引',   get: () => { const n = loadSites().length; return n ? `${n} 个常用网站` : '收藏常用网站'; } },
  { page: 'api',       icon: '🔑', name: 'API 管理',   get: () => { const n = loadAPIs().filter(a => a.key).length; return n ? `${n} 个服务已配置` : '配置 AI 服务密钥'; } },
  { page: 'task',      icon: '✅', name: '任务清单',   get: () => { const t = loadTasks(); const open = t.filter(x => x.status !== '已完成').length; return open ? `${open} 个任务待完成` : (t.length ? '全部任务已完成 🎉' : '规划科研任务'); } },
  { page: 'notes',     icon: '📝', name: '研究笔记',   get: () => { const n = loadNotes(); const pin = n.filter(x => x.pin).length; return n.length ? `${n.length} 条笔记${pin ? ' · ' + pin + ' 条置顶' : ''}` : '记录灵感与思路'; } }
];
function renderHomeCards() {
  const box = document.getElementById('homeCards');
  if (!box) return;
  box.innerHTML = HOME_CARDS.map(c => `<button class="home-card" data-page="${c.page}">
      <span class="home-card-icon">${c.icon}</span>
      <span class="home-card-main"><b>${c.name}</b><span class="home-card-sub">${esc(c.get())}</span></span>
      <span class="home-card-arrow">›</span>
    </button>`).join('');
  box.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)));
}
function renderLitFeed() {
  // 最新文献（最近入库 4 篇）
  const libBox = document.getElementById('litFeed');
  if (libBox) {
    const lib = loadLibrary();
    const sorted = [...lib].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
    libBox.innerHTML = sorted.slice(0, 4).map(x => `<div class="lit-item" data-page="library">
        <span class="lit-dot"></span>
        <div class="lit-main"><div class="lit-title">${esc(x.title)}</div>
        <div class="lit-sub">${esc(x.authors || '')} · ${x.year || ''} ${x.journal ? '· ' + esc(x.journal) : ''}</div></div>
      </div>`).join('') || '<div class="mini-empty">文献库还空着<br><span class="mini-hint">去「我的文献库」导入 Zotero 文献</span></div>';
    libBox.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => showPage('library')));
  }
  // 雷达推荐（最新 3 条）
  const rdBox = document.getElementById('radarFeed');
  if (rdBox) {
    const r = loadJSON('gradwb_radar');
    const recs = (r && r.recs) || [];
    rdBox.innerHTML = recs.slice(0, 3).map(x => `<div class="lit-item" data-page="radar">
        <span class="lit-dot rd"></span>
        <div class="lit-main"><div class="lit-title">${esc(x.title || '未命名文献')}</div>
        <div class="lit-sub">${esc(x.source || x.type || '')}${x.date ? ' · ' + esc(x.date) : ''}</div></div>
      </div>`).join('') || '<div class="mini-empty">暂无推荐<br><span class="mini-hint">在「文献雷达」配置学者/期刊后自动推荐</span></div>';
    rdBox.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => showPage('radar')));
  }
}
function renderOverview() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  try { set('ovLib', loadLibrary().length); } catch (e) { set('ovLib', 0); }
  try {
    const s = loadSummaries();
    const today = s.filter(x => x.date === todayKey());
    set('ovSum', today.length ? today.length + ' 条 · ' + (today.reduce((a, x) => a + (Number(x.duration) || 0), 0) || 0) + 'h' : '0 条');
  } catch (e) { set('ovSum', '0 条'); }
  try { const e = loadJSON('gradwb_english'); set('ovEng', (e && e.streak) || 0); } catch (e) { set('ovEng', 0); }
  try {
    const f = loadJSON('gradwb_fitness');
    const m = (f && f.records || []).filter(r => (r.date || '').startsWith(String(new Date().getFullYear()) + '-' + String(new Date().getMonth() + 1).padStart(2, '0'))).length;
    set('ovFit', m);
  } catch (e) { set('ovFit', 0); }
  try {
    const subs = loadJSON('gradwb_submissions') || [];
    set('ovSub', subs.filter(x => !['已录用', '已拒稿', '已撤稿'].includes(x.status)).length);
  } catch (e) { set('ovSub', 0); }
  try { const ev = loadJSON('gradwb_events') || []; set('ovEvt', ev.filter(x => x.date === todayKey()).length); } catch (e) { set('ovEvt', 0); }
  try { const t = loadTasks(); set('ovTask', t.filter(x => x.status !== '已完成').length); } catch (e) { set('ovTask', 0); }
}
document.getElementById('ovRow').addEventListener('click', e => {
  const card = e.target.closest('.ov-card');
  if (!card) return;
  const map = { library: 'library', summary: 'summary', english: 'english', fitness: 'fitness', submission: 'submission', calendar: 'calendar', task: 'task' };
  const page = map[card.dataset.ov];
  if (page) showPage(page);
});
function renderHomeAggregate() {
  renderHomeCards();
  renderOverview();
  renderLitFeed();
  const lib = loadLibrary();
  const subs = loadJSON('gradwb_submissions');
  const eng = loadJSON('gradwb_english');
  const fit = loadJSON('gradwb_fitness');
  const events = loadJSON('gradwb_events') || [];
  const todayEvents = events.filter(e => e.date === todayKey());
  const evBox = document.getElementById('todayEvents');
  if (evBox) {
    evBox.innerHTML = todayEvents.length
      ? todayEvents.map(e => `<div class="event-item"><span class="event-type" style="background:${e.color}"></span><span class="event-time">${e.time || '全天'}</span><span class="event-title">${esc(e.title)}</span></div>`).join('')
      : `<div class="mini-empty">今天还没有日程安排<br><span class="mini-hint">去「工作日历」添加</span></div>`;
  }
  const feed = [];
  const s = loadSummaries();
  if (s.length) { const l = s[s.length-1]; feed.push({ icon: '📝', text: `记录工作 ${l.duration || ''} 小时`, time: l.date || '' }); }
  if (lib && lib.length) { const l = lib[lib.length-1]; feed.push({ icon: '📚', text: `收录文献《${l.title.slice(0, 28)}》`, time: l.addedAt || '' }); }
  if (fit && fit.records && fit.records.length) { const l = fit.records[fit.records.length-1]; feed.push({ icon: '💪', text: `完成训练：${l.type} ${l.duration}分钟`, time: l.date || '' }); }
  if (eng && eng.records && eng.records.length) { const l = eng.records[eng.records.length-1]; feed.push({ icon: '🌐', text: `英语打卡第 ${l.day || '?'} 天`, time: l.date || '' }); }
  const subs2 = subs || [];
  if (subs2.length) { const l = subs2[subs2.length-1]; feed.push({ icon: '✉️', text: `投稿《${l.title.slice(0, 24)}》→ ${l.status}`, time: l.createdAt || '' }); }
  const recentFeed = document.getElementById('recentFeed');
  if (recentFeed) {
    recentFeed.innerHTML = feed.length
      ? feed.slice(0, 5).map(f => `<div class="feed-item"><span class="feed-icon">${f.icon}</span><span>${f.text}</span><span class="feed-time">${f.time}</span></div>`).join('')
      : `<div class="mini-empty">暂无动态<br><span class="mini-hint">记录工作、打卡、训练后会出现在这里</span></div>`;
  }
}
renderHomeAggregate();
setInterval(renderHomeAggregate, 5 * 60 * 1000);
renderAgentFeed();

/* ======================================================
   工作总结（记录 + 复盘）
   ====================================================== */
function loadSummaries() { return loadJSON('gradwb_summaries') || []; }
function saveSummaries(list) { saveJSON('gradwb_summaries', list); }
let sumEditId = null;

/* --- 工作记录标签：固定 5 类 + 自定义 --- */
const FIXED_TAGS = ['读文献','查资料','做实验','写文章','干杂活'];
function loadCustomTags() { return loadJSON('gradwb_custom_tags') || []; }
function saveCustomTag(t) {
  if (!t || FIXED_TAGS.includes(t)) return;
  const list = loadCustomTags();
  if (!list.includes(t)) { list.push(t); saveJSON('gradwb_custom_tags', list); }
}
function renderCustomTagList() {
  const dl = document.getElementById('customTagList');
  if (dl) dl.innerHTML = loadCustomTags().map(x => `<option value="${esc(x)}"></option>`).join('');
}
function currentSumTag() {
  const custom = document.getElementById('sumCustomTag').value.trim();
  if (custom) return custom;
  const active = document.querySelector('#sumTagPicker .tag-chip.active');
  return active ? active.dataset.tag : '';
}
function setSumTag(tag) {
  const customInput = document.getElementById('sumCustomTag');
  document.querySelectorAll('#sumTagPicker .tag-chip').forEach(ch => ch.classList.remove('active'));
  if (!tag) { customInput.value = ''; customInput.hidden = true; return; }
  if (FIXED_TAGS.includes(tag)) {
    document.querySelector(`#sumTagPicker .tag-chip[data-tag="${tag}"]`).classList.add('active');
    customInput.value = '';
    customInput.hidden = true;
  } else {
    document.querySelector('#sumTagPicker .tag-chip[data-tag="__custom__"]').classList.add('active');
    customInput.value = tag;
    customInput.hidden = false;
  }
}
// 标签选择交互
document.querySelectorAll('#sumTagPicker .tag-chip').forEach(ch => ch.addEventListener('click', () => {
  const customInput = document.getElementById('sumCustomTag');
  if (ch.dataset.tag === '__custom__') {
    document.querySelectorAll('#sumTagPicker .tag-chip').forEach(x => x.classList.remove('active'));
    if (customInput.hidden) {
      ch.classList.add('active');
      customInput.hidden = false;
      customInput.focus();
    } else {
      customInput.hidden = true;
      customInput.value = '';
    }
  } else {
    document.querySelectorAll('#sumTagPicker .tag-chip').forEach(x => x.classList.remove('active'));
    ch.classList.add('active');
    customInput.hidden = true;
    customInput.value = '';
  }
}));
document.getElementById('sumCustomTag').addEventListener('input', () => {
  const customInput = document.getElementById('sumCustomTag');
  document.querySelectorAll('#sumTagPicker .tag-chip').forEach(x => x.classList.remove('active'));
  if (customInput.value.trim()) {
    document.querySelector('#sumTagPicker .tag-chip[data-tag="__custom__"]').classList.add('active');
  }
});
renderCustomTagList();

function renderSummary() {
  const list = loadSummaries();
  list.sort((a, b) => b.date.localeCompare(a.date) || (b.id || '').localeCompare(a.id || ''));
  // 统计
  const now = new Date();
  const weekStart = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
  const monthKey = now.getFullYear() + '-' + pad(now.getMonth()+1);
  let weekH = 0, monthH = 0;
  const daySet = new Set();
  list.forEach(s => {
    if (s.date >= weekStart) weekH += Number(s.hours) || 0;
    if (s.date.startsWith(monthKey)) monthH += Number(s.hours) || 0;
    daySet.add(s.date);
  });
  const sumWeek = document.getElementById('sumWeek');
  const sumMonth = document.getElementById('sumMonth');
  const sumDays = document.getElementById('sumDays');
  const sumStreak = document.getElementById('sumStreak');
  if (sumWeek) sumWeek.textContent = weekH;
  if (sumMonth) sumMonth.textContent = monthH;
  if (sumDays) sumDays.textContent = daySet.size;
  if (sumStreak) sumStreak.textContent = calcStreak([...daySet].sort());
  document.getElementById('sumCount').textContent = `共 ${list.length} 条`;

  const box = document.getElementById('sumList');
  box.innerHTML = list.length
    ? list.map(s => `<div class="lib-row">
        <span class="lib-status-dot" style="background:#1d6fe0"></span>
        <div class="lib-main">
          <div class="lib-title">${esc(s.content || '(无内容)')}</div>
          <div class="lib-meta">${fmtCN(s.date)} · 时长 ${s.hours}h ${s.tags ? '· ' + esc(s.tags) : ''}</div>
        </div>
        <div class="lib-actions">
          <button class="lib-act" data-sum-edit="${s.id}">编辑</button>
          <button class="lib-act" data-sum-del="${s.id}">删除</button>
        </div>
      </div>`).join('')
    : `<div class="mini-empty">还没有工作记录<br><span class="mini-hint">在上方填写后点「添加记录」</span></div>`;
  box.querySelectorAll('[data-sum-edit]').forEach(btn => btn.addEventListener('click', () => {
    const it = loadSummaries().find(x => x.id === btn.dataset.sumEdit);
    if (!it) return;
    sumEditId = it.id;
    document.getElementById('sumDate').value = it.date;
    document.getElementById('sumHours').value = it.hours || '';
    setSumTag((it.tags || '').split(/[,，]/)[0] || '');
    document.getElementById('sumContent').value = it.content || '';
    document.getElementById('sumAddBtn').textContent = '保存修改';
    document.getElementById('sumEditHint').hidden = false;
  }));
  box.querySelectorAll('[data-sum-del]').forEach(btn => btn.addEventListener('click', () => {
    saveSummaries(loadSummaries().filter(s => s.id !== btn.dataset.sumDel));
    renderSummary();
    renderBarChart('barChart', 'barTotal');
    renderHomeAggregate();
  }));
  renderBarChart('barChart2', 'barTotal2');
  renderReviews();
  renderTagDist();
  renderHeatmap();
}
/* 工作方向分布：按标签聚合次数/时长 */
function renderTagDist() {
  const list = loadSummaries();
  const tagMap = {};
  let noTag = { count: 0, hours: 0 };
  list.forEach(s => {
    const tags = (s.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
    const h = Number(s.hours) || 0;
    if (!tags.length) { noTag.count++; noTag.hours += h; return; }
    tags.forEach(t => {
      tagMap[t] = tagMap[t] || { count: 0, hours: 0 };
      tagMap[t].count++;
      tagMap[t].hours += h;
    });
  });
  const box = document.getElementById('tagDist');
  if (!box) return;
  const entries = Object.entries(tagMap).sort((a, b) => b[1].hours - a[1].hours).slice(0, 6);
  if (!entries.length && !noTag.count) {
    box.innerHTML = `<div class="mini-empty">暂无标签数据<br><span class="mini-hint">记录工作时选标签，这里会统计</span></div>`;
    return;
  }
  const maxH = Math.max(1, ...entries.map(e => e[1].hours), noTag.hours);
  box.innerHTML = entries.map(([tag, v]) => `
      <div class="tag-row">
        <span class="tag-name" title="${esc(tag)}">${esc(tag)}</span>
        <div class="tag-bar"><div class="tag-fill" style="width:${v.hours / maxH * 100}%"></div></div>
        <span class="tag-val">${v.hours}h · ${v.count}次</span>
      </div>`).join('') +
    (noTag.count ? `
      <div class="tag-row">
        <span class="tag-name">未分类</span>
        <div class="tag-bar"><div class="tag-fill" style="width:${noTag.hours / maxH * 100}%"></div></div>
        <span class="tag-val">${noTag.hours}h · ${noTag.count}次</span>
      </div>` : '');
}
/* 本月工作热力 */
function renderHeatmap() {
  const box = document.getElementById('heatmap');
  if (!box) return;
  const list = loadSummaries();
  const hoursMap = {};
  list.forEach(s => { hoursMap[s.date] = (hoursMap[s.date] || 0) + (Number(s.hours) || 0); });
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const maxH = Math.max(...Object.values(hoursMap), 1);
  let html = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(m+1)}-${pad(d)}`;
    const h = hoursMap[key] || 0;
    const level = h === 0 ? '' : (h / maxH >= 0.66 ? '3' : h / maxH >= 0.33 ? '2' : '1');
    html += `<span class="hm-cell lv${level}" title="${fmtCN(key)}${h ? '：' + h + 'h' : '：未记录'}">${d}</span>`;
  }
  box.innerHTML = html;
}
function calcStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  const set = new Set(sortedDates);
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 10000; i++) {
    if (set.has(dateKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
document.getElementById('sumAddBtn').addEventListener('click', () => {
  const date = document.getElementById('sumDate').value || todayKey();
  const hours = Number(document.getElementById('sumHours').value);
  const tags = currentSumTag();
  const content = document.getElementById('sumContent').value.trim();
  if (!content && !hours) { toast('请填写内容或时长'); return; }
  const list = loadSummaries();
  if (sumEditId) {
    const it = list.find(x => x.id === sumEditId);
    if (it) Object.assign(it, { date, hours: hours || 0, tags, content });
    sumEditId = null;
    document.getElementById('sumAddBtn').textContent = '添加记录';
    document.getElementById('sumEditHint').hidden = true;
  } else {
    list.push({ id: uid(), date, hours: hours || 0, tags, content, addedAt: new Date().toLocaleString('zh-CN') });
  }
  saveSummaries(list);
  saveCustomTag(tags);
  document.getElementById('sumHours').value = '';
  document.getElementById('sumContent').value = '';
  setSumTag('');
  renderCustomTagList();
  renderSummary();
  renderBarChart('barChart', 'barTotal');
  renderHomeAggregate();
});

/* --- 工作复盘（只记日期 + 内容） --- */
function loadReviews() { return loadJSON('gradwb_reviews') || []; }
function saveReviews(list) { saveJSON('gradwb_reviews', list); }
let revEditId = null;

function renderReviews() {
  const list = loadReviews();
  list.sort((a, b) => b.date.localeCompare(a.date) || (b.id || '').localeCompare(a.id || ''));
  const box = document.getElementById('revList');
  box.innerHTML = list.length
    ? list.map(r => `<div class="lib-row">
        <span class="lib-status-dot" style="background:#7c3aed"></span>
        <div class="lib-main">
          <div class="lib-title">${esc(r.content)}</div>
          <div class="lib-meta">${fmtCN(r.date)} · 复盘</div>
        </div>
        <div class="lib-actions">
          <button class="lib-act" data-rev-edit="${r.id}">编辑</button>
          <button class="lib-act" data-rev-del="${r.id}">删除</button>
        </div>
      </div>`).join('')
    : `<div class="mini-empty">还没有复盘<br><span class="mini-hint">记录做得好/不足/下一步改进</span></div>`;
  box.querySelectorAll('[data-rev-edit]').forEach(btn => btn.addEventListener('click', () => {
    const it = loadReviews().find(x => x.id === btn.dataset.revEdit);
    if (!it) return;
    revEditId = it.id;
    document.getElementById('revDate').value = it.date;
    document.getElementById('revContent').value = it.content;
    document.getElementById('revAddBtn').textContent = '保存修改';
    document.getElementById('revEditHint').hidden = false;
  }));
  box.querySelectorAll('[data-rev-del]').forEach(btn => btn.addEventListener('click', () => {
    saveReviews(loadReviews().filter(r => r.id !== btn.dataset.revDel));
    renderReviews();
  }));
}
document.getElementById('revAddBtn').addEventListener('click', () => {
  const date = document.getElementById('revDate').value || todayKey();
  const content = document.getElementById('revContent').value.trim();
  if (!content) { toast('请填写复盘内容'); return; }
  const list = loadReviews();
  if (revEditId) {
    const it = list.find(x => x.id === revEditId);
    if (it) Object.assign(it, { date, content });
    revEditId = null;
    document.getElementById('revAddBtn').textContent = '保存复盘';
    document.getElementById('revEditHint').hidden = true;
  } else {
    list.push({ id: uid(), date, content, addedAt: new Date().toLocaleString('zh-CN') });
  }
  saveReviews(list);
  document.getElementById('revContent').value = '';
  renderReviews();
});
/* --- 记录/复盘 tab 切换 --- */
function switchSummaryTab(tab) {
  const rec = document.getElementById('recPane');
  const rev = document.getElementById('revPane');
  const b1 = document.getElementById('tabRecord');
  const b2 = document.getElementById('tabReview');
  if (tab === 'record') {
    rec.hidden = false; rev.hidden = true;
    b1.classList.add('active'); b2.classList.remove('active');
  } else {
    rev.hidden = false; rec.hidden = true;
    b2.classList.add('active'); b1.classList.remove('active');
  }
}
document.getElementById('tabRecord').addEventListener('click', () => switchSummaryTab('record'));
document.getElementById('tabReview').addEventListener('click', () => switchSummaryTab('review'));

/* ======================================================
   工作日历
   ====================================================== */
const EV_COLORS = { '组会':'#1d6fe0', '文献阅读':'#0e9f8e', '写作':'#7c3aed', '实验/数据':'#e8a33c', '投稿截止':'#d64545', '其他':'#8b93a1' };
let calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
let calSelected = todayKey();
function loadEvents() { return loadJSON('gradwb_events') || []; }
function saveEvents(list) { saveJSON('gradwb_events', list); }
function loadJournals() { return loadJSON('gradwb_journals') || {}; }
function saveJournals(map) { saveJSON('gradwb_journals', map); }

function renderCalendar() {
  const { y, m } = calView;
  document.getElementById('calTitle').textContent = `${y}年${m+1}月`;
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7;  // 周一起
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const events = loadEvents();
  const journals = loadJournals();
  const dls = loadDls();
  const dlMap = {};
  dls.forEach(d => { if (d.date) dlMap[d.date] = true; });
  const today = todayKey();
  const grid = document.getElementById('calDays');
  let html = '';
  for (let i = 0; i < startOffset; i++) {
    const prevDate = new Date(y, m, i - startOffset + 1);
    html += `<div class="day-cell other"><span class="day-num">${prevDate.getDate()}</span></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(m+1)}-${pad(d)}`;
    const dayEvents = events.filter(e => e.date === key);
    const hasJournal = journals[key];
    const cls = ['day-cell'];
    if (key === today) cls.push('today');
    if (key === calSelected) cls.push('selected');
    html += `<div class="${cls.join(' ')}" data-date="${key}">
      <span class="day-num">${d}</span>
      <div class="day-dots">
        ${dayEvents.slice(0, 4).map(e => `<span class="dot" style="background:${e.color}" title="${esc(e.title)}"></span>`).join('')}
        ${hasJournal ? '<span class="dot day-journal-dot" title="有工作日记"></span>' : ''}
        ${dlMap[key] ? '<span class="dot day-dl-dot" title="截稿/会议"></span>' : ''}
      </div></div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.day-cell[data-date]').forEach(cell => cell.addEventListener('click', () => {
    calSelected = cell.dataset.date;
    renderCalendar();
    renderCalSide();
  }));
  renderCalSide();
  renderDlList();
}
function renderCalSide() {
  const selEl = document.getElementById('calSelDate');
  selEl.textContent = fmtCN(calSelected);
  const events = loadEvents().filter(e => e.date === calSelected);
  const evBox = document.getElementById('dayEvents');
  evBox.innerHTML = events.length
    ? events.map(e => `<div class="event-item">
        <span class="event-type" style="background:${e.color}"></span>
        <span class="event-time">${e.time || '全天'}</span>
        <span class="event-title">${esc(e.title)}</span>
        <button class="event-del" data-ev-del="${e.id}">✕</button>
      </div>`).join('')
    : `<div class="mini-empty" style="padding:12px">当天无日程</div>`;
  evBox.querySelectorAll('[data-ev-del]').forEach(btn => btn.addEventListener('click', () => {
    const list = loadEvents().filter(e => e.id !== btn.dataset.evDel);
    saveEvents(list);
    renderCalendar(); renderHomeAggregate();
  }));
  document.getElementById('dayJournal').value = (loadJournals()[calSelected]) || '';
}
document.getElementById('calPrev').addEventListener('click', () => {
  calView.m--; if (calView.m < 0) { calView.m = 11; calView.y--; }
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calView.m++; if (calView.m > 11) { calView.m = 0; calView.y++; }
  renderCalendar();
});
document.getElementById('calPrevYear').addEventListener('click', () => {
  calView.y--;
  renderCalendar();
});
document.getElementById('calNextYear').addEventListener('click', () => {
  calView.y++;
  renderCalendar();
});
document.getElementById('calToday').addEventListener('click', () => {
  calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  calSelected = todayKey();
  renderCalendar();
});
// 点击标题弹出年月选择器（原生 month 控件）
document.getElementById('calTitle').addEventListener('click', () => {
  const p = document.getElementById('calMonthPicker');
  p.value = `${calView.y}-${pad(calView.m + 1)}`;
  if (p.showPicker) p.showPicker(); else p.click();
});
document.getElementById('calMonthPicker').addEventListener('change', () => {
  const v = document.getElementById('calMonthPicker').value;
  if (!v) return;
  const [y, m] = v.split('-').map(Number);
  calView = { y, m: m - 1 };
  renderCalendar();
});
document.getElementById('evAddBtn').addEventListener('click', () => {
  const title = document.getElementById('evTitle').value.trim();
  if (!title) { toast('请输入日程标题'); return; }
  const type = document.getElementById('evType').value;
  const time = document.getElementById('evTime').value;
  const list = loadEvents();
  list.push({ id: uid(), date: calSelected, time, title, type, color: EV_COLORS[type] || '#8b93a1' });
  saveEvents(list);
  document.getElementById('evTitle').value = '';
  document.getElementById('evTime').value = '';
  renderCalendar(); renderHomeAggregate();
});
document.getElementById('journalSaveBtn').addEventListener('click', () => {
  const text = document.getElementById('dayJournal').value.trim();
  const map = loadJournals();
  if (text) map[calSelected] = text; else delete map[calSelected];
  saveJournals(map);
  renderCalendar();
  toast('日记已保存');
});
renderCalendar();

/* ======================================================
   文献雷达
   ====================================================== */
function loadRadar() {
  const d = loadJSON('gradwb_radar');
  if (!d) {
    return {
      journals: ['Journal of Development Economics', 'Journal of International Economics', 'Journal of Accounting and Economics'],
      scholars: [],
      keywords: 'international trade, globalization, FDI',
      recs: []
    };
  }
  // 容错：旧数据/部分结构缺字段时逐项兜底，避免 renderRadar 的 .map 崩溃
  return {
    journals: Array.isArray(d.journals) ? d.journals : [],
    scholars: Array.isArray(d.scholars) ? d.scholars : [],
    keywords: d.keywords || '',
    recs: Array.isArray(d.recs) ? d.recs : [],
  };
}
function saveRadar(r) { saveJSON('gradwb_radar', r); }

function renderRadar() {
  const r = loadRadar();
  const chips = document.getElementById('journalChips');
  chips.innerHTML = r.journals.map((j, i) => `<span class="chip">${esc(j)}<span class="chip-rm" data-rm="${i}">✕</span></span>`).join('')
    || `<span class="hint-text">还没有期刊，添加一个吧</span>`;
  chips.querySelectorAll('[data-rm]').forEach(el => el.addEventListener('click', () => {
    const r2 = loadRadar();
    r2.journals.splice(Number(el.dataset.rm), 1);
    saveRadar(r2);
    renderRadar();
  }));
  document.getElementById('keywordInput').value = r.keywords;
  document.getElementById('radarDate').textContent = `今天 · ${fmtCN(todayKey())} · 期刊优先，学者补漏`;
  const sc = document.getElementById('scholarChips');
  sc.innerHTML = (r.scholars || []).map((s, i) => `<span class="chip">👤 ${esc(s)}<span class="chip-rm" data-rm="${i}">✕</span></span>`).join('')
    || `<span class="hint-text">还没有关注学者，可添加导师/领域大牛</span>`;
  sc.querySelectorAll('[data-rm]').forEach(el => el.addEventListener('click', () => {
    const r2 = loadRadar();
    r2.scholars.splice(Number(el.dataset.rm), 1);
    saveRadar(r2);
    renderRadar();
  }));
  renderRecs(r);
}
let recOrder = [];
function renderRecs(r) {
  const grid = document.getElementById('recGrid');
  const recs = r.recs;
  if (!recs.length) {
    grid.innerHTML = `<div class="mini-empty" style="grid-column:1/-1">暂无推荐<br><span class="mini-hint">点「＋ 添加推荐」手动添加，之后接 AI 可自动抓取</span></div>`;
    return;
  }
  if (!recOrder.length || recOrder.length !== recs.length) {
    recOrder = recs.map((_, i) => i).sort(() => Math.random() - 0.5);
  }
  grid.innerHTML = recOrder.map(i => {
    const rec = recs[i];
    const letter = (rec.journal || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const srcBadge = rec.src === 'scholar'
      ? `<span class="rec-src scholar">👤 ${esc(rec.srcName || '学者')}</span>`
      : rec.src === 'journal' ? `<span class="rec-src">📕 ${esc(rec.srcName || rec.journal)}</span>` : '';
    return `<div class="rec-card">
      <button class="rec-del" data-rec-del="${i}" title="删除">✕</button>
      <div class="rec-journal"><span class="rec-journal-letter">${letter}</span>${esc(rec.journal || '')}${srcBadge}</div>
      <div class="rec-title">${esc(rec.title)}</div>
      <div class="rec-authors">${esc(rec.authors || '')} ${rec.year ? '· ' + esc(rec.year) : ''}${rec.cited ? ' · 💬 被引 ' + rec.cited : ''}</div>
      <div class="rec-abstract">${esc(rec.abstract || '')}</div>
      <div class="rec-actions">
        <button class="rec-btn" data-rec-lib="${i}">📚 存入文献库</button>
        <button class="rec-btn" data-rec-ana="${i}">🔬 深度分析</button>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-rec-del]').forEach(btn => btn.addEventListener('click', () => {
    const r2 = loadRadar();
    r2.recs.splice(Number(btn.dataset.recDel), 1);
    saveRadar(r2);
    recOrder = [];
    renderRadar();
  }));
  grid.querySelectorAll('[data-rec-lib]').forEach(btn => btn.addEventListener('click', () => {
    const r2 = loadRadar();
    const rec = r2.recs[Number(btn.dataset.recLib)];
    const lib = loadLibrary();
    if (lib.some(x => x.title === rec.title)) { toast('文献库中已有同名文献'); return; }
    lib.push({ id: uid(), title: rec.title, authors: rec.authors || '', journal: rec.journal || '', year: rec.year || '', doi: '', tags: [], status: '未读', abstract: rec.abstract || '', addedAt: new Date().toLocaleDateString('zh-CN') });
    saveLibrary(lib);
    toast('已存入文献库');
    renderHomeAggregate();
  }));
  grid.querySelectorAll('[data-rec-ana]').forEach(btn => btn.addEventListener('click', () => {
    const r2 = loadRadar();
    const rec = r2.recs[Number(btn.dataset.recAna)];
    document.getElementById('analysisInput').value = rec.title;
    showPage('analysis');
    document.getElementById('analysisBtn').click();
  }));
}
/* --- 关注学者添加 --- */
document.getElementById('scholarAddBtn').addEventListener('click', () => {
  const s = document.getElementById('scholarInput').value.trim();
  if (!s) return;
  const r = loadRadar();
  if (!r.scholars.includes(s)) r.scholars.push(s);
  saveRadar(r);
  document.getElementById('scholarInput').value = '';
  renderRadar();
});

/* --- 获取今日推荐：期刊优先 → 学者查漏补缺（Crossref API） --- */
function cleanAbstract(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
/* --- OpenAlex 搜索（谷歌学术的开放替代：相关性/被引排序） --- */
function reconstructAbstract(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) pos.forEach(p => { words[p] = w; });
  return words.join(' ');
}
async function openalexSearch({ journal, author, q, rows = 3 }) {
  if (q) q = q.replace(/[,，]/g, ' ').trim();  // OpenAlex 不支持逗号
  let url;
  if (journal) {
    // 两步：期刊名 -> source id -> 按 id + 关键词（filter 不支持直接按刊名搜索）
    const sRes = await fetch('https://api.openalex.org/sources?search=' + encodeURIComponent(journal) + '&per-page=1&mailto=gradwb-local@example.com');
    if (!sRes.ok) throw new Error('OpenAlex HTTP ' + sRes.status);
    const sData = await sRes.json();
    const src = sData.results && sData.results[0];
    if (!src) return [];
    const filters = ['primary_location.source.id:' + src.id.split('/').pop()];
    if (q) filters.push('title.search:' + q);
    url = 'https://api.openalex.org/works?filter=' + filters.join(',') +
      '&sort=cited_by_count:desc&per-page=' + rows + '&mailto=gradwb-local@example.com';
  } else {
    const filters = [];
    if (author) filters.push('raw_author_name.search:' + encodeURIComponent(author));
    if (q) filters.push('title.search:' + encodeURIComponent(q));
    url = 'https://api.openalex.org/works?filter=' + filters.join(',') +
      '&sort=cited_by_count:desc&per-page=' + rows + '&mailto=gradwb-local@example.com';
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('OpenAlex HTTP ' + res.status);
  const data = await res.json();
  return (data.results || []).map(w => ({
    doi: w.doi || '',
    title: w.title || '',
    authors: (w.authorships || []).map(a => a.author.display_name).join(', '),
    journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    year: w.publication_year || '',
    abstract: reconstructAbstract(w.abstract_inverted_index),
    cited: w.cited_by_count || 0,
    url: (w.primary_location && w.primary_location.landing_page_url) || ''
  }));
}
async function crossrefSearch(params) {
  const qs = new URLSearchParams({
    rows: params.rows || 5,
    select: 'DOI,title,author,container-title,issued,abstract,URL',
    sort: 'published',
    order: 'desc',
    mailto: 'gradwb-local@example.com'
  });
  if (params['query.container-title']) qs.set('query.container-title', params['query.container-title']);
  if (params['query.author']) qs.set('query.author', params['query.author']);
  if (params['query.bibliographic']) qs.set('query.bibliographic', params['query.bibliographic']);
  const res = await fetch('https://api.crossref.org/works?' + qs.toString());
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.message.items || []).map(it => ({
    doi: it.DOI || '',
    title: (it.title || [''])[0] || '',
    authors: (it.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).join(', '),
    journal: (it['container-title'] || [''])[0] || '',
    year: (it.issued && it.issued['date-parts'] && it.issued['date-parts'][0][0]) || '',
    abstract: cleanAbstract(it.abstract),
    url: it.URL || ''
  }));
}
async function fetchTodayRecs() {
  const r = loadRadar();
  const keywords = r.keywords || '';
  const grid = document.getElementById('recGrid');
  const btn = document.getElementById('radarFetchBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 搜索中…';
  const results = [];
  const seen = new Set();
  const put = it => {
    if (!it.title || seen.has(it.title)) return;
    seen.add(it.title);
    results.push(it);
  };
  try {
    // 1. 从关注期刊搜索（优先）
    grid.innerHTML = `<div class="mini-empty" style="grid-column:1/-1">🔍 正在从 ${r.journals.length} 个关注期刊搜索（按被引排序）…</div>`;
    for (const j of r.journals) {
      let items;
      try {
        items = await openalexSearch({ journal: j, q: keywords, rows: 3 });
      } catch (e) {
        items = await crossrefSearch({ 'query.container-title': j, 'query.bibliographic': keywords, rows: 3 });
      }
      items.forEach(it => put({ ...it, src: 'journal', srcName: j }));
    }
    // 2. 学者查漏补缺：他们发在其他期刊的论文
    const scholars = r.scholars || [];
    if (scholars.length) {
      grid.innerHTML = `<div class="mini-empty" style="grid-column:1/-1">👤 期刊搜完，正在查 ${scholars.length} 位关注学者发在其他期刊的论文…</div>`;
      for (const s of scholars) {
        let items;
        try {
          items = await openalexSearch({ author: s, q: keywords, rows: 5 });
        } catch (e) {
          items = await crossrefSearch({ 'query.author': s, 'query.bibliographic': keywords, rows: 5 });
        }
        items.forEach(it => {
          const jl = (it.journal || '').toLowerCase();
          if (r.journals.some(j => jl.includes(j.toLowerCase()) || j.toLowerCase().includes(jl))) return; // 已由期刊源覆盖
          put({ ...it, src: 'scholar', srcName: s });
        });
      }
    }
    if (!results.length) throw new Error('没有搜到相关结果');
    r.recs = results.slice(0, 12);
    saveRadar(r);
    recOrder = [];
    renderRadar();
  } catch (e) {
    grid.innerHTML = `<div class="mini-empty" style="grid-column:1/-1">❌ 搜索失败：${esc(e.message)}<br><span class="mini-hint">请检查网络后重试，或点「＋ 添加推荐」手动添加</span></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 获取今日推荐';
  }
}
document.getElementById('radarFetchBtn').addEventListener('click', fetchTodayRecs);

document.getElementById('journalAddBtn').addEventListener('click', () => {
  const j = document.getElementById('journalInput').value.trim();
  if (!j) return;
  const r = loadRadar();
  if (!r.journals.includes(j)) r.journals.push(j);
  saveRadar(r);
  document.getElementById('journalInput').value = '';
  renderRadar();
});
document.getElementById('keywordBtn').addEventListener('click', () => {
  const r = loadRadar();
  r.keywords = document.getElementById('keywordInput').value.trim();
  saveRadar(r);
  toast('关键词已更新');
});
document.getElementById('radarShuffle').addEventListener('click', () => {
  recOrder = [];
  renderRadar();
});
document.getElementById('radarAddRec').addEventListener('click', () => {
  document.getElementById('recJournal').value = (loadRadar().journals[0]) || '';
  openModal('recModal');
});
document.getElementById('recSaveBtn').addEventListener('click', () => {
  const journal = document.getElementById('recJournal').value.trim();
  const title = document.getElementById('recTitle').value.trim();
  if (!title) { toast('请填写标题'); return; }
  const r = loadRadar();
  r.recs.push({
    journal: journal || '未标注期刊',
    title,
    authors: document.getElementById('recAuthors').value.trim(),
    year: document.getElementById('recYear').value.trim(),
    abstract: document.getElementById('recAbstract').value.trim(),
    addedAt: new Date().toLocaleDateString('zh-CN')
  });
  saveRadar(r);
  recOrder = [];
  ['recJournal','recTitle','recAuthors','recYear','recAbstract'].forEach(id => document.getElementById(id).value = '');
  closeModal('recModal');
  renderRadar();
});
renderRadar();

/* ======================================================
   我的文献库
   ====================================================== */
let libEditId = null;
/* --- 分类（带颜色，单选大类） --- */
const CAT_COLORS = ['#1d6fe0','#0e9f8e','#7c3aed','#e8a33c','#d64545','#2b9de8','#8b5cf6','#14b8a6','#f05a8a','#5c7cfa'];
function loadCats() {
  const c = loadJSON('gradwb_cats');
  if (Array.isArray(c)) {
    // 旧预设升级：核心文献/背景文献/方法类/待读 -> 中文期刊/英文期刊/中文综述/英文综述
    const oldPreset = ['核心文献', '背景文献', '方法类', '待读'];
    if (c.length === oldPreset.length && c.every((x, i) => x === oldPreset[i])) {
      const fresh = ['中文期刊', '英文期刊', '中文综述', '英文综述'];
      saveJSON('gradwb_cats', fresh);
      return fresh;
    }
    return c;
  }
  const init = ['中文期刊', '英文期刊', '中文综述', '英文综述'];
  saveJSON('gradwb_cats', init);
  return init;
}
function saveCats(list) { saveJSON('gradwb_cats', list); }
function catColor(name) {
  const i = loadCats().indexOf(name);
  return i >= 0 ? CAT_COLORS[i % CAT_COLORS.length] : '#8b93a1';
}
function renderCatPicker(selId, value) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">未分类</option>' + loadCats().map(c => `<option>${esc(c)}</option>`).join('');
  sel.value = value || '';
}
function loadLibrary() {
  if (libCache === null) libCache = loadJSON('gradwb_library') || [];
  return libCache;
}
function saveLibrary(list) { libCache = list; saveJSON('gradwb_library', list); }
function renderLibrary() {
  let items = loadLibrary();
  const q = document.getElementById('libSearch').value.trim().toLowerCase();
  const st = document.getElementById('libStatusFilter').value;
  const tag = document.getElementById('libTagFilter').value;
  const c = document.getElementById('libCatFilter').value;
  if (q) items = items.filter(it => (it.title + it.authors + it.journal).toLowerCase().includes(q));
  if (c === '__none__') items = items.filter(it => !it.cat);
  else if (c) items = items.filter(it => it.cat === c);
  if (st) items = items.filter(it => it.status === st);
  if (tag) items = items.filter(it => (it.tags || []).includes(tag));
  document.getElementById('libCount').textContent = `共 ${items.length} 篇`;
  const box = document.getElementById('libList');
  const dotColor = { '未读':'#b9c2cf', '在读':'#1d6fe0', '已读':'#0e9f8e', '精读':'#7c3aed' };
  const shown = items.slice(0, libShow);
  box.innerHTML = items.length
    ? shown.map(it => `<div class="lib-row">
        <span class="lib-status-dot" style="background:${dotColor[it.status] || '#b9c2cf'}"></span>
        <div class="lib-main">
          <div class="lib-title">${it.cat ? `<span class="lib-cat" style="background:${catColor(it.cat)}">${esc(it.cat)}</span>` : ''}${esc(it.title)}</div>
          <div class="lib-meta">${esc(it.authors || '佚名')} · ${esc(it.journal || '')} ${it.year || ''}${it.doi ? ' · ' + esc(it.doi) : ''}</div>
          ${(it.tags || []).length ? `<div class="lib-tags">${it.tags.map(t => `<span class="lib-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="lib-actions">
          <select data-st="${it.id}">${['未读','在读','已读','精读'].map(s => `<option ${s === it.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          ${it.status === '精读' ? '<button class="lib-act" data-deep="' + it.id + '" title="精读笔记模板">📖 精读</button>' : ''}
          <button class="lib-act zotero" data-zotero="${it.id}" title="在 Zotero 中打开并搜索">📎 Zotero</button>
          <button class="lib-act" data-edit="${it.id}">编辑</button>
          <button class="lib-act" data-ana="${it.id}">分析</button>
          <button class="lib-act" data-del="${it.id}">删除</button>
        </div>
      </div>`).join('') +
      (items.length > libShow ? `<button class="lib-more" id="libMoreBtn">▼ 加载更多（还有 ${items.length - libShow} 条）</button>` : '')
    : `<div class="mini-empty">${q || st || tag ? '没有匹配的文献' : '文献库还是空的<br><span class="mini-hint">点右上角「＋ 添加文献」或从雷达存入'}</div>`;
  // 标签筛选下拉
  const allTags = [...new Set(loadLibrary().flatMap(x => x.tags || []))];
  const tagSel = document.getElementById('libTagFilter');
  const prev = tagSel.value;
  tagSel.innerHTML = '<option value="">全部标签</option>' + allTags.map(t => `<option>${esc(t)}</option>`).join('');
  tagSel.value = allTags.includes(prev) ? prev : '';
  // 分类筛选下拉
  const catSel = document.getElementById('libCatFilter');
  const prevCat = catSel.value;
  catSel.innerHTML = '<option value="">全部分类</option><option value="__none__">未分类</option>' + loadCats().map(x => `<option>${esc(x)}</option>`).join('');
  catSel.value = loadCats().includes(prevCat) ? prevCat : (prevCat === '__none__' ? '__none__' : '');
}
/* 文献列表事件委托（只绑一次，497 行也不卡） */
const libListEl = document.getElementById('libList');
libListEl.addEventListener('change', e => {
  const sel = e.target.closest('select[data-st]');
  if (!sel) return;
  const list = loadLibrary();
  const it = list.find(x => x.id === sel.dataset.st);
  if (it) { it.status = sel.value; saveLibrary(list); renderLibrary(); renderHomeAggregate(); }
});
libListEl.addEventListener('click', e => {
  const more = e.target.closest('#libMoreBtn');
  if (more) { libShow += 40; renderLibrary(); return; }
  const z = e.target.closest('[data-zotero]');
  if (z) {
    const it = loadLibrary().find(x => x.id === z.dataset.zotero);
    if (it) openZotero(it.title);
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const it = loadLibrary().find(x => x.id === ed.dataset.edit);
    if (!it) return;
    libEditId = it.id;
    document.getElementById('libTitle').value = it.title;
    document.getElementById('libAuthors').value = it.authors || '';
    document.getElementById('libJournal').value = it.journal || '';
    document.getElementById('libYear').value = it.year || '';
    document.getElementById('libDoi').value = it.doi || '';
    document.getElementById('libTags').value = (it.tags || []).join(',');
    document.getElementById('libStatus').value = it.status || '未读';
    document.getElementById('libAbstract').value = it.abstract || '';
    document.getElementById('libNotes').value = it.notes || '';
    renderCatPicker('libCat', it.cat || '');
    openModal('libModal');
    return;
  }
  const dp = e.target.closest('[data-deep]');
  if (dp) {
    openDeepNote(dp.dataset.deep);
    return;
  }
  const an = e.target.closest('[data-ana]');
  if (an) {
    const it = loadLibrary().find(x => x.id === an.dataset.ana);
    if (it) { document.getElementById('analysisInput').value = it.title; showPage('analysis'); document.getElementById('analysisBtn').click(); }
    return;
  }
  const dl = e.target.closest('[data-del]');
  if (dl) {
    saveLibrary(loadLibrary().filter(x => x.id !== dl.dataset.del));
    renderLibrary(); renderHomeAggregate();
  }
});
/* 搜索防抖 + 筛选重置分页 */
let libSearchTimer = null;
document.getElementById('libSearch').addEventListener('input', () => {
  clearTimeout(libSearchTimer);
  libSearchTimer = setTimeout(() => { libShow = 40; renderLibrary(); }, 300);
});
/* --- 导入 Zotero（BibTeX 解析） --- */
function parseBibTex(text) {
  const items = [];
  const entryRe = /@(\w+)\s*[{(]/g;
  let m;
  while ((m = entryRe.exec(text)) !== null) {
    const openChar = text[m[0].length - 1];
    const closeChar = openChar === '{' ? '}' : ')';
    let depth = 0, end = -1;
    for (let j = m.index + m[0].length - 1; j < text.length; j++) {
      if (text[j] === openChar) depth++;
      else if (text[j] === closeChar) { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    const body = text.slice(m.index + m[0].length - 1, end);
    const fields = {};
    const fRe = /([A-Za-z]+)\s*=\s*/g;
    let fm;
    while ((fm = fRe.exec(body)) !== null) {
      const name = fm[1].toLowerCase();
      const vs = fRe.lastIndex;
      let val = '', next = -1;
      if (body[vs] === '{') {
        let d = 0;
        for (let j = vs; j < body.length; j++) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') { d--; if (d === 0) { val = body.slice(vs + 1, j); next = j + 1; break; } }
        }
      } else if (body[vs] === '"') {
        const q = body.indexOf('"', vs + 1);
        if (q > 0) { val = body.slice(vs + 1, q); next = q + 1; }
      } else {
        const mm = /^([^,\n]+)/.exec(body.slice(vs));
        if (mm) { val = mm[1].trim(); next = vs + mm[1].length; }
      }
      if (name) fields[name] = val;
      if (next > 0) fRe.lastIndex = next;
    }
    const title = (fields.title || '').replace(/[{}]/g, '');
    if (title.trim()) {
      items.push({
        title: title.replace(/\s+/g, ' ').trim(),
        authors: (fields.author || fields.editor || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().replace(/\s+and\s+/gi, ', '),
        journal: (fields.journal || fields.booktitle || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim(),
        year: fields.year || '',
        doi: fields.doi || ''
      });
    }
  }
  return items;
}
function runImport(text) {
  const parsed = parseBibTex(text);
  const resEl = document.getElementById('importResult');
  if (!parsed.length) { resEl.textContent = '⚠️ 未解析到文献，请确认是 BibTeX 格式'; return; }
  const list = loadLibrary();
  const existing = new Set(list.map(x => x.title.toLowerCase()));
  let added = 0, dup = 0;
  parsed.forEach(p => {
    const k = p.title.toLowerCase();
    if (existing.has(k)) { dup++; return; }
    existing.add(k);
    list.push({ id: uid(), title: p.title, authors: p.authors, journal: p.journal, year: p.year, doi: p.doi, tags: [], status: '未读', abstract: '', addedAt: new Date().toLocaleDateString('zh-CN') });
    added++;
  });
  saveLibrary(list);
  resEl.textContent = `✅ 新增 ${added} 篇，跳过重复 ${dup} 篇`;
  renderLibrary(); renderHomeAggregate();
}
document.getElementById('libImportBtn').addEventListener('click', () => {
  document.getElementById('importResult').textContent = '';
  openModal('importModal');
});
document.getElementById('importPickBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('importText').value = reader.result; runImport(reader.result); };
  reader.readAsText(f);
});
document.getElementById('importRunBtn').addEventListener('click', () => {
  const t = document.getElementById('importText').value.trim();
  if (!t) { toast('请选择 .bib 文件或粘贴内容'); return; }
  runImport(t);
});

/* --- 在 Zotero 中打开并搜索（二次确认） --- */
function openZotero(title) {
  const short = title.length > 60 ? title.slice(0, 60) + '…' : title;
  myConfirm(`将打开 Zotero 并搜索：\n「${esc(short)}」\n\n请确认 Zotero 桌面端已启动。`, async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch('http://localhost:23119/', { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        window.open('http://localhost:23119/search?q=' + encodeURIComponent(title));
      } else {
        toast('Zotero 本地服务未响应（HTTP ' + res.status + '），请确认 Zotero 已打开');
      }
    } catch (e) {
      toast('无法连接 Zotero（' + e.message + '）\n请先启动 Zotero 桌面端再试。');
    }
  });
}

document.getElementById('libAddBtn').addEventListener('click', () => {
  libEditId = null;
  ['libTitle','libAuthors','libJournal','libYear','libDoi','libTags','libAbstract'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('libStatus').value = '未读';
  renderCatPicker('libCat', '');
  openModal('libModal');
});
document.getElementById('libSaveBtn').addEventListener('click', () => {
  const title = document.getElementById('libTitle').value.trim();
  if (!title) { toast('请填写标题'); return; }
  const list = loadLibrary();
  const data = {
    title,
    authors: document.getElementById('libAuthors').value.trim(),
    journal: document.getElementById('libJournal').value.trim(),
    year: document.getElementById('libYear').value.trim(),
    doi: document.getElementById('libDoi').value.trim(),
    cat: document.getElementById('libCat').value || '',
    tags: document.getElementById('libTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    status: document.getElementById('libStatus').value,
    abstract: document.getElementById('libAbstract').value.trim()
  };
  if (libEditId) {
    const it = list.find(x => x.id === libEditId);
    Object.assign(it, data);
  } else {
    list.push({ id: uid(), ...data, addedAt: new Date().toLocaleDateString('zh-CN') });
  }
  saveLibrary(list);
  closeModal('libModal');
  renderLibrary(); renderHomeAggregate();
});
/* 清空文献库 */
document.getElementById('libClearBtn').addEventListener('click', () => {
  const n = loadLibrary().length;
  if (!n) { toast('文献库本来就是空的'); return; }
  myConfirm(`确定清空文献库全部 ${n} 篇文献？\n此操作不可恢复。`, () => {
    saveLibrary([]);
    libShow = 40;
    renderLibrary();
    renderHomeAggregate();
  });
});
/* 分类管理 */
document.getElementById('libCatMgrBtn').addEventListener('click', () => {
  renderCatList();
  openModal('catModal');
});
function renderCatList() {
  const box = document.getElementById('catList');
  const cats = loadCats();
  box.innerHTML = cats.length
    ? cats.map((c, i) => `<div class="cat-item">
        <span class="cat-dot" style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></span>
        <span>${esc(c)}</span>
        <span class="hint-text">${loadLibrary().filter(x => x.cat === c).length} 篇</span>
        <button class="cat-rm" data-cat-rm="${esc(c)}">✕</button>
      </div>`).join('')
    : `<div class="mini-empty">还没有分类<br><span class="mini-hint">下方输入名称添加</span></div>`;
  box.querySelectorAll('[data-cat-rm]').forEach(btn => btn.addEventListener('click', () => {
    myConfirm(`删除分类「${btn.dataset.catRm}」？文献不会删除，只是变为未分类。`, () => {
      saveCats(loadCats().filter(x => x !== btn.dataset.catRm));
      saveLibrary(loadLibrary().map(it => it.cat === btn.dataset.catRm ? { ...it, cat: '' } : it));
      renderCatList();
      renderLibrary();
    });
  }));
}
document.getElementById('catAddBtn').addEventListener('click', () => {
  const name = document.getElementById('catInput').value.trim();
  if (!name) return;
  const cats = loadCats();
  if (cats.includes(name)) { toast('分类已存在'); return; }
  cats.push(name);
  saveCats(cats);
  document.getElementById('catInput').value = '';
  renderCatList();
});
document.getElementById('catInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('catAddBtn').click();
});
document.getElementById('libStatusFilter').addEventListener('change', () => { libShow = 40; renderLibrary(); });
document.getElementById('libTagFilter').addEventListener('change', () => { libShow = 40; renderLibrary(); });
document.getElementById('libCatFilter').addEventListener('change', () => { libShow = 40; renderLibrary(); });
document.getElementById('libExportBtn').addEventListener('click', () => {
  const items = loadLibrary();
  if (!items.length) { toast('文献库为空'); return; }
  const bib = items.map(it => {
    const key = (it.authors || 'unknown').split(/[,，\s]+/)[0] + (it.year || '');
    return `@article{${key},\n  title   = {${it.title}},\n  author  = {${it.authors || 'unknown'}},\n  journal = {${it.journal || ''}},\n  year    = {${it.year || 'n.d.'}},\n  doi     = {${it.doi || ''}}\n}`;
  }).join('\n\n');
  const blob = new Blob([bib], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-literature.bib';
  a.click();
  URL.revokeObjectURL(a.href);
});
renderLibrary();

/* ======================================================
   文献分析（AI）
   ====================================================== */
const ANALYSIS_PROMPT = `你是一位严谨的经济学/管理学领域研究助理。请对下面给出的论文进行结构化分析，**用简体中文**输出，严格按照以下小标题（每节内容 2-4 句，基于输入信息；信息不足处合理推断并标注「推测」）：

## 研究问题
## 研究动机
## 方法与数据
## 核心结论
## 创新点
## 局限与改进

论文信息：\n`;

function loadAnalyses() { return loadJSON('gradwb_analyses') || []; }
function saveAnalyses(list) { saveJSON('gradwb_analyses', list); }

function renderAnalysisPage() {
  const warn = document.getElementById('analysisWarn');
  if (warn) warn.hidden = bridgeOnline;
  renderAnalysisHistory();
}
function renderAnalysisHistory() {
  const list = loadAnalyses();
  const box = document.getElementById('analysisHistory');
  box.innerHTML = list.length
    ? list.map((a, i) => `<div class="his-item ${i === 0 ? 'active' : ''}" data-his="${a.id}">
        <span class="his-del" data-his-del="${a.id}">✕</span>
        <div>${esc(a.input.slice(0, 30))}${a.input.length > 30 ? '…' : ''}</div>
        <div class="his-time">${a.time}</div>
      </div>`).join('')
    : `<div class="mini-empty">暂无分析历史</div>`;
  box.querySelectorAll('[data-his]').forEach(item => item.addEventListener('click', () => {
    const a = list.find(x => x.id === item.dataset.his);
    if (a) { renderResult(a.result); box.querySelectorAll('.his-item').forEach(h => h.classList.remove('active')); item.classList.add('active'); }
  }));
  box.querySelectorAll('[data-his-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    saveAnalyses(loadAnalyses().filter(x => x.id !== btn.dataset.hisDel));
    renderAnalysisHistory();
  }));
}
function renderResult(text) {
  const box = document.getElementById('analysisResult');
  if (!text) { box.innerHTML = '<div class="mini-empty">分析结果将显示在这里</div>'; return; }
  const sections = text.split(/^##\s+/m).map(s => s.trim()).filter(Boolean);
  if (sections.length >= 2) {
    box.innerHTML = sections.map(s => {
      const nl = s.indexOf('\n');
      const title = nl > 0 ? s.slice(0, nl).trim() : s;
      const body = nl > 0 ? s.slice(nl + 1).trim() : '';
      return `<div class="res-section"><div class="res-h">${esc(title)}</div><div class="res-p">${esc(body)}</div></div>`;
    }).join('');
  } else {
    box.innerHTML = `<div class="res-p">${mdToHtml(text)}</div>`;
  }
}
/* 文献分析：支持上传本地文献文件（桥存 data/uploads/，agent 读原文分析） */
let analysisFileUploaded = null;
document.getElementById('analysisFileBtn').addEventListener('click', () => document.getElementById('analysisFile').click());
document.getElementById('analysisFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (!bridgeOnline) { toast('桥服务未开启：请先点击桌面「开启工作台桥」图标'); e.target.value = ''; return; }
  const chip = document.getElementById('analysisFileName');
  chip.hidden = false;
  chip.textContent = '⏳ 上传 ' + f.name + '…';
  try {
    const dataUrl = await new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(rd.result);
      rd.onerror = () => rej(new Error('读取文件失败'));
      rd.readAsDataURL(f);
    });
    const r = await fetch(BRIDGE + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.name, data: dataUrl }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    analysisFileUploaded = { name: d.name, path: d.path };
    chip.textContent = '📄 ' + d.name;
  } catch (err) {
    chip.textContent = '';
    chip.hidden = true;
    toast('上传失败：' + err.message);
  }
  e.target.value = '';
});

document.getElementById('analysisBtn').addEventListener('click', async () => {
  const input = document.getElementById('analysisInput').value.trim();
  if (!input && !analysisFileUploaded) { toast('请先上传文献文件，或输入分析要求'); return; }
  const loading = document.getElementById('analysisLoading');
  const btn = document.getElementById('analysisBtn');
  loading.hidden = false;
  btn.disabled = true;
  try {
    if (!bridgeOnline) throw new Error('桥服务未开启：请先点击桌面「开启工作台桥」图标');
    const r = await fetch(BRIDGE + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input || '请帮我分析这篇文献', scene: 'analysis', file: analysisFileUploaded ? analysisFileUploaded.path : null }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    const text = d.reply;
    if (!text) throw new Error('Agent 没有返回结果，请重试');
    const list = loadAnalyses();
    list.unshift({ id: uid(), input, result: text, time: new Date().toLocaleString('zh-CN'), api: 'Hermes Agent' });
    saveAnalyses(list);
    renderResult(text);
    renderAnalysisHistory();
  } catch (e) {
    toast('分析失败：' + e.message);
  } finally {
    loading.hidden = true;
    btn.disabled = false;
  }
});

/* ======================================================
   投稿管理
   ====================================================== */
function loadSubs() { return loadJSON('gradwb_submissions') || []; }
function saveSubs(list) { saveJSON('gradwb_submissions', list); }
const SUB_STATUSES = ['拟投','在投','审稿中','返修','已录用','已拒稿','已撤稿'];

function renderSubmission() {
  const list = loadSubs();
  const active = list.filter(s => !['已录用','已拒稿','已撤稿'].includes(s.status)).length;
  const review = list.filter(s => s.status === '审稿中' || s.status === '返修').length;
  const accept = list.filter(s => s.status === '已录用').length;
  const reject = list.filter(s => s.status === '已拒稿').length;
  document.getElementById('subStatActive').textContent = active;
  document.getElementById('subStatReview').textContent = review;
  document.getElementById('subStatAccept').textContent = accept;
  document.getElementById('subStatReject').textContent = reject;
  document.getElementById('subCount').textContent = `共 ${list.length} 个投稿`;
  const box = document.getElementById('subList');
  box.innerHTML = list.length
    ? list.map(s => {
      const lastUpd = (s.stage && s.stage.length ? s.stage[s.stage.length - 1].time : null) || s.createdAt || '';
      let idleDays = -1;
      try {
        const t = Date.parse(String(lastUpd).replace(/[年月]/g, '/').replace(/日/g, ''));
        if (!isNaN(t)) idleDays = Math.floor((Date.now() - t) / 86400000);
      } catch (e) {}
      const idleWarn = idleDays >= 0 && !['已录用', '已拒稿', '已撤稿'].includes(s.status) && idleDays >= 30;
      return `<div class="sub-card ${idleWarn ? 'sub-idle' : ''}">
        <div class="sub-head">
          <div class="lib-title">${esc(s.title)}</div>
          <span class="status-badge status-${s.status}">${s.status}</span>
        </div>
        <div class="sub-meta">
          <span>📮 ${esc(s.journal)}</span>
          ${s.if ? `<span>IF: ${esc(s.if)}</span>` : ''}
          ${s.zone ? `<span>${esc(s.zone)}</span>` : ''}
          <span>🕒 创建于 ${s.createdAt || ''}</span>
          ${idleDays >= 0 ? `<span class="${idleWarn ? 'idle-warn' : ''}">⏳ 上次更新 ${idleDays} 天前${idleWarn ? '（建议跟进）' : ''}</span>` : ''}
          ${s.url ? `<a class="sub-link" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.url)}">🔗 打开投稿链接</a>` : ''}
        </div>
        <div class="sub-actions">
          ${SUB_STATUSES.filter(st => st !== s.status && !(st === '已撤稿' && ['已录用','已拒稿'].includes(s.status))).map(st =>
            `<button class="sub-action-btn ${['已录用','已拒稿','已撤稿'].includes(st) ? 'end' : ''}" data-sub-st="${s.id}" data-st="${st}">→ ${st}</button>`).join('')}
          <button class="sub-action-btn" data-sub-edit="${s.id}">✏️ 编辑</button>
          <button class="sub-action-btn end" data-sub-del="${s.id}">删除</button>
        </div>
        <div class="sub-timeline" id="tl-${s.id}" ${s.stage && s.stage.length ? '' : 'style="display:none"'}>
          ${(s.stage || []).slice().reverse().map(t => `<div class="tl-item"><span class="tl-time">${t.time}</span>${t.status}${t.note ? ' — ' + esc(t.note) : ''}</div>`).join('')}
        </div>
      </div>`;
    })
    : `<div class="mini-empty">还没有投稿记录<br><span class="mini-hint">点右上角「＋ 新增投稿」开始跟踪</span></div>`;
  box.querySelectorAll('[data-sub-st]').forEach(btn => btn.addEventListener('click', () => {
    const list2 = loadSubs();
    const s = list2.find(x => x.id === btn.dataset.subSt);
    const newStatus = btn.dataset.st;
    s.status = newStatus;
    s.stage = s.stage || [];
    s.stage.push({ time: new Date().toLocaleString('zh-CN'), status: newStatus, note: '' });
    saveSubs(list2);
    renderSubmission(); renderHomeAggregate();
  }));
  box.querySelectorAll('[data-sub-edit]').forEach(btn => btn.addEventListener('click', () => {
    const s = loadSubs().find(x => x.id === btn.dataset.subEdit);
    if (!s) return;
    subEditId = s.id;
    document.getElementById('subModalTitle').textContent = '✉️ 编辑投稿';
    document.getElementById('subTitle').value = s.title || '';
    document.getElementById('subJournal').value = s.journal || '';
    document.getElementById('subStatus').value = s.status || '拟投';
    document.getElementById('subIF').value = s.if || '';
    document.getElementById('subZone').value = s.zone || '';
    document.getElementById('subUrl').value = s.url || '';
    document.getElementById('subNote').value = s.note || '';
    openModal('subModal');
  }));
  box.querySelectorAll('[data-sub-del]').forEach(btn => btn.addEventListener('click', () => {
    myConfirm('确定删除该投稿记录？', () => {
      saveSubs(loadSubs().filter(x => x.id !== btn.dataset.subDel));
      renderSubmission(); renderHomeAggregate();
    });
  }));
}
let subEditId = null;
document.getElementById('subAddBtn').addEventListener('click', () => {
  subEditId = null;
  document.getElementById('subModalTitle').textContent = '✉️ 新增投稿';
  ['subTitle','subJournal','subIF','subZone','subUrl','subNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('subStatus').value = '拟投';
  openModal('subModal');
});
document.getElementById('subSaveBtn').addEventListener('click', () => {
  const title = document.getElementById('subTitle').value.trim();
  const journal = document.getElementById('subJournal').value.trim();
  if (!title || !journal) { toast('请填写标题和目标期刊'); return; }
  const status = document.getElementById('subStatus').value;
  const note = document.getElementById('subNote').value.trim();
  const url = document.getElementById('subUrl').value.trim();
  const data = {
    title, journal, status,
    if: document.getElementById('subIF').value.trim(),
    zone: document.getElementById('subZone').value.trim(),
    url,
    note
  };
  const list = loadSubs();
  if (subEditId) {
    const s = list.find(x => x.id === subEditId);
    if (s) Object.assign(s, data);
    subEditId = null;
  } else {
    list.push({ id: uid(), ...data, createdAt: new Date().toLocaleDateString('zh-CN'), stage: [{ time: new Date().toLocaleString('zh-CN'), status, note }] });
  }
  saveSubs(list);
  closeModal('subModal');
  renderSubmission(); renderHomeAggregate();
});
renderSubmission();

/* ======================================================
   文章管理（固定 4 资料库：小论文/大论文/综述/项目 + 文件管理）
   ====================================================== */
// IndexedDB：存文件内容（Blob），localStorage 只存元数据
const IDB = (() => {
  let db = null;
  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open('gradwb_files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  return {
    put(id, blob) { return open().then(d => new Promise((res, rej) => { const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); })); },
    get(id) { return open().then(d => new Promise((res, rej) => { const rq = d.transaction('files').objectStore('files').get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); })); },
    del(id) { return open().then(d => new Promise((res, rej) => { const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); })); }
  };
})();

const ART_CATS = [
  { name: '小论文', icon: '📄' },
  { name: '大论文', icon: '📖' },
  { name: '综述',   icon: '🔍' },
  { name: '项目',   icon: '📁' }
];
let curCat = '小论文';
let curPartId = null;
let partEditId = null;
let artBlobUrls = [];

function loadArticles() {
  const d = loadJSON('gradwb_articles');
  if (d && d['小论文'] && Array.isArray(d['小论文'].parts) && d['小论文'].parts.every(p => Array.isArray(p.files))) return d;
  // 首次使用：4 个固定资料库，各部分由用户在每个类型下独立添加
  const init = {};
  ART_CATS.forEach(c => {
    init[c.name] = { parts: [] };
  });
  saveJSON('gradwb_articles', init);
  return init;
}
function saveArticles() { saveJSON('gradwb_articles', loadArticles()); }
function touchArticle() { saveJSON('gradwb_articles', loadArticles()); }
function artFileCount(cat) { return (cat.parts || []).reduce((s, p) => s + (p.files || []).length, 0); }
function artFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','jpeg','gif','webp','bmp','svg','heic'].includes(ext)) return '🖼️';
  if (['doc','docx','pdf','txt','md','tex','ppt','pptx','xls','xlsx'].includes(ext)) return '📄';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  return '📦';
}
function fmtSize(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function releaseBlobUrls() { artBlobUrls.forEach(u => URL.revokeObjectURL(u)); artBlobUrls = []; }

function renderArticles() {
  const all = loadArticles();
  // 高亮当前分类 tab + 显示各分类文件数
  document.querySelectorAll('#artCatTabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === curCat);
    const cnt = artFileCount(all[btn.dataset.cat] || { parts: [] });
    btn.textContent = `${(ART_CATS.find(c => c.name === btn.dataset.cat) || {}).icon || ''} ${btn.dataset.cat}${cnt ? ` (${cnt})` : ''}`;
  });
  renderCatWork();
}
function renderCatWork() {
  const all = loadArticles();
  const cat = all[curCat] || { parts: [] };
  const tree = document.getElementById('artTree');
  tree.innerHTML = (cat.parts.length
    ? `<div class="art-part-tip">🖱️ 左键选中 · 右键改名 · 拖动排序</div>` + cat.parts.map(p => `
    <div class="art-part-row ${p.id === curPartId ? 'active' : ''}" draggable="true" data-part="${p.id}">
      <span class="art-part-name" title="${esc(p.name)}">${esc(p.name)}</span>
      <span class="hint-text" data-cnt="${p.id}">${(p.files || []).length}</span>
      <button class="art-mini" data-part-del="${p.id}" title="删除部分">✕</button>
    </div>`).join('')
    : `<div class="mini-empty">这个类型还没有部分<br><span class="mini-hint">点下方「＋ 添加部分」创建</span></div>`) +
    `<button class="art-add-ch" id="artAddPart">＋ 添加部分</button>`;

  // 左键：选中部分（只重渲染文件区，不重建树）
  tree.querySelectorAll('[data-part]').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('[data-part-del]')) return;
    curPartId = row.dataset.part;
    updatePartActive();
    renderArtFiles();
  }));
  // 右键：改名（弹 modal，左键不会误触编辑）
  tree.querySelectorAll('[data-part]').forEach(row => row.addEventListener('contextmenu', e => {
    e.preventDefault();
    const all2 = loadArticles();
    const p = (all2[curCat].parts || []).find(x => x.id === row.dataset.part);
    partEditId = row.dataset.part;
    document.getElementById('partModalTitle').textContent = '✏️ 重命名部分';
    document.getElementById('partNameInput').value = p ? p.name : '';
    openModal('partModal');
    document.getElementById('partNameInput').focus();
  }));
  // 删除部分
  tree.querySelectorAll('[data-part-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    myConfirm('删除该部分？其中的文件也会一并删除。', async () => {
      const all2 = loadArticles();
      const p = (all2[curCat].parts || []).find(x => x.id === btn.dataset.partDel);
      if (p) for (const f of (p.files || [])) { try { await IDB.del(f.id); } catch (e) {} }
      all2[curCat].parts = all2[curCat].parts.filter(x => x.id !== btn.dataset.partDel);
      saveJSON('gradwb_articles', all2);
      if (curPartId === btn.dataset.partDel) curPartId = null;
      renderArticles();
    });
  }));
  // 拖拽排序
  let dragId = null;
  tree.querySelectorAll('[data-part]').forEach(row => {
    row.addEventListener('dragstart', () => { dragId = row.dataset.part; row.classList.add('dragging'); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      tree.querySelectorAll('.art-part-row').forEach(r => r.classList.remove('drag-over'));
      if (row.dataset.part !== dragId) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      tree.querySelectorAll('.art-part-row').forEach(r => r.classList.remove('drag-over'));
      if (!dragId || dragId === row.dataset.part) return;
      const all2 = loadArticles();
      const parts = all2[curCat].parts;
      const from = parts.findIndex(x => x.id === dragId);
      const to = parts.findIndex(x => x.id === row.dataset.part);
      if (from < 0 || to < 0) return;
      const [moved] = parts.splice(from, 1);
      parts.splice(to, 0, moved);
      saveJSON('gradwb_articles', all2);
      dragId = null;
      renderCatWork();
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      tree.querySelectorAll('.art-part-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
    });
  });
  // 添加部分
  document.getElementById('artAddPart').addEventListener('click', () => {
    partEditId = null;
    document.getElementById('partModalTitle').textContent = '＋ 添加部分';
    document.getElementById('partNameInput').value = '';
    openModal('partModal');
    document.getElementById('partNameInput').focus();
  });
  renderArtFiles();
}
function updatePartActive() {
  document.querySelectorAll('#artTree [data-part]').forEach(r => r.classList.toggle('active', r.dataset.part === curPartId));
}
function updateTreeCounts() {
  const all = loadArticles();
  const cat = all[curCat] || { parts: [] };
  document.querySelectorAll('#artTree [data-cnt]').forEach(el => {
    const p = cat.parts.find(x => x.id === el.dataset.cnt);
    el.textContent = p ? (p.files || []).length : 0;
  });
}
/* --- 文件列表 --- */
function renderArtFiles() {
  const all = loadArticles();
  const cat = all[curCat] || { parts: [] };
  const head = document.getElementById('artEditorHead');
  const pane = document.getElementById('artFilesPane');
  const part = curPartId ? cat.parts.find(p => p.id === curPartId) : null;
  if (!part) {
    head.textContent = '👆 选中左侧一个「部分」来管理文件';
    pane.hidden = true;
    return;
  }
  head.textContent = `🗂️ ${esc(part.name)} · ${part.files.length} 个文件（同部分多个文件 = 多版本）`;
  pane.hidden = false;
  const box = document.getElementById('fileList');
  box.innerHTML = part.files.length
    ? part.files.map((f, i) => `<div class="file-item">
        <span class="file-ver">v${i + 1}</span>
        <span class="file-icon">${artFileIcon(f.name)}</span>
        <div class="file-info">
          <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="file-meta">${fmtSize(f.size)} · ${f.uploadedAt}</div>
        </div>
        <div class="file-actions">
          ${f.type && f.type.startsWith('image/') ? '<button class="file-act" data-f-preview="' + f.id + '">查看</button>' : ''}
          <button class="file-act" data-f-dl="${f.id}">下载</button>
          <button class="file-act danger" data-f-del="${f.id}">删除</button>
        </div>
      </div>`).join('')
    : `<div class="mini-empty">这个部分还没有文件<br><span class="mini-hint">拖文件进来或点「📤 上传文件」</span></div>`;
  box.querySelectorAll('[data-f-dl]').forEach(btn => btn.addEventListener('click', () => downloadFile(btn.dataset.fDl)));
  box.querySelectorAll('[data-f-preview]').forEach(btn => btn.addEventListener('click', () => previewFile(btn.dataset.fPreview)));
  box.querySelectorAll('[data-f-del]').forEach(btn => btn.addEventListener('click', () => {
    myConfirm('删除该文件？', async () => {
      const all2 = loadArticles();
      const p2 = (all2[curCat].parts || []).find(x => x.id === curPartId);
      if (p2) {
        const f = p2.files.find(x => x.id === btn.dataset.fDel);
        if (f) { try { await IDB.del(f.id); } catch (e) {} }
        p2.files = p2.files.filter(x => x.id !== btn.dataset.fDel);
        saveJSON('gradwb_articles', all2);
      }
      updateTreeCounts();
      renderArtFiles();
    });
  }));
}
async function getFileMeta(id) {
  const all = loadArticles();
  const cat = all[curCat] || { parts: [] };
  for (const p of cat.parts) {
    const f = (p.files || []).find(x => x.id === id);
    if (f) return f;
  }
  return null;
}
async function downloadFile(id) {
  const meta = await getFileMeta(id);
  const blob = await IDB.get(id);
  if (!meta || !blob) { toast('文件不存在或已损坏'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = meta.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function previewFile(id) {
  const meta = await getFileMeta(id);
  const blob = await IDB.get(id);
  if (!meta || !blob) { toast('文件不存在或已损坏'); return; }
  releaseBlobUrls();  // 释放上一次预览占用的内存，避免累积卡死
  const url = URL.createObjectURL(blob);
  artBlobUrls.push(url);
  document.getElementById('imgModalTitle').textContent = meta.name;
  document.getElementById('imgModalBody').src = url;
  openModal('imgModal');
}
/* --- 上传 --- */
async function uploadFiles(fileList) {
  const all = loadArticles();
  const cat = all[curCat];
  if (!cat) { toast('请先选择资料库'); return; }
  if (!curPartId) { toast('请先在左侧选中一个「部分」再上传'); return; }
  const part = cat.parts.find(p => p.id === curPartId);
  if (!part) return;
  for (const file of fileList) {
    const fid = uid();
    try {
      await IDB.put(fid, file);
    } catch (e) {
      toast(`「${file.name}」保存失败（文件可能过大）：${e.message}`);
      continue;
    }
    part.files = part.files || [];
    part.files.push({ id: fid, name: file.name, size: file.size, type: file.type || '', uploadedAt: new Date().toLocaleString('zh-CN') });
  }
  if (fileList.length) { saveJSON('gradwb_articles', all); updateTreeCounts(); renderArtFiles(); }
}
document.getElementById('artUploadBtn').addEventListener('click', () => {
  if (!curPartId) { toast('请先在左侧选中一个「部分」再上传'); return; }
  document.getElementById('artFileInput').click();
});
document.getElementById('artFileInput').addEventListener('change', e => {
  uploadFiles([...e.target.files]);
  e.target.value = '';
});
/* 拖拽上传 */
const fileDrop = document.getElementById('fileDrop');
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
});
/* 分类切换 */
document.querySelectorAll('#artCatTabs .tab-btn').forEach(btn => btn.addEventListener('click', () => {
  curCat = btn.dataset.cat;
  curPartId = null;
  renderArticles();
}));
renderArticles();

/* ======================================================
   英语学习（多词库：六级核心 / 光计算…  + 发音 + AI 生成）
   ====================================================== */
/* 六级核心（预置 60 个高频学术词） */
const KAOYAN_BANK = [
  { word: 'Abandon', ipa: '', cn: '放弃', ex: '' },
  { word: 'Abstract', ipa: '', cn: '摘要；抽象的', ex: '' },
  { word: 'Accommodate', ipa: '', cn: '容纳；适应', ex: '' },
  { word: 'Acknowledge', ipa: '', cn: '承认', ex: '' },
  { word: 'Acquire', ipa: '', cn: '获得', ex: '' },
  { word: 'Adequate', ipa: '', cn: '足够的', ex: '' },
  { word: 'Advocate', ipa: '', cn: '提倡', ex: '' },
  { word: 'Assess', ipa: '', cn: '评估', ex: '' },
  { word: 'Assume', ipa: '', cn: '假定', ex: '' },
  { word: 'Attain', ipa: '', cn: '达到', ex: '' },
  { word: 'Attribute', ipa: '', cn: '归因于', ex: '' },
  { word: 'Capacity', ipa: '', cn: '能力；容量', ex: '' },
  { word: 'Category', ipa: '', cn: '类别', ex: '' },
  { word: 'Circumstance', ipa: '', cn: '环境', ex: '' },
  { word: 'Cite', ipa: '', cn: '引用', ex: '' },
  { word: 'Commence', ipa: '', cn: '开始', ex: '' },
  { word: 'Compensate', ipa: '', cn: '补偿', ex: '' },
  { word: 'Confine', ipa: '', cn: '限制', ex: '' },
  { word: 'Consensus', ipa: '', cn: '共识', ex: '' },
  { word: 'Considerable', ipa: '', cn: '相当大的', ex: '' },
  { word: 'Consistent', ipa: '', cn: '一致的', ex: '' },
  { word: 'Constitute', ipa: '', cn: '构成', ex: '' },
  { word: 'Consume', ipa: '', cn: '消耗', ex: '' },
  { word: 'Controversial', ipa: '', cn: '有争议的', ex: '' },
  { word: 'Convey', ipa: '', cn: '传达', ex: '' },
  { word: 'Crucial', ipa: '', cn: '关键的', ex: '' },
  { word: 'Demonstrate', ipa: '', cn: '证明', ex: '' },
  { word: 'Deprive', ipa: '', cn: '剥夺', ex: '' },
  { word: 'Descend', ipa: '', cn: '下降', ex: '' },
  { word: 'Diminish', ipa: '', cn: '减少', ex: '' },
  { word: 'Discriminate', ipa: '', cn: '歧视', ex: '' },
  { word: 'Distinguish', ipa: '', cn: '区分', ex: '' },
  { word: 'Diverse', ipa: '', cn: '多样的', ex: '' },
  { word: 'Dominate', ipa: '', cn: '主导', ex: '' },
  { word: 'Eliminate', ipa: '', cn: '消除', ex: '' },
  { word: 'Emerge', ipa: '', cn: '出现', ex: '' },
  { word: 'Emphasis', ipa: '', cn: '强调', ex: '' },
  { word: 'Enhance', ipa: '', cn: '提高', ex: '' },
  { word: 'Ensure', ipa: '', cn: '确保', ex: '' },
  { word: 'Evaluate', ipa: '', cn: '评估', ex: '' },
  { word: 'Exceed', ipa: '', cn: '超过', ex: '' },
  { word: 'Explicit', ipa: '', cn: '明确的', ex: '' },
  { word: 'Exploit', ipa: '', cn: '利用', ex: '' },
  { word: 'Facilitate', ipa: '', cn: '促进', ex: '' },
  { word: 'Feasible', ipa: '', cn: '可行的', ex: '' },
  { word: 'Fluctuate', ipa: '', cn: '波动', ex: '' },
  { word: 'Fundamental', ipa: '', cn: '基本的', ex: '' },
  { word: 'Generate', ipa: '', cn: '产生', ex: '' },
  { word: 'Genuine', ipa: '', cn: '真正的', ex: '' },
  { word: 'Grasp', ipa: '', cn: '掌握', ex: '' },
  { word: 'Hypothesis', ipa: '', cn: '假说', ex: '' },
  { word: 'Identical', ipa: '', cn: '相同的', ex: '' },
  { word: 'Identify', ipa: '', cn: '识别', ex: '' },
  { word: 'Implement', ipa: '', cn: '实施', ex: '' },
  { word: 'Imply', ipa: '', cn: '暗示', ex: '' },
  { word: 'Incentive', ipa: '', cn: '激励', ex: '' },
  { word: 'Inevitable', ipa: '', cn: '不可避免的', ex: '' },
  { word: 'Insight', ipa: '', cn: '洞察力', ex: '' },
  { word: 'Integrate', ipa: '', cn: '整合', ex: '' },
  { word: 'Justify', ipa: '', cn: '证明…合理', ex: '' },
  { word: 'Legitimate', ipa: '', cn: '合法的', ex: '' },
  { word: 'Manipulate', ipa: '', cn: '操纵', ex: '' },
  { word: 'Migrate', ipa: '', cn: '迁移', ex: '' },
  { word: 'Notion', ipa: '', cn: '观念', ex: '' },
  { word: 'Objective', ipa: '', cn: '目标', ex: '' },
  { word: 'Obstacle', ipa: '', cn: '障碍', ex: '' },
  { word: 'Offset', ipa: '', cn: '抵消', ex: '' },
  { word: 'Perceive', ipa: '', cn: '感知', ex: '' },
  { word: 'Persistent', ipa: '', cn: '坚持不懈的', ex: '' },
  { word: 'Precise', ipa: '', cn: '精确的', ex: '' },
  { word: 'Preliminary', ipa: '', cn: '初步的', ex: '' },
  { word: 'Presume', ipa: '', cn: '假定', ex: '' },
  { word: 'Prevail', ipa: '', cn: '盛行', ex: '' },
  { word: 'Priority', ipa: '', cn: '优先', ex: '' },
  { word: 'Prominent', ipa: '', cn: '突出的', ex: '' },
  { word: 'Prompt', ipa: '', cn: '促使', ex: '' },
  { word: 'Propose', ipa: '', cn: '提议', ex: '' },
  { word: 'Pursue', ipa: '', cn: '追求', ex: '' },
  { word: 'Reconcile', ipa: '', cn: '调和', ex: '' },
  { word: 'Resolve', ipa: '', cn: '解决', ex: '' },
  { word: 'Retain', ipa: '', cn: '保留', ex: '' },
  { word: 'Reveal', ipa: '', cn: '揭示', ex: '' },
  { word: 'Reverse', ipa: '', cn: '逆转', ex: '' },
  { word: 'Rigorous', ipa: '', cn: '严谨的', ex: '' },
  { word: 'Scrutiny', ipa: '', cn: '仔细审查', ex: '' },
  { word: 'Severe', ipa: '', cn: '严重的', ex: '' },
  { word: 'Shift', ipa: '', cn: '转变', ex: '' },
  { word: 'Simulate', ipa: '', cn: '模拟', ex: '' },
  { word: 'Skeptical', ipa: '', cn: '怀疑的', ex: '' },
  { word: 'Soar', ipa: '', cn: '飙升', ex: '' },
  { word: 'Speculate', ipa: '', cn: '推测', ex: '' },
  { word: 'Stability', ipa: '', cn: '稳定', ex: '' },
  { word: 'Straightforward', ipa: '', cn: '直截了当的', ex: '' },
  { word: 'Substantial', ipa: '', cn: '大量的', ex: '' },
  { word: 'Subtle', ipa: '', cn: '微妙的', ex: '' },
  { word: 'Successive', ipa: '', cn: '连续的', ex: '' },
  { word: 'Sustain', ipa: '', cn: '维持', ex: '' },
  { word: 'Tackle', ipa: '', cn: '处理', ex: '' },
  { word: 'Temporary', ipa: '', cn: '临时的', ex: '' },
  { word: 'Terminate', ipa: '', cn: '终止', ex: '' },
  { word: 'Transform', ipa: '', cn: '转变', ex: '' },
  { word: 'Transmit', ipa: '', cn: '传输', ex: '' },
  { word: 'Tremendous', ipa: '', cn: '巨大的', ex: '' },
  { word: 'Trigger', ipa: '', cn: '触发', ex: '' },
  { word: 'Ultimate', ipa: '', cn: '最终的', ex: '' },
  { word: 'Undergo', ipa: '', cn: '经历', ex: '' },
  { word: 'Undermine', ipa: '', cn: '破坏', ex: '' },
  { word: 'Undertake', ipa: '', cn: '承担', ex: '' },
  { word: 'Verify', ipa: '', cn: '证实', ex: '' },
  { word: 'Viable', ipa: '', cn: '可行的', ex: '' },
  { word: 'Vulnerable', ipa: '', cn: '脆弱的', ex: '' },
  { word: 'Yield', ipa: '', cn: '屈服', ex: '' },
];

const IELTS_BANK = [
  { word: 'Accommodation', ipa: '', cn: '住宿', ex: '' },
  { word: 'Achievement', ipa: '', cn: '成就', ex: '' },
  { word: 'Adaptation', ipa: '', cn: '适应', ex: '' },
  { word: 'Agriculture', ipa: '', cn: '农业', ex: '' },
  { word: 'Architecture', ipa: '', cn: '建筑', ex: '' },
  { word: 'Atmosphere', ipa: '', cn: '大气', ex: '' },
  { word: 'Biodiversity', ipa: '', cn: '生物多样性', ex: '' },
  { word: 'Carbon', ipa: '', cn: '碳', ex: '' },
  { word: 'Chemical', ipa: '', cn: '化学的', ex: '' },
  { word: 'Climate', ipa: '', cn: '气候', ex: '' },
  { word: 'Conservation', ipa: '', cn: '保护', ex: '' },
  { word: 'Consumption', ipa: '', cn: '消费', ex: '' },
  { word: 'Cultivation', ipa: '', cn: '耕作', ex: '' },
  { word: 'Decade', ipa: '', cn: '十年', ex: '' },
  { word: 'Deforestation', ipa: '', cn: '森林砍伐', ex: '' },
  { word: 'Density', ipa: '', cn: '密度', ex: '' },
  { word: 'Destination', ipa: '', cn: '目的地', ex: '' },
  { word: 'Disposal', ipa: '', cn: '处理', ex: '' },
  { word: 'Distribution', ipa: '', cn: '分布', ex: '' },
  { word: 'Drought', ipa: '', cn: '干旱', ex: '' },
  { word: 'Ecosystem', ipa: '', cn: '生态系统', ex: '' },
  { word: 'Emission', ipa: '', cn: '排放', ex: '' },
  { word: 'Environment', ipa: '', cn: '环境', ex: '' },
  { word: 'Erosion', ipa: '', cn: '侵蚀', ex: '' },
  { word: 'Expedition', ipa: '', cn: '探险', ex: '' },
  { word: 'Extinction', ipa: '', cn: '灭绝', ex: '' },
  { word: 'Fertility', ipa: '', cn: '肥沃', ex: '' },
  { word: 'Fossil', ipa: '', cn: '化石', ex: '' },
  { word: 'Fuel', ipa: '', cn: '燃料', ex: '' },
  { word: 'Geology', ipa: '', cn: '地质', ex: '' },
  { word: 'Habitat', ipa: '', cn: '栖息地', ex: '' },
  { word: 'Humidity', ipa: '', cn: '湿度', ex: '' },
  { word: 'Infrastructure', ipa: '', cn: '基础设施', ex: '' },
  { word: 'Innovation', ipa: '', cn: '创新', ex: '' },
  { word: 'Irrigation', ipa: '', cn: '灌溉', ex: '' },
  { word: 'Landscape', ipa: '', cn: '景观', ex: '' },
  { word: 'Latitude', ipa: '', cn: '纬度', ex: '' },
  { word: 'Migration', ipa: '', cn: '迁徙', ex: '' },
  { word: 'Mineral', ipa: '', cn: '矿物', ex: '' },
  { word: 'Moisture', ipa: '', cn: '水分', ex: '' },
  { word: 'Nutrition', ipa: '', cn: '营养', ex: '' },
  { word: 'Organism', ipa: '', cn: '生物体', ex: '' },
  { word: 'Oxygen', ipa: '', cn: '氧气', ex: '' },
  { word: 'Pollution', ipa: '', cn: '污染', ex: '' },
  { word: 'Population', ipa: '', cn: '人口', ex: '' },
  { word: 'Precipitation', ipa: '', cn: '降水', ex: '' },
  { word: 'Preservation', ipa: '', cn: '保护', ex: '' },
  { word: 'Radiation', ipa: '', cn: '辐射', ex: '' },
  { word: 'Recycling', ipa: '', cn: '回收', ex: '' },
  { word: 'Renewable', ipa: '', cn: '可再生的', ex: '' },
  { word: 'Reservoir', ipa: '', cn: '水库', ex: '' },
  { word: 'Resource', ipa: '', cn: '资源', ex: '' },
  { word: 'Sediment', ipa: '', cn: '沉积物', ex: '' },
  { word: 'Solar', ipa: '', cn: '太阳的', ex: '' },
  { word: 'Sustainable', ipa: '', cn: '可持续的', ex: '' },
  { word: 'Temperature', ipa: '', cn: '温度', ex: '' },
  { word: 'Tropical', ipa: '', cn: '热带的', ex: '' },
  { word: 'Urban', ipa: '', cn: '城市的', ex: '' },
  { word: 'Vegetation', ipa: '', cn: '植被', ex: '' },
  { word: 'Wildlife', ipa: '', cn: '野生动物', ex: '' },
];
const CET6_BANK = [
  { word: 'Analyze', ipa: '/ˈænəlaɪz/', cn: '分析', ex: 'We analyze the data to test the hypothesis.' },
  { word: 'Assumption', ipa: '/əˈsʌmpʃn/', cn: '假设', ex: 'The model rests on a strong assumption.' },
  { word: 'Hypothesis', ipa: '/haɪˈpɒθəsɪs/', cn: '假说', ex: 'The hypothesis was confirmed by experiments.' },
  { word: 'Empirical', ipa: '/ɪmˈpɪrɪkl/', cn: '实证的，经验的', ex: 'Empirical results support the theory.' },
  { word: 'Criterion', ipa: '/kraɪˈtɪəriən/', cn: '标准', ex: 'Cost is the key criterion for selection.' },
  { word: 'Significant', ipa: '/sɪɡˈnɪfɪkənt/', cn: '显著的', ex: 'The difference is statistically significant.' },
  { word: 'Framework', ipa: '/ˈfreɪmwɜːk/', cn: '框架', ex: 'A unified framework covers all cases.' },
  { word: 'Implication', ipa: '/ˌɪmplɪˈkeɪʃn/', cn: '含义，影响', ex: 'The findings have policy implications.' },
  { word: 'Mechanism', ipa: '/ˈmekənɪzəm/', cn: '机制', ex: 'The mechanism behind the effect remains unclear.' },
  { word: 'Phenomenon', ipa: '/fəˈnɒmɪnən/', cn: '现象', ex: 'This phenomenon is widely observed.' },
  { word: 'Component', ipa: '/kəmˈpəʊnənt/', cn: '组成部分', ex: 'Each component must be tested separately.' },
  { word: 'Comprehensive', ipa: '/ˌkɒmprɪˈhensɪv/', cn: '全面的', ex: 'A comprehensive review covers the literature.' },
  { word: 'Constraint', ipa: '/kənˈstreɪnt/', cn: '约束条件', ex: 'The design faces tight constraints.' },
  { word: 'Derive', ipa: '/dɪˈraɪv/', cn: '推导出', ex: 'We derive the equation from first principles.' },
  { word: 'Estimate', ipa: '/ˈestɪmeɪt/', cn: '估计', ex: 'The estimate is precise within 1%.' },
  { word: 'Explicit', ipa: '/ɪkˈsplɪsɪt/', cn: '明确的', ex: 'The rules are explicit and easy to follow.' },
  { word: 'Implicit', ipa: '/ɪmˈplɪsɪt/', cn: '隐含的', ex: 'The assumption is implicit in the derivation.' },
  { word: 'Infer', ipa: '/ɪnˈfɜː/', cn: '推断', ex: 'We can infer the cause from the data.' },
  { word: 'Innovation', ipa: '/ˌɪnəˈveɪʃn/', cn: '创新', ex: 'Innovation drives long-term growth.' },
  { word: 'Integral', ipa: '/ˈɪntɪɡrəl/', cn: '不可或缺的', ex: 'Training is an integral part of the job.' },
  { word: 'Intensity', ipa: '/ɪnˈtensəti/', cn: '强度', ex: 'The light intensity was measured precisely.' },
  { word: 'Interpret', ipa: '/ɪnˈtɜːprɪt/', cn: '解释，解读', ex: 'Interpret the results with caution.' },
  { word: 'Intrinsic', ipa: '/ɪnˈtrɪnsɪk/', cn: '固有的', ex: 'The material has intrinsic losses.' },
  { word: 'Magnitude', ipa: '/ˈmæɡnɪtjuːd/', cn: '大小，量级', ex: 'The magnitude of the error is small.' },
  { word: 'Plausible', ipa: '/ˈplɔːzəbl/', cn: '似乎合理的', ex: 'The explanation sounds plausible.' },
  { word: 'Preliminary', ipa: '/prɪˈlɪmɪnəri/', cn: '初步的', ex: 'Preliminary results look promising.' },
  { word: 'Principle', ipa: '/ˈprɪnsəpl/', cn: '原理', ex: 'The device works on a simple principle.' },
  { word: 'Proportional', ipa: '/prəˈpɔːʃənl/', cn: '成比例的', ex: 'Output is proportional to input.' },
  { word: 'Quantify', ipa: '/ˈkwɒntɪfaɪ/', cn: '量化', ex: 'It is hard to quantify the benefit.' },
  { word: 'Random', ipa: '/ˈrændəm/', cn: '随机的', ex: 'The sample was chosen at random.' },
  { word: 'Ratio', ipa: '/ˈreɪʃiəʊ/', cn: '比率', ex: 'The signal-to-noise ratio is high.' },
  { word: 'Reject', ipa: '/rɪˈdʒekt/', cn: '拒绝，驳回', ex: 'The editor rejected the paper.' },
  { word: 'Relevant', ipa: '/ˈreləvənt/', cn: '相关的', ex: 'Only relevant data were included.' },
  { word: 'Residual', ipa: '/rɪˈzɪdjuəl/', cn: '剩余的', ex: 'The residual noise was negligible.' },
  { word: 'Rigorous', ipa: '/ˈrɪɡərəs/', cn: '严谨的', ex: 'A rigorous proof requires no shortcuts.' },
  { word: 'Robust', ipa: '/rəʊˈbʌst/', cn: '稳健的', ex: 'The result is robust to parameter changes.' },
  { word: 'Sample', ipa: '/ˈsɑːmpl/', cn: '样本', ex: 'The sample size is large enough.' },
  { word: 'Scenario', ipa: '/səˈnɑːriəʊ/', cn: '情景', ex: 'We tested the worst-case scenario.' },
  { word: 'Scheme', ipa: '/skiːm/', cn: '方案', ex: 'The proposed scheme reduces crosstalk.' },
  { word: 'Scope', ipa: '/skəʊp/', cn: '范围', ex: 'The scope of the study is limited.' },
  { word: 'Sequence', ipa: '/ˈsiːkwəns/', cn: '序列', ex: 'The sequence of operations matters.' },
  { word: 'Simulate', ipa: '/ˈsɪmjuleɪt/', cn: '模拟', ex: 'We simulate the device in software.' },
  { word: 'Specific', ipa: '/spəˈsɪfɪk/', cn: '特定的', ex: 'The effect is specific to this wavelength.' },
  { word: 'Specify', ipa: '/ˈspesɪfaɪ/', cn: '明确规定', ex: 'Specify the input parameters clearly.' },
  { word: 'Stimulate', ipa: '/ˈstɪmjuleɪt/', cn: '刺激，促进', ex: 'The results stimulate further research.' },
  { word: 'Strategy', ipa: '/ˈstrætədʒi/', cn: '策略', ex: 'A better strategy avoids the local optimum.' },
  { word: 'Subsequent', ipa: '/ˈsʌbsɪkwənt/', cn: '随后的', ex: 'Subsequent experiments confirmed the finding.' },
  { word: 'Substitute', ipa: '/ˈsʌbstɪtjuːt/', cn: '替代物', ex: 'Silicon is a substitute for other materials.' },
  { word: 'Supplement', ipa: '/ˈsʌplɪment/', cn: '补充', ex: 'The appendix supplements the main text.' },
  { word: 'Technique', ipa: '/tekˈniːk/', cn: '技术，方法', ex: 'This technique enables high precision.' },
  { word: 'Tendency', ipa: '/ˈtendənsi/', cn: '趋势', ex: 'There is a tendency toward miniaturization.' },
  { word: 'Threshold', ipa: '/ˈθreʃhəʊld/', cn: '阈值', ex: 'Above the threshold, the device switches.' },
  { word: 'Transition', ipa: '/trænˈzɪʃn/', cn: '转变，跃迁', ex: 'The phase transition occurs at high temperature.' },
  { word: 'Underlying', ipa: '/ˌʌndəˈlaɪɪŋ/', cn: '根本的，潜在的', ex: 'The underlying physics is well understood.' },
  { word: 'Valid', ipa: '/ˈvælɪd/', cn: '有效的', ex: 'The measurement is valid only in this range.' },
  { word: 'Vary', ipa: '/ˈveəri/', cn: '变化', ex: 'The loss varies with wavelength.' },
  { word: 'Accommodate', ipa: '/əˈkɒmədeɪt/', cn: '容纳，适应', ex: 'The chip accommodates 1000 modulators.' },
  { word: 'Ambiguous', ipa: '/æmˈbɪɡjuəs/', cn: '模棱两可的', ex: 'The output is ambiguous without calibration.' },
  { word: 'Coherent', ipa: '/kəʊˈhɪərənt/', cn: '相干的', ex: 'A coherent light source is required.' },
  { word: 'Enhance', ipa: '/ɪnˈhɑːns/', cn: '增强，提高', ex: 'Feedback enhances the modulation speed.' }
];
const DEFAULT_PHRASES = [
  { en: 'ceteris paribus', cn: '其他条件不变' },
  { en: 'ex ante / ex post', cn: '事前 / 事后' },
  { en: 'inter alia', cn: '尤其，除其他外' },
  { en: 'mutatis mutandis', cn: '在细节上作适当修改后' },
  { en: 'prima facie evidence', cn: '初步证据' },
  { en: 'de facto / de jure', cn: '事实上的 / 法律上的' },
  { en: 'per se', cn: '就其本身而言' },
  { en: 'vis-à-vis', cn: '与…相比；相对于' },
  { en: 'status quo', cn: '现状' },
  { en: 'ad hoc', cn: '专门的，临时的' },
  { en: 'ex post facto', cn: '事后的' },
  { en: 'in situ', cn: '在原位，就地' },
  { en: 'a priori', cn: '先验地，演绎地' },
  { en: 'ipso facto', cn: '因此，事实如此' }
];
/* --- 词库数据 --- */
function loadWordBooks() {
  const b = loadJSON('gradwb_wordbooks');
  const ALL = { '六级核心': CET6_BANK, '考研核心': KAOYAN_BANK, '雅思核心': IELTS_BANK, '光计算': [] };
  if (b && typeof b === 'object') {
    let changed = false;
    for (const k of Object.keys(ALL)) {
      if (!Array.isArray(b[k])) { b[k] = ALL[k]; changed = true; }
    }
    if (changed) saveJSON('gradwb_wordbooks', b);
    return b;
  }
  saveJSON('gradwb_wordbooks', ALL);
  return { ...ALL };
}
function saveWordBooks(b) { saveJSON('gradwb_wordbooks', b); }
function curBookName() { return localStorage.getItem('gradwb_wordbook_cur') || '六级核心'; }
function setCurBook(n) { localStorage.setItem('gradwb_wordbook_cur', n); }
function loadWbProgress() { return loadJSON('gradwb_wb_progress') || {}; }
function saveWbProgress(p) { saveJSON('gradwb_wb_progress', p); }
function loadEnglish() {
  const e = loadJSON('gradwb_english');
  if (!e) return { streak: 0, lastDate: '', records: [], words: [], date: '', phrases: DEFAULT_PHRASES };
  // 旧数据兼容：缺失 phrases 时补齐，防止渲染崩溃
  if (!Array.isArray(e.phrases)) e.phrases = DEFAULT_PHRASES;
  if (!Array.isArray(e.records)) e.records = [];
  if (!Array.isArray(e.words)) e.words = [];
  return e;
}
function saveEnglish(e) { saveJSON('gradwb_english', e); }
/* --- 例句翻译：检测词库里有例句但没翻译的，批量调用桥 /translate 补齐 --- */
let exCnBusy = false;
function ensureExCn() {
  if (exCnBusy || !bridgeOnline) return;
  try {
    const bookName = curBookName();
    const books = loadWordBooks();
    const list = books[bookName] || [];
    const need = [];
    list.forEach((w, i) => { if (w && w.ex && !w.ex_cn) need.push(i); });
    if (!need.length || need.length > 60) return;
    exCnBusy = true;
    const sentences = need.map(i => list[i].ex);
    fetch(BRIDGE + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences: sentences }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d || !d.cn) return;
        const b2 = loadWordBooks();
        let changed = false;
        Object.keys(d.cn).forEach(k => {
          const idx = Number(k);
          const w = (b2[bookName] || [])[idx];
          if (w && w.ex && !w.ex_cn && d.cn[k]) { w.ex_cn = String(d.cn[k]); changed = true; }
        });
        if (changed) { saveWordBooks(b2); renderEnglish(); }
      })
      .catch(() => {})
      .finally(() => { exCnBusy = false; });
  } catch (e) { exCnBusy = false; }
}
/* --- 发音（浏览器 TTS） --- */
let engVoices = [];
function loadEngVoices() { try { engVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { engVoices = []; } }
if ('speechSynthesis' in window) { loadEngVoices(); window.speechSynthesis.onvoiceschanged = loadEngVoices; }
function speakWord(text) {
  if (!('speechSynthesis' in window)) { toast('当前浏览器不支持发音'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.85;
  const v = engVoices.find(v => v.lang.startsWith('en-GB')) || engVoices.find(v => v.lang.startsWith('en-US')) || engVoices.find(v => v.lang.startsWith('en'));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}
/* --- 渲染 --- */
function renderEnglish() {
  const eng = loadEnglish();
  ensureExCn();
  const checked = eng.lastDate === todayKey();
  document.getElementById('engStreak').textContent = eng.streak;
  document.getElementById('engCheckBtn').textContent = checked ? '✅ 今日已打卡' : '✅ 今日打卡';
  document.getElementById('engCheckBtn').disabled = checked;
  renderBookChips();
  renderWords(eng);
  const phraseBox = document.getElementById('phraseList');
  phraseBox.innerHTML = eng.phrases.map((p, i) => `<div class="phrase-item">
      <span class="ph-en">${esc(p.en)}</span><span class="ph-cn">${esc(p.cn)}</span>
      <span class="phrase-del" data-ph-del="${i}">✕</span></div>`).join('')
    || '<div class="mini-empty">暂无短语</div>';
  phraseBox.querySelectorAll('[data-ph-del]').forEach(btn => btn.addEventListener('click', () => {
    const e2 = loadEnglish();
    e2.phrases.splice(Number(btn.dataset.phDel), 1);
    saveEnglish(e2);
    renderEnglish();
  }));
}
function renderBookChips() {
  const box = document.getElementById('bookChips');
  const books = loadWordBooks();
  const cur = curBookName();
  const prog = loadWbProgress();
  const totalWords = Object.values(books).reduce((s, v) => s + (v || []).length, 0);
  const hint = document.getElementById('bookHint');
  if (hint) hint.textContent = fullBooksLoaded ? `（完整词库已加载，共 ${totalWords} 词）` : '';
  box.innerHTML = Object.keys(books).map(b => {
    const total = books[b].length;
    const done = (prog[b] || []).length;
    return `<button class="tab-btn ${b === cur ? 'active' : ''}" data-book="${esc(b)}">${esc(b)}${total ? ` (${done}/${total})` : ''}</button>`;
  }).join('') || '<span class="hint-text">暂无词库</span>';
  box.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => {
    setCurBook(btn.dataset.book);
    renderEnglish();
  }));
}
function renderWords(eng) {
  const grid = document.getElementById('wordGrid');
  const today = eng.date === todayKey() ? eng.words : [];
  const doneCount = today.filter(w => w.learned).length;
  const book = loadWordBooks()[curBookName()] || [];
  const prog = (loadWbProgress()[curBookName()] || []);
  // 例句翻译：今日快照可能没拷 ex_cn，按 word 从词库补查
  const bankMap = {};
  book.forEach(w => { bankMap[String(w.word || '').toLowerCase()] = w; });
  document.getElementById('engProgress').textContent = today.length
    ? `${doneCount}/${today.length} 已掌握 · 词库进度 ${prog.length}/${book.length}`
    : `词库 ${curBookName()} 共 ${book.length} 词，已掌握 ${prog.length}`;
  if (!today.length) {
    grid.innerHTML = `<div class="mini-empty" style="grid-column:1/-1">今天还没有单词<br><span class="mini-hint">点「🎲 生成今日单词」从「${esc(curBookName())}」抽取 8 个</span></div>`;
    return;
  }
  grid.innerHTML = today.map((w, i) => {
    const bw = bankMap[String(w.word || '').toLowerCase()];
    const exCn = w.ex_cn || (bw && bw.ex_cn) || '';
    return `<div class="word-card ${w.learned ? 'done' : ''}">
      <div class="word-main">${esc(w.word)} <button class="word-sound" data-sound="${i}" title="发音">🔊</button></div>
      <div class="word-ipa">${esc(w.ipa)}</div>
      <div class="word-cn">${esc(w.cn)}</div>
      ${w.ex ? `<div class="word-ex">${esc(w.ex)}</div>${exCn ? `<div class="word-ex-cn">${esc(exCn)}</div>` : ''}` : ''}
      <button class="word-btn ${w.learned ? 'done' : ''}" data-word="${i}">${w.learned ? '✅ 已掌握' : '标记已掌握'}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-word]').forEach(btn => btn.addEventListener('click', () => {
    const e2 = loadEnglish();
    const w = e2.words[Number(btn.dataset.word)];
    w.learned = !w.learned;
    const bookName = curBookName();
    const prog2 = loadWbProgress();
    prog2[bookName] = prog2[bookName] || [];
    if (w.learned) { if (!prog2[bookName].includes(w.word)) prog2[bookName].push(w.word); }
    else { prog2[bookName] = prog2[bookName].filter(x => x !== w.word); }
    saveWbProgress(prog2);
    saveEnglish(e2);
    renderEnglish();
  }));
  grid.querySelectorAll('[data-sound]').forEach(btn => btn.addEventListener('click', () => {
    const w = today[Number(btn.dataset.sound)];
    if (w) speakWord(w.word);
  }));
}
document.getElementById('engGenBtn').addEventListener('click', () => {
  const eng = loadEnglish();
  const bookName = curBookName();
  const bank = loadWordBooks()[bookName] || [];
  if (!bank.length) { toast(`词库「${bookName}」还是空的，先添加单词或生成词库`); return; }
  const prog = loadWbProgress()[bookName] || [];
  const todo = bank.filter(w => !prog.includes(w.word));
  const pool = todo.length >= 8 ? todo : bank;
  eng.words = [...pool].sort(() => Math.random() - 0.5).slice(0, 8).map(w => ({ ...w, learned: prog.includes(w.word) }));
  eng.date = todayKey();
  saveEnglish(eng);
  renderEnglish();
  genExamplesFor(eng.words, bookName);
});
/* --- 生成今日单词后：异步为缺例句的词生成例句+中文翻译（写回词库，下次抽到直接有） --- */
let genExBusy = false;
function genExamplesFor(words, bookName) {
  if (genExBusy || !bridgeOnline) return;
  const need = [];
  words.forEach((w, i) => { if (w && !w.ex) need.push({ i: i, w: w.word, cn: w.cn }); });
  if (!need.length) return;
  genExBusy = true;
  toast('正在生成例句和翻译…');
  fetch(BRIDGE + '/gen_examples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words: need }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.ex) { toast('例句生成失败，请稍后重试'); return; }
      const eng2 = loadEnglish();
      const b2 = loadWordBooks();
      const list = b2[bookName] || [];
      let changed = false;
      need.forEach(n => {
        const item = d.ex[n.i];
        if (!item || !item.ex) return;
        const wd = eng2.words[n.i];
        if (wd && !wd.ex) { wd.ex = item.ex; wd.ex_cn = item.ex_cn || ''; changed = true; }
        const bw = list.find(x => String(x.word || '').toLowerCase() === String(n.w).toLowerCase());
        if (bw && !bw.ex) { bw.ex = item.ex; bw.ex_cn = item.ex_cn || ''; }
      });
      if (changed) { saveEnglish(eng2); saveWordBooks(b2); renderEnglish(); toast('例句已生成 ✓'); }
    })
    .catch(() => { toast('例句生成失败（桥或 API 不可用）'); })
    .finally(() => { genExBusy = false; });
}
/* --- 复习模式：从已掌握词中抽查 --- */
let reviewList = [], reviewIdx = 0, reviewRevealed = false;
function renderReviewCard() {
  const w = reviewList[reviewIdx];
  if (!w) { document.getElementById('reviewModal').classList.remove('open'); return; }
  document.getElementById('reviewWord').textContent = w.word;
  document.getElementById('reviewIpa').textContent = w.ipa || '';
  const cn = document.getElementById('reviewCn');
  cn.textContent = reviewRevealed ? w.cn : '';
  cn.style.visibility = reviewRevealed ? 'visible' : 'hidden';
  const ex = document.getElementById('reviewEx');
  ex.textContent = reviewRevealed && w.ex ? w.ex : '';
  document.getElementById('reviewPos').textContent = `${reviewIdx + 1} / ${reviewList.length}`;
  document.getElementById('reviewRevealBtn').style.display = reviewRevealed ? 'none' : '';
  document.getElementById('reviewOkBtn').style.display = reviewRevealed ? '' : 'none';
  document.getElementById('reviewAgainBtn').style.display = reviewRevealed ? '' : 'none';
}
document.getElementById('engRevBtn').addEventListener('click', () => {
  const bookName = curBookName();
  const prog = loadWbProgress()[bookName] || [];
  const bank = loadWordBooks()[bookName] || [];
  if (!prog.length) { toast(`「${bookName}」还没有已掌握的单词，先学习再复习`); return; }
  const known = bank.filter(w => prog.includes(w.word));
  reviewList = [...known].sort(() => Math.random() - 0.5).slice(0, 10);
  reviewIdx = 0;
  reviewRevealed = false;
  renderReviewCard();
  openModal('reviewModal');
});
document.getElementById('reviewRevealBtn').addEventListener('click', () => { reviewRevealed = true; renderReviewCard(); });
document.getElementById('reviewOkBtn').addEventListener('click', () => {
  reviewIdx++;
  reviewRevealed = false;
  if (reviewIdx >= reviewList.length) {
    document.getElementById('reviewModal').classList.remove('open');
    toast('🎉 本轮复习完成！');
  } else renderReviewCard();
});
document.getElementById('reviewAgainBtn').addEventListener('click', () => {
  const bookName = curBookName();
  const prog = loadWbProgress();
  prog[bookName] = (prog[bookName] || []).filter(x => x !== reviewList[reviewIdx].word);
  saveWbProgress(prog);
  reviewList.splice(reviewIdx, 1);
  if (!reviewList.length) {
    document.getElementById('reviewModal').classList.remove('open');
    toast('已掌握的单词都复习完了，重新开始学习吧');
    renderEnglish();
    return;
  }
  if (reviewIdx >= reviewList.length) reviewIdx = reviewList.length - 1;
  reviewRevealed = false;
  renderReviewCard();
  renderEnglish();
});
document.getElementById('agentImportBtn').addEventListener('click', importAgentResults);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('reviewModal').classList.contains('open')) {
    if (reviewRevealed) document.getElementById('reviewOkBtn').click();
    else document.getElementById('reviewRevealBtn').click();
  }
});
document.getElementById('engCheckBtn').addEventListener('click', () => {
  const eng = loadEnglish();
  const today = todayKey();
  if (eng.lastDate === today) return;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  eng.streak = (eng.lastDate === dateKey(yest)) ? eng.streak + 1 : 1;
  eng.lastDate = today;
  eng.records = eng.records || [];
  eng.records.push({ date: today, day: eng.streak });
  saveEnglish(eng);
  renderEnglish();
  renderHomeAggregate();
  toast(`🎉 打卡成功！已连续打卡 ${eng.streak} 天`);
});
/* --- 手动添加单词 --- */
document.getElementById('bookAddBtn').addEventListener('click', () => {
  ['wWord', 'wIpa', 'wCn', 'wEx'].forEach(id => document.getElementById(id).value = '');
  openModal('wordModal');
  document.getElementById('wWord').focus();
});
document.getElementById('wSaveBtn').addEventListener('click', () => {
  const word = document.getElementById('wWord').value.trim();
  const cn = document.getElementById('wCn').value.trim();
  if (!word || !cn) { toast('请填写单词和中文释义'); return; }
  const books = loadWordBooks();
  const bookName = curBookName();
  books[bookName] = books[bookName] || [];
  if (books[bookName].some(w => w.word.toLowerCase() === word.toLowerCase())) { toast('该词已存在'); return; }
  books[bookName].push({
    word,
    ipa: document.getElementById('wIpa').value.trim(),
    cn,
    ex: document.getElementById('wEx').value.trim()
  });
  saveWordBooks(books);
  closeModal('wordModal');
  renderEnglish();
});
document.getElementById('wWord').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('wSaveBtn').click(); });
/* --- AI 生成光计算词汇库（从文献库提取） --- */
document.getElementById('bookGenBtn').addEventListener('click', async () => {
  const lib = loadLibrary();
  if (!lib.length) { toast('文献库还是空的，先导入文献再生成'); return; }
  const apis = loadAPIs().filter(a => a.key);
  if (!apis.length) { toast('请先在「API 管理」配置 Key'); return; }
  const btn = document.getElementById('bookGenBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 正在逐篇阅读文献提取词汇…';
  try {
    const texts = lib.slice(0, 40).map(it => (it.title || '') + (it.abstract ? '. ' + it.abstract : '')).join(' ');
    const prompt = `你是光计算与集成光子学领域的学术词汇专家。请从下面的文献标题和摘要中提取专业词汇，整理成一份【光计算词汇库】。要求：
1. 只提取领域专业术语（如微环谐振器、马赫-曾德尔干涉仪、相变材料、硅光波导、可编程光子芯片、储备池计算、铌酸锂调制器等对应的英文术语），以及该领域高频学术表达
2. 去掉常见通用词（研究、方法、数据、结果这类基础词汇不要）
3. 每个词输出：英文、IPA 音标、中文释义、一句英文例句
4. 输出严格的 JSON 数组，格式：[{"word":"Micro-ring Resonator","ipa":"/ˈmaɪkrəʊ rɪŋ ˈrezəneɪtə/","cn":"微环谐振器","ex":"The micro-ring resonator enables compact filtering."}]
5. 最多输出 40 个词，只输出 JSON，不要其他文字

文献内容：
${texts.slice(0, 6000)}`;
    const api = apis[0];
    const text = await callAI(api, [
      { role: 'system', content: '你输出任何内容都必须严格符合要求的 JSON 格式。' },
      { role: 'user', content: prompt }
    ]);
    let jsonText = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const m = jsonText.match(/\[[\s\S]*\]/);
    if (m) jsonText = m[0];
    const arr = JSON.parse(jsonText);
    if (!Array.isArray(arr) || !arr.length) throw new Error('AI 返回格式不对');
    const books = loadWordBooks();
    const existing = books['光计算'] || [];
    const seen = new Set(existing.map(w => w.word.toLowerCase()));
    let added = 0;
    arr.forEach(w => {
      if (!w.word || seen.has(w.word.toLowerCase())) return;
      seen.add(w.word.toLowerCase());
      existing.push({ word: w.word, ipa: w.ipa || '', cn: w.cn || '', ex: w.ex || '' });
      added++;
    });
    books['光计算'] = existing;
    saveWordBooks(books);
    setCurBook('光计算');
    renderEnglish();
    toast(`✅ 光计算词汇库已生成：新增 ${added} 个词（词库共 ${existing.length} 词）`);
  } catch (e) {
    toast('生成失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 生成光计算词库';
  }
});
document.getElementById('phraseAddBtn').addEventListener('click', () => {
  const raw = document.getElementById('phraseInput').value.trim();
  if (!raw) return;
  const m = raw.match(/^(.*?)\s*(?:→|->)\s*(.*)$/);
  if (!m) { toast('格式：短语 → 释义'); return; }
  const en = m[1].trim(), cn = m[2].trim();
  const eng = loadEnglish();
  eng.phrases.push({ en, cn });
  saveEnglish(eng);
  document.getElementById('phraseInput').value = '';
  renderEnglish();
});
renderEnglish();

/* ======================================================
   健身记录
   ====================================================== */
const FIT_ICONS = { '跑步':'🏃', '力量':'🏋️', '有氧':'🚴', '球类':'⚽', '骑行':'🚴', '其他':'💪' };
function loadFitness() { return loadJSON('gradwb_fitness') || { records: [] }; }
function saveFitness(f) { saveJSON('gradwb_fitness', f); }

function renderFitness() {
  const fit = loadFitness();
  const records = [...(fit.records || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.id || '').localeCompare(a.id || ''));
  const weekCnt = fitWeekCount(fit);
  const weekMin = (fit.records || []).filter(r => r.date >= weekStartKey()).reduce((s, r) => s + (Number(r.duration) || 0), 0);
  document.getElementById('fitStatCount').textContent = weekCnt;
  document.getElementById('fitStatMin').textContent = weekMin;
  document.getElementById('fitStatTotal').textContent = (fit.records || []).length;
  document.getElementById('fitStatStreak').textContent = fitStreak(fit);
  document.getElementById('fitCount').textContent = `共 ${records.length} 条记录`;
  // 类型分布
  const distBox = document.getElementById('fitDist');
  const typeCnt = {};
  (fit.records || []).forEach(r => { typeCnt[r.type] = (typeCnt[r.type] || 0) + 1; });
  const distArr = Object.entries(typeCnt).sort((a, b) => b[1] - a[1]);
  if (distBox) {
    distBox.innerHTML = distArr.length
      ? distArr.map(([t, n]) => `<span class="fit-dist-chip">${FIT_ICONS[t] || '💪'} ${esc(t)} × ${n}</span>`).join('')
      : '<div class="mini-empty">暂无数据</div>';
  }
  const box = document.getElementById('fitList');
  box.innerHTML = records.length
    ? records.map(r => `<div class="fit-row">
        <span class="fit-type-icon">${FIT_ICONS[r.type] || '💪'}</span>
        <div class="fit-main">
          <div class="fit-title">${esc(r.type)} · ${r.duration} 分钟${r.distance ? ' · ' + r.distance + ' km' : ''}</div>
          <div class="fit-meta">${fmtCN(r.date)}</div>
        </div>
        <button class="fit-del" data-fit-del="${r.id}">✕</button>
      </div>`).join('')
    : `<div class="mini-empty">还没有训练记录<br><span class="mini-hint">在上方添加第一条</span></div>`;
  box.querySelectorAll('[data-fit-del]').forEach(btn => btn.addEventListener('click', () => {
    const f = loadFitness();
    f.records = f.records.filter(r => r.id !== btn.dataset.fitDel);
    saveFitness(f);
    renderFitness(); renderHomeAggregate(); renderMilestones();
  }));
}
function weekStartKey() {
  const now = new Date();
  const d = new Date(now); d.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return dateKey(d);
}
function fitStreak(fit) {
  if (!fit || !fit.records) return 0;
  const set = new Set(fit.records.map(r => r.date));
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 10000; i++) {
    if (set.has(dateKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
document.getElementById('fitAddBtn').addEventListener('click', () => {
  const duration = Number(document.getElementById('fitDuration').value);
  if (!duration || duration <= 0) { toast('请填写时长'); return; }
  const f = loadFitness();
  f.records.push({
    id: uid(),
    type: document.getElementById('fitType').value,
    duration,
    distance: Number(document.getElementById('fitDistance').value) || 0,

    date: document.getElementById('fitDate').value || todayKey()
  });
  saveFitness(f);
  ['fitDuration','fitDistance'].forEach(id => document.getElementById(id).value = '');
  renderFitness(); renderHomeAggregate(); renderMilestones();
});
renderFitness();

/* ======================================================
   网站索引
   ====================================================== */
// 预置常用网站官方图标（国内直连可达；Google/DuckDuckGo 图标服务国内不通）
const KNOWN_FAVICONS = {
  'tokenrhythm.studio': 'assets/tokenrhythm.svg',
  'cnki.net': 'https://www.cnki.net/favicon.ico',
  'scholar.google.com': 'https://scholar.google.com/favicon.ico',
  'gemini.google.com': 'https://www.gstatic.com/lamda/images/favicon_v1_150160cddff7f294ce30.svg',
  'google.com': 'https://www.google.com/favicon.ico',
  'chatgpt.com': 'https://cdn.oaistatic.com/assets/favicon-miwirzcw.ico',
  'mimo.mi.com': 'https://mimo.mi.com/favicon.png',
  'cloud.tencent.com': 'https://cloud.tencent.com/favicon.ico',
  'priceai.cc': 'assets/priceai.png',
  'xn--mes358aby2apfg.com': 'assets/peiqian.png',
  'arxiv.org': 'https://arxiv.org/favicon.ico',
  'github.com': 'https://github.com/favicon.ico',
  'zhihu.com': 'https://www.zhihu.com/favicon.ico',
  'bilibili.com': 'https://www.bilibili.com/favicon.ico',
  'youtube.com': 'https://www.youtube.com/favicon.ico',
  'agentrouter.org': 'assets/agentrouter.png',
  'supxh.xin': 'assets/supxin.png',
  'sensenova.cn': 'assets/sensenova.png',
  'youtu.be': 'https://www.youtube.com/favicon.ico',
  'csdn.net': 'https://www.csdn.net/favicon.ico',
  'baidu.com': 'https://xueshu.baidu.com/favicon.ico',
  'ieee.org': 'https://www.ieee.org/favicon.ico',
  'optica.org': 'https://opg.optica.org/favicon.ico',
  'deepseek.com': 'https://fe-static.deepseek.com/platform/favicon.svg',
  'opencode.ai': 'https://opencode.ai/favicon.svg',
  'console.bce.baidu.com': 'assets/qianfan.png',
  'baidu.com': 'https://xueshu.baidu.com/favicon.ico',
  'sophet.com': 'assets/sophet.png',
  'sophnet.com': 'assets/sophnet.png',
  'cursor.com': 'assets/cursor.png',
  'dots.ai': 'assets/dots.png',
  'bigmodel.cn': 'assets/bigmodel.png',
  'scnet.cn': 'assets/scnet.png',
  'volcengine.com': 'assets/volcengine.png',
  'aliyun.com': 'assets/aliyun.png',
  'xfyun.cn': 'assets/xfyun.png',
  'lzu.edu.cn': 'assets/lzu.png',
  'qq.com': 'https://www.qq.com/favicon.ico',
  'taobao.com': 'https://www.taobao.com/favicon.ico',
  'weibo.com': 'https://weibo.com/favicon.ico',
  'douban.com': 'https://www.douban.com/favicon.ico',
  'jd.com': 'https://www.jd.com/favicon.ico',
  '163.com': 'https://www.163.com/favicon.ico',
  'sina.com.cn': 'https://www.sina.com.cn/favicon.ico',
  'chuanglan.com': 'https://www.chuanglan.com/favicon.ico',
  'gov.cn': 'https://www.gov.cn/favicon.ico',
  'edu.cn': 'https://www.edu.cn/favicon.ico',
};
function faviconUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const host = u.hostname.toLowerCase();
    for (const k of Object.keys(KNOWN_FAVICONS)) {
      if (host === k || host.endsWith('.' + k)) return KNOWN_FAVICONS[k];
    }
  } catch (e) {}
  return '';
}
function loadSites() {
  try {
    const s = JSON.parse(localStorage.getItem('gradwb_sites_v1'));
    if (Array.isArray(s) && s.length) return s;
  } catch (e) {}
  return DEFAULT_SITES;
}
function saveSites(list) { localStorage.setItem('gradwb_sites_v1', JSON.stringify(list)); }
function renderSites() {
  const sites = loadSites();
  const grid = document.getElementById('siteGrid');
  if (!grid) return;
  grid.innerHTML = sites.map((s, i) => `<div class="site-card" draggable="true" data-site-i="${i}">
      <span class="site-del" data-site-del="${i}" title="删除">✕</span>
      <span class="site-icon">${faviconUrl(s.url) ? `<img src="${faviconUrl(s.url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display=''">` : ''}<span class="site-fallback">${esc((s.name || '🌐')[0])}</span></span>
      <span class="site-name">${esc(s.name)}</span>
    </div>`).join('');
  // 拖拽排序
  let dragI = -1;
  grid.querySelectorAll('.site-card').forEach(card => {
    card.addEventListener('dragstart', e => { dragI = Number(card.dataset.siteI); card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', e => { e.preventDefault(); const t = Number(card.dataset.siteI); card.classList.toggle('drag-over', t !== dragI); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetI = Number(card.dataset.siteI);
      if (dragI < 0 || dragI === targetI) return;
      const list = loadSites();
      const [moved] = list.splice(dragI, 1);
      list.splice(targetI, 0, moved);
      saveSites(list);
      renderSites();
    });
  });
  grid.querySelectorAll('.site-card').forEach((card, i) => card.addEventListener('click', e => {
    if (e.target.classList.contains('site-del')) return;
    window.open(sites[i].url, '_blank');
  }));
  grid.querySelectorAll('[data-site-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const list = loadSites();
    list.splice(Number(btn.dataset.siteDel), 1);
    saveSites(list);
    renderSites();
  }));
}
document.getElementById('siteAddBtn').addEventListener('click', () => {
  const name = document.getElementById('siteName').value.trim();
  let url = document.getElementById('siteUrl').value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const list = loadSites();
  list.push({ name, url, icon: '🌐' });
  saveSites(list);
  document.getElementById('siteName').value = '';
  document.getElementById('siteUrl').value = '';
  renderSites();
});
['siteName', 'siteUrl'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('siteAddBtn').click();
  });
});

/* ======================================================
   API 管理（密钥 + 用量额度中心）
   ====================================================== */
function loadAPIs() {
  try {
    const s = JSON.parse(localStorage.getItem('gradwb_apis_v1'));
    if (Array.isArray(s)) return s;
  } catch (e) {}
  return [{ id: uid(), name: 'DeepSeek 官方', base: 'https://api.deepseek.com', key: '', model: 'deepseek-chat' }];
}
function saveAPIs(list) { saveJSON('gradwb_apis_v1', list); }
function isOCApi(a) { return /opencode/i.test(a.base || ''); }
function isJyApi(a) {
  const b = (a.base || '').toLowerCase();
  const n = (a.name || '').toLowerCase();
  return b.includes('tokenrhythm') || b.includes('jiyuan') || b.includes('基元') || n.includes('基元') || n.includes('jiyuan');
}
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function renderAPIs() {
  const apis = loadAPIs();
  const ocList = apis.filter(isOCApi);
  const jyList = apis.filter(isJyApi);
  const dsList = apis.filter(a => !isOCApi(a) && !isJyApi(a));
  document.getElementById('apiStatCount').textContent = apis.filter(a => a.key).length;
  renderKeyList('apiList', ocList);
  renderKeyList('jyKeyList', jyList);
  renderKeyList('dsKeyList', dsList);
  renderOCUsage();
  renderDSUsage();
  renderJyUsage();
  renderGySites();
  renderFySites();
  renderSxUsage();
  renderSnUsage();
  ensureKnownKeys();
  renderKeyNotes();
}
function brandIcon(base) {
  const b = (base || '').toLowerCase();
  if (b.includes('opencode')) return '<img class="brand-ico-fb" src="https://opencode.ai/favicon.svg" alt="" onerror="this.outerHTML=\'🚀\'">';
  if (b.includes('tokenrhythm') || b.includes('jiyuan')) return '<img class="brand-ico-fb" src="assets/tokenrhythm.svg" alt="" onerror="this.outerHTML=\'💠\'">';
  if (b.includes('deepseek')) return '<img class="brand-ico-fb" src="https://fe-static.deepseek.com/platform/favicon.svg" alt="" onerror="this.outerHTML=\'🧠\'">';
  if (b.includes('openai') || b.includes('chatgpt') || b.includes('api.openai')) return '<img class="brand-ico-fb" src="https://chatgpt.com/favicon.ico" alt="" onerror="this.outerHTML=\'🤖\'">';
  if (b.includes('anthropic') || b.includes('claude')) return '<img class="brand-ico-fb" src="https://claude.ai/favicon.ico" alt="" onerror="this.outerHTML=\'✨\'">';
  if (b.includes('qwen') || b.includes('aliyun') || b.includes('dashscope')) return '<img class="brand-ico-fb" src="https://www.alibabacloud.com/favicon.ico" alt="" onerror="this.outerHTML=\'🌀\'">';
  if (b.includes('moonshot') || b.includes('kimi')) return '<img class="brand-ico-fb" src="https://kimi.moonshot.cn/favicon.ico" alt="" onerror="this.outerHTML=\'🌙\'">';
  if (b.includes('zhipu') || b.includes('bigmodel')) return '<img class="brand-ico-fb" src="https://open.bigmodel.cn/favicon.ico" alt="" onerror="this.outerHTML=\'🔮\'">';
  if (b.includes('minimax')) return '<img class="brand-ico-fb" src="https://www.minimaxi.com/favicon.ico" alt="" onerror="this.outerHTML=\'🎭\'">';
  if (b.includes('gemini') || b.includes('googleapis')) return '<img class="brand-ico-fb" src="https://www.gstatic.com/images/branding/product/1x/googleg_32dp.png" alt="" onerror="this.outerHTML=\'🌟\'">';
  return '🔑';
}
function renderKeyList(listId, apis) {
  const list = document.getElementById(listId);
  if (!list) return;
  if (!apis.length) {
    list.innerHTML = `<div class="api-empty">还没有配置密钥，在上方添加</div>`;
    return;
  }
  list.innerHTML = apis.map(a => `<div class="api-card">
    <div class="api-info">
      <div class="api-name">${a.key ? '🔓' : '🔒'} ${brandIcon(a.base)} ${esc(a.name)} ${a.key ? '' : '<span class="hint-text">未配置 Key</span>'}</div>
      <div class="api-detail">Base: ${esc(a.base)} · 默认模型: ${esc(a.model || '—')}</div>
      <div class="api-key-line">
        <span class="api-key-text">${a.key ? a.key.slice(0,5) + '••••••' + a.key.slice(-4) : '未配置 Key'}</span>
        <button class="api-btn" data-eye="${a.id}">👁</button>
        <button class="api-btn" data-copy="${a.id}" title="一键复制完整密钥">📋</button>
        <button class="api-btn" data-edit="${a.id}">✏️</button>
        <button class="api-btn" data-test="${a.id}">测试连接</button>
        <span class="api-status"></span>
      </div>
    </div>
    <button class="api-del" data-api-del="${a.id}" title="删除">✕</button>
  </div>`).join('');
}
function apiById(id) { return loadAPIs().find(a => a.id === id); }
['apiList', 'dsKeyList', 'jyKeyList'].forEach(listId => {
  document.getElementById(listId).addEventListener('click', e => {
    const eye = e.target.closest('[data-eye]');
    if (eye) {
      const a = apiById(eye.dataset.eye);
      const keyText = eye.parentElement.querySelector('.api-key-text');
      if (!a) return;
      if (eye.textContent === '👁') { eye.textContent = '🙈'; keyText.textContent = a.key || '未配置 Key'; }
      else { eye.textContent = '👁'; keyText.textContent = a.key ? a.key.slice(0,5) + '••••••' + a.key.slice(-4) : '未配置 Key'; }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openEdit(ed.dataset.edit); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const a = apiById(cp.dataset.copy);
      if (a && a.key) copyText(a.key);
      else toast('该密钥未配置 Key');
      return;
    }
    const t = e.target.closest('[data-test]');
    if (t) { testAPI(t.dataset.test); return; }
    const d = e.target.closest('[data-api-del]');
    if (d) {
      myConfirm('删除该密钥配置？', () => {
        saveAPIs(loadAPIs().filter(x => x.id !== d.dataset.apiDel));
        renderAPIs();
      });
    }
  });
});
async function testAPI(id) {
  const a = apiById(id);
  if (!a) return;
  const btn = document.querySelector(`[data-test="${id}"]`);
  const statusEl = btn ? btn.parentElement.querySelector('.api-status') : null;
  if (!statusEl) return;
  if (!a.key) { statusEl.textContent = '先填写 Key 再测试'; statusEl.className = 'api-status bad'; return; }
  statusEl.textContent = '测试中…';
  statusEl.className = 'api-status wait';
  try {
    const r = await fetch(a.base.replace(/\/+$/, '') + '/models', { headers: { 'Authorization': 'Bearer ' + a.key } });
    if (r.ok) {
      const d = await r.json();
      const n = (d.data && d.data.length) ? d.data.length : '?';
      statusEl.textContent = `✅ 连接成功（${n} 个模型）`;
      statusEl.className = 'api-status ok';
    } else {
      statusEl.textContent = `❌ HTTP ${r.status}`;
      statusEl.className = 'api-status bad';
    }
  } catch (e) {
    statusEl.textContent = '❌ 请求失败（CORS 或网络）';
    statusEl.className = 'api-status bad';
  }
}
/* --- 统一密钥导入弹窗（opencode / DeepSeek / 基元律动 同一形式；支持编辑） --- */
let kfTarget = 'oc';
let kfEditingId = null;
function openEdit(id) {
  const a = apiById(id);
  if (!a) return;
  kfEditingId = id;
  kfTarget = isOCApi(a) ? 'oc' : (isJyApi(a) ? 'jy' : 'ds');
  document.getElementById('apiKeyModalTitle').textContent = '✏️ 编辑密钥配置';
  document.getElementById('kfName').value = a.name || '';
  document.getElementById('kfKey').value = a.key || '';
  document.getElementById('kfBase').value = a.base || '';
  document.getElementById('kfModel').value = a.model || '';
  openModal('apiKeyModal');
}
function openImport(target) {
  kfEditingId = null;
  kfTarget = target === 'ds' ? 'ds' : (target === 'jy' ? 'jy' : 'oc');
  const isDS = kfTarget === 'ds';
  const isJY = kfTarget === 'jy';
  document.getElementById('apiKeyModalTitle').textContent = isDS ? '🔑 导入 DeepSeek 密钥配置' : (isJY ? '💠 导入基元律动密钥配置' : '🚀 导入 opencode 密钥配置');
  document.getElementById('kfBase').value = isDS ? 'https://api.deepseek.com' : (isJY ? '' : 'https://opencode.ai/zen/go/v1');
  document.getElementById('kfModel').value = isDS ? 'deepseek-chat' : (isJY ? '' : 'deepseek-v4-flash');
  document.getElementById('kfName').value = '';
  document.getElementById('kfKey').value = '';
  openModal('apiKeyModal');
}
document.getElementById('ocImportBtn').addEventListener('click', () => openImport('oc'));
document.getElementById('dsImportBtn').addEventListener('click', () => openImport('ds'));
document.getElementById('jyImportBtn').addEventListener('click', () => openImport('jy'));
document.getElementById('kfSave').addEventListener('click', () => {
  const name = document.getElementById('kfName').value.trim();
  const key = document.getElementById('kfKey').value.trim();
  const base = document.getElementById('kfBase').value.trim();
  if (!name) { toast('请填写名称'); return; }
  if (!key) { toast('请填写 API Key'); return; }
  if (!base) { toast('请填写 Base URL'); return; }
  const list = loadAPIs();
  if (kfEditingId) {
    const it = list.find(x => x.id === kfEditingId);
    if (it) {
      it.name = name;
      it.key = key;
      it.base = base.replace(/\/+$/, '');
      it.model = document.getElementById('kfModel').value.trim();
    }
  } else {
    list.push({ id: uid(), name, base: base.replace(/\/+$/, ''), key, model: document.getElementById('kfModel').value.trim() });
  }
  saveAPIs(list);
  closeModal('apiKeyModal');
  renderAPIs();
  switchApiTab(kfTarget);
});

/* --- AI 调用统一封装（自动累计用量） --- */
async function callAI(api, messages) {
  const model = api.model || 'deepseek-chat';
  // 桥在线：走本地转发（绕过 API 的 CORS 限制，opencode 也能用）；桥离线：直连兜底（DeepSeek 支持 CORS）
  if (bridgeOnline) {
    const r = await fetch(BRIDGE + '/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: api.base, key: api.key, model, messages }),
    });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch (e) { throw new Error('响应解析失败 HTTP ' + r.status); }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((d.error && d.error.message) || ''));
    if (!d.choices || !d.choices[0]) throw new Error('响应无内容');
    return d.choices[0].message.content;
  }
  const r = await fetch(api.base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
    body: JSON.stringify({ model, messages, temperature: 0.7 })
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error?.message || ''; } catch (e) {}
    throw new Error(`HTTP ${r.status} ${detail}`);
  }
  const d = await r.json();
  return d.choices[0].message.content;
}

/* --- 添加部分弹层 --- */
document.getElementById('partOkBtn').addEventListener('click', () => {
  const name = document.getElementById('partNameInput').value.trim();
  const all2 = loadArticles();
  if (partEditId) {
    const p = (all2[curCat].parts || []).find(x => x.id === partEditId);
    if (p) p.name = name || p.name;
    partEditId = null;
  } else {
    const pid = uid();
    all2[curCat].parts.push({ id: pid, name: name || '新部分', files: [] });
    curPartId = pid;
  }
  saveJSON('gradwb_articles', all2);
  closeModal('partModal');
  renderCatWork();
});
document.getElementById('partNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('partOkBtn').click();
});

/* --- 自绘确认弹层（替代 window.confirm，预览环境更可靠） --- */
let cfCallback = null;
function myConfirm(text, onOk) {
  document.getElementById('cfText').textContent = text;
  cfCallback = onOk;
  openModal('confirmModal');
}
document.getElementById('cfOk').addEventListener('click', () => {
  closeModal('confirmModal');
  if (cfCallback) { const cb = cfCallback; cfCallback = null; cb(); }
});
document.getElementById('cfCancel').addEventListener('click', () => { cfCallback = null; closeModal('confirmModal'); });

/* --- 通用弹层 --- */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// 事件委托：关闭按钮 + 点遮罩空白处关闭（动态/延迟绑定都可靠）
document.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeModal(closeBtn.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('modal-mask')) {
    closeModal(e.target.id);
  }
});

/* --- Agent 助手（网页 ↔ Hermes）--- */
/* --- Agent 助手：多会话管理（每会话独立 Hermes session）--- */
const AGENT_CONVS_KEY = 'gradwb_agent_convs';
let agentSending = false;
let curConvId = null;
function loadConvs() {
  try {
    const list = JSON.parse(localStorage.getItem(AGENT_CONVS_KEY));
    if (Array.isArray(list) && list.length) return list;
  } catch (e) {}
  return [];
}
function saveConvs(list) {
  try { localStorage.setItem(AGENT_CONVS_KEY, JSON.stringify(list.slice(-30))); } catch (e) {}
}
function curConv() { return loadConvs().find(c => c.id === curConvId) || null; }
function ensureConv() {
  let convs = loadConvs();
  if (!curConvId || !convs.find(c => c.id === curConvId)) {
    const c = { id: uid(), title: '新对话', sessionId: null, msgs: [], ts: Date.now() };
    convs.unshift(c);
    saveConvs(convs);
    curConvId = c.id;
  }
  return curConv();
}
function convTitleOf(msg) { return String(msg || '').trim().slice(0, 14) || '新对话'; }
function loadAgentHistory() { const c = curConv(); return c ? c.msgs : []; }
function saveAgentHistory(msgs) {
  const convs = loadConvs();
  const c = convs.find(x => x.id === curConvId);
  if (!c) return;
  c.msgs = msgs.slice(-50);
  c.ts = Date.now();
  saveConvs(convs);
}
// 轻量 markdown 渲染（安全转义后支持 代码块/行内代码/加粗/斜体/列表/引用/标题/链接/换行）
function mdToHtml(md) {
  let s = esc(String(md || ''));
  // 代码块（先保护）
  const blocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => { blocks.push('<pre><code>' + esc(code).replace(/&/g, '&amp;') + '</code></pre>'); return '\x00B' + (blocks.length - 1) + '\x00'; });
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 标题
  s = s.replace(/^###\s+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/^##\s+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/^#\s+(.+)$/gm, '<b>$1</b>');
  // 引用
  s = s.replace(/^&gt;\s?(.+)$/gm, '<div class="ag-quote">$1</div>');
  // 无序列表
  s = s.replace(/^\s*[-*]\s+(.+)$/gm, '<div class="ag-li">• $1</div>');
  // 有序列表
  s = s.replace(/^\s*\d+\.\s+(.+)$/gm, '<div class="ag-li">$1</div>');
  // 加粗 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  // 链接
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 换行
  s = s.replace(/\n/g, '<br>');
  // 恢复代码块
  s = s.replace(/\x00B(\d+)\x00/g, (m, i) => blocks[Number(i)]);
  return s;
}
const AGENT_QUICKS = [
  ['📡', '查最新论文', 'arXiv 实时检索', '帮我查一下相变材料光计算最近的新论文，整理 5 篇发给我'],
  ['🔬', '研究方向梳理', '文献库分析', '请帮我梳理文献库里的研究方向，给出下一步的研究建议'],
  ['🌐', '英语学习计划', '背单词 + 阅读', '帮我制定一周英语学习计划（每天 30 分钟，六级核心词汇）'],
  ['📅', '本周规划', '日程 + 目标', '帮我规划本周的工作安排，按优先级排序'],
];
function renderConvList() {
  const list = document.getElementById('convList');
  if (!list) return;
  const convs = loadConvs();
  list.innerHTML = convs.map(c => `<div class="conv-item ${c.id === curConvId ? 'active' : ''}" data-conv="${c.id}">
      <span class="conv-title">${esc(c.title)}</span>
      <span class="conv-del" data-conv-del="${c.id}" title="删除对话">✕</span>
    </div>`).join('') || '<div class="conv-empty">还没有对话<br><span>点上方「新建对话」开始</span></div>';
  list.querySelectorAll('[data-conv]').forEach(el => el.addEventListener('click', e => {
    if (e.target.classList.contains('conv-del')) return;
    switchConv(el.dataset.conv);
  }));
  list.querySelectorAll('[data-conv-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = btn.dataset.convDel;
    myConfirm('删除这个对话？对话记录会一并清除。', () => {
      let convs = loadConvs();
      convs = convs.filter(c => c.id !== id);
      if (curConvId === id) curConvId = convs.length ? convs[0].id : null;
      saveConvs(convs);
      renderConvList();
    });
  }));
}
function newConv() {
  const convs = loadConvs();
  const c = { id: uid(), title: '新对话', sessionId: null, msgs: [], ts: Date.now() };
  convs.unshift(c);
  saveConvs(convs);
  curConvId = c.id;
  renderAgentChat();
  renderConvList();
}
function switchConv(id) {
  if (agentSending) { toast('Agent 正在回复中，请稍候再切换'); return; }
  curConvId = id;
  renderAgentChat();
  renderConvList();
}
function renderAgentChat() {
  const box = document.getElementById('agentChat');
  const msgs = loadAgentHistory();
  if (!msgs.length) {
    box.innerHTML = `<div class="agent-welcome">
      <div class="aw-ico">🤖</div>
      <div class="aw-title">你好，我是 Hermes Agent</div>
      <div class="aw-sub">AI 助手 —— 我能调用工具和技能：读文献、查资料、写代码、整理数据…</div>
      <div class="aw-cards">${AGENT_QUICKS.map(q => `<button class="aw-card" data-quick="${esc(q[3])}"><i>${q[0]}</i><b>${q[1]}</b><span>${q[2]}</span></button>`).join('')}</div>
      <div class="aw-tip">直接提问即可，或点击上方快捷入口 · 每个问题约 10~60 秒</div>
    </div>`;
    return;
  }
  box.innerHTML = msgs.map(m => `<div class="ag-msg ${m.role}"><div class="ag-bubble">${m.role === 'user' ? esc(m.text) : mdToHtml(m.text)}</div></div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function sendAgentMessage(text) {
  if (agentSending) return;
  const conv = ensureConv();
  const msgs = conv.msgs.slice();
  const isFirst = !msgs.length;
  msgs.push({ role: 'user', text });
  conv.msgs = msgs;
  if (conv.title === '新对话') conv.title = convTitleOf(text);
  conv.ts = Date.now();
  saveConvs(loadConvs().map(c => c.id === conv.id ? conv : c));
  renderAgentChat();
  renderConvList();
  logAgentAct('对话：' + convTitleOf(text));
  renderAgentFeed();
  agentSending = true;
  const hint = document.getElementById('agentHint');
  const sendBtn = document.getElementById('agentSend');
  hint.style.display = '';
  sendBtn.disabled = true;
  fetch(BRIDGE + '/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, scene: 'chat', session: conv.sessionId || null }),
  })
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      return d;
    })
    .then(d => {
      const convs = loadConvs();
      const c = convs.find(x => x.id === curConvId);
      if (c) {
        c.msgs.push({ role: 'assistant', text: d.reply });
        if (d.sessionId) c.sessionId = d.sessionId;
        c.ts = Date.now();
      }
      saveConvs(convs);
      renderAgentChat();
      renderConvList();
    })
    .catch(e => {
      const convs = loadConvs();
      const c = convs.find(x => x.id === curConvId);
      if (c) { c.msgs.push({ role: 'assistant', text: '⚠️ ' + e.message }); c.ts = Date.now(); }
      saveConvs(convs);
      renderAgentChat();
    })
    .finally(() => { agentSending = false; hint.style.display = 'none'; sendBtn.disabled = false; });
}
document.getElementById('agentSend').addEventListener('click', () => {
  const inp = document.getElementById('agentInput');
  const v = inp.value.trim();
  if (!v) return;
  inp.value = '';
  sendAgentMessage(v);
});
document.getElementById('agentInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('agentSend').click(); }
});
document.getElementById('analysisInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.getElementById('analysisBtn').click(); }
});
document.getElementById('agentClear').addEventListener('click', () => {
  myConfirm('确定清空当前对话吗？（仅当前对话，不影响其他对话）', () => {
    const convs = loadConvs();
    const c = convs.find(x => x.id === curConvId);
    if (c) { c.msgs = []; c.sessionId = null; c.title = '新对话'; }
    saveConvs(convs);
    renderAgentChat();
    renderConvList();
  });
});
// 快捷入口卡：事件委托（欢迎卡由 renderAgentChat 动态渲染）
document.getElementById('agentChat').addEventListener('click', e => {
  const card = e.target.closest('.aw-card');
  if (!card) return;
  const q = card.dataset.quick;
  if (!q) return;
  sendAgentMessage(q);
});
// 桥状态点
function updateAgentStatus() {
  const st = document.getElementById('agentStatus');
  if (!st) return;
  const on = typeof bridgeOnline !== 'undefined' && bridgeOnline;
  st.classList.toggle('off', !on);
  st.querySelector('.as-text').textContent = on ? '桥已连接' : '桥未连接';
}
setInterval(updateAgentStatus, 15000);
updateAgentStatus();
// 切到 agent 页时滚动到底部
document.querySelector('.nav-item[data-page="agent"]').addEventListener('click', () => {
  const box = document.getElementById('agentChat');
  if (box) box.scrollTop = box.scrollHeight;
});
// 初始化：默认对话 + 列表渲染
document.getElementById('convNewBtn').addEventListener('click', newConv);
if (!loadConvs().length) {
  const c = { id: uid(), title: '新对话', sessionId: null, msgs: [], ts: Date.now() };
  saveConvs([c]);
}
if (!curConvId || !loadConvs().find(c => c.id === curConvId)) curConvId = loadConvs()[0].id;
renderConvList();
renderAgentChat();

/* --- 全局搜索（Ctrl+K）--- */
function openLibEdit(it) {
  libEditId = it.id;
  document.getElementById('libTitle').value = it.title || '';
  document.getElementById('libAuthors').value = it.authors || '';
  document.getElementById('libJournal').value = it.journal || '';
  document.getElementById('libYear').value = it.year || '';
  document.getElementById('libDoi').value = it.doi || '';
  document.getElementById('libTags').value = (it.tags || []).join(',');
  document.getElementById('libStatus').value = it.status || '未读';
  document.getElementById('libAbstract').value = it.abstract || '';
  document.getElementById('libNotes').value = it.notes || '';
  renderCatPicker('libCat', it.cat || '');
  openModal('libModal');
}
function searchAll(q) {
  q = String(q || '').toLowerCase().trim();
  if (q.length < 2) return [];
  const res = [];
  const push = (page, label, title, sub, jump) => {
    if (title && String(title).toLowerCase().includes(q)) res.push({ page, label, title: String(title), sub: String(sub || ''), jump });
  };
  loadLibrary().forEach(it => push('library', '文献', it.title, [it.authors, it.journal, it.year].filter(Boolean).join(' · '),
    () => { showPage('library'); setTimeout(() => openLibEdit(it), 60); }));
  loadSubs().forEach(s => push('submission', '投稿', s.title, [s.journal, s.status].filter(Boolean).join(' · '),
    () => showPage('submission')));
  loadSummaries().forEach(s => push('summary', '总结', s.text, s.date, () => showPage('summary')));
  loadEvents().forEach(e => push('calendar', '日程', e.title, e.date, () => showPage('calendar')));
  loadFitness().records.forEach(r => push('fitness', '健身', (r.type || '') + ' ' + (r.detail || ''), r.date, () => showPage('fitness')));
  loadEnglish().phrases.forEach(ph => push('english', '短语', ph.en, ph.cn, () => showPage('english')));
  try { loadSites().forEach(s => push('sites', '网站', s.name, s.url, () => showPage('sites'))); } catch (e) {}
  loadAnalyses().forEach(a => push('analysis', '分析', a.input, a.time, () => showPage('analysis')));
  const arts = loadArticles() || {};
  Object.entries(arts).forEach(([cat, obj]) => (obj && obj.parts || []).forEach(pt => (pt.files || []).forEach(f => {
    push('articles', '文章·' + cat, f.name || f, pt.name || '', () => showPage('articles'));
  })));
  // 已学英语单词（当前词库进度）
  const wbProg = loadJSON('gradwb_wb_progress') || {};
  Object.entries(wbProg).forEach(([book, words]) => (words || []).forEach(w => push('english', '单词·' + book, w, '', () => showPage('english'))));
  return res.slice(0, 40);
}
function renderSearchResults(q) {
  const box = document.getElementById('searchResults');
  const res = searchAll(q);
  if (!q || q.length < 2) { box.innerHTML = '<div class="search-empty">输入至少 2 个字符开始搜索</div>'; return; }
  if (!res.length) { box.innerHTML = '<div class="search-empty">没有找到「' + esc(q) + '」相关的内容</div>'; return; }
  // 按页面分组（先展平赋索引，再渲染，避免 data-idx 悬空）
  const groups = {};
  res.forEach(r => { (groups[r.page] = groups[r.page] || []).push(r); });
  const PAGE_NAMES = { home: '首页', summary: '工作总结', calendar: '工作日历', radar: '文献雷达', library: '文献库', analysis: '文献分析', submission: '投稿', articles: '文章', english: '英语', fitness: '健身', sites: '网站', api: 'API', agent: 'Agent' };
  let idx = 0;
  const flat = [];
  Object.values(groups).forEach(g => g.forEach(r => { r._i = idx++; flat.push(r); }));
  box.innerHTML = Object.entries(groups).map(([page, items]) => `
    <div class="search-group"><div class="search-group-label">${PAGE_NAMES[page] || page}（${items.length}）</div>
    ${items.map(r => `<div class="search-item" data-idx="${r._i}"><span class="search-label">${r.label}</span> ${esc(r.title)}<div class="search-sub">${esc(r.sub)}</div></div>`).join('')}</div>`).join('');
  box.querySelectorAll('.search-item').forEach(el => el.addEventListener('click', () => {
    const r = flat[Number(el.dataset.idx)];
    if (r && r.jump) { closeModal('searchModal'); r.jump(); }
  }));
}
/* --- / 命令面板 --- */
const CMD_PAGES = [
  ['🏠', '首页', 'home'], ['📝', '工作总结', 'summary'], ['📅', '工作日历', 'calendar'],
  ['📡', '文献雷达', 'radar'], ['📚', '我的文献库', 'library'], ['🧠', '文献分析', 'analysis'],
  ['✉️', '投稿管理', 'submission'], ['✍️', '文章管理', 'articles'], ['🌐', '英语学习', 'english'],
  ['🏋️', '健身记录', 'fitness'], ['🔗', '网站索引', 'sites'], ['🔑', 'API 管理', 'api'],
  ['🤖', 'Agent 助手', 'agent'],
];
const CMD_ACTIONS = [
  ['🔍', '全局搜索', () => openModal('searchModal')],
  ['💾', '备份数据', () => { if (typeof backupExport === 'function') backupExport(); }],
  ['➕', '新建 Agent 对话', () => { if (typeof newConv === 'function') newConv(); }],
  ['📥', '导入 Zotero 文献', () => { if (typeof openImportModal === 'function') openImportModal(); }],
];
function openCommandModal() {
  openModal('commandModal');
  document.getElementById('cmdInput').value = '';
  renderCmdList('');
  setTimeout(() => document.getElementById('cmdInput').focus(), 60);
}
function renderCmdList(q) {
  const kw = q.toLowerCase().trim();
  const items = [];
  for (const [ic, nm, pg] of CMD_PAGES) {
    if (!kw || nm.toLowerCase().includes(kw) || pg.includes(kw)) items.push({ ic, nm, run: () => { closeModal('commandModal'); showPage(pg); } });
  }
  for (const [ic, nm, run] of CMD_ACTIONS) {
    if (!kw || nm.toLowerCase().includes(kw)) items.push({ ic, nm, run: () => { closeModal('commandModal'); run(); } });
  }
  const list = document.getElementById('cmdList');
  if (!items.length) { list.innerHTML = '<div class="search-empty">没有匹配的命令</div>'; return; }
  list.innerHTML = items.map((it, i) => `<div class="search-hit" data-i="${i}"><span style="margin-right:8px">${it.ic}</span>${esc(it.nm)}</div>`).join('');
  list.querySelectorAll('.search-hit').forEach((el, i) => el.addEventListener('click', () => items[i].run()));
  window._cmdItems = items;
}
document.getElementById('cmdInput').addEventListener('input', e => renderCmdList(e.target.value));
document.getElementById('cmdInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const it = (window._cmdItems || [])[0]; if (it) it.run(); }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    openCommandModal();
  }
});
/* --- ✍️ AI 写作助手 --- */
let writeMode = 'outline';
let writeBusy = false;
document.getElementById('artWriteBtn').addEventListener('click', () => {
  openModal('writeModal');
  document.getElementById('writeInput').value = '';
  document.getElementById('writeResult').innerHTML = '';
  document.getElementById('writeCopy').hidden = true;
  document.getElementById('writeHint').style.display = 'none';
});
document.getElementById('writeModeTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  writeMode = btn.dataset.wmode;
  document.querySelectorAll('#writeModeTabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('writeGo').addEventListener('click', () => {
  if (writeBusy) return;
  const inp = document.getElementById('writeInput').value.trim();
  if (!inp) { toast('请先输入内容'); return; }
  const modeText = { outline: '请为以下主题生成详细的论文大纲（标题建议、摘要要点、章节结构、每节要点、图表建议）', polish: '请润色改写以下文本（提升学术性和流畅度，保留原意，输出润色后的完整文本）：', cover: '请为以下稿件生成一封规范的投稿 cover letter（英文，正式语气，含标题/亮点/适合期刊的理由）：' }[writeMode];
  writeBusy = true;
  const hint = document.getElementById('writeHint');
  const btn = document.getElementById('writeGo');
  hint.style.display = '';
  btn.disabled = true;
  const result = document.getElementById('writeResult');
  result.innerHTML = '';
  fetch(BRIDGE + '/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: modeText + '\n\n' + inp, scene: 'writing' }),
  })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; })
    .then(d => {
      result.innerHTML = mdToHtml(d.reply || '（空回复）');
      document.getElementById('writeCopy').hidden = false;
    })
    .catch(e => { result.innerHTML = '<div class="mini-empty">⚠️ ' + esc(e.message) + '</div>'; })
    .finally(() => { writeBusy = false; hint.style.display = 'none'; btn.disabled = false; });
});
document.getElementById('writeCopy').addEventListener('click', () => {
  const txt = document.getElementById('writeResult').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('✅ 已复制'));
  else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('✅ 已复制'); }
});
document.getElementById('globalSearchBtn').addEventListener('click', () => {
  openModal('searchModal');
  setTimeout(() => document.getElementById('searchInput').focus(), 60);
});
document.getElementById('searchInput').addEventListener('input', e => renderSearchResults(e.target.value));
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const box = document.getElementById('searchResults');
    const first = box.querySelector('.search-item');
    if (first) first.click();
  }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const mask = document.getElementById('searchModal');
    if (mask && mask.classList.contains('show')) closeModal('searchModal');
    else document.getElementById('globalSearchBtn').click();
  }
});

/* --- 数据备份/恢复 --- */
function backupExport() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('gradwb_'));
  const data = { app: '读研工作台', version: '1.0', exportedAt: new Date().toISOString(), keys: keys.length, data: {} };
  keys.forEach(k => { try { data.data[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { data.data[k] = localStorage.getItem(k); } });
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = `gradwb_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  const info = document.getElementById('backupInfo');
  if (info) info.textContent = '✅ 已导出 ' + keys.length + ' 项数据';
}
function backupImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const bag = data && data.data ? data.data : data;
      if (!bag || typeof bag !== 'object') throw new Error('格式不对');
      let n = 0;
      Object.entries(bag).forEach(([k, v]) => { if (k.startsWith('gradwb_')) { localStorage.setItem(k, JSON.stringify(v)); n++; } });
      const info = document.getElementById('backupInfo');
      if (info) info.textContent = '✅ 已恢复 ' + n + ' 项数据，正在刷新页面…';
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast('导入失败：文件不是有效的工作台备份（' + e.message + '）');
    }
  };
  reader.readAsText(file);
}
/* 文献库：从本地文件路径导入（agent 提取元数据 → 写 agent_out → 网页轮询自动入库） */
document.getElementById('libFileGo').addEventListener('click', async () => {
  const pathInput = document.getElementById('libFilePath');
  const filePath = pathInput.value.trim();
  if (!filePath) { toast('请先粘贴本地文件路径'); return; }
  if (!bridgeOnline) { toast('桥服务未开启：请先点击桌面「开启工作台桥」图标'); return; }
  const msg = document.getElementById('libFileMsg');
  msg.hidden = false;
  msg.textContent = '⏳ 🤖 Agent 正在读取文件并提取信息…（10~60 秒，网页会自动弹出入库提示）';
  try {
    const r = await fetch(BRIDGE + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: filePath, scene: 'import_lit' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    msg.textContent = '✅ 已提交给 Agent，等待入库结果…（网页轮询 30 秒内提示）';
  } catch (e) {
    msg.textContent = '';
    msg.hidden = true;
    toast('提交失败：' + e.message);
  }
});
document.getElementById('backupBtn').addEventListener('click', () => openModal('backupModal'));
document.getElementById('backupExport').addEventListener('click', backupExport);
document.getElementById('backupImport').addEventListener('click', () => document.getElementById('backupFileInput').click());
document.getElementById('backupFileInput').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) backupImportFile(f);
  e.target.value = '';
});
