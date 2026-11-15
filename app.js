/* 北港文化探索｜離線優先走讀系統  v1.0
 * 資料全部存在本機 IndexedDB；Service Worker 負責離線開啟；有網路且設定 syncUrl 時自動同步到 Google Apps Script。 */
'use strict';
const APP_VER = '1.0.0';
const ASSETS = ['./', './index.html', './app.js', './style.css', './activity.json', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './assets/map-v1.png', './assets/ctg-plan-v3.png'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hhmm = t => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- IndexedDB ---------- */
let _db;
function db() {
  if (!_db) _db = new Promise((res, rej) => {
    const r = indexedDB.open('beigang-explorer', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('records', { keyPath: 'id' }).createIndex('student', 'studentId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('資料庫被其他分頁占用，請關閉其他分頁'));
  });
  return _db;
}
const p2 = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('寫入中止（可能空間不足）')); });
async function kvGet(k) { const d = await db(); return p2(d.transaction('kv').objectStore('kv').get(k)); }
async function kvSet(k, v) { const d = await db(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); return done(t); }
async function kvDel(k) { const d = await db(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); return done(t); }
async function recPut(r) { const d = await db(); const t = d.transaction('records', 'readwrite'); t.objectStore('records').put(r); return done(t); }
async function recGet(id) { const d = await db(); return p2(d.transaction('records').objectStore('records').get(id)); }
async function recAll(sid) { const d = await db(); return p2(d.transaction('records').objectStore('records').index('student').getAll(sid)); }

/* ---------- SHA-256（優先用瀏覽器內建，無 HTTPS 時用備援） ---------- */
async function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  if (window.crypto && crypto.subtle) {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256js(bytes);
}
function sha256js(m) {
  const K = [], H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  let n = 2, c = 0; const fr = x => ((x - Math.floor(x)) * 4294967296) | 0;
  while (c < 64) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) K[c++] = fr(Math.cbrt(n)); n++; }
  const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(nb); b.set(m); b[l] = 0x80;
  const dv = new DataView(b.buffer); dv.setUint32(nb - 4, l * 8); dv.setUint32(nb - 8, Math.floor(l / 536870912));
  const w = new Int32Array(64), r = (x, y) => (x >>> y) | (x << (32 - y));
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], d = w[i - 2]; w[i] = (w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(d, 17) ^ r(d, 19) ^ (d >>> 10))) | 0; }
    let [A, B, C, D, E, F, G, Hh] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (Hh + (r(E, 6) ^ r(E, 11) ^ r(E, 25)) + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
      const t2 = ((r(A, 2) ^ r(A, 13) ^ r(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      Hh = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0; H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + Hh) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const codeHash = (act, code) => sha256(act.salt + ':' + String(code).replace(/\s+/g, '').toUpperCase());

/* ---------- 二進位工具 ---------- */
function bufToDataURL(buf, type) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(new Blob([buf], { type })); }); }
function dataURLToBuf(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; }
function blobToBuf(blob) { return blob.arrayBuffer ? blob.arrayBuffer() : new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(blob); }); }
async function compressImage(file, max = 1600, q = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('無法讀取這張圖片，請改用拍照或換一張')); img.src = url; });
    let w = img.naturalWidth, h = img.naturalHeight; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    let blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    if (!blob) blob = new Blob([dataURLToBuf(cv.toDataURL('image/jpeg', q))], { type: 'image/jpeg' });
    cv.width = cv.height = 1;
    return { buf: await blobToBuf(blob), type: 'image/jpeg', w, h, size: blob.size };
  } finally { URL.revokeObjectURL(url); }
}
let urlPool = [];
function photoURL(ph) { if (!ph) return ''; if (ph.dataUrl) return ph.dataUrl; const u = URL.createObjectURL(new Blob([ph.buf], { type: ph.type })); urlPool.push(u); return u; }
function freeURLs() { urlPool.forEach(u => URL.revokeObjectURL(u)); urlPool = []; }
async function fetchT(url, opt = {}, ms = 6000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); } }

/* ---------- 全域狀態 ---------- */
const S = { act: null, ident: null, recs: new Map(), pending: new Set(), saveTimer: 0, saveState: null, syncing: false, syncErr: '', lastSync: 0, prep: null };
const sid = () => S.ident.studentId;
const stuName = () => ((S.act.students || []).find(s => s.id === sid()) || {}).name || S.ident.name;
const key = (t, l, i) => `${sid()}|${t}|${l}|${i}`;
function getRec(type, locId, itemId) {
  const id = key(type, locId, itemId);
  let r = S.recs.get(id);
  if (!r) { r = { id, studentId: sid(), type, locId, itemId, data: {}, updatedAt: 0, syncedAt: 0 }; S.recs.set(id, r); }
  return r;
}
const hasText = v => typeof v === 'string' && v.trim().length > 0;
const anyText = (d, ks) => ks.some(k => hasText(d[k]));

/* ---------- 自動儲存 ---------- */
function draftKey(id) { return 'bgx-draft:' + id; }
function writeDraft(rec) { try { const d = { ...rec.data }; delete d.photo; localStorage.setItem(draftKey(rec.id), JSON.stringify({ t: Date.now(), d })); } catch (e) { } }
function setField(rec, k, v) { rec.data[k] = v; writeDraft(rec); S.pending.add(rec.id); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flush, 350); showSave('saving'); }
async function flush() {
  clearTimeout(S.saveTimer);
  const ids = [...S.pending]; if (!ids.length) return true;
  S.pending.clear();
  try {
    for (const id of ids) { const r = S.recs.get(id); r.updatedAt = Date.now(); await recPut(r); try { localStorage.removeItem(draftKey(id)); } catch (e) { } }
    showSave('ok'); scheduleSync(); return true;
  } catch (e) { ids.forEach(i => S.pending.add(i)); showSave('err', e.message); return false; }
}
async function saveNow(rec) { rec.updatedAt = Date.now(); S.recs.set(rec.id, rec); await recPut(rec); showSave('ok'); scheduleSync(); }
let hideT;
function showSave(st, msg) {
  S.saveState = st; const b = $('#savebar'); clearTimeout(hideT);
  if (st === 'saving') b.innerHTML = '<span class="pill mute">儲存中…</span>';
  else if (st === 'ok') { b.innerHTML = `<span class="pill ok">✓ 已儲存在本機 ${hhmm(Date.now())}</span>`; hideT = setTimeout(() => b.classList.add('hide'), 2200); }
  else { b.innerHTML = `<span class="pill err" style="pointer-events:auto" onclick="flush()">✗ 儲存失敗，請點此重試${msg ? '（' + esc(msg) + '）' : ''}</span>`; }
  b.classList.remove('hide');
  updateTopStatus();
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', () => flush());

/* ---------- 同步（Google Apps Script） ---------- */
const pendingSync = () => [...S.recs.values()].filter(r => r.updatedAt && r.updatedAt > (r.syncedAt || 0));
async function serializeRec(r) {
  const o = JSON.parse(JSON.stringify({ ...r, data: { ...r.data, photo: undefined } }));
  if (r.data.photo) { const p = r.data.photo; o.data.photo = { dataUrl: p.dataUrl || await bufToDataURL(p.buf, p.type), type: p.type, w: p.w, h: p.h, size: p.size }; }
  return o;
}
let syncT;
function scheduleSync(ms = 6000) { clearTimeout(syncT); syncT = setTimeout(() => syncNow(false), ms); }
async function syncNow(manual) {
  if (!S.act || !S.ident || !S.act.syncUrl || S.syncing) { updateTopStatus(); return; }
  if (!navigator.onLine && !manual) { updateTopStatus(); return; }
  const list = pendingSync(); if (!list.length) { updateTopStatus(); return; }
  S.syncing = true; S.syncErr = ''; updateTopStatus();
  try {
    for (const r of list) {
      const ver = r.updatedAt;
      const body = JSON.stringify({ action: 'put', activityId: S.act.id, activityTitle: S.act.title, student: { id: sid(), name: stuName(), code: S.ident.code || "" }, record: await serializeRec(r) });
      const res = await fetchT(S.act.syncUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }, 45000);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '伺服器拒絕');
      r.syncedAt = ver; await recPut(r);
    }
    S.lastSync = Date.now();
  } catch (e) { S.syncErr = e.name === 'AbortError' ? '連線逾時' : (e.message || '連線失敗'); }
  S.syncing = false; updateTopStatus();
  if (location.hash === '#backup') renderBackup();
}
addEventListener('online', () => { updateTopStatus(); scheduleSync(1500); });
addEventListener('offline', updateTopStatus);
setInterval(() => { if (pendingSync().length) syncNow(false); }, 60000);

function syncPill() {
  if (!S.act || !S.ident) return '';
  const n = pendingSync().length + S.pending.size;
  if (!S.act.syncUrl) return '<span class="pill mute">僅存本機</span>';
  if (S.syncing) return '<span class="pill info">同步中…</span>';
  if (!n) return S.lastSync || [...S.recs.values()].some(r => r.syncedAt) ? '<span class="pill ok">☁ 已同步完成</span>' : '<span class="pill mute">尚無資料</span>';
  if (S.syncErr && navigator.onLine) return `<span class="pill err">同步失敗・${n} 筆等待</span>`;
  return `<span class="pill warn">等待同步 ${n} 筆</span>`;
}
function updateTopStatus() { const el = $('#topstatus'); if (el) el.innerHTML = syncPill(); }

/* ---------- 版面 ---------- */
function setTop(title, back, extra = '') {
  $('#topbar').innerHTML = `<div class="top"><div class="in">${back !== undefined ? `<button class="back" onclick="go('${back}')">‹ 返回</button>` : ''}
  <div class="title">${esc(title)}</div><span id="topstatus"></span>${extra}</div></div>`;
  updateTopStatus();
}
function go(h) { location.hash = h; }
window.go = go; window.flush = flush;

/* ---------- 啟動 ---------- */
async function loadActivity() {
  let stored = await kvGet('activity'); const pinned = await kvGet('activityPinned');
  if (!pinned) {
    try {
      const r = await fetchT('activity.json?t=' + Date.now(), { cache: 'no-store' }, 5000);
      if (r.ok) { const a = await r.json(); if (a && a.format === 'beigang-activity' && JSON.stringify(a) !== JSON.stringify(stored)) { await kvSet('activity', a); stored = a; } }
    } catch (e) { /* 離線：使用本機活動資料 */ }
  }
  return stored;
}
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW 註冊失敗', e); }
  }
  try { S.act = await loadActivity(); } catch (e) { app().innerHTML = `<div class="card"><h2>無法開啟本機資料庫</h2><p>${esc(e.message)}</p><p>若使用無痕模式，請改用一般模式。</p></div>`; return; }
  S.ident = await kvGet('ident');
  if (S.ident && S.act && (S.ident.activityId !== S.act.id || !(S.ident.studentId.startsWith('c-') || (S.act.students || []).some(s => s.id === S.ident.studentId)))) S.ident = null;
  S.prep = await kvGet('prep');
  if (S.ident) await loadRecs();
  addEventListener('hashchange', route);
  route();
  scheduleSync(3000);
}
async function loadRecs() {
  S.recs.clear(); (await recAll(sid())).forEach(r => S.recs.set(r.id, r));
  // 救回「打字後立刻關閉」時尚未寫入資料庫的文字（同步暫存在 localStorage）
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k || !k.startsWith('bgx-draft:' + sid() + '|')) continue;
      const id = k.slice(10), dr = JSON.parse(localStorage.getItem(k)); const [, type, locId, itemId] = id.split('|');
      let r = S.recs.get(id) || { id, studentId: sid(), type, locId, itemId, data: {}, updatedAt: 0, syncedAt: 0 };
      if (dr.t > r.updatedAt) { Object.assign(r.data, dr.d); S.recs.set(id, r); S.pending.add(id); } else localStorage.removeItem(k);
    }
    if (S.pending.size) await flush();
  } catch (e) { console.warn(e); }
}
const app = () => $('#app');

async function route() {
  await flush(); freeURLs(); scrollTo(0, 0);
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('teacher')) return renderTeacher(h);
  if (!S.act) { setTop('北港文化探索'); app().innerHTML = `<div class="card"><h2>第一次使用需要網路</h2><p>請先連上網路並重新整理，系統會下載活動資料。</p><button class="btn primary" onclick="location.reload()">重新整理</button></div>`; return; }
  if (!S.ident) return renderLogin();
  if (h === 'prep') return renderPrep();
  if (h === 'mission' || h.startsWith('mission/')) return renderMission(h.split('/')[1]);
  if (h.startsWith('loc/')) { const [, id, tab] = h.split('/'); return renderLoc(id, tab || 'hunt'); }
  if (h === 'synth') return renderSynth();
  if (h === 'book') return renderBookView();
  if (h === 'backup') return renderBackup();
  return renderHome();
}

/* ---------- 登入 ---------- */
function renderLogin() {
  setTop(S.act.title);
  const iosWarn = isIOS && !isStandalone();
  app().innerHTML = `
  <div class="hero"><div style="font-size:54px">🧭</div><h1>${esc(S.act.title)}</h1><p class="muted">${esc(S.act.intro || '')}</p></div>
  ${iosWarn ? `<div class="card hl"><h3>⚠️ iPad 請先「加入主畫面」再登入</h3>
   <p>iPad 的 Safari 與主畫面 App 資料是分開的，而且 Safari 可能清除長時間未開啟的網站資料。</p>
   <ol><li>點 Safari 上方的「分享」按鈕 <b>⎙</b></li><li>選「加入主畫面」→「加入」</li><li>關掉 Safari，從主畫面的「文化探索」圖示開啟，再登入</li></ol>
   <p class="muted small">（教師測試可直接在下方登入）</p></div>` : ''}
  <div class="card"><h2>學生登入</h2>
   <div id="recent"></div>
   <label class="field" for="code">我的代碼 <span class="muted small">（老師給的或自己取的，3–20 個英文字母或數字）</span></label>
   <input id="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 BG01" style="font-size:22px;letter-spacing:.1em">
   <label class="field" for="lname">我的名字 <span class="muted small">（第一次使用才需要填，會印在手冊上）</span></label>
   <input id="lname" type="text" autocomplete="off" maxlength="20" placeholder="例如 王小明">
   <p id="lerr" class="hint" style="color:var(--err)"></p>
   <button class="btn primary block" id="lbtn">進入我的探索</button></div>
  <p class="muted small" style="text-align:center">資料跟著代碼存：下次輸入同一個代碼，就會回到你的紀錄。<br>請記住自己的代碼，不要告訴別人。<br><a href="#teacher">教師入口</a></p>`;
  kvGet('profiles').then(P => {
    const list = Object.values(P || {}).filter(p => p.activityId === S.act.id).sort((a, b) => b.at - a.at);
    if (!list.length) return;
    $('#recent').innerHTML = `<p class="muted small" style="margin:0 0 6px">這台平板用過的代碼：</p><div class="row" style="flex-wrap:wrap;margin-bottom:8px">${list.map(p => `<button class="btn sm" data-code="${esc(p.code)}">${esc(p.name)}（${esc(p.code)}）</button>`).join('')}</div>`;
    $$('[data-code]', $('#recent')).forEach(b => b.onclick = () => { $('#code').value = b.dataset.code; doLogin(); });
  }).catch(() => { });
  const doLogin = async () => {
    const code = normCode($('#code').value); if (!code) return;
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) { $('#lerr').textContent = '代碼格式不正確：請用 3–20 個英文字母、數字或「-」。'; return; }
    const h = await codeHash(S.act, code);
    const st = (S.act.students || []).find(s => s.codeHash === h);
    const id = st ? st.id : 'c-' + h.slice(0, 16);
    const P = (await kvGet('profiles')) || {};
    let name = st ? st.name : (P[id] && P[id].name);
    if (!name) {
      const n = $('#lname').value.trim();
      if (!n) { $('#lerr').textContent = `「${code}」是新的代碼。請在「我的名字」填上名字，再按一次。（如果你用過別的代碼，請確認沒有打錯）`; $('#lname').focus(); return; }
      name = n;
    }
    S.ident = { activityId: S.act.id, studentId: id, name, code, at: Date.now() };
    try { P[id] = { activityId: S.act.id, code, name, at: Date.now() }; await kvSet('profiles', P); await kvSet('ident', S.ident); } catch (e) { $('#lerr').textContent = '無法寫入本機儲存：' + e.message; S.ident = null; return; }
    await loadRecs();
    go(S.prep && S.prep.ok && S.prep.v === S.act.version ? '' : 'prep'); route();
  };
  $('#lbtn').onclick = doLogin; $('#code').onkeydown = $('#lname').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
}
const normCode = s => String(s || '').replace(/\s+/g, '').toUpperCase();

/* ---------- 離線準備檢查 ---------- */
async function runPrepChecks() {
  const items = [];
  const add = (ok, label, detail = '', required = true) => items.push({ ok, label, detail, required });
  const wasReady = S.prep && S.prep.ok && S.prep.v === S.act.version;
  add(navigator.onLine, '目前有網路（第一次準備時需要）', navigator.onLine ? '' : (wasReady ? '目前離線：之前已完成準備，離線使用沒有問題' : '請先連上網路再按「重新檢查」'), !wasReady);
  let swOk = false;
  if ('serviceWorker' in navigator) {
    try { const reg = await navigator.serviceWorker.ready; swOk = !!(reg.active); } catch (e) { }
    if (swOk && !navigator.serviceWorker.controller) { await sleep(800); }
    swOk = swOk && !!navigator.serviceWorker.controller;
  }
  add(swOk, '離線程式已安裝並接管頁面', swOk ? '' : '請按「重新檢查」；若仍失敗，關閉 App 後重新開啟再檢查一次');
  let missing = [];
  if ('caches' in window) { for (const a of ASSETS) { if (!(await caches.match(a, { ignoreSearch: true }))) missing.push(a); } } else missing = ['不支援快取'];
  if (missing.length && swOk) { // 嘗試補抓
    try { const c = await caches.open((await caches.keys()).find(k => k.startsWith('bgx-')) || 'bgx-v1'); await c.addAll(missing); missing = []; for (const a of ASSETS) if (!(await caches.match(a, { ignoreSearch: true }))) missing.push(a); } catch (e) { }
  }
  add(!missing.length, `程式與活動檔已下載到平板（${ASSETS.length - missing.length}/${ASSETS.length}）`, missing.length ? '缺少：' + missing.join('、') : '');
  const stored = await kvGet('activity');
  add(!!stored && stored.id === S.act.id, `活動資料已存入本機（${S.act.locations.length} 個地點、${S.act.locations.reduce((n, l) => n + l.clues.length, 0)} 條線索）`);
  let wOk = false, wErr = '';
  try {
    const test = { id: '__test__', studentId: '__test__', data: { buf: new Uint8Array(200000).buffer }, updatedAt: Date.now() };
    await recPut(test); const back = await recGet('__test__'); wOk = back && back.data.buf.byteLength === 200000;
    const d = await db(); const t = d.transaction('records', 'readwrite'); t.objectStore('records').delete('__test__'); await done(t);
  } catch (e) { wErr = e.message; }
  add(wOk, '照片與文字可寫入本機並讀回', wErr);
  let persisted = false; try { persisted = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { }
  let est = ''; try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `可用空間約 ${Math.round((e.quota - e.usage) / 1048576)} MB`; } } catch (e) { }
  add(true, '儲存空間', `${est}${persisted ? '・已設為永久保存' : '・瀏覽器未承諾永久保存（正常現象，請勿清除瀏覽器資料）'}`, false);
  if (isIOS) add(isStandalone(), '從主畫面圖示開啟（iPad 必要）', isStandalone() ? '' : '請先「分享 → 加入主畫面」，從圖示開啟後重新登入並準備');
  const ok = items.filter(i => i.required).every(i => i.ok);
  return { ok, items };
}
async function renderPrep() {
  setTop('離線準備', '');
  app().innerHTML = `<div class="card"><h2>出發前的離線準備</h2><p class="muted">系統會實際檢查每一項，全部通過才算準備完成。</p><div id="chk"><p>檢查中…</p></div></div>`;
  const r = await runPrepChecks();
  if (r.ok) { S.prep = { ok: true, at: Date.now(), v: S.act.version }; await kvSet('prep', S.prep); }
  $('#chk').innerHTML = `<ul class="checklist">${r.items.map(i => `<li><span class="ic" style="color:${i.ok ? 'var(--ok)' : i.required ? 'var(--err)' : 'var(--warn)'}">${i.ok ? '✓' : i.required ? '✗' : '!'}</span><div><b>${esc(i.label)}</b>${i.detail ? `<div class="hint">${esc(i.detail)}</div>` : ''}</div></li>`).join('')}</ul>
   <div style="margin:16px 0;text-align:center">${r.ok ? '<div class="bigok">✓ 已準備好離線使用</div><p class="muted">可以開啟飛航模式測試：關閉 App 再重新開啟，應該仍能看到所有地點。</p>' : '<div class="bigwarn">尚未準備完成</div>'}</div>
   <div class="row"><button class="btn grow" onclick="renderPrep()">重新檢查</button><button class="btn primary grow" onclick="go('')">${r.ok ? '開始探索' : '先進入首頁'}</button></div>
   ${isIOS && !isStandalone() ? `<p class="hint" style="margin-top:10px"><a href="javascript:void(0)" id="iosok">教師測試：略過主畫面檢查</a></p>` : ''}`;
  const o = $('#iosok'); if (o) o.onclick = async () => { if (r.items.filter(i => i.required && !i.label.includes('主畫面')).every(i => i.ok)) { S.prep = { ok: true, at: Date.now(), v: S.act.version, iosSafari: true }; await kvSet('prep', S.prep); go(''); } else alert('其他項目尚未通過'); };
}
window.renderPrep = renderPrep;

/* ---------- 進度計算 ---------- */
function locStatus(loc) {
  const clues = loc.clues.map(c => getRec('clue', loc.id, c.id));
  const found = clues.filter(r => r.data.photo).length;
  const g = getRec('guide', loc.id, 'main').data, d = getRec('disc', loc.id, 'main').data;
  const guide = Object.keys(g).some(k => hasText(g[k])), disc = Object.keys(d).some(k => hasText(d[k]));
  const total = loc.clues.length + 2, got = found + (guide ? 1 : 0) + (disc ? 1 : 0);
  return { found, nClues: loc.clues.length, guide, disc, got, total, state: got === 0 ? 'none' : got === total ? 'done' : 'part' };
}
const SYN_KEYS = ['same', 'diff', 'evidence1', 'evidence2', 'why', 'element', 'idea', 'reflection'];
function overall() {
  let got = 0, total = 0; S.act.locations.forEach(l => { const s = locStatus(l); got += s.got; total += s.total; });
  const sd = getRec('synth', 'all', 'main').data; const sg = ['same', 'evidence1', 'idea'].filter(k => hasText(sd[k])).length;
  return { got: got + sg, total: total + 3 };
}

/* ---------- 首頁 ---------- */
function mapHTML() {
  const L = S.act.locations;
  const markers = L.map((l, i) => { if (S.act.mapImage && l.x == null) return ''; const s = locStatus(l); return `<button class="marker ${s.state === 'done' ? 'done' : s.state === 'part' ? 'part' : ''}" style="left:${l.x ?? 20 + i * 20}%;top:${l.y ?? 50}%" onclick="go('loc/${l.id}')"><div class="pin"><b>${s.state === 'done' ? '✓' : i + 1}</b></div><span class="lbl">${esc(l.name)}</span></button>`; }).join('');
  if (S.act.mapImage) {
    const off = L.filter(l => l.x == null);
    return `<div class="map map-img"><img src="${esc(S.act.mapImage)}" alt="北港街區走讀地圖">${markers}</div>
    ${off.length ? `<p class="muted small mapnote">📍 ${off.map(l => esc(l.name)).join('、')}：${esc(off[0].mapNote || '地圖位置確認中')}，請從下方地點清單進入。</p>` : ''}
    ${S.act.mapCredit ? `<p class="muted small mapnote">${esc(S.act.mapCredit)}</p>` : ''}`;
  }
  const pts = L.map(l => `${(l.x ?? 50) * 8},${(l.y ?? 50) * 5}`).join(' ');
  return `<div class="map"><svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
   <defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#e2d2ad" stroke-width="1"/></pattern></defs>
   <rect width="800" height="500" fill="#f3e7c9"/><rect width="800" height="500" fill="url(#g)"/>
   <path d="M-10 120 C150 90 260 170 380 140 S620 60 810 110" fill="none" stroke="#9cc3c0" stroke-width="26" stroke-linecap="round" opacity=".7"/>
   <polyline points="${pts}" fill="none" stroke="#a33a22" stroke-width="3" stroke-dasharray="8 8" opacity=".55"/>
   <g transform="translate(720 420)" font-family="serif" fill="#6b5440"><circle r="34" fill="#fffaf0" stroke="#6b5440" stroke-width="2"/><path d="M0 -28 L7 0 L0 28 L-7 0Z" fill="#a33a22"/><text y="-38" text-anchor="middle" font-size="16">北</text></g>
   <text x="20" y="485" font-size="15" fill="#8a7458">示意圖・非實際比例</text></svg>${markers}</div>`;
}
function renderHome() {
  setTop(S.act.title);
  const o = overall(), pct = Math.round(o.got / o.total * 100);
  const prepOk = S.prep && S.prep.ok && S.prep.v === S.act.version;
  app().innerHTML = `
  <div class="hero"><h1>${esc(S.act.title)}</h1><div class="who">探索者：<b>${esc(stuName())}</b>　<span class="muted">${esc(S.act.date)}</span></div></div>
  ${missionCard()}
  <div class="card"><div class="row"><b>探索進度</b><span class="grow"></span><b>${pct}%</b></div><div class="progress" style="margin-top:6px"><i style="width:${pct}%"></i></div>
   <div class="row" style="margin-top:10px">${prepOk ? '<span class="pill ok">✓ 離線已就緒</span>' : '<a class="pill warn" href="#prep">⚠ 尚未完成離線準備，點此檢查</a>'}
   <span class="pill ok">文字與照片自動存在本機</span></div></div>
  ${mapHTML()}
  <h2 style="margin-top:18px">必訪地點 <span class="muted small">（不用照順序，想去哪就點哪）</span></h2>
  <div class="locs">${S.act.locations.map((l, i) => { const s = locStatus(l); return `<button class="loc" onclick="go('loc/${l.id}')"><h3><span class="num" style="${s.state === 'done' ? 'background:var(--ok)' : s.state === 'part' ? 'background:var(--gold)' : ''}">${s.state === 'done' ? '✓' : i + 1}</span>${esc(l.name)}</h3>
    ${l.subtitle ? `<div class="muted small">${esc(l.subtitle)}</div>` : ''}
    <div class="chips"><span class="chip ${s.found === s.nClues && s.nClues ? 'ok' : ''}">🔍 尋寶 ${s.found}/${s.nClues}</span><span class="chip ${s.guide ? 'ok' : ''}">🎧 導覽紀錄 ${s.guide ? '✓' : '—'}</span><span class="chip ${s.disc ? 'ok' : ''}">💡 我的發現 ${s.disc ? '✓' : '—'}</span></div></button>`; }).join('')}</div>
  <h2 style="margin-top:22px">走讀之後</h2>
  <div class="bigrow"><button class="btn teal" onclick="go('synth')">🧠 統整任務</button><button class="btn primary" onclick="go('book')">📖 我的探索手冊</button><button class="btn" onclick="go('backup')">💾 備份與同步</button></div>
  <p class="muted small" style="text-align:center;margin-top:24px">v${APP_VER}・<a href="#prep">離線檢查</a></p>`;
}

/* ---------- 任務說明（出發前約 10 分鐘） ---------- */
function missionDone() { const m = S.act.mission; if (!m) return false; const d = getRec('mission', 'all', 'main').data; return (m.prompts || []).some(([k]) => hasText(d[k])); }
function missionCard() {
  const m = S.act.mission; if (!m) return '';
  const ok = missionDone();
  return `<button class="mission-entry ${ok ? 'ok' : ''}" onclick="go('mission')"><h3>📜 任務說明 <span class="muted small">（出發前，約 ${m.minutes || 10} 分鐘）</span></h3>
   <div class="muted small">${ok ? '✓ 已讀過，想複習可以再點進來' : '先認識四個地點，知道到現場要看什麼'}</div></button>`;
}
function renderMission(focus) {
  const m = S.act.mission; if (!m) return go('');
  setTop('任務說明', focus ? `loc/${focus}` : '');
  const L = S.act.locations.filter(l => l.brief);
  const mins = L.length ? Math.max(1, Math.round(((m.minutes || 10) - 2) / L.length)) : 0;
  const sec = (n, t, min) => `<h2 class="mhead"><span class="mstep">${n}</span>${t}${min ? `<span class="muted small">　約 ${min} 分鐘</span>` : ''}</h2>`;
  const src = list => (list && list.length) ? `<details class="msrc"><summary>資料來源</summary><ul>${list.map(s => `<li>${esc(s.title)}${s.url ? `<br><span class="small muted">${esc(s.url)}</span>` : ''}</li>`).join('')}</ul></details>` : '';
  app().innerHTML = `
  <div class="card hl">${sec(1, '今天的任務', 1)}<p>${esc(m.goal)}</p><p>${esc(m.town)}</p></div>
  ${sec(2, '認識四個地點', mins * L.length)}
  ${L.map(l => { const b = l.brief, i = S.act.locations.indexOf(l); return `<div class="card mloc" id="m-${l.id}">
    <h3><span class="num">${i + 1}</span>${esc(l.name)}<span class="muted small">　約 ${mins} 分鐘</span></h3>
    <p class="mlead">${esc(b.lead)}</p>
    ${b.facts && b.facts.length ? `<div class="mlabel">📖 小知識</div><ul>${b.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${b.lookFor && b.lookFor.length ? `<div class="mlabel">👀 到現場找找看</div><ul>${b.lookFor.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${b.think ? `<div class="mthink">🤔 想一想：${esc(b.think)}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn sm" onclick="go('loc/${l.id}')">到這個地點的任務 ›</button><span class="grow"></span>${src(b.sources)}</div></div>`; }).join('')}
  <div class="card">${sec(3, '怎麼記錄', 0)}<ul>${(m.howto || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
  <div class="card" id="mprompts">${sec(4, '出發前想一想', 1)}<p class="muted">寫一兩句就好，會放進你的探索手冊。</p>
   ${(m.prompts || []).map(([k, q, ph]) => `<label class="field">${esc(q)}</label><textarea data-f="${esc(k)}" rows="2" placeholder="${esc(ph || '')}"></textarea>`).join('')}</div>
  <button class="btn primary block" onclick="go('')">準備好了，開始探索 ›</button>
  ${m.reviewed ? '' : '<p class="muted small" style="text-align:center;margin-top:14px">介紹內容整理自公開資料，老師確認中。</p>'}`;
  bindText($('#mprompts'), getRec('mission', 'all', 'main'));
  if (focus) { const el = $('#m-' + CSS.escape(focus)); if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'start' }); } }
}

/* ---------- 地點頁 ---------- */
function renderLoc(id, tab) {
  const loc = S.act.locations.find(l => l.id === id); if (!loc) return go('');
  const s = locStatus(loc);
  setTop(loc.name, '');
  const T = (k, label) => `<button class="tab ${tab === k ? 'on' : ''}" onclick="go('loc/${id}/${k}')">${label}</button>`;
  app().innerHTML = `${loc.brief ? `<button class="btn sm ghost" style="margin:10px 0 0" onclick="go('mission/${id}')">📜 認識這裡（任務說明）</button>` : ''}<div class="tabs">${T('hunt', `🔍 尋寶 ${s.found}/${s.nClues}`)}${T('guide', '🎧 導覽紀錄')}${T('disc', '💡 我的發現')}</div><div id="pane"></div>`;
  const pane = $('#pane');
  if (tab === 'hunt') renderHunt(loc, pane);
  else if (tab === 'guide') renderGuide(loc, pane);
  else renderDisc(loc, pane);
}
function bindText(root, rec) {
  $$('[data-f]', root).forEach(el => { el.value = rec.data[el.dataset.f] || ''; el.addEventListener('input', () => setField(rec, el.dataset.f, el.value)); el.addEventListener('blur', flush); });
}
/* 分區平面圖：點分區 → 顯示該區的尋寶線索（線索可設 zone；尚無分區題時顯示全部） */
function planHTML(loc) {
  const p = loc.plan; if (!p) return '';
  const sel = S.zone && S.zone.loc === loc.id ? S.zone.id : null;
  const z = p.zones.find(z => z.id === sel);
  const boxes = p.zones.map(z => { const [x1, y1, x2, y2] = z.rect; return `<button class="zone ${z.id === sel ? 'on' : ''}" data-zone="${esc(z.id)}" aria-label="${esc(z.name)}" style="left:${x1}%;top:${y1}%;width:${x2 - x1}%;height:${y2 - y1}%"><span class="zbadge" id="zb-${esc(z.id)}">${zoneBadge(loc, z.id)}</span></button>`; }).join('');
  const nSel = z ? loc.clues.filter(c => c.zone === z.id).length : 0;
  return `<div class="card plan"><div class="row"><b>🗺️ ${esc(loc.name)}分區平面圖</b><span class="grow"></span>${sel ? '<button class="btn sm ghost" data-zone="">看全部</button>' : ''}</div>
   <p class="muted small" style="margin:4px 0 8px">點一個分區，看看那裡有哪些尋寶線索。入口在圖的下方。</p>
   <div class="planimg"><img src="${esc(p.image)}" alt="${esc(loc.name)}分區平面示意圖">${boxes}</div>
   ${z ? `<div class="zonepick">📍 你選了：<b>${esc(z.name)}</b>${nSel ? `　<span class="muted small">這一區有 ${nSel} 條線索，往下看 ↓</span>` : ''}</div>` : ''}
   ${p.pending && p.pending.length ? `<details class="small muted" style="margin-top:8px"><summary>還在確認位置的區域（${p.pending.length}）</summary>${p.pending.map(esc).join('、')}<br>這些地方圖上還沒畫，可以問導覽員在哪裡。</details>` : ''}
   ${p.credit ? `<p class="muted small" style="margin:6px 0 0">${esc(p.credit)}</p>` : ''}</div>`;
}
function zoneBadge(loc, zid) {
  const cs = loc.clues.filter(c => c.zone === zid); if (!cs.length) return '';
  const f = cs.filter(c => getRec('clue', loc.id, c.id).data.photo).length;
  return f === cs.length ? '✓' : `${f}/${cs.length}`;
}
function renderHunt(loc, pane) {
  const sel = loc.plan && S.zone && S.zone.loc === loc.id ? S.zone.id : null;
  const zoned = loc.clues.some(c => c.zone);
  const show = sel && zoned ? loc.clues.filter(c => c.zone === sel) : loc.clues;
  const note = sel ? (!zoned || !show.length ? `<p class="muted small zonemsg">這一區的尋寶題老師還在準備，下面先列出全部線索。</p>` : '') : '';
  const list = sel && zoned && show.length ? show : loc.clues;
  pane.innerHTML = planHTML(loc) + note + list.map((c, i) => `<div class="card clue" id="clue-${c.id}"></div>`).join('') +
    `<p class="muted small" style="text-align:center">找不到也沒關係，可以先跳過，稍後再回來。</p>`;
  list.forEach(c => drawClue(loc, c, loc.clues.indexOf(c)));
  $$('[data-zone]', pane).forEach(b => b.onclick = () => { S.zone = b.dataset.zone ? { loc: loc.id, id: b.dataset.zone } : null; renderHunt(loc, pane); });
}
function drawClue(loc, c, i) {
  const box = $('#clue-' + c.id); if (!box) return;
  const rec = getRec('clue', loc.id, c.id), ph = rec.data.photo;
  const zn = c.zone && loc.plan ? (loc.plan.zones.find(z => z.id === c.zone) || {}).name : '';
  const zb = c.zone && $('#zb-' + CSS.escape(c.zone)); if (zb) zb.textContent = zoneBadge(loc, c.zone);
  box.innerHTML = `<h3><span class="no">線索 ${i + 1}</span>${zn ? `<span class="pill zonetag">📍 ${esc(zn)}</span>` : ''}　${rec.data.photo ? '<span class="pill ok">已找到</span>' : rec.data.skipped ? '<span class="pill mute">稍後再找</span>' : ''}</h3>
   <p style="font-size:18px">${esc(c.text)}</p>
   ${c.hint ? `<details class="hintbox"><summary>需要提示嗎？</summary><p>${esc(c.hint)}</p></details>` : ''}
   <div class="photo">${ph ? `<img src="${photoURL(ph)}" alt="線索${i + 1}照片"><div class="photostatus" style="color:var(--ok)">✓ 照片已儲存在本機（${Math.round(ph.size / 1024)} KB）</div>` : '<div class="empty">還沒有照片</div>'}</div>
   <div class="row"><label class="btn primary grow">📷 ${ph ? '重拍' : '拍照'}<input type="file" accept="image/*" capture="environment" data-k="cam"></label>
   <label class="btn grow">🖼 ${ph ? '重新選擇' : '從相簿選'}<input type="file" accept="image/*" data-k="pick"></label></div>
   <div class="photostatus" id="ps-${c.id}"></div>
   <label class="field">我為什麼認為是它？<span class="muted small">（選填）</span></label>
   <textarea data-f="reason" rows="2" placeholder="寫幾個關鍵字就好"></textarea>
   ${!ph ? `<button class="btn ghost sm" style="margin-top:8px" data-k="skip">${rec.data.skipped ? '↺ 取消跳過' : '⏭ 先跳過，稍後再找'}</button>` : ''}`;
  bindText(box, rec);
  $$('input[type=file]', box).forEach(inp => inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const st = $('#ps-' + c.id); st.style.color = 'var(--ink2)'; st.textContent = '處理照片中…';
    try {
      const p = await compressImage(f); rec.data.photo = p; rec.data.skipped = false;
      await flush(); await saveNow(rec);
      const back = await recGet(rec.id);
      if (!back || !back.data.photo || back.data.photo.buf.byteLength !== p.buf.byteLength) throw new Error('讀回檢查失敗');
      drawClue(loc, c, i);
    } catch (e) { st.style.color = 'var(--err)'; st.textContent = '✗ 儲存失敗，請重試：' + e.message; }
    inp.value = '';
  });
  const sk = $('[data-k=skip]', box); if (sk) sk.onclick = async () => { rec.data.skipped = !rec.data.skipped; await saveNow(rec); drawClue(loc, c, i); };
}
function renderGuide(loc, pane) {
  const rec = getRec('guide', loc.id, 'main');
  pane.innerHTML = `<div class="card"><p class="muted">🎧 專心聽導覽，先記<b>關鍵字</b>就好，回去再補充。</p>
   ${(loc.guide || []).map((q, i) => `<label class="field">${esc(q)}</label><textarea data-f="q${i}" rows="3"></textarea>`).join('')}
   <label class="field">自由筆記</label><textarea data-f="notes" rows="4" placeholder="人名、年代、數字、有趣的詞…"></textarea></div>`;
  bindText(pane, rec);
}
const DISC = [['observe', '我自己觀察到什麼？', '我看到、聽到、聞到…'], ['curious', '有什麼讓我好奇？', ''], ['question', '我想提出的問題', '為什麼…？如果…會怎樣？'], ['guess', '我的初步推測', '我猜…因為…']];
function renderDisc(loc, pane) {
  const rec = getRec('disc', loc.id, 'main');
  pane.innerHTML = `<div class="card"><p class="muted">💡 這裡寫的是<b>你自己</b>的發現，不一定要每格都寫。</p>
   ${DISC.map(([k, q, ph]) => `<label class="field">${q}</label><textarea data-f="${k}" rows="3" placeholder="${esc(ph)}"></textarea>`).join('')}</div>`;
  bindText(pane, rec);
}

/* ---------- 統整任務 ---------- */
function synthDef() {
  return Object.assign({
    analysis: '比較兩個不同走讀地點的文化特色，找出共同點與差異。',
    evaluation: '如果只能向第一次來北港的人推薦一個文化地點，你會選哪裡？請用至少兩項實際觀察或導覽資訊支持你的選擇。',
    creation: '選擇今天發現的文化元素，設計一項能讓其他國小學生認識北港的活動、作品或介紹方式。',
    reflection: '今天的走讀，我學到最重要的一件事是什麼？我還想繼續探究什麼？'
  }, S.act.synthesis || {});
}
function renderSynth() {
  setTop('統整任務', '');
  const rec = getRec('synth', 'all', 'main'), D = synthDef(), L = S.act.locations;
  const opts = sel => `<option value="">— 選擇地點 —</option>` + L.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  app().innerHTML = `<p class="muted">可以先回去看看自己在各地點的照片和筆記，再回答。所有文字都是你自己的想法，會自動保存。</p>
  <div class="card"><h2>一、分析　<span class="muted small">比較</span></h2><p>${esc(D.analysis)}</p>
   <div class="row"><select data-f="locA" class="grow">${opts()}</select><b>和</b><select data-f="locB" class="grow">${opts()}</select></div>
   <label class="field">共同點</label><textarea data-f="same" rows="3"></textarea>
   <label class="field">差異</label><textarea data-f="diff" rows="3"></textarea></div>
  <div class="card"><h2>二、評鑑　<span class="muted small">推薦</span></h2><p>${esc(D.evaluation)}</p>
   <label class="field">我推薦</label><select data-f="choice">${opts()}</select>
   <label class="field">證據 1（我觀察到的或導覽員說的）</label><textarea data-f="evidence1" rows="2"></textarea>
   <label class="field">證據 2</label><textarea data-f="evidence2" rows="2"></textarea>
   <label class="field">所以我認為…</label><textarea data-f="why" rows="3"></textarea></div>
  <div class="card"><h2>三、創造　<span class="muted small">設計</span></h2><p>${esc(D.creation)}</p>
   <label class="field">我選的文化元素</label><input type="text" data-f="element">
   <label class="field">我的構想（名稱、怎麼進行、需要什麼）</label><textarea data-f="idea" rows="5"></textarea></div>
  <div class="card"><h2>學習反思</h2><p>${esc(D.reflection)}</p><textarea data-f="reflection" rows="4"></textarea></div>
  <button class="btn primary block" onclick="go('book')">📖 看看我的探索手冊</button>`;
  $$('[data-f]', app()).forEach(el => { el.value = rec.data[el.dataset.f] || ''; const ev = el.tagName === 'SELECT' ? 'change' : 'input'; el.addEventListener(ev, () => setField(rec, el.dataset.f, el.value)); el.addEventListener('blur', flush); });
}

/* ---------- 探索手冊（學生與教師共用） ---------- */
function bookHTML(act, name, recOf) {
  const A = (v) => hasText(v) ? `<div class="a">${esc(v)}</div>` : `<div class="a empty">（未填寫）</div>`;
  const locName = id => (act.locations.find(l => l.id === id) || {}).name || '（未選擇）';
  let h = `<div class="book"><section class="page cover"><div class="t2">文 化 走 讀 探 索 手 冊</div><div class="t1">${esc(act.title)}</div><div class="compass">✦</div>
    <div class="who">探索者　${esc(name)}</div><div class="date">走讀日期　${esc(act.date)}</div></section>`;
  if (act.mission && (act.mission.prompts || []).length) {
    const md = recOf('mission', 'all', 'main').data;
    h += `<section class="page"><h2>出發前的想法</h2>${act.mission.prompts.map(([k, q]) => `<div class="q">${esc(q)}</div>${A(md[k])}`).join('')}</section>`;
  }
  act.locations.forEach((l, i) => {
    const g = recOf('guide', l.id, 'main').data, d = recOf('disc', l.id, 'main').data;
    h += `<section class="page"><h2>地點 ${i + 1}｜${esc(l.name)}</h2><h3>🔍 尋寶紀錄</h3>`;
    l.clues.forEach((c, j) => { const r = recOf('clue', l.id, c.id).data;
      h += `<div class="clueblk"><div class="cluetxt"><b>線索 ${j + 1}：</b>${esc(c.text)}</div>${r.photo ? `<img src="${photoURL(r.photo)}" alt="">` : `<div class="noimg">${r.skipped ? '這條線索暫時跳過' : '尚未拍照'}</div>`}${hasText(r.reason) ? `<div class="q">我的判斷理由</div>${A(r.reason)}` : ''}</div>`; });
    h += `<h3>🎧 導覽紀錄</h3>${(l.guide || []).map((q, k) => `<div class="q">${esc(q)}</div>${A(g['q' + k])}`).join('')}<div class="q">自由筆記</div>${A(g.notes)}
      <h3>💡 我的發現與疑問</h3>${DISC.map(([k, q]) => `<div class="q">${q}</div>${A(d[k])}`).join('')}</section>`;
  });
  const s = recOf('synth', 'all', 'main').data, D = synthDef.call(null);
  h += `<section class="page"><h2>統整與創造</h2>
    <h3>一、跨地點分析：${esc(locName(s.locA))} × ${esc(locName(s.locB))}</h3><div class="q">共同點</div>${A(s.same)}<div class="q">差異</div>${A(s.diff)}
    <h3>二、文化特色評鑑：我推薦「${esc(locName(s.choice))}」</h3><div class="q">證據 1</div>${A(s.evidence1)}<div class="q">證據 2</div>${A(s.evidence2)}<div class="q">所以我認為</div>${A(s.why)}
    <h3>三、創意構想${hasText(s.element) ? '：' + esc(s.element) : ''}</h3>${A(s.idea)}
    <h3>學習反思</h3>${A(s.reflection)}
    <div class="foot">本手冊內容皆為探索者本人原始紀錄，未經改寫。</div></section></div>`;
  return h;
}
function renderBookView() {
  setTop('我的探索手冊', '');
  app().innerHTML = `<div class="card noprint"><p>手冊會用你目前的紀錄自動排版，<b>沒完成的部分也能先匯出</b>。</p>
   <div class="row"><button class="btn primary grow" id="pdfbtn">📄 下載 PDF</button><button class="btn grow" onclick="window.print()">🖨 列印 / 存成 PDF</button></div>
   <p class="hint" id="pdfmsg">PDF 在平板上直接產生，不需要網路。iPad 會出現分享選單，請選「儲存到檔案」。</p></div>
   <div id="bookwrap">${bookHTML(S.act, stuName(), getRec)}</div>`;
  $('#pdfbtn').onclick = () => makePDF($('#bookwrap'), `${S.act.title}_${stuName()}_探索手冊.pdf`, $('#pdfmsg'), $('#pdfbtn'));
}
function loadScript(src) { return new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('無法載入 ' + src)); document.head.appendChild(s); }); }
async function makePDF(srcWrap, filename, msgEl, btn) {
  const say = t => { if (msgEl) msgEl.textContent = t; };
  btn && (btn.disabled = true);
  try {
    say('準備中…');
    await loadScript('vendor/html2canvas.min.js'); await loadScript('vendor/jspdf.umd.min.js');
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;z-index:-1';
    stage.innerHTML = srcWrap.innerHTML; document.body.appendChild(stage);
    $$('.page', stage).forEach(p => { p.style.margin = '0'; p.style.boxShadow = 'none'; p.style.borderRadius = '0'; p.style.border = p.classList.contains('cover') ? p.style.border : '0'; if (p.classList.contains('cover')) p.style.minHeight = '1040px'; });
    await Promise.all($$('img', stage).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const PW = 210, PH = 297, M = 12, CW = PW - M * 2, CH = PH - M * 2;
    const pages = $$('.page', stage); let first = true;
    for (let i = 0; i < pages.length; i++) {
      say(`排版第 ${i + 1}/${pages.length} 頁…`);
      const cv = await html2canvas(pages[i], { scale: 1.6, backgroundColor: '#fffdf7', useCORS: true, logging: false });
      const pxPerMm = cv.width / CW, sliceH = Math.floor(CH * pxPerMm);
      for (let y = 0; y < cv.height; y += sliceH) {
        const h = Math.min(sliceH, cv.height - y); if (h < 20 && y > 0) break;
        const part = document.createElement('canvas'); part.width = cv.width; part.height = h;
        const ctx = part.getContext('2d'); ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, part.width, h); ctx.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
        if (!first) pdf.addPage(); first = false;
        pdf.addImage(part.toDataURL('image/jpeg', 0.85), 'JPEG', M, M, CW, h / pxPerMm);
        part.width = part.height = 1;
      }
      cv.width = cv.height = 1;
    }
    stage.remove();
    const blob = pdf.output('blob');
    await saveFile(blob, filename, 'application/pdf');
    say(`✓ PDF 已產生（${Math.round(blob.size / 1024)} KB）`);
  } catch (e) { say('✗ PDF 產生失敗：' + e.message + '。可改用「列印 / 存成 PDF」。'); }
  btn && (btn.disabled = false);
}
async function saveFile(blob, filename, type) {
  const file = new File([blob], filename, { type });
  if ((isIOS || /Android/.test(navigator.userAgent)) && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- 備份與同步 ---------- */
async function buildPackage(act, student, recs) {
  return { format: 'beigang-pkg', v: 1, exportedAt: new Date().toISOString(), app: APP_VER,
    activity: { ...act, mapImage: '', students: undefined, teacherPinHash: undefined }, student,
    records: await Promise.all(recs.filter(r => r.updatedAt).map(serializeRec)) };
}
async function renderBackup() {
  setTop('備份與同步', '');
  const n = pendingSync().length, all = [...S.recs.values()].filter(r => r.updatedAt).length;
  let est = ''; try { const e = await navigator.storage.estimate(); est = `本 App 已使用約 ${(e.usage / 1048576).toFixed(1)} MB`; } catch (e) { }
  app().innerHTML = `
  <div class="card"><h2>📍 本機狀態</h2><p><span class="pill ok">已儲存在本機 ${all} 筆紀錄</span> <span class="muted small">${est}</span></p>
   <p class="muted small">「已儲存在本機」代表資料在這台平板上，<b>不代表已上傳</b>。</p></div>
  <div class="card"><h2>☁ 雲端同步</h2>
   ${S.act.syncUrl ? `<p>目前狀態：${syncPill()} ${navigator.onLine ? '' : '<span class="pill mute">目前離線</span>'}</p>
     ${S.syncErr ? `<p class="hint" style="color:var(--err)">上次錯誤：${esc(S.syncErr)}</p>` : ''}
     <p class="muted small">有網路時會自動同步；也可以手動按下方按鈕。</p>
     <button class="btn teal block" id="syncbtn" ${n ? '' : 'disabled'}>${n ? `立即同步 ${n} 筆` : '沒有需要同步的資料'}</button>`
    : '<p class="muted">老師尚未設定雲端同步，請使用下方「匯出資料包」交給老師。</p>'}</div>
  <div class="card"><h2>💾 匯出資料包（不需網路）</h2><p>把你的所有照片與紀錄存成一個檔案，可以用 AirDrop、LINE、USB 傳給老師，也能用來還原。</p>
   <button class="btn primary block" id="expbtn">匯出我的資料包</button><p class="hint" id="expmsg"></p></div>
  <div class="card"><h2>↺ 從資料包還原</h2><p class="muted small">只會還原屬於「${esc(stuName())}」的紀錄，較新的內容優先，不會重複。</p>
   <label class="btn block">選擇資料包檔案<input type="file" accept=".json,application/json" id="impf"></label><p class="hint" id="impmsg"></p></div>
  <div class="card"><h2>其他</h2><div class="row"><button class="btn sm" onclick="go('prep')">重新做離線檢查</button><button class="btn sm ghost" id="logout">登出此平板</button></div></div>`;
  const sb = $('#syncbtn'); if (sb) sb.onclick = async () => { sb.disabled = true; sb.textContent = '同步中…'; await flush(); await syncNow(true); renderBackup(); };
  $('#expbtn').onclick = async () => {
    await flush(); $('#expmsg').textContent = '打包中…';
    try { const pkg = await buildPackage(S.act, { id: sid(), name: stuName(), code: S.ident.code || "" }, [...S.recs.values()]);
      const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
      await saveFile(blob, `北港探索資料包_${stuName()}_${stamp()}.json`, 'application/json');
      await kvSet('lastExport', Date.now()); $('#expmsg').textContent = `✓ 已產生資料包（${(blob.size / 1048576).toFixed(1)} MB，${pkg.records.length} 筆）`;
    } catch (e) { $('#expmsg').textContent = '✗ 匯出失敗：' + e.message; }
  };
  $('#impf').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const pkg = JSON.parse(await f.text());
      if (pkg.format !== 'beigang-pkg' || !pkg.student || pkg.student.id !== sid()) throw new Error('這不是「' + stuName() + '」的資料包');
      let added = 0;
      for (const r of pkg.records) { const cur = S.recs.get(r.id); if (cur && cur.updatedAt >= r.updatedAt) continue;
        if (r.data.photo && r.data.photo.dataUrl) r.data.photo = { buf: dataURLToBuf(r.data.photo.dataUrl), type: r.data.photo.type, w: r.data.photo.w, h: r.data.photo.h, size: r.data.photo.size };
        r.syncedAt = cur ? cur.syncedAt : 0; await recPut(r); S.recs.set(r.id, r); added++; }
      $('#impmsg').textContent = `✓ 還原完成，更新 ${added} 筆。`;
    } catch (err) { $('#impmsg').textContent = '✗ ' + err.message; }
  };
  $('#logout').onclick = async () => {
    if (!confirm('登出後，這台平板上的紀錄仍會保留，重新登入就能看到。確定登出？')) return;
    await flush(); await kvDel('ident'); S.ident = null; S.recs.clear(); go(''); route();
  };
}
window.renderBackup = renderBackup;

/* =================== 教師端 =================== */
let T = { ok: sessionStorage.getItem('bgx-teacher') === '1', draft: null, pkgs: null };
async function renderTeacher(h) {
  if (!S.act) { setTop('教師端'); app().innerHTML = '<div class="card">請先連網載入活動資料。</div>'; return; }
  if (!T.ok) {
    setTop('教師端', '');
    app().innerHTML = `<div class="card"><h2>教師登入</h2><label class="field">教師 PIN 碼</label><input type="password" id="pin" inputmode="numeric"><p class="hint" id="perr" style="color:var(--err)"></p><button class="btn primary block" id="pbtn">進入</button>
     <p class="hint">提醒：此為簡易存取限制，請勿在學生面前輸入 PIN。</p></div>`;
    const f = async () => { if ((await codeHash(S.act, $('#pin').value)) === S.act.teacherPinHash) { T.ok = true; sessionStorage.setItem('bgx-teacher', '1'); renderTeacher(h); } else $('#perr').textContent = 'PIN 不正確'; };
    $('#pbtn').onclick = f; $('#pin').onkeydown = e => e.key === 'Enter' && f(); return;
  }
  const sub = h.split('/')[1] || 'results';
  setTop('教師端', '', `<button class="btn sm ghost" onclick="sessionStorage.removeItem('bgx-teacher');location.hash='';location.reload()">登出</button>`);
  const nav = `<div class="tabs"><button class="tab ${sub === 'results' ? 'on' : ''}" onclick="go('teacher/results')">📊 學生成果</button><button class="tab ${sub === 'edit' ? 'on' : ''}" onclick="go('teacher/edit')">✏️ 活動設定</button></div>`;
  if (sub === 'edit') return renderTEdit(nav);
  if (sub === 'view') return renderTView(h.split('/')[2]);
  return renderTResults(nav);
}
async function tPkgs() { if (!T.pkgs) T.pkgs = (await kvGet('teacherPkgs')) || {}; return T.pkgs; }
async function mergePkg(pkg) {
  const P = await tPkgs(); const id = pkg.student.id;
  const cur = P[id] || { student: pkg.student, activity: pkg.activity, records: [], at: 0 };
  const m = new Map(cur.records.map(r => [r.id, r])); let n = 0;
  pkg.records.forEach(r => { const o = m.get(r.id); if (!o || (r.updatedAt || 0) > (o.updatedAt || 0)) { m.set(r.id, r); n++; } });
  P[id] = { student: pkg.student, activity: pkg.activity || cur.activity, records: [...m.values()], at: Date.now() };
  await kvSet('teacherPkgs', P); return n;
}
function pkgRecOf(pkg) { const m = new Map(pkg.records.map(r => [r.id, r])); return (t, l, i) => m.get(`${pkg.student.id}|${t}|${l}|${i}`) || { data: {} }; }
async function renderTResults(nav) {
  const P = await tPkgs();
  const pre = (S.act.students || []).map(s => ({ id: s.id, name: s.name }));
  const all = [...pre, ...Object.values(P).map(p => p.student).filter(s => s && !pre.some(x => x.id === s.id))];
  const rows = !all.length ? '<tr><td colspan="3" class="muted">還沒有收到任何學生的資料。學生用自己的代碼登入，資料匯入或同步後會出現在這裡。</td></tr>' : all.map(st => { const p = P[st.id];
    if (!p) return `<tr><td><b>${esc(st.name)}</b></td><td colspan="3" class="muted">尚未收到資料</td></tr>`;
    const rof = pkgRecOf(p); const act = S.act;
    const loc = act.locations.map(l => { const f = l.clues.filter(c => rof('clue', l.id, c.id).data.photo).length; return `${esc(l.name)}：${f}/${l.clues.length}`; }).join('<br>');
    const last = Math.max(0, ...p.records.map(r => r.updatedAt || 0));
    return `<tr><td><b>${esc(st.name)}</b>${(p.student && p.student.code) ? `<span class="muted small">（${esc(p.student.code)}）</span>` : ""}<div class="muted small">${p.records.length} 筆・最後更新 ${last ? new Date(last).toLocaleString('zh-TW') : '—'}</div></td><td class="small">${loc}</td><td><button class="btn sm teal" onclick="go('teacher/view/${st.id}')">檢視 / 手冊</button></td></tr>`; }).join('');
  app().innerHTML = nav + `<div class="card"><h2>學生成果</h2><table class="t"><tr><th>學生</th><th>尋寶照片</th><th></th></tr>${rows}</table></div>
   <div class="card"><h2>取得學生資料</h2>
    <p><b>方式一：匯入資料包</b>（學生在「備份與同步」匯出的 .json 檔，可一次選多個，重複匯入不會重複）</p>
    <label class="btn primary block">選擇資料包<input type="file" id="tpk" accept=".json,application/json" multiple></label>
    <p class="hint" id="tmsg"></p><hr class="sep">
    <p><b>方式二：從 Google 雲端下載</b>（需先在「活動設定」填入同步網址）</p>
    <label class="field">雲端讀取密語（Apps Script 裡的 TEACHER_KEY，不會存檔）</label><input type="password" id="tkey">
    <button class="btn teal block" style="margin-top:8px" id="tcloud" ${S.act.syncUrl ? '' : 'disabled'}>從雲端下載成果</button><p class="hint" id="cmsg"></p></div>`;
  $('#tpk').onchange = async e => { let msg = []; for (const f of e.target.files) { try { const p = JSON.parse(await f.text()); if (p.format !== 'beigang-pkg') throw new Error('格式不符'); const n = await mergePkg(p); msg.push(`✓ ${p.student.name}：更新 ${n} 筆`); } catch (err) { msg.push(`✗ ${f.name}：${err.message}`); } } $('#tmsg').innerHTML = msg.map(esc).join('<br>'); setTimeout(() => renderTResults(nav), 1500); };
  $('#tcloud').onclick = async () => {
    $('#cmsg').textContent = '下載中…';
    try { const r = await fetchT(`${S.act.syncUrl}?action=list&activityId=${encodeURIComponent(S.act.id)}&key=${encodeURIComponent($('#tkey').value)}`, {}, 90000); const j = await r.json();
      if (!j.ok) throw new Error(j.error || '失敗');
      let msg = []; for (const s of j.students) { const n = await mergePkg({ student: s.student, records: s.records }); msg.push(`${s.student.name}：${s.records.length} 筆（更新 ${n}）`); }
      $('#cmsg').textContent = '✓ ' + (msg.join('；') || '雲端尚無資料'); setTimeout(() => renderTResults(nav), 1500);
    } catch (e) { $('#cmsg').textContent = '✗ ' + e.message; }
  };
}
async function renderTView(id) {
  const p = (await tPkgs())[id]; if (!p) return go('teacher/results');
  setTop(p.student.name + ' 的手冊', 'teacher/results');
  app().innerHTML = `<div class="card noprint"><div class="row"><button class="btn primary grow" id="tpdf">📄 下載 PDF</button><button class="btn grow" onclick="window.print()">🖨 列印</button>
   <button class="btn grow" id="tjson">💾 下載資料包</button></div><p class="hint" id="tmsg"></p></div><div id="bookwrap">${bookHTML(S.act, p.student.name, pkgRecOf(p))}</div>`;
  $('#tpdf').onclick = () => makePDF($('#bookwrap'), `${S.act.title}_${p.student.name}_探索手冊.pdf`, $('#tmsg'), $('#tpdf'));
  $('#tjson').onclick = () => saveFile(new Blob([JSON.stringify({ format: 'beigang-pkg', v: 1, student: p.student, activity: p.activity, records: p.records })], { type: 'application/json' }), `北港探索資料包_${p.student.name}_${stamp()}.json`, 'application/json');
}

/* ---- 活動設定編輯器 ---- */
const uid = p => p + Math.random().toString(36).slice(2, 7);
function renderTEdit(nav) {
  if (!T.draft) T.draft = JSON.parse(JSON.stringify(S.act));
  const d = T.draft;
  const L = d.locations.map((l, i) => `<div class="locbox" data-li="${i}">
    <div class="row"><b>地點 ${i + 1}</b><span class="grow"></span><button class="btn sm ghost" data-act="up" ${i ? '' : 'disabled'}>↑</button><button class="btn sm ghost" data-act="dellocation">刪除地點</button></div>
    <label class="field">名稱</label><input type="text" data-p="name" value="${esc(l.name)}">
    <label class="field">副標（選填）</label><input type="text" data-p="subtitle" value="${esc(l.subtitle || '')}">
    <div class="row"><label class="grow">地圖位置 X（0–100）<input type="number" min="0" max="100" data-p="x" value="${l.x ?? 50}"></label><label class="grow">Y（0–100）<input type="number" min="0" max="100" data-p="y" value="${l.y ?? 50}"></label></div>
    <h4>尋寶線索</h4>${l.clues.map((c, j) => `<div class="card" data-ci="${j}" style="margin:8px 0;padding:10px"><label class="field" style="margin-top:0">線索 ${j + 1}</label><textarea rows="2" data-c="text">${esc(c.text)}</textarea><label class="field">第二階段提示</label><input type="text" data-c="hint" value="${esc(c.hint || '')}"><button class="btn sm ghost" data-act="delclue" style="margin-top:6px">刪除此線索</button></div>`).join('')}
    <button class="btn sm" data-act="addclue">＋ 新增線索</button>
    <h4>導覽引導問題（1–2 題）</h4>${(l.guide || []).map((q, k) => `<div class="row" data-gi="${k}" style="margin:6px 0"><input type="text" class="grow" data-g="1" value="${esc(q)}"><button class="btn sm ghost" data-act="delq">✕</button></div>`).join('')}
    <button class="btn sm" data-act="addq">＋ 新增問題</button></div>`).join('');
  const Sx = d.students.map((s, i) => `<div class="row" data-si="${i}" style="margin:8px 0"><input type="text" data-s="name" value="${esc(s.name)}" placeholder="姓名或代號" class="grow"><input type="text" data-s="code" placeholder="新登入碼（留空＝不變）" class="grow" autocapitalize="characters"><button class="btn sm ghost" data-act="delstu">✕</button></div>`).join('');
  app().innerHTML = nav + `<div class="tedit">
   <div class="card"><h2>基本資料</h2><label class="field">活動名稱</label><input type="text" id="e-title" value="${esc(d.title)}">
    <label class="field">日期</label><input type="date" id="e-date" value="${esc(d.date)}">
    <label class="field">簡介</label><textarea id="e-intro" rows="2">${esc(d.intro || '')}</textarea>
    <label class="field">活動代碼（換新地區時請改，例如 huwei-2027-03）</label><input type="text" id="e-id" value="${esc(d.id)}"><p class="hint">改代碼後學生需重新登入；同一活動內請勿更改。</p>
    <label class="field">雲端同步網址（Google Apps Script 部署網址，可留空）</label><input type="url" id="e-sync" value="${esc(d.syncUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec">
    <label class="field">新的教師 PIN（留空＝不變）</label><input type="text" id="e-pin">
    <label class="field">地圖圖片（選填，會取代示意圖）</label><div class="row"><label class="btn sm">上傳地圖<input type="file" accept="image/*" id="e-map"></label>${d.mapImage ? '<button class="btn sm ghost" id="e-mapdel">移除地圖</button><span class="pill ok">已設定</span>' : '<span class="muted small">目前使用示意圖</span>'}</div></div>
   <div class="card"><h2>預先設定的學生 <span class="muted small">（選填）</span></h2><p class="muted small">不設定也可以：學生直接輸入自己的代碼與名字就能使用，資料跟著代碼存。這裡只在想「固定代碼對應固定姓名」時才需要設定；登入碼只以雜湊值儲存。</p>${Sx}<button class="btn sm" data-act="addstu">＋ 新增學生</button></div>
   <div class="card"><h2>地點與任務</h2>${L}<button class="btn" data-act="addloc">＋ 新增地點</button></div>
   <div class="card hl"><h2>儲存</h2><p class="muted small">「下載 activity.json」後，用它取代網站上的同名檔案，學生下次連網開啟就會更新。「只套用到這台裝置」適合先預覽。</p>
    <div class="row"><button class="btn primary grow" id="e-dl">下載 activity.json</button><button class="btn grow" id="e-apply">只套用到這台裝置</button></div>
    <div class="row" style="margin-top:8px"><label class="btn sm ghost">匯入 activity.json<input type="file" accept=".json" id="e-imp"></label><button class="btn sm ghost" id="e-reset">捨棄修改</button><button class="btn sm ghost" id="e-unpin">恢復使用網站版本</button></div><p class="hint" id="e-msg"></p></div></div>`;
  const root = app();
  const bind = (sel, fn) => { const el = $(sel, root); if (el) el.addEventListener('input', () => fn(el.value)); };
  bind('#e-title', v => d.title = v); bind('#e-date', v => d.date = v); bind('#e-intro', v => d.intro = v); bind('#e-id', v => d.id = v.trim()); bind('#e-sync', v => d.syncUrl = v.trim());
  $$('[data-li]', root).forEach(box => { const l = d.locations[+box.dataset.li];
    $$('[data-p]', box).forEach(el => el.addEventListener('input', () => { l[el.dataset.p] = el.type === 'number' ? +el.value : el.value; }));
    $$('[data-ci]', box).forEach(cb => { const c = l.clues[+cb.dataset.ci]; $$('[data-c]', cb).forEach(el => el.addEventListener('input', () => c[el.dataset.c] = el.value)); });
    $$('[data-gi]', box).forEach(gb => { $('[data-g]', gb).addEventListener('input', e => l.guide[+gb.dataset.gi] = e.target.value); });
  });
  $$('[data-si]', root).forEach(sb => { const s = d.students[+sb.dataset.si]; $('[data-s=name]', sb).addEventListener('input', e => s.name = e.target.value); $('[data-s=code]', sb).addEventListener('input', e => s._code = e.target.value); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    const lb = b.closest('[data-li]'), l = lb && d.locations[+lb.dataset.li];
    if (a === 'addloc') d.locations.push({ id: uid('loc'), name: '新地點', subtitle: '', x: 50, y: 50, clues: [{ id: uid('c'), text: '', hint: '' }], guide: [''] });
    if (a === 'dellocation' && confirm('刪除此地點？學生在此地點的紀錄將不會出現在手冊中。')) d.locations.splice(+lb.dataset.li, 1);
    if (a === 'up') { const i = +lb.dataset.li; [d.locations[i - 1], d.locations[i]] = [d.locations[i], d.locations[i - 1]]; }
    if (a === 'addclue') l.clues.push({ id: uid('c'), text: '', hint: '' });
    if (a === 'delclue') l.clues.splice(+b.closest('[data-ci]').dataset.ci, 1);
    if (a === 'addq') (l.guide = l.guide || []).push('');
    if (a === 'delq') l.guide.splice(+b.closest('[data-gi]').dataset.gi, 1);
    if (a === 'addstu') d.students.push({ id: uid('stu-'), name: '', codeHash: '' });
    if (a === 'delstu' && confirm('刪除此學生？')) d.students.splice(+b.closest('[data-si]').dataset.si, 1);
    renderTEdit(nav);
  });
  $('#e-map').onchange = async e => { const f = e.target.files[0]; if (!f) return; const p = await compressImage(f, 1400, 0.78); d.mapImage = await bufToDataURL(p.buf, p.type); renderTEdit(nav); };
  const md = $('#e-mapdel'); if (md) md.onclick = () => { d.mapImage = ''; renderTEdit(nav); };
  const finalize = async () => {
    const out = JSON.parse(JSON.stringify(d));
    const pin = $('#e-pin').value.trim(); if (pin) out.teacherPinHash = await codeHash(out, pin);
    for (const s of out.students) { if (s._code && s._code.trim()) s.codeHash = await codeHash(out, s._code); delete s._code; if (!s.codeHash) throw new Error(`學生「${s.name || '未命名'}」尚未設定登入碼`); }
    const hs = out.students.map(s => s.codeHash); if (new Set(hs).size !== hs.length) throw new Error('兩位學生的登入碼不能相同');
    out.version = (S.act.version || 0) + 1; return out;
  };
  $('#e-dl').onclick = async () => { try { const o = await finalize(); await saveFile(new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' }), 'activity.json', 'application/json'); $('#e-msg').textContent = '✓ 已下載。請上傳取代網站上的 activity.json。'; } catch (e) { $('#e-msg').textContent = '✗ ' + e.message; } };
  $('#e-apply').onclick = async () => { try { const o = await finalize(); await kvSet('activity', o); await kvSet('activityPinned', true); S.act = o; T.draft = null; $('#e-msg').textContent = '✓ 已套用到這台裝置（網站版本更新將暫停，直到按「恢復使用網站版本」）'; } catch (e) { $('#e-msg').textContent = '✗ ' + e.message; } };
  $('#e-imp').onchange = async e => { try { const a = JSON.parse(await e.target.files[0].text()); if (a.format !== 'beigang-activity') throw new Error('格式不符'); T.draft = a; renderTEdit(nav); } catch (err) { $('#e-msg').textContent = '✗ ' + err.message; } };
  $('#e-reset').onclick = () => { T.draft = null; renderTEdit(nav); };
  $('#e-unpin').onclick = async () => { await kvDel('activityPinned'); location.reload(); };
}

boot();
