'use strict';
/* 2026 聖誕劇劇本：純靜態 PWA，資料來自 data/*.json，使用者設定存在 localStorage */
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'xmas-play-v1';
const DEF = {
  roles: [], font: 19, theme: 'auto', mastered: {}, mode: 'read', onlyMine: false, hint: 'first',
  unmasteredOnly: false, flaggedOnly: false, myScenesOnly: false, notes: {}, flags: {}, roleNotes: {}, cover: false, tts: { rate: 1, mine: 'auto', name: true, voice: 'auto' }, keepAwake: true, haptic: true, onboarded: false, tipsSeen: {}, prompts: {}, cards: { scope: 0, deck: 'unmastered', shuffle: true }, showPast: false, last: { act: 1, line: null },
};
let S = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* 無痕模式等情況 */ }
S.tts = { ...DEF.tts, ...(S.tts || {}) };
S.cards = { ...DEF.cards, ...(S.cards || {}) };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

let D = null;           // { script, schedule, crew }
let roleById = {};
let linesByAct = {};
const allLines = new Map(), lineCtx = new Map();
let route = { name: 'home' };
let cur = 0;            // 彩排游標（本幕第幾句）
const revealed = new Set();

const ICONS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  book: '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6M20 4v14h-6"/>',
  mask: '<circle cx="9" cy="8" r="4"/><circle cx="16" cy="14" r="4"/><path d="M4 14c0 3 2 6 5 6M14 4h5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};
const NAV = [['home', '首頁', 'home', '#/'], ['read', '劇本', 'book', '#/read?resume=1'], ['schedule', '行程', 'cal', '#/schedule'], ['more', '更多', 'more', '#/more']];

/* ---------- 啟動 ---------- */
async function boot() {
  applyTheme();
  document.documentElement.style.setProperty('--fs', S.font + 'px');
  const get = f => fetch(f).then(r => r.json());
  try {
    const [script, schedule, crew] = await Promise.all([get('data/script.json'), get('data/schedule.json'), get('data/crew.json')]);
    D = { script, schedule, crew };
  } catch (e) {
    $('#app').innerHTML = '<div class="card"><h3>讀取失敗</h3>請連上網路後重新整理一次，之後就能離線使用。</div>';
    return;
  }
  D.script.roles.forEach((r, i) => { r.hue = (i * 47) % 360; roleById[r.id] = r; });
  D.script.acts.forEach(a => { // 每句台詞的上下文（場景、前兩句），閃卡用
    let prev = [], stage = null;
    a.scenes.forEach(sc => sc.items.forEach(it => {
      if (it.t === 'stage') { stage = it.text; return; }
      lineCtx.set(it.id, { prev: prev.slice(-2), stage, sc, act: a.n }); prev.push(it); stage = null;
    }));
  });
  D.script.acts.forEach(a => {
    a.scenes.forEach(sc => sc.items.forEach(i => { if (i.t === 'line') allLines.set(i.id, i); }));
    linesByAct[a.n] = a.scenes.flatMap(s => s.items.filter(i => i.t === 'line'));
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (document.hidden) ttsStop(); if (!document.hidden) wake(route.name === 'read' && S.mode === 'rehearse'); });
  render();
  if (!S.onboarded) setTimeout(openTour, 250);
  else if (!S.roles.length && !sessionStorage.getItem('asked')) { sessionStorage.setItem('asked', '1'); setTimeout(() => openRolePicker(true), 300); }
}

function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}

/* ---------- 路由 ---------- */
function parseRoute() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const p = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const name = p[0] || 'home';
  return { name, act: Math.min(3, Math.max(1, +p[1] || S.last.act || 1)), q };
}
function render() {
  route = parseRoute();
  wake(false);
  ttsStop();
  window.onscroll = null;
  const view = { home: viewHome, read: viewRead, roles: viewRoles, schedule: viewSchedule, more: viewMore, crew: viewCrew, settings: viewSettings, cards: viewCards, print: viewPrint, help: viewHelp }[route.name] || viewHome;
  const app = $('#app');
  app.className = '';
  app.innerHTML = view();
  const tab = ['crew', 'settings', 'print', 'help', 'roles'].includes(route.name) ? 'more' : route.name === 'cards' ? 'home' : route.name;
  $('#nav').innerHTML = NAV.map(([k, t, ic, href]) => `<a href="${href}" class="${k === tab ? 'on' : ''}"><svg viewBox="0 0 24 24">${ICONS[ic]}</svg>${t}</a>`).join('');
  if (route.name === 'read') afterRead();
  else window.scrollTo(0, 0);
  maybeTip();
}

/* ---------- 共用 ---------- */
const focusRoles = () => (route.q && route.q.role ? [route.q.role] : S.roles);
const isMine = (it, f) => it.t === 'line' && it.who.some(w => f.includes(w));
const roleName = id => (roleById[id] || {}).name || id;
const myNames = () => S.roles.map(roleName);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 1800); }
const WEEK = '日一二三四五六';
const evDate = e => new Date(`${e.date}T${e.time}:00`);
const dayDiff = (a, b) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 864e5);
function actsOfRoles(f) { // 這些角色有戲的幕
  return [1, 2, 3].filter(n => linesByAct[n].some(l => l.who.some(w => f.includes(w))));
}
function myProgress(f) {
  return [1, 2, 3].map(n => {
    const mine = linesByAct[n].filter(l => isMine(l, f));
    return { n, total: mine.length, done: mine.filter(l => S.mastered[l.id]).length };
  });
}

/* ---------- 首頁 ---------- */
function viewHome() {
  const now = new Date();
  const next = D.schedule.events.find(e => evDate(e).getTime() + 3 * 36e5 > now.getTime());
  const my = actsOfRoles(S.roles);
  let nextHtml = '<p class="muted">所有行程都結束了，辛苦了！</p>';
  if (next) {
    const dd = dayDiff(evDate(next), now);
    const cnt = dd === 0 ? '就是今天！' : dd === 1 ? '明天' : `${dd} 天後`;
    const involved = next.acts.length ? next.acts.map(n => `第${'一二三'[n - 1]}幕`).join('、') : '全員讀本';
    const mine = !S.roles.length || !next.acts.length ? '' : next.acts.some(a => my.includes(a)) ? '<span class="chip gold">本場有你的戲</span>' : '<span class="chip">本場沒有你的戲（依幕次推算）</span>';
    nextHtml = `<div class="next-date">${+next.date.slice(5, 7)}/${+next.date.slice(8)}<small>週${WEEK[evDate(next).getDay()]} ${next.time}</small></div>
      <p style="margin:6px 0"><b>${esc(next.title)}</b> <span class="count">· ${cnt}</span></p>
      <div class="chips"><span class="chip">${involved}</span>${mine}</div>
      ${next.note ? `<p class="muted" style="margin:8px 0 0;font-size:14px">${esc(next.note)}</p>` : ''}`;
  }
  const dropDay = D.schedule.milestones.find(m => m.title === '丟本');
  const dd = dropDay ? dayDiff(new Date(dropDay.date + 'T00:00:00'), now) : -1;
  const drop = dd > 0 ? `<div class="card"><h3>距離丟本</h3><span class="next-date">${dd}<small>天（${dropDay.date.slice(5).replace('-', '/')} 起不看劇本）</small></span></div>`
    : dd === 0 ? '<div class="card"><h3>丟本</h3><b>今天開始丟本！加油！</b></div>' : '';
  const prog = S.roles.length ? myProgress(S.roles).filter(p => p.total).map(p => `
      <div class="prog-row"><span>第${'一二三'[p.n - 1]}幕</span><div class="bar"><i style="width:${p.done / p.total * 100}%"></i></div><span>${p.done}/${p.total}</span></div>`).join('') : '';
  const weak = S.roles.length ? weakLines(S.roles).length : 0;
  const prepAct = next && next.acts.find(a => my.includes(a));
  return `
  <div class="hero"><small>CHRISTMAS PLAY 2026</small><h1>聖誕劇劇本</h1>
    <div class="who-me">${S.roles.length ? `你的角色：<b>${S.roles.map(r => esc(roleName(r))).join('、')}</b> <button class="btn small ghost" data-do="pick">修改</button>` : '<button class="btn primary" data-do="pick">選擇我的角色</button>'}</div></div>
  <div class="cta">
    <button class="btn" data-go="read"><b>📖</b>閱讀</button>
    <button class="btn" data-go="memo"><b>🧠</b>背誦</button>
    <button class="btn" data-go="rehearse"><b>🎬</b>彩排</button>
    <a class="btn" href="#/cards"><b>🃏</b>閃卡</a>
  </div>
  <div class="card"><h3>下一次排練</h3>${nextHtml}<div class="btn-row" style="margin-top:12px">
    ${prepAct ? `<button class="btn small primary" data-prep="${prepAct}">預習第${'一二三'[prepAct - 1]}幕</button>` : ''}<a class="btn small" href="#/schedule" style="text-decoration:none;display:inline-flex;align-items:center">完整行程</a></div></div>
  ${weak ? `<div class="card"><h3>需要加強</h3><p style="margin:0 0 10px"><b>${weak}</b> 句常忘或標了 ⚠ 的台詞</p><button class="btn small primary" data-cards="weak">用閃卡練這些</button></div>` : ''}
  ${prog ? `<div class="card"><h3>背誦進度</h3>${prog}</div>` : ''}
  ${drop}
  <blockquote class="verse">林前 4:9　因為我們成了一臺戲，給世人和天使觀看。</blockquote>`;
}

/* ---------- 閱讀頁（閱讀 / 背誦 / 彩排） ---------- */
const HINT_SPLIT = /([，。！？、；：,.!?．…\n\s]+)/;
function hintText(t) {
  if (S.hint === 'none') return '點一下顯示台詞';
  const plain = t.replace(/[（(［\[][^）)］\]]*[）)］\]]/g, '');
  return esc(plain.split(HINT_SPLIT).map((p, i) => {
    if (i % 2) return p; const c = [...p]; return c.length ? c[0] + '＿'.repeat(Math.min(c.length - 1, 4)) : '';
  }).join(''));
}
function fmtText(t) { return esc(t).replace(/[（(][^）)]*[）)]|［[^］]*］|\[[^\]]*\]/g, m => `<i>${m}</i>`); }

const inPractice = id => !((S.unmasteredOnly && S.mastered[id]) || (S.flaggedOnly && !S.flags[id]));

function lineHtml(it, o) {
  const hue = (roleById[it.who[0]] || { hue: 0 }).hue;
  const memo = S.mode === 'memo';
  const covered = o.mine && (memo || (S.mode === 'rehearse' && S.cover)) && !(memo && !inPractice(it.id));
  const cls = ['line', o.mine && 'mine', it.spot && 'spot', o.cue && 'cue', o.mine && memo && 'memo', o.mine && S.mastered[it.id] && 'mastered', S.flags[it.id] && 'flag'].filter(Boolean).join(' ');
  return `<div class="${cls}" data-id="${it.id}"${o.mine ? ' data-mine="1"' : ''}>
    <div class="who" style="--h:${hue}">${esc(it.label)}<button class="nb${S.notes[it.id] || S.flags[it.id] ? ' on' : ''}" data-note="${it.id}" aria-label="筆記">${S.flags[it.id] ? '⚠' : S.notes[it.id] ? '📝' : '✎'}</button></div>
    <div class="say${covered ? ' covered' + (revealed.has(it.id) ? ' revealed' : '') : ''}">${it.dir ? `<span class="dir">（${esc(it.dir)}）</span>` : ''}<span class="real">${fmtText(it.text)}</span>${covered ? `<span class="hintt">${hintText(it.text)}</span>` : ''}${S.notes[it.id] ? `<div class="note-box">📝 ${esc(S.notes[it.id])}</div>` : ''}</div>
    ${o.mine && memo ? `<button class="chk${S.mastered[it.id] ? ' on' : ''}" data-chk="${it.id}" aria-label="標記背熟了">✓</button>` : ''}
  </div>`;
}

function viewRead() {
  const n = route.act, act = D.script.acts[n - 1], f = focusRoles();
  const memo = S.mode === 'memo', reh = S.mode === 'rehearse';
  const flat = [];
  const hasMine = sc => sc.items.some(i => isMine(i, f));
  const scenes = act.scenes.filter(sc => !(S.myScenesOnly && f.length) || hasMine(sc));
  scenes.forEach(sc => { flat.push({ t: 'scene', sc }); sc.items.forEach(i => flat.push(i)); });
  const target = it => isMine(it, f) && !(memo && !inPractice(it.id));
  const filtering = S.onlyMine && !reh && f.length;
  const keep = new Array(flat.length).fill(!filtering), cueIdx = new Set();
  if (filtering) {
    flat.forEach((it, i) => {
      if (it.t === 'scene') keep[i] = true;
      if (!target(it)) return;
      keep[i] = true;
      let j = i - 1;
      while (j >= 0 && flat[j].t === 'stage') { keep[j] = true; j--; }
      if (j >= 0 && flat[j].t === 'line' && !isMine(flat[j], f)) { keep[j] = true; cueIdx.add(j); }
    });
  }
  let html = '', gap = false;
  flat.forEach((it, i) => {
    if (!keep[i]) { gap = true; return; }
    if (gap && it.t !== 'scene') html += '<div class="gap">⋯</div>';
    gap = false;
    if (it.t === 'scene') {
      const sc = it.sc, nk = 'scene:' + sc.id, mc = f.length ? sc.items.filter(x => isMine(x, f)).length : 0;
      html += `<div class="scene" id="${sc.id}"><div class="sc-top"><b>場景 ${sc.no}${sc.title ? '・' + esc(sc.title) : ''}</b><button class="nb${S.notes[nk] ? ' on' : ''}" data-note="${nk}" aria-label="場景筆記">${S.notes[nk] ? '📝' : '✎'}</button></div>
        ${sc.desc ? `<div class="desc">${esc(sc.desc)}</div>` : ''}${f.length ? `<div class="chips" style="margin-top:6px">${mc ? `<span class="chip gold">你有 ${mc} 句</span>` : '<span class="chip">這場沒有你的戲</span>'}</div>` : ''}
        ${S.notes[nk] ? `<div class="note-box">📝 ${esc(S.notes[nk])}</div>` : ''}</div>`;
    }
    else if (it.t === 'stage') html += `<div class="stage">（${esc(it.text)}）</div>`;
    else html += lineHtml(it, { mine: isMine(it, f), cue: cueIdx.has(i) });
  });
  const roleBanner = route.q.role ? `<div class="banner">正在看「${esc(roleName(route.q.role))}」的台詞。<a href="#/read/${n}">回到我的角色</a></div>` : '';
  const noRole = !f.length ? `<div class="banner">還沒選擇角色，所以沒辦法標出你的台詞。<button class="btn small" data-do="pick">選擇角色</button></div>` : '';
  const modes = [['read', '閱讀'], ['memo', '背誦'], ['rehearse', '彩排']];
  const opts = [];
  if (f.length && !route.q.role) opts.push(`<button class="opt mine" data-do="pick">👤 ${esc(f.map(roleName).join('、'))}</button>`);
  if (!reh) opts.push(`<button class="opt${S.onlyMine ? ' on' : ''}" data-opt="onlyMine">只看我的台詞</button>`);
  if (memo) {
    opts.push(`<button class="opt${S.hint === 'first' ? ' on' : ''}" data-opt="hint">首字提示</button>`);
    opts.push(`<button class="opt${S.unmasteredOnly ? ' on' : ''}" data-opt="unmasteredOnly">只練還沒背熟的</button>`);
  }
  if (reh) opts.push(`<button class="opt${S.cover ? ' on' : ''}" data-opt="cover">丟本（蓋住我的台詞）</button>`);
  opts.push('<button class="opt" data-do="opts">⋯ 更多</button>');
  const pr = memo && f.length ? myProgress(f).find(p => p.n === n) : null;
  return `
  <div class="rhead" id="rhead">
    <div class="rrow"><div class="tabs">${[1, 2, 3].map(i => `<a href="#/read/${i}${route.q.role ? '?role=' + route.q.role : ''}" class="${i === n ? 'on' : ''}">第${'一二三'[i - 1]}幕</a>`).join('')}</div>
      <button class="ibtn" data-do="scenes" aria-label="場景目錄">📑</button><button class="ibtn" data-do="fontsheet" aria-label="字體大小">Aa</button><button class="ibtn" data-do="search" aria-label="搜尋">🔍</button></div>
    <div class="rrow"><div class="seg">${modes.map(([k, t]) => `<button data-mode="${k}" class="${S.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    ${opts.length ? `<div class="rrow opts">${opts.join('')}</div>` : ''}
    ${pr && pr.total ? `<div class="rrow" style="font-size:12px;color:var(--muted)"><div class="bar" style="flex:1"><i style="width:${pr.done / pr.total * 100}%"></i></div><span id="progtxt">本幕已背熟 ${pr.done}/${pr.total}</span></div>` : ''}
  </div>
  ${roleBanner}${noRole}
  <div class="script${reh ? ' rehearse' : ''}" id="script">${html || '<p class="muted">這一幕沒有符合的台詞。</p>'}</div>
  ${reh ? `<div class="dock"><div class="irow"><div class="info" id="info"></div>${hasTTS ? '<button class="tts" id="ttsbtn" data-tts="toggle">🔊 朗讀對詞</button><button class="tts" data-tts="set" aria-label="朗讀設定">⚙</button>' : ''}</div><div class="pad">
      <button data-nav="mprev" aria-label="我的上一句">⏮</button><button data-nav="prev" aria-label="上一句">◀</button>
      <button class="main" data-nav="next" aria-label="下一句">▶</button><button data-nav="mnext" aria-label="我的下一句">⏭</button></div></div>`
    : (f.length ? '<div class="fabs"><button data-nav="mprev" aria-label="我的上一句">▲ 上一句</button><button data-nav="mnext" aria-label="我的下一句">▼ 我的下一句</button></div>' : '')}`;
}

function afterRead() {
  const app = $('#app');
  if (S.mode === 'rehearse') {
    const els = $$('.line');
    const idx = els.findIndex(e => e.dataset.id === (route.q.line || (S.last.act === route.act ? S.last.line : null)));
    cur = Math.max(0, idx);
    setCursor(cur, route.q.line ? true : false, true);
    wake(true);
  }
  S.last.act = route.act; save();
  if (route.q.line) {
    const el = $(`.line[data-id="${CSS.escape(route.q.line)}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); }
  } else if (S.mode !== 'rehearse' && S.last.line && S.last.act === route.act && route.q.resume) {
    const el = $(`.line[data-id="${CSS.escape(S.last.line)}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
  } else if (route.q.scene) setTimeout(() => gotoScene(route.q.scene), 30);
  else if (S.mode !== 'rehearse') window.scrollTo(0, 0);
  hookScroll();
}

let lastY = 0, scrollT = 0;
function hookScroll() {
  lastY = window.scrollY;
  window.onscroll = () => {
    const y = window.scrollY, head = $('#rhead');
    if (head) head.classList.toggle('hide', y > lastY && y > 120);
    lastY = y;
    clearTimeout(scrollT);
    scrollT = setTimeout(() => {
      if (S.mode === 'rehearse') return;
      const first = $$('.line').find(e => e.getBoundingClientRect().top > 100);
      if (first) { S.last = { act: route.act, line: first.dataset.id }; save(); }
    }, 400);
  };
}

function setCursor(i, scroll = true, quiet = false) {
  const els = $$('.line');
  if (!els.length) return;
  cur = Math.min(els.length - 1, Math.max(0, i));
  els.forEach((e, k) => { e.classList.toggle('cursor', k === cur); e.classList.toggle('passed', k < cur); });
  if (scroll) els[cur].scrollIntoView({ block: 'center', behavior: quiet ? 'auto' : 'smooth' });
  else if (quiet) els[cur].scrollIntoView({ block: 'center' });
  S.last = { act: route.act, line: els[cur].dataset.id }; save();
  if (S.haptic && !quiet && els[cur].dataset.mine && navigator.vibrate) navigator.vibrate(40);
  if (playing && !ttsInternal) restartTts();
  const nxt = els.findIndex((e, k) => k > cur && e.dataset.mine);
  const info = $('#info');
  if (info) info.textContent = els[cur].dataset.mine ? '輪到你了！' : !S.roles.length ? '請先選擇角色' : nxt < 0 ? '本幕你的台詞已結束' : `再 ${nxt - cur} 句輪到你`;
}
function jumpMine(dir) {
  const f = focusRoles();
  if (!f.length) return openRolePicker(false);
  const n = route.act;
  const mineIn = k => linesByAct[k].filter(l => isMine(l, f));
  const goAct = k => { // 這一幕沒有了：跳到上／下一幕裡我的台詞
    for (let j = k; j >= 1 && j <= 3; j += dir) {
      const m = mineIn(j);
      if (m.length) { location.hash = `#/read/${j}?line=${m[dir > 0 ? 0 : m.length - 1].id}${route.q.role ? '&role=' + route.q.role : ''}`; return toast(`到第${'一二三'[j - 1]}幕`); }
    }
    toast(dir > 0 ? '後面沒有你的台詞了' : '前面沒有你的台詞了');
  };
  if (S.mode === 'rehearse') {
    const all = $$('.line');
    const mi = all.map((e, k) => e.dataset.mine ? k : -1).filter(k => k >= 0);
    const t = dir > 0 ? mi.find(k => k > cur) : [...mi].reverse().find(k => k < cur);
    return t === undefined ? goAct(n + dir) : setCursor(t);
  }
  // 閱讀／背誦：以畫面中線為基準，找中線下方（上方）最近的一句，所以連按會一句句往下走
  const mid = innerHeight / 2, els = $$('.line[data-mine]');
  const t = dir > 0 ? els.find(e => e.getBoundingClientRect().top > mid + 24)
    : [...els].reverse().find(e => e.getBoundingClientRect().bottom < mid - 24);
  if (!t) return goAct(n + dir);
  t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  t.classList.remove('hl'); void t.offsetWidth; t.classList.add('hl');
}

/* ---------- 角色 ---------- */
function viewRoles() {
  const card = r => {
    const sel = S.roles.includes(r.id), first = [1, 2, 3].find(n => r.lines[n]) || 1;
    const per = [1, 2, 3].filter(n => r.lines[n]).map(n => `第${'一二三'[n - 1]}幕 ${r.lines[n]} 句`).join('・');
    return `<div class="card role"><div class="top"><h3>${esc(r.name)}</h3>${sel ? '<span class="chip gold">我的角色</span>' : ''}</div>
      <p>${esc(r.desc)}</p><div class="chips" style="margin-bottom:10px"><span class="chip">${per || '無台詞'}</span></div>
      <details class="rn"${S.roleNotes[r.id] ? ' open' : ''}><summary>角色小傳／筆記${S.roleNotes[r.id] ? ' 📝' : ''}</summary>
        <textarea data-rn="${r.id}" rows="4" placeholder="寫下這個角色的背景、個性、和其他人的關係…（只存在你的手機）">${esc(S.roleNotes[r.id] || '')}</textarea></details>
      <div class="btn-row"><button class="btn small${sel ? '' : ' primary'}" data-role="${r.id}">${sel ? '取消我的角色' : '設為我的角色'}</button>
      ${per ? `<a class="btn small" style="text-decoration:none;display:inline-flex;align-items:center" href="#/read/${first}?role=${r.id}">看他的台詞</a>` : ''}</div></div>`;
  };
  const g = k => D.script.roles.filter(r => r.group === k && r.id !== 'video').map(card).join('');
  return `<h1 class="page-title">角色</h1><p class="muted" style="margin:0">可以複選（例如一人分飾兩角）。</p>
    ${g('main')}<div class="roles-h">少女舞團</div>${g('dance')}<details><summary class="roles-h">其他小角色（點開）</summary>${g('minor')}</details>`;
}
function openRolePicker(first) {
  const groups = [['main', '主要角色'], ['dance', '少女舞團'], ['minor', '其他小角色']];
  const body = groups.map(([k, t]) => {
    const rows = D.script.roles.filter(r => r.group === k && r.id !== 'video').map(r => {
      const total = r.lines[1] + r.lines[2] + r.lines[3];
      return `<label class="pick"><input type="checkbox" value="${r.id}" ${S.roles.includes(r.id) ? 'checked' : ''}>${esc(r.name)}<small>${total} 句</small></label>`;
    }).join('');
    return k === 'minor' ? `<details${D.script.roles.some(r => r.group === k && S.roles.includes(r.id)) ? ' open' : ''}><summary class="roles-h">${t}（點開）</summary>${rows}</details>` : `<div class="roles-h">${t}</div>${rows}`;
  }).join('');
  showSheet(`<h2>${first ? '歡迎！你是哪個角色？' : '我的角色'}</h2><p class="muted" style="margin:0 0 6px">選好之後，劇本裡你的台詞會自動標出來。可以複選。</p>${body}
    <div class="btn-row" style="margin-top:16px"><button class="btn primary" data-do="saveRoles" style="flex:1">完成</button><button class="btn" data-do="close">先跳過</button></div>`);
}

/* ---------- 行程 ---------- */
function viewSchedule() {
  const now = new Date(), my = actsOfRoles(S.roles);
  let lastM = '', html = '';
  const upcomingIdx = D.schedule.events.findIndex(e => evDate(e).getTime() + 3 * 36e5 > now.getTime());
  const pastCount = upcomingIdx < 0 ? D.schedule.events.length : upcomingIdx;
  D.schedule.events.forEach((e, i) => {
    const d = evDate(e), past = i < upcomingIdx || upcomingIdx < 0;
    if (past && !S.showPast) return;
    const m = `${d.getMonth() + 1} 月`;
    if (m !== lastM) { html += `<div class="month">${m}</div>`; lastM = m; }
    const today = dayDiff(d, now) === 0;
    const acts = e.acts.length === 3 ? '全劇' : e.acts.length ? e.acts.map(n => `第${'一二三'[n - 1]}幕`).join('、') : '全員讀本';
    const mine = S.roles.length && e.acts.length && e.acts.length < 3 ? (e.acts.some(a => my.includes(a)) ? '<span class="chip gold">有你的戲</span>' : '<span class="chip">沒有你的戲</span>') : '';
    const kind = { show: '<span class="chip red">正式演出</span>', dress: '<span class="chip red">彩排／總彩</span>' }[e.kind] || '';
    html += `<div class="card ev${past ? ' past' : ''}${today ? ' today' : ''}"><div class="d"><b>${d.getDate()}</b><span>週${WEEK[d.getDay()]}</span></div>
      <div><h3>${esc(e.title)}</h3><div class="chips"><span class="chip">${e.time}</span><span class="chip">${acts}</span>${mine}${kind}${today ? '<span class="chip red">今天</span>' : ''}</div>
      ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div></div>`;
  });
  return `<h1 class="page-title">排練行程</h1>
    <div class="btn-row"><button class="btn small" data-do="ics">加入手機行事曆（.ics）</button>
    ${pastCount ? `<button class="btn small" data-do="past">${S.showPast ? '隱藏' : '顯示'}已過的 ${pastCount} 場</button>` : ''}</div>
    ${html || '<p class="muted">沒有即將到來的行程。</p>'}
    <p class="muted" style="font-size:13px;margin-top:20px">「有／沒有你的戲」是依各場排練的幕次推算，實際通告請以導演組公告為準。</p>`;
}
function downloadIcs() {
  const p = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const ev = D.schedule.events.map((e, i) => {
    const s = evDate(e), en = new Date(s.getTime() + (e.kind === 'show' ? 2.5 : 2) * 36e5);
    return ['BEGIN:VEVENT', `UID:xmas2026-${i}@play`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(s)}`, `DTEND:${fmt(en)}`,
      `SUMMARY:聖誕劇｜${e.title}`, `DESCRIPTION:${(e.note || '').replace(/[,;\n]/g, ' ')}`, 'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:一小時後排練', 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  const blob = new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//xmas2026//zh', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xmas-play-2026.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- 更多 / 劇組 / 設定 ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function viewMore() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<h1 class="page-title">更多</h1>
  ${standalone ? '' : `<div class="card"><h3>安裝成 App（建議）</h3>
    ${ios ? '<p style="margin:0">用 Safari 開啟，點下方「分享」→「加入主畫面」，之後就能像 App 一樣離線使用。</p>'
      : installEvt ? '<button class="btn primary" data-do="install">安裝到手機</button>' : '<p style="margin:0">用 Chrome 開啟，點右上角選單 →「安裝應用程式／加到主畫面」，之後就能離線使用。</p>'}</div>`}
  <div class="roles-h">我的資料</div>
  <div class="card list"><a href="#/roles">角色與角色小傳 <span>›</span></a><a href="#/print">列印我的台詞本（存成 PDF） <span>›</span></a><a href="#/settings">設定與備份 <span>›</span></a></div>
  <div class="roles-h">說明與分享</div>
  <div class="card list"><a href="#/help">使用說明 <span>›</span></a><button class="row" data-do="tour">重看新手導覽 <span>›</span></button><button class="row" data-do="share">分享網站給其他演員 <span>↗</span></button></div>
  <div class="roles-h">劇組</div>
  <div class="card list"><a href="#/crew">劇組分工 <span>›</span></a></div>
  <p class="muted" style="font-size:13px">你的角色、背誦進度和筆記只存在這支手機，不會上傳。換手機前請到「設定與備份」匯出。</p>`;
}
function viewCrew() {
  return `<h1 class="page-title">劇組分工</h1><div class="card">${D.crew.map(c => `<div class="crew-g"><b>${esc(c.role)}</b><span class="muted">${esc(c.names)}</span></div>`).join('')}</div>
    <a href="#/more">‹ 返回</a>`;
}
function viewSettings() {
  const sw = (k, on) => `<button class="switch${on ? ' on' : ''}" data-opt="${k}" role="switch" aria-checked="${on}"></button>`;
  return `<h1 class="page-title">設定</h1><div class="card">
    <div class="set"><span>字體大小</span><input type="range" min="14" max="32" value="${S.font}" data-set="font"></div>
    <div class="set"><span>外觀</span><select data-set="theme">${[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, t]) => `<option value="${v}"${S.theme === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="set"><span>彩排時螢幕保持亮著</span>${sw('keepAwake', S.keepAwake)}</div>
    <div class="set"><span>輪到我時震動提示（Android）</span>${sw('haptic', S.haptic)}</div>
    ${hasTTS ? '<div class="set"><span>語音朗讀（對詞）</span><button class="btn small" data-tts="set">設定</button></div>' : ''}</div>
    <div class="card"><h3>備份</h3><p class="muted" style="margin:0 0 10px;font-size:14px">角色、背誦進度和筆記只存在這支手機。換手機前先匯出，再到新手機匯入。</p>
      <div class="btn-row"><button class="btn small" data-do="export">匯出備份</button><button class="btn small" data-do="import">匯入備份</button></div>
      <input type="file" id="importfile" accept="application/json,.json" hidden></div>
    <div class="card"><div class="set"><span>已背熟 ${Object.keys(S.mastered).length} 句</span><button class="btn small" data-do="resetMastered">重設背誦進度</button></div></div>
    <a href="#/more">‹ 返回</a>`;
}

/* ---------- 疊層：選單、搜尋 ---------- */
function showSheet(html) { const o = $('#overlay'); o.innerHTML = `<div class="sheet">${html}</div>`; o.hidden = false; }
function closeSheet() { $('#overlay').hidden = true; $('#overlay').innerHTML = ''; }
function openSearch() {
  showSheet('<input type="search" id="q" placeholder="搜尋台詞、角色…" autocomplete="off"><div id="hits" style="margin-top:8px"></div>');
  const q = $('#q'); q.focus();
  q.oninput = () => {
    const k = q.value.trim().toLowerCase();
    if (!k) { $('#hits').innerHTML = ''; return; }
    const out = [];
    D.script.acts.forEach(a => linesByAct[a.n].forEach(l => {
      if (out.length < 60 && (l.text.toLowerCase().includes(k) || l.label.toLowerCase().includes(k))) out.push([a.n, l]);
    }));
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    $('#hits').innerHTML = out.length ? out.map(([n, l]) => `<a class="hit" href="#/read/${n}?line=${l.id}" data-do="close"><small>第${'一二三'[n - 1]}幕・${esc(l.label)}</small>${esc(l.text.slice(0, 80)).replace(re, m => `<mark>${m}</mark>`)}</a>`).join('') : '<p class="muted">找不到。</p>';
  };
}

/* ---------- 語音朗讀（對詞）：念別人的台詞，輪到我時停下或等我念 ---------- */
const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let zhVoices = [], playing = false, ttsToken = 0, ttsInternal = false, ttsCancel = null;
function loadVoices() { zhVoices = speechSynthesis.getVoices().filter(v => /^zh/i.test(v.lang)); }
if (hasTTS) { loadVoices(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadVoices); }
const speakable = t => t.normalize('NFKC').replace(/[（(［\[][^）)］\]]*[）)］\]]/g, '').replace(/[.．…。]{2,}/g, '，').replace(/\s+/g, ' ').trim();
const chunks = t => { // 切成短句，避免手機瀏覽器念到一半被截斷
  const parts = t.replace(/([。！？!?；;，,\n])/g, '$1\u0001').split('\u0001').map(x => x.trim()).filter(Boolean), out = []; let c = '';
  for (const p of parts) { if (c && (c + p).length > 36) { out.push(c); c = p; } else c += p; }
  if (c) out.push(c); return out;
};
function pickVoice(rid) {
  if (S.tts.voice !== 'auto') return zhVoices.find(v => v.name === S.tts.voice);
  if (!zhVoices.length) return null;
  const tw = zhVoices.filter(v => /tw|hant|hk/i.test(v.lang)); const pool = tw.length ? tw : zhVoices;
  return pool[Math.max(0, D.script.roles.findIndex(r => r.id === rid)) % pool.length];
}
function utter(text, rid, opt = {}) {
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-TW'; u.rate = opt.rate || S.tts.rate;
    u.pitch = 0.85 + (((roleById[rid] || { hue: 0 }).hue / 47) % 5) * 0.1;
    const v = pickVoice(rid); if (v) { u.voice = v; u.lang = v.lang; }
    let done = false; const tm = setTimeout(() => fin(), text.length * 600 / u.rate + 4000);
    const fin = () => { if (!done) { done = true; clearTimeout(tm); res(); } };
    u.onend = fin; u.onerror = fin; ttsCancel = fin;
    try { speechSynthesis.speak(u); } catch (err) { fin(); }
  });
}
const wait = ms => new Promise(res => { const t = setTimeout(res, ms); ttsCancel = () => { clearTimeout(t); res(); }; });
function ttsUI() { const b = $('#ttsbtn'); if (b) { b.textContent = playing ? '⏸ 暫停朗讀' : '🔊 朗讀對詞'; b.classList.toggle('on', playing); } }
function ttsStart() {
  if (!hasTTS) return toast('這個瀏覽器不支援朗讀');
  if (route.name !== 'read' || S.mode !== 'rehearse') return;
  if (!S.roles.length) toast('還沒選角色，會全部念出來');
  playing = true; ttsToken++; speechSynthesis.cancel(); ttsUI();
  const el = $$('.line')[cur];
  if (el && el.dataset.mine && S.tts.mine === 'pause') { ttsInternal = true; setCursor(cur + 1); ttsInternal = false; }
  ttsLoop(ttsToken);
}
function ttsStop() {
  const was = playing; playing = false; ttsToken++;
  if (hasTTS) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  if (ttsCancel) ttsCancel();
  if (was) ttsUI();
}
function restartTts() { const tok = ++ttsToken; speechSynthesis.cancel(); if (ttsCancel) ttsCancel(); setTimeout(() => { if (playing && tok === ttsToken) ttsLoop(tok); }, 80); }
async function ttsLoop(token) {
  while (playing && token === ttsToken) {
    const els = $$('.line'), el = els[cur]; if (!el) break;
    const it = allLines.get(el.dataset.id), mine = !!el.dataset.mine;
    if (mine && S.tts.mine !== 'read') {
      if (S.tts.mine === 'pause') { ttsStop(); return toast('輪到你了，念完按「朗讀對詞」繼續'); }
      await wait((speakable(it.text).length * 320 + 1500) / S.tts.rate); // 等我自己念
    } else {
      if (S.tts.name) await utter(it.label.replace(/[，,]/g, '、'), it.who[0]);
      for (const c of chunks(speakable(it.text))) { if (token !== ttsToken) return; await utter(c, it.who[0]); }
    }
    if (token !== ttsToken || !playing) return;
    if (cur >= els.length - 1) { ttsStop(); return toast('這一幕結束了'); }
    ttsInternal = true; setCursor(cur + 1); ttsInternal = false;
  }
}
function ttsSettings() {
  const seg = (k, opts) => `<div class="opts" style="margin:6px 0 14px">${opts.map(([v, t]) => `<button class="opt${String(S.tts[k]) === String(v) ? ' on' : ''}" data-ttsset="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
  showSheet(`<h2>語音朗讀設定</h2>
    <p class="muted" style="margin:0 0 12px;font-size:14px">在彩排模式按「朗讀對詞」，會用語音念出別人的台詞，輪到你就停下來等你念。聲音由手機提供。</p>
    <b>輪到我的台詞時</b>${seg('mine', [['auto', '等我念（自動繼續）'], ['pause', '停下來，我按繼續'], ['read', '也念出來（聽範本）']])}
    <b>朗讀速度</b>${seg('rate', [[0.8, '慢'], [1, '正常'], [1.2, '快'], [1.4, '很快']])}
    <b>先念角色名</b>${seg('name', [[true, '要'], [false, '不要']])}
    <b>聲音</b><div style="margin:6px 0 14px"><select id="ttsvoice" style="width:100%;padding:10px;font:inherit;border-radius:10px">
      <option value="auto">自動（不同角色用不同音高）</option>${zhVoices.map(v => `<option value="${esc(v.name)}"${S.tts.voice === v.name ? ' selected' : ''}>${esc(v.name)}（${esc(v.lang)}）</option>`).join('')}</select>
      ${zhVoices.length ? '' : '<div class="muted" style="font-size:13px;margin-top:6px">這支手機找不到中文語音，請到系統設定下載中文語音。</div>'}</div>
    <div class="btn-row"><button class="btn" data-tts="test">試聽</button><button class="btn primary" data-do="close" style="flex:1">完成</button></div>`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ttsset]'); if (!b) return;
  const v = b.dataset.v, k = b.dataset.ttsset;
  S.tts[k] = k === 'rate' ? +v : k === 'name' ? v === 'true' : v; save();
  $$('[data-ttsset="' + k + '"]').forEach(x => x.classList.toggle('on', x === b));
});
document.addEventListener('change', e => { if (e.target.id === 'ttsvoice') { S.tts.voice = e.target.value; save(); } });

/* ---------- 筆記、場景跳轉、備份 ---------- */
/* ---------- 保留位置的重新繪製（切換模式／選項時不跳回最上面） ---------- */
function keepRender() {
  let id = null; const act = route.act;
  if (route.name === 'read') {
    const cl = S.mode === 'rehearse' ? $('.line.cursor') : $$('.line').find(e => e.getBoundingClientRect().top >= 100);
    id = cl && cl.dataset.id;
    if (id) S.last = { act, line: id };
  }
  const y = scrollY;
  render();
  if (route.name !== 'read') return scrollTo(0, y);
  if (!id || S.mode === 'rehearse') return;
  const order = linesByAct[act].map(l => l.id), at = order.indexOf(id);
  const el = [...order.slice(at), ...order.slice(0, at).reverse()].map(c => $(`.line[data-id="${CSS.escape(c)}"]`)).find(Boolean);
  if (el) el.scrollIntoView({ block: 'start' });
}

/* ---------- 閱讀頁的「更多選項」：每個開關都附一句白話說明 ---------- */
const swHtml = (k, on) => `<button class="switch${on ? ' on' : ''}" data-opt="${k}" role="switch" aria-checked="${on}"></button>`;
function openOpts() {
  const row = (t, d, k, on) => `<div class="set"><div><b>${t}</b><div class="muted" style="font-size:13px">${d}</div></div>${swHtml(k, on)}</div>`;
  const reh = S.mode === 'rehearse', memo = S.mode === 'memo';
  showSheet(`<div id="optsheet"><h2>閱讀選項</h2>
    ${reh ? '' : row('只看我的台詞', '隱藏別人的台詞，只留你的台詞和前一句（當提詞）', 'onlyMine', S.onlyMine)}
    ${S.roles.length ? row('只看我有戲的場景', '整場都沒有你的戲就隱藏', 'myScenesOnly', S.myScenesOnly) : ''}
    ${memo ? row('首字提示', '蓋住的台詞顯示每句的第一個字', 'hint', S.hint === 'first') + row('只練還沒背熟的', '打勾背熟的台詞不再蓋住', 'unmasteredOnly', S.unmasteredOnly) + row('只練常忘（⚠）的', '只蓋住標了 ⚠ 的台詞', 'flaggedOnly', S.flaggedOnly) : ''}
    ${reh ? row('丟本', '蓋住你的台詞，點一下才顯示；被你點開的次數會記成「常忘」', 'cover', S.cover) : ''}
    ${memo ? '<div class="btn-row" style="margin-top:12px"><button class="btn" data-do="revealAll">把這一幕的台詞全部顯示</button></div>' : ''}
    <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-do="close" style="flex:1">完成</button></div></div>`);
}

/* ---------- 場景目錄、字體 ---------- */
function openScenes() {
  const f = focusRoles();
  showSheet(`<h2>場景目錄</h2>` + D.script.acts.map(a => `<div class="roles-h">第${'一二三'[a.n - 1]}幕</div>` + a.scenes.map(sc => {
    const mine = f.length ? sc.items.filter(i => isMine(i, f)) : [], done = mine.filter(i => S.mastered[i.id]).length;
    return `<button class="toc${a.n === route.act ? ' here' : ''}" data-sg="${a.n}:${sc.id}"><b>${sc.no}．${esc(sc.title)}</b>
      <span class="muted">${esc(sc.desc)}</span>
      <span class="chips">${f.length ? (mine.length ? `<span class="chip gold">你有 ${mine.length} 句</span>${done ? `<span class="chip green">已背 ${done}</span>` : ''}` : '<span class="chip">沒有你的戲</span>') : ''}</span></button>`;
  }).join('')).join('') + '<div class="btn-row" style="margin-top:14px"><button class="btn" data-do="close" style="flex:1">關閉</button></div>');
}
function openFont() {
  showSheet(`<h2>字體大小</h2><input type="range" min="14" max="32" value="${S.font}" data-set="font" style="width:100%;margin:10px 0">
    <p style="font-size:var(--fs);line-height:1.75;margin:0 0 14px">感謝老天爺，我們夢幻已久的豪華郵輪之旅，終於成行了。</p>
    <div class="btn-row"><button class="btn primary" data-do="close" style="flex:1">完成</button></div>`);
}

/* ---------- 常忘的台詞：彩排時被提詞、閃卡答錯會累計，兩次就自動標 ⚠ ---------- */
function addPrompt(id) {
  S.prompts[id] = (S.prompts[id] || 0) + 1;
  if (S.prompts[id] >= 2 && !S.flags[id]) { S.flags[id] = 1; toast('這句常忘，已標記 ⚠'); const nb = $(`.line[data-id="${CSS.escape(id)}"] .nb`); if (nb) { nb.textContent = '⚠'; nb.classList.add('on'); } }
  save();
}
const weakLines = f => Object.values(linesByAct).flat().filter(l => isMine(l, f) && (S.flags[l.id] || S.prompts[l.id]));

/* ---------- 閃卡：看前一句，回想自己的台詞 ---------- */
let deck = null;
const actOf = id => (lineCtx.get(id) || {}).act;
function deckIds() {
  const c = S.cards, f = S.roles;
  let ids = Object.values(linesByAct).flat().filter(l => isMine(l, f) && (!c.scope || actOf(l.id) === c.scope)
    && (c.deck === 'all' || (c.deck === 'unmastered' && !S.mastered[l.id]) || (c.deck === 'weak' && (S.flags[l.id] || S.prompts[l.id])))).map(l => l.id);
  if (c.shuffle) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}
function viewCards() {
  if (!S.roles.length) return `<h1 class="page-title">閃卡練習</h1><div class="banner">請先選擇你的角色。<button class="btn small" data-do="pick">選擇角色</button></div>`;
  const c = S.cards;
  if (deck && deck.ids.length) {
    if (deck.i >= deck.ids.length) {
      return `<h1 class="page-title">練習完成 🎉</h1><div class="card"><p style="margin:0 0 6px;font-size:20px">記得 <b>${deck.ok}</b> 句，忘了 <b>${deck.bad.length}</b> 句</p>
        <p class="muted" style="margin:0">忘記的台詞已加入「常忘」，之後可以專門練習。</p></div>
        <div class="btn-row">${deck.bad.length ? '<button class="btn primary" data-fc="again">再練忘了的</button>' : ''}<button class="btn" data-fc="end">回設定</button></div>`;
    }
    const id = deck.ids[deck.i], l = allLines.get(id), cx = lineCtx.get(id) || { prev: [] }, sc = cx.sc;
    const cue = cx.prev.map(p => `<div class="fc-cue"><b style="color:hsl(${(roleById[p.who[0]] || { hue: 0 }).hue} 50% 45%)">${esc(p.label)}</b>　${fmtText(p.text.length > 90 ? p.text.slice(0, 90) + '…' : p.text)}</div>`).join('') || '<div class="fc-cue muted">（這是這一幕的第一句）</div>';
    return `<div class="rrow" style="margin-top:18px"><div class="bar" style="flex:1"><i style="width:${deck.i / deck.ids.length * 100}%"></i></div><span class="muted" style="font-size:13px">${deck.i + 1}/${deck.ids.length}</span><button class="btn small ghost" data-fc="end">結束</button></div>
    <div class="fc" data-fc="reveal"><div class="muted" style="font-size:13px;margin-bottom:10px">第${'一二三'[cx.act - 1]}幕・${esc(sc ? sc.title : '')}</div>
      ${cx.stage ? `<div class="stage" style="text-align:left;margin:0 0 8px">（${esc(cx.stage)}）</div>` : ''}${cue}
      <div class="fc-q">輪到你：${esc(l.label)}${l.dir ? `<span class="dir">（${esc(l.dir)}）</span>` : ''}</div>
      <div class="fc-ans${deck.show ? '' : ' hid'}">${deck.show ? fmtText(l.text) : deck.hint ? hintText(l.text) : '先自己念念看，再點一下卡片看答案'}</div>
      ${S.notes[id] ? `<div class="note-box">📝 ${esc(S.notes[id])}</div>` : ''}</div>
    <div class="fc-btns">${deck.show ? '<button class="btn bad" data-fc="bad">✗ 忘了</button><button class="btn good" data-fc="ok">✓ 記得</button>'
        : `<button class="btn" data-fc="hint">提示首字</button><button class="btn primary" data-fc="reveal">看答案</button>`}</div>`;
  }
  const n = deckIds().length, seg = (k, opts) => `<div class="opts" style="margin:6px 0 16px;flex-wrap:wrap">${opts.map(([v, t]) => `<button class="opt${String(c[k]) === String(v) ? ' on' : ''}" data-cset="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
  return `<h1 class="page-title">閃卡練習</h1><p class="muted" style="margin:0 0 12px">卡片會顯示前一句，你先回想自己的台詞，再翻開對答案。</p>
    <div class="card"><b>範圍</b>${seg('scope', [[0, '全劇'], [1, '第一幕'], [2, '第二幕'], [3, '第三幕']])}
      <b>要練哪些</b>${seg('deck', [['unmastered', '還沒背熟的'], ['all', '全部我的台詞'], ['weak', '常忘／⚠ 標記的']])}</div>
    <button class="btn primary" data-fc="start" style="width:100%;font-size:18px"${n ? '' : ' disabled'}>${n ? `開始練習（${n} 張）` : '這個範圍沒有台詞可以練'}</button>`;
}
function fcAct(a) {
  if (a === 'start') { const ids = deckIds(); deck = { ids, i: 0, show: false, hint: false, ok: 0, bad: [] }; }
  else if (a === 'again') deck = { ids: [...deck.bad], i: 0, show: false, hint: false, ok: 0, bad: [] };
  else if (a === 'end') deck = null;
  else if (a === 'reveal') deck.show = !deck.show;
  else if (a === 'hint') deck.hint = true;
  else if (a === 'ok' || a === 'bad') {
    const id = deck.ids[deck.i];
    if (a === 'ok') { deck.ok++; S.mastered[id] = 1; } else { deck.bad.push(id); addPrompt(id); }
    deck.i++; deck.show = false; deck.hint = false; save();
  }
  render();
}

/* ---------- 列印／存成 PDF 的台詞本 ---------- */
function viewPrint() {
  const f = S.roles, cues = route.q.cues === '1';
  const m = S.mode; S.mode = 'read';
  const acts = D.script.acts.map(a => {
    const flat = []; a.scenes.forEach(sc => { flat.push({ t: 'scene', sc }); sc.items.forEach(i => flat.push(i)); });
    const keep = new Array(flat.length).fill(!cues), cue = new Set();
    if (cues && f.length) flat.forEach((it, i) => {
      if (it.t === 'scene') keep[i] = true;
      if (!isMine(it, f)) return; keep[i] = true;
      let j = i - 1; while (j >= 0 && flat[j].t === 'stage') { keep[j] = true; j--; }
      if (j >= 0 && flat[j].t === 'line' && !isMine(flat[j], f)) { keep[j] = true; cue.add(j); }
    });
    let h = `<h2 class="ph">第${'一二三'[a.n - 1]}幕</h2>`, gap = false;
    flat.forEach((it, i) => {
      if (!keep[i]) { gap = true; return; }
      if (gap && it.t !== 'scene') h += '<div class="gap">⋯</div>'; gap = false;
      if (it.t === 'scene') h += `<div class="scene"><b>場景 ${it.sc.no}・${esc(it.sc.title)}</b><div class="desc">${esc(it.sc.desc)}</div></div>`;
      else if (it.t === 'stage') h += `<div class="stage">（${esc(it.text)}）</div>`;
      else h += lineHtml(it, { mine: isMine(it, f), cue: cue.has(i) });
    });
    return h;
  }).join('');
  S.mode = m;
  return `<div class="noprint"><h1 class="page-title">列印台詞本</h1>
    <p class="muted" style="margin:0 0 10px">你的台詞會用灰底粗體標出。按「列印」後，在手機可選「存成 PDF」或分享。</p>
    <div class="opts" style="flex-wrap:wrap;margin-bottom:10px"><a class="opt${cues ? '' : ' on'}" href="#/print">完整劇本</a><a class="opt${cues ? ' on' : ''}" href="#/print?cues=1">只印我的台詞（含前一句）</a></div>
    <div class="btn-row"><button class="btn primary" data-do="printnow">🖨 列印／存成 PDF</button><a class="btn" href="#/more" style="text-decoration:none">返回</a></div>
    ${f.length ? '' : '<div class="banner">還沒選擇角色，所以沒有標出台詞。</div>'}</div><div class="script printdoc">${acts}</div>`;
}

/* ---------- 使用說明 ---------- */
function viewHelp() {
  const sec = (t, body) => `<details class="card"><summary><b>${t}</b></summary><div class="helpbody">${body}</div></details>`;
  return `<h1 class="page-title">使用說明</h1>
  ${sec('第一次使用', '<p>打開後先選「我的角色」（可以複選）。選好之後，劇本裡你的台詞會用黃底粗體標出來，也會算出每一場你有幾句。</p><p>用 Safari／Chrome 把網站「加到主畫面」，就能像 App 一樣離線使用。</p>')}
  ${sec('閱讀', '<p>頂端切換三幕。📑 可以看場景目錄、直接跳到某一場。「只看我的台詞」會把別人的台詞收起來，只留你的台詞和前一句（提詞用）。右下角的「▼ 我的下一句」可以一句一句跳。</p>')}
  ${sec('背誦', '<p>你的台詞會被蓋住，點一下才顯示，念完打勾表示背熟。可以選「每句首字」提示，也能只練還沒背熟或 ⚠ 標記的。</p><p>閃卡練習：顯示前一句，你回想台詞再翻牌，記得或忘了都會記錄。</p>')}
  ${sec('彩排', '<p>目前的句子會放大框起來，按 ▶ 或左右滑動換句。「丟本」會蓋住你的台詞，被你點開提詞的次數會累計，兩次以上自動標 ⚠。</p><p>「🔊 朗讀對詞」會用語音念別人的台詞，輪到你就停下或等你念。</p>')}
  ${sec('筆記', '<p>每句台詞旁的 ✎ 可以寫筆記、標 ⚠；每個場景標題旁也有。角色頁可以寫角色小傳。筆記只存在你的手機，別人看不到。</p>')}
  ${sec('備份與換手機', '<p>設定頁可以匯出備份檔，換手機或清除瀏覽資料前先匯出，到新手機再匯入。</p>')}
  <a href="#/more">‹ 返回</a>`;
}

const rerender = keepRender;
function openNote(key) {
  const isScene = key.startsWith('scene:');
  let title = '';
  if (isScene) { const sc = D.script.acts.flatMap(a => a.scenes).find(x => x.id === key.slice(6)); title = `場景 ${sc.no}${sc.title ? '・' + sc.title : ''}`; }
  else { const l = Object.values(linesByAct).flat().find(x => x.id === key); title = l ? `${l.label}：${l.text.replace(/\n/g, ' ').slice(0, 26)}…` : ''; }
  const tags = ['停頓', '轉身', '放慢', '大聲', '放柔', '看著對方', '走位'];
  showSheet(`<h2>筆記</h2><p class="muted" style="margin:0 0 10px;font-size:14px">${esc(title)}</p>
    <textarea id="notetxt" rows="5" placeholder="例如：這裡要停頓一拍、轉身看艾薇…">${esc(S.notes[key] || '')}</textarea>
    <div class="opts" style="margin:8px 0">${tags.map(t => `<button class="opt" data-do="tag" data-tag="${t}">${t}</button>`).join('')}</div>
    ${isScene ? '' : `<label class="pick"><input type="checkbox" id="noteflag" ${S.flags[key] ? 'checked' : ''}>⚠ 標記為常忘（之後可以專門複習）</label>`}
    <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-do="saveNote" data-key="${esc(key)}" style="flex:1">儲存</button>
    ${S.notes[key] || S.flags[key] ? `<button class="btn" data-do="delNote" data-key="${esc(key)}">刪除</button>` : ''}<button class="btn" data-do="close">取消</button></div>`);
}
function gotoScene(id) {
  const el = document.getElementById(id); if (!el) return;
  if (S.mode === 'rehearse') {
    let n = el.nextElementSibling; while (n && !n.classList.contains('line')) n = n.nextElementSibling;
    if (n) return setCursor($$('.line').indexOf(n));
  }
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function exportData() {
  const { roles, mastered, notes, flags, roleNotes, prompts, font, theme } = S;
  const blob = new Blob([JSON.stringify({ app: 'xmas-play-2026', roles, mastered, notes, flags, roleNotes, prompts, font, theme }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xmas-play-backup.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.addEventListener('change', e => {
  if (e.target.id !== 'importfile' || !e.target.files[0]) return;
  e.target.files[0].text().then(txt => {
    const d = JSON.parse(txt);
    if (d.app !== 'xmas-play-2026') throw 0;
    ['roles', 'mastered', 'notes', 'flags', 'roleNotes', 'prompts', 'font', 'theme'].forEach(k => { if (d[k] !== undefined) S[k] = d[k]; });
    save(); applyTheme(); document.documentElement.style.setProperty('--fs', S.font + 'px'); render(); toast('已匯入備份');
  }).catch(() => toast('這不是有效的備份檔'));
});
/* 彩排：左右滑動換句 */
let tx = null;
document.addEventListener('touchstart', e => { tx = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!tx || route.name !== 'read' || S.mode !== 'rehearse' || !$('#overlay').hidden || e.target.closest('.opts,.dock,.rhead')) return;
  const dx = e.changedTouches[0].clientX - tx[0], dy = e.changedTouches[0].clientY - tx[1]; tx = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 45) setCursor(cur + (dx < 0 ? 1 : -1));
}, { passive: true });

function shareApp() {
  const url = location.origin + location.pathname, data = { title: '2026 聖誕劇劇本', text: '聖誕劇演員用劇本網站（可離線、背台詞、彩排）', url };
  if (navigator.share) navigator.share(data).catch(() => { });
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('網址已複製'));
  else prompt('複製這個網址：', url);
}

/* ---------- 新手導覽（第一次打開）與各頁面的第一次提示 ---------- */
const TOUR = [
  { icon: '🎭', title: '歡迎來到聖誕劇劇本', text: '先選你的角色，劇本裡你的台詞就會自動標出來，其他人的台詞只當提示。',
    demo: '<div class="chips"><span class="chip">可凡</span><span class="chip gold">若心 ✓</span><span class="chip">艾薇</span></div><p class="muted" style="margin:10px 0 0;font-size:13px">可以複選，一人分飾兩角也沒問題</p>' },
  { icon: '📖', title: '讀劇本、背台詞', text: '黃底粗體就是你的台詞。「背誦」會蓋住你的台詞，點一下才顯示，念對了打勾；「閃卡」只給前一句，讓你先回想再翻牌。',
    demo: '<div class="line"><div class="who" style="--h:120">艾薇</div><div class="say">若心啊，你真的沒變……</div></div><div class="line mine"><div class="who" style="--h:20">若心</div><div class="say">（又好笑，又緊張）小聲一點啊！</div></div><div class="line mine"><div class="who" style="--h:20">若心</div><div class="say covered"><span class="hintt">還＿＿＿＿，是＿，我＿＿＿</span></div></div>' },
  { icon: '🎬', title: '彩排、筆記與備份', text: '彩排按 ▶ 或左右滑動換句，也能讓手機念別人的台詞。每句旁的 ✎ 可以寫筆記。資料只存在你的手機，換手機前到「設定」匯出備份。',
    demo: '<div class="line cursor mine" style="outline:3px solid var(--accent);outline-offset:-2px"><div class="who" style="--h:20">若心</div><div class="say">輪到你了！</div></div><div class="pad demo-pad"><span>⏮</span><span>◀</span><span class="m">▶</span><span>⏭</span></div><p class="muted" style="margin:10px 0 0;font-size:13px">小提醒：把網站「加到主畫面」就能離線使用</p>' },
];
function openTour() {
  const o = $('#overlay');
  o.innerHTML = `<div class="tour" role="dialog" aria-label="新手導覽"><button class="skip" data-tour="skip">略過</button>
    <div class="track" id="tourtrack">${TOUR.map(s => `<section><div class="ticon">${s.icon}</div><h2>${s.title}</h2><p>${s.text}</p><div class="demo">${s.demo}</div></section>`).join('')}</div>
    <div class="dots" id="tourdots">${TOUR.map(() => '<i></i>').join('')}</div>
    <div class="tour-btns"><button class="btn" data-tour="prev">上一步</button><button class="btn primary" data-tour="next">下一步</button></div></div>`;
  o.hidden = false;
  const tr = $('#tourtrack'), upd = () => {
    const i = Math.round(tr.scrollLeft / tr.clientWidth);
    $$('#tourdots i').forEach((d, k) => d.classList.toggle('on', k === i));
    $('[data-tour=prev]').style.visibility = i ? 'visible' : 'hidden';
    $('[data-tour=next]').textContent = i === TOUR.length - 1 ? '開始使用' : '下一步';
    tr.dataset.i = i;
  };
  tr.addEventListener('scroll', upd, { passive: true }); upd();
}
function tourAct(a) {
  const tr = $('#tourtrack'); if (!tr) return;
  const i = +tr.dataset.i || 0;
  if (a === 'skip' || (a === 'next' && i >= TOUR.length - 1)) {
    S.onboarded = 1; save(); closeSheet();
    if (!S.roles.length) openRolePicker(true);
    return;
  }
  tr.scrollTo({ left: (i + (a === 'next' ? 1 : -1)) * tr.clientWidth, behavior: 'smooth' });
}
const TIPS = {
  read: ['閱讀', '📑 看場景目錄、🔍 搜尋台詞；右下角「▼ 我的下一句」一句句跳。上方可以切換「背誦」和「彩排」。'],
  memo: ['背誦', '你的台詞被蓋住了，點一下顯示，念對了按 ✓。想只練還沒背熟的，打開上方的選項。'],
  rehearse: ['彩排', '按 ▶ 或左右滑動換句；「丟本」會蓋住你的台詞，點開提詞會被記下來；🔊 讓手機念別人的台詞。'],
  cards: ['閃卡', '先自己回想台詞，再點卡片看答案。按「忘了」會記下來，之後可以專門複習。'],
  roles: ['角色', '可以複選自己的角色，也能寫角色小傳。「看他的台詞」可以只看某個角色。'],
  schedule: ['行程', '灰色的是已經過的排練。可以匯出到手機行事曆，排練前一小時會提醒你。'],
};
function maybeTip() {
  const old = $('.tip'); if (old) old.remove();
  const key = route.name === 'read' ? S.mode : route.name, tip = TIPS[key];
  if (!tip || S.tipsSeen[key] || !S.onboarded) return;
  const at = location.hash;
  setTimeout(() => {
    if (location.hash !== at || !$('#overlay').hidden || $('.tip') || S.tipsSeen[key]) return;
    S.tipsSeen[key] = 1; save();
    const d = document.createElement('div'); d.className = 'tip' + (key === 'rehearse' ? ' high' : '');
    d.innerHTML = `<b>${tip[0]}小提示</b><p>${tip[1]}</p><button class="btn small primary" data-tip="x">知道了</button>`;
    document.body.appendChild(d);
  }, 600);
}

/* ---------- 螢幕常亮 ---------- */
let wl = null;
async function wake(on) {
  try {
    if (on && S.keepAwake && 'wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) { wl = null; }
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-do],[data-mode],[data-opt],[data-chk],[data-nav],[data-role],[data-go],[data-note],[data-scene],[data-tts],[data-prep],[data-tour],[data-tip],.script:not(.rehearse) .line,[data-cards],[data-fc],[data-cset],[data-sg],.covered,.rehearse .line,#overlay');
  if (!t) return;
  if (t.id === 'overlay') { if (e.target === t) closeSheet(); return; }
  const d = t.dataset;
  if (d.go) { S.mode = d.go; save(); const a = S.last.act || 1; location.hash = `#/read/${a}?resume=1`; if (route.name === 'read') render(); return; }
  if (d.mode) { S.mode = d.mode; revealed.clear(); save(); keepRender(); return; }
  if (d.tour) return tourAct(d.tour);
  if (d.tip) { t.closest('.tip').remove(); return; }
  if (d.prep) { S.mode = 'read'; S.last = { act: +d.prep, line: null }; save(); location.hash = `#/read/${d.prep}`; if (route.name === 'read') render(); return; }
  if (d.cards) { S.cards.deck = d.cards; save(); deck = null; location.hash = '#/cards'; if (route.name === 'cards') render(); return; }
  if (d.fc) return fcAct(d.fc);
  if (d.cset) { S.cards[d.cset] = d.cset === 'scope' ? +d.v : d.cset === 'shuffle' ? d.v === 'true' : d.v; save(); return render(); }
  if (d.sg) { closeSheet(); const [ac, sid] = d.sg.split(':'); return +ac === route.act && route.name === 'read' ? gotoScene(sid) : (location.hash = `#/read/${ac}?scene=${sid}`); }
  if (d.opt) {
    if (d.opt === 'hint') S.hint = S.hint === 'first' ? 'none' : 'first'; else S[d.opt] = !S[d.opt];
    save(); route.name === 'read' ? (revealed.clear(), keepRender()) : render();
    if ($('#optsheet')) openOpts();
    return;
  }
  if (d.chk) {
    S.mastered[d.chk] ? delete S.mastered[d.chk] : (S.mastered[d.chk] = 1); save();
    const ln = t.closest('.line'); t.classList.toggle('on', !!S.mastered[d.chk]); ln.classList.toggle('mastered', !!S.mastered[d.chk]);
    { const p = myProgress(focusRoles()).find(x => x.n === route.act), el = $('#progtxt'); if (el && p) { el.textContent = `本幕已背熟 ${p.done}/${p.total}`; el.previousElementSibling.firstChild.style.width = p.done / p.total * 100 + '%'; } }
    return;
  }
  if (d.nav) {
    ({ next: () => setCursor(cur + 1), prev: () => setCursor(cur - 1), mnext: () => jumpMine(1), mprev: () => jumpMine(-1) })[d.nav]();
    return;
  }
  if (d.role) { S.roles = S.roles.includes(d.role) ? S.roles.filter(r => r !== d.role) : [...S.roles, d.role]; save(); const y = scrollY; render(); scrollTo(0, y); return; }
  if (d.tts === 'test') { speechSynthesis.cancel(); utter('各位，我們準備好了嗎？來，從第一句開始。', 'kefan'); return; }
  if (d.tts) return d.tts === 'toggle' ? (playing ? ttsStop() : ttsStart()) : d.tts === 'set' ? ttsSettings() : null;
  if (d.note) return openNote(d.note);
  if (d.scene) return gotoScene(d.scene);
  if (d.do) return doAction(d.do, e, t);
  if (t.classList.contains('line') && !t.closest('.rehearse')) { t.classList.toggle('sel'); return; } // 閱讀：點一下別人的台詞，顯示 ✎ 筆記
  if (t.classList.contains('line')) { // 彩排：點哪句，游標到哪句；被蓋住的台詞順便翻開
    const els = $$('.line'); const i = els.indexOf(t); const say = $('.covered', t);
    if (say) {
      const was = say.classList.contains('revealed'); say.classList.toggle('revealed');
      was ? revealed.delete(t.dataset.id) : revealed.add(t.dataset.id);
      if (!was && S.mode === 'rehearse' && t.dataset.mine) addPrompt(t.dataset.id); // 被提詞
    }
    setCursor(i, false); return;
  }
  if (t.classList.contains('covered') && S.mode === 'rehearse') { t.closest('.line').click(); return; }
  if (t.classList.contains('covered')) {
    const id = t.closest('.line').dataset.id;
    t.classList.toggle('revealed'); revealed.has(id) ? revealed.delete(id) : revealed.add(id);
  }
});
function doAction(a, e, t) {
  if (a === 'pick') openRolePicker(false);
  else if (a === 'close') closeSheet();
  else if (a === 'saveRoles') { S.roles = $$('#overlay input:checked').map(i => i.value); save(); closeSheet(); render(); toast(S.roles.length ? '已儲存我的角色' : '尚未選擇角色'); }
  else if (a === 'font+' || a === 'font-') { S.font = Math.min(32, Math.max(14, S.font + (a === 'font+' ? 1 : -1))); document.documentElement.style.setProperty('--fs', S.font + 'px'); save(); toast(`字體 ${S.font}`); }
  else if (a === 'search') openSearch();
  else if (a === 'scenes') openScenes();
  else if (a === 'opts') openOpts();
  else if (a === 'fontsheet') openFont();
  else if (a === 'printnow') window.print();
  else if (a === 'share') shareApp();
  else if (a === 'tour') { S.tipsSeen = {}; save(); openTour(); }
  else if (a === 'revealAll') { $$('.covered').forEach(c => { c.classList.add('revealed'); revealed.add(c.closest('.line').dataset.id); }); closeSheet(); }
  else if (a === 'ics') downloadIcs();
  else if (a === 'past') { S.showPast = !S.showPast; save(); render(); }
  else if (a === 'install' && installEvt) { installEvt.prompt(); installEvt = null; }
  else if (a === 'saveNote') {
    const k = t.dataset.key, v = $('#notetxt').value.trim(), fl = $('#noteflag');
    v ? S.notes[k] = v : delete S.notes[k];
    if (fl) fl.checked ? S.flags[k] = 1 : delete S.flags[k];
    save(); closeSheet(); rerender(); toast('已儲存筆記');
  }
  else if (a === 'delNote') { const k = t.dataset.key; delete S.notes[k]; delete S.flags[k]; save(); closeSheet(); rerender(); }
  else if (a === 'tag') { const ta = $('#notetxt'); ta.value = (ta.value ? ta.value.replace(/\s*$/, '、') : '') + t.dataset.tag; ta.focus(); }
  else if (a === 'export') exportData();
  else if (a === 'import') $('#importfile').click();
  else if (a === 'resetMastered') { if (confirm('確定要清除所有「背熟了」的標記嗎？')) { S.mastered = {}; save(); render(); } }
}
document.addEventListener('input', e => {
  const rn = e.target.closest('[data-rn]');
  if (rn) { rn.value.trim() ? S.roleNotes[rn.dataset.rn] = rn.value : delete S.roleNotes[rn.dataset.rn]; save(); return; }
  const t = e.target.closest('[data-set]'); if (!t) return;
  if (t.dataset.set === 'font') { S.font = +t.value; document.documentElement.style.setProperty('--fs', S.font + 'px'); }
  if (t.dataset.set === 'theme') { S.theme = t.value; applyTheme(); }
  save();
});
document.addEventListener('keydown', e => {
  if (route.name !== 'read' || S.mode !== 'rehearse' || e.target.closest('input')) return;
  if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); setCursor(cur + 1); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setCursor(cur - 1); }
});

if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) { toast('已更新到新版本'); setTimeout(() => location.reload(), 800); } });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
boot();
