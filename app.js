'use strict';
/* 2026 聖誕劇劇本：純靜態 PWA，資料來自 data/*.json，使用者設定存在 localStorage */
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'xmas-play-v1';
const DEF = {
  roles: [], font: 19, theme: 'auto', mastered: {}, mode: 'read', onlyMine: false, hint: 'first',
  unmasteredOnly: false, flaggedOnly: false, myScenesOnly: false, notes: {}, flags: {}, roleNotes: {}, cover: false, keepAwake: true, showPast: false, last: { act: 1, line: null },
};
let S = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* 無痕模式等情況 */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

let D = null;           // { script, schedule, crew }
let roleById = {};
let linesByAct = {};
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
const NAV = [['home', '首頁', 'home', '#/'], ['read', '劇本', 'book', '#/read?resume=1'], ['roles', '角色', 'mask', '#/roles'], ['schedule', '行程', 'cal', '#/schedule'], ['more', '更多', 'more', '#/more']];

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
  D.script.acts.forEach(a => {
    linesByAct[a.n] = a.scenes.flatMap(s => s.items.filter(i => i.t === 'line'));
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(route.name === 'read' && S.mode === 'rehearse'); });
  render();
  if (!S.roles.length && !sessionStorage.getItem('asked')) { sessionStorage.setItem('asked', '1'); setTimeout(() => openRolePicker(true), 300); }
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
  window.onscroll = null;
  const view = { home: viewHome, read: viewRead, roles: viewRoles, schedule: viewSchedule, more: viewMore, crew: viewCrew, settings: viewSettings }[route.name] || viewHome;
  const app = $('#app');
  app.className = '';
  app.innerHTML = view();
  const tab = ['crew', 'settings'].includes(route.name) ? 'more' : route.name;
  $('#nav').innerHTML = NAV.map(([k, t, ic, href]) => `<a href="${href}" class="${k === tab ? 'on' : ''}"><svg viewBox="0 0 24 24">${ICONS[ic]}</svg>${t}</a>`).join('');
  if (route.name === 'read') afterRead();
  else window.scrollTo(0, 0);
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
  return `
  <div class="hero"><small>CHRISTMAS PLAY 2026</small><h1>聖誕劇劇本</h1>
    <blockquote>林前 4:9　因為我們成了一臺戲，給世人和天使觀看。</blockquote></div>
  <div class="card"><h3>我的角色</h3>
    <div class="chips">${S.roles.length ? S.roles.map(r => `<span class="chip gold">${esc(roleName(r))}</span>`).join('') : '<span class="muted">還沒選擇角色</span>'}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn small" data-do="pick">${S.roles.length ? '修改角色' : '選擇我的角色'}</button></div>
  </div>
  <div class="card"><h3>下一次排練</h3>${nextHtml}<div style="margin-top:12px"><a class="btn small" href="#/schedule" style="text-decoration:none;display:inline-flex;align-items:center">完整行程</a></div></div>
  ${drop}
  ${prog ? `<div class="card"><h3>背誦進度</h3>${prog}</div>` : ''}
  <div class="cta">
    <button class="btn" data-go="read"><b>📖</b>閱讀</button>
    <button class="btn" data-go="memo"><b>🧠</b>背台詞</button>
    <button class="btn" data-go="rehearse"><b>🎬</b>彩排</button>
  </div>`;
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
  if (!reh) opts.push(`<button class="opt${S.onlyMine ? ' on' : ''}" data-opt="onlyMine">只看我的台詞</button>`);
  if (f.length) opts.push(`<button class="opt${S.myScenesOnly ? ' on' : ''}" data-opt="myScenesOnly">只看我有戲的場景</button>`);
  if (memo) {
    opts.push(`<button class="opt${S.hint === 'first' ? ' on' : ''}" data-opt="hint">提示：${S.hint === 'first' ? '每句首字' : '全部蓋住'}</button>`);
    opts.push(`<button class="opt${S.unmasteredOnly ? ' on' : ''}" data-opt="unmasteredOnly">只練還沒背熟的</button>`);
    opts.push(`<button class="opt${S.flaggedOnly ? ' on' : ''}" data-opt="flaggedOnly">只練 ⚠ 標記的</button>`);
    opts.push('<button class="opt" data-do="revealAll">全部顯示</button>');
  }
  if (reh) opts.push(`<button class="opt${S.cover ? ' on' : ''}" data-opt="cover">丟本：蓋住我的台詞</button>`);
  const pr = memo && f.length ? myProgress(f).find(p => p.n === n) : null;
  return `
  <div class="rhead" id="rhead">
    <div class="rrow"><div class="tabs">${[1, 2, 3].map(i => `<a href="#/read/${i}${route.q.role ? '?role=' + route.q.role : ''}" class="${i === n ? 'on' : ''}">第${'一二三'[i - 1]}幕</a>`).join('')}</div>
      <button class="ibtn" data-do="font-" aria-label="縮小字體">A−</button><button class="ibtn" data-do="font+" aria-label="放大字體">A＋</button><button class="ibtn" data-do="search" aria-label="搜尋">🔍</button></div>
    <div class="rrow opts scn">${scenes.map(sc => `<button class="opt${f.length && hasMine(sc) ? ' mine' : ''}" data-scene="${sc.id}">${sc.no}．${esc(sc.title || '場景')}</button>`).join('')}</div>
    <div class="rrow"><div class="seg">${modes.map(([k, t]) => `<button data-mode="${k}" class="${S.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    ${opts.length ? `<div class="rrow opts">${opts.join('')}</div>` : ''}
    ${pr && pr.total ? `<div class="rrow" style="font-size:12px;color:var(--muted)"><div class="bar" style="flex:1"><i style="width:${pr.done / pr.total * 100}%"></i></div><span id="progtxt">本幕已背熟 ${pr.done}/${pr.total}</span></div>` : ''}
  </div>
  ${roleBanner}${noRole}
  <div class="script${reh ? ' rehearse' : ''}" id="script">${html || '<p class="muted">這一幕沒有符合的台詞。</p>'}</div>
  ${reh ? `<div class="dock"><div class="info" id="info"></div><div class="pad">
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
  } else if (S.mode !== 'rehearse') window.scrollTo(0, 0);
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
  const g = k => D.script.roles.filter(r => r.group === k).map(card).join('');
  return `<h1 class="page-title">角色</h1><p class="muted" style="margin:0">可以複選（例如一人分飾兩角）。</p>
    ${g('main')}<div class="roles-h">少女舞團</div>${g('dance')}<div class="roles-h">其他小角色</div>${g('minor')}`;
}
function openRolePicker(first) {
  const groups = [['main', '主要角色'], ['dance', '少女舞團'], ['minor', '其他小角色']];
  const body = groups.map(([k, t]) => `<div class="roles-h">${t}</div>` + D.script.roles.filter(r => r.group === k).map(r => {
    const total = r.lines[1] + r.lines[2] + r.lines[3];
    return `<label class="pick"><input type="checkbox" value="${r.id}" ${S.roles.includes(r.id) ? 'checked' : ''}>${esc(r.name)}<small>${total} 句</small></label>`;
  }).join('')).join('');
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
      `SUMMARY:聖誕劇｜${e.title}`, `DESCRIPTION:${(e.note || '').replace(/[,;\n]/g, ' ')}`, 'END:VEVENT'].join('\r\n');
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
  <div class="card list"><a href="#/crew">劇組分工 <span>›</span></a><a href="#/settings">設定 <span>›</span></a></div>
  ${standalone ? '' : `<div class="card"><h3>安裝成 App</h3>
    ${ios ? '<p style="margin:0">用 Safari 開啟，點下方「分享」→「加入主畫面」，之後就能像 App 一樣離線使用。</p>'
      : installEvt ? '<button class="btn primary" data-do="install">安裝到手機</button>' : '<p style="margin:0">用 Chrome 開啟，點右上角選單 →「安裝應用程式／加到主畫面」，之後就能離線使用。</p>'}</div>`}
  <p class="muted" style="font-size:13px">資料只存在你的手機，不會上傳。換手機或清除瀏覽資料後需重新選角色。</p>`;
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
    <div class="set"><span>彩排時螢幕保持亮著</span>${sw('keepAwake', S.keepAwake)}</div></div>
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

/* ---------- 筆記、場景跳轉、備份 ---------- */
function rerender() { const y = scrollY; render(); if (S.mode !== 'rehearse') scrollTo(0, y); }
function openNote(key) {
  const isScene = key.startsWith('scene:');
  let title = '';
  if (isScene) { const sc = D.script.acts.flatMap(a => a.scenes).find(x => x.id === key.slice(6)); title = `場景 ${sc.no}${sc.title ? '・' + sc.title : ''}`; }
  else { const l = Object.values(linesByAct).flat().find(x => x.id === key); title = l ? `${l.label}：${l.text.replace(/\n/g, ' ').slice(0, 26)}…` : ''; }
  const tags = ['停頓', '轉身', '放慢', '大聲', '放柔', '看著對方', '走位'];
  showSheet(`<h2>筆記</h2><p class="muted" style="margin:0 0 10px;font-size:14px">${esc(title)}</p>
    <textarea id="notetxt" rows="5" placeholder="例如：這裡要停頓一拍、轉身看艾薇…">${esc(S.notes[key] || '')}</textarea>
    <div class="opts" style="margin:8px 0">${tags.map(t => `<button class="opt" data-do="tag" data-tag="${t}">${t}</button>`).join('')}</div>
    ${isScene ? '' : `<label class="pick"><input type="checkbox" id="noteflag" ${S.flags[key] ? 'checked' : ''}>⚠ 標記為容易忘／要特別注意</label>`}
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
  const { roles, mastered, notes, flags, roleNotes, font, theme } = S;
  const blob = new Blob([JSON.stringify({ app: 'xmas-play-2026', roles, mastered, notes, flags, roleNotes, font, theme }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xmas-play-backup.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.addEventListener('change', e => {
  if (e.target.id !== 'importfile' || !e.target.files[0]) return;
  e.target.files[0].text().then(txt => {
    const d = JSON.parse(txt);
    if (d.app !== 'xmas-play-2026') throw 0;
    ['roles', 'mastered', 'notes', 'flags', 'roleNotes', 'font', 'theme'].forEach(k => { if (d[k] !== undefined) S[k] = d[k]; });
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
  const t = e.target.closest('[data-do],[data-mode],[data-opt],[data-chk],[data-nav],[data-role],[data-go],[data-note],[data-scene],.covered,.rehearse .line,#overlay');
  if (!t) return;
  if (t.id === 'overlay') { if (e.target === t) closeSheet(); return; }
  const d = t.dataset;
  if (d.go) { S.mode = d.go; save(); const a = S.last.act || 1; location.hash = `#/read/${a}?resume=1`; if (route.name === 'read') render(); return; }
  if (d.mode) { S.mode = d.mode; revealed.clear(); save(); render(); return; }
  if (d.opt) {
    if (d.opt === 'hint') S.hint = S.hint === 'first' ? 'none' : 'first'; else S[d.opt] = !S[d.opt];
    save(); route.name === 'settings' ? render() : (revealed.clear(), render()); return;
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
  if (d.note) return openNote(d.note);
  if (d.scene) return gotoScene(d.scene);
  if (d.do) return doAction(d.do, e, t);
  if (t.classList.contains('line')) { // 彩排：點哪句，游標到哪句；被蓋住的台詞順便翻開
    const els = $$('.line'); const i = els.indexOf(t); const say = $('.covered', t);
    if (say) { say.classList.toggle('revealed'); revealed.has(t.dataset.id) ? revealed.delete(t.dataset.id) : revealed.add(t.dataset.id); }
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
  else if (a === 'revealAll') { $$('.covered').forEach(c => { c.classList.add('revealed'); revealed.add(c.closest('.line').dataset.id); }); }
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
