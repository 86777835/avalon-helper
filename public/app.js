import { ROLES, SIDE_ZH, OPTIONAL, SIDES, TEAM, MIN, MAX, MAX_REJECTS, failsNeeded, config, lineup, check } from './logic.js';

// What each role knows and does, in short (written for this site, from the rulebook).
const DESC = {
  merlin: '你知道谁是邪恶方（莫德雷德除外）。引导好人做对任务，但别暴露自己：好人完成 3 个任务后，刺客认出你，好人就输。',
  percival: '你要找出并保护梅林。有莫甘娜时，你看到的两个人里一个是梅林、一个是莫甘娜。',
  servant: '你没有特殊信息。听大家发言、看投票和任务结果，找出邪恶方。',
  assassin: '你和邪恶同伴互相认识。好人完成 3 个任务后，由你指认梅林，认对了邪恶方获胜。',
  morgana: '你和邪恶同伴互相认识。在派西维尔眼里，你和梅林一模一样。',
  mordred: '你和邪恶同伴互相认识，而梅林看不到你。',
  oberon: '你是邪恶方，但不认识同伴，同伴也不认识你。梅林看得到你。',
  minion: '你和邪恶同伴互相认识。想办法混进队伍，让任务失败。'
};
const TAG = { evil: '邪恶', mm: '梅林或莫甘娜', merlin: '梅林' };
const WHY = { quests: '3 个任务失败', rejects: '同一轮 5 次组队都被否决', stab: '刺客认出了梅林', missed: '刺客没有认出梅林' };
const ZH = ['一', '二', '三', '四', '五'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const tokenKey = c => 'avl-seat-' + c;

let code = cleanCode(new URLSearchParams(location.search).get('r'));
let S = null, noRoom = false, online = false, ws = null, queue = [], retry = 0;
// pick: team being picked; votes: votes being entered; fails: fail count being entered; card: phone card chosen, not yet sent
const ui = { tab: 'game', pick: [], votes: {}, fails: 0, card: null, target: null, hold: false, sheet: null, err: '', busy: false, rooms: null, saving: false, rv: null, joining: false, draftKey: '' };

/* ---------- connection ---------- */
function connect() {
  if (!code) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room/${code}/ws`);
  ws.onopen = () => {
    retry = 0; online = true;
    const t = store.get(tokenKey(code));
    if (t) ws.send(JSON.stringify({ hello: t }));
    queue.splice(0).forEach(m => ws.send(m)); render();
  };
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      const before = S; S = m.state; remember(code); syncDrafts(); newLady(before); render();
    } else if (m.type === 'seat') { store.set(tokenKey(code), m.token); ui.joining = false; }
    else if (m.type === 'error') {
      if (m.error === 'noroom') { noRoom = true; forget(code); ws.close(); render(); }
      else if (m.error === 'noseat') { store.del(tokenKey(code)); }
      else if (m.error === 'started') { ui.joining = false; toast('游戏已经开始，不能再入座'); }
      else if (m.error === 'nojoin') { ui.joining = false; toast('入座失败：最多 10 人'); }
      else if (m.error === 'viewonly') toast('先入座才能操作');
    }
  };
  ws.onclose = () => {
    online = false; render();
    if (!noRoom && code) setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
  };
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && code && !noRoom && (!ws || ws.readyState > 1)) { retry = 0; connect(); }
});
function sendRaw(o) { const m = JSON.stringify(o); if (ws && ws.readyState === 1) ws.send(m); else queue.push(m); }
const send = action => sendRaw({ action });

// Inputs being filled in reset when the step they belong to changes.
function syncDrafts() {
  const c = S.cur, k = c ? `${S.gid}:${c.q}:${c.att}:${c.step}:${S.stage}` : 'setup';
  if (k === ui.draftKey) return;
  ui.draftKey = k; ui.pick = []; ui.votes = {}; ui.fails = 0; ui.card = null; ui.target = null;
}
// A Lady of the Lake check this phone just made: show the result once.
function newLady(before) {
  const now = S.me?.lady || [], old = before?.gid === S.gid ? before?.me?.lady || [] : now;
  if (now.length > old.length) ui.sheet = { kind: 'lady', ...now.at(-1) };
}

/* ---------- rooms this phone has been in ---------- */
function mine() { try { const v = JSON.parse(store.get('avl-mine')); if (Array.isArray(v)) return v; } catch {} return []; }
const remember = c => store.set('avl-mine', JSON.stringify([c, ...mine().filter(x => x !== c)].slice(0, 8)));
const forget = c => store.set('avl-mine', JSON.stringify(mine().filter(x => x !== c)));
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`;
}
async function loadRooms() {
  if (code) return;
  try { const r = await fetch('/api/rooms'); if (r.ok) { ui.rooms = await r.json(); render(); } } catch {}
}
setInterval(() => { if (!code && !document.hidden) loadRooms(); }, 8000);
function cleanCode(v) { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); return c.length === 4 ? c : null; }

/* ---------- helpers ---------- */
const myId = () => S?.me?.id || null;
const seated = () => !!myId() && S.seats.some(p => p.id === myId());
const nm = id => S.seats.find(p => p.id === id)?.name ?? '?';
const n = () => S.seats.length;
const roleImg = (r, cls = 'sm') => `<span class="por ${cls}" style="--c:var(--${ROLES[r].side})"><img src="img/${r}.jpg" alt=""></span>`;
const initial = (id, cls = 'xs') => `<span class="por ini ${cls}" style="--c:${S.roles ? `var(--${ROLES[S.roles[id]].side})` : 'var(--silver)'}"><b>${esc([...nm(id)][0] || '?')}</b></span>`;
function toast(t) { const el = $('#toast'); el.innerHTML = `<div class="toast">${esc(t)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => el.innerHTML = '', 2000); }

/* ---------- render (DOM morph keeps focus and typed text) ---------- */
function morph(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  bc.forEach((y, i) => {
    const x = ac[i];
    if (!x) { a.appendChild(y); return; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute('data-k') !== y.getAttribute('data-k'))) { a.replaceChild(y, x); return; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') {
      const v = y.tagName === 'TEXTAREA' ? y.value : y.getAttribute('value') ?? '';
      if (x !== document.activeElement && x.value !== v) x.value = v;
      return;
    }
    if ('disabled' in x) x.disabled = y.hasAttribute('disabled');
    morph(x, y);
  });
  while (a.childNodes.length > bc.length) a.removeChild(a.lastChild);
}
function render() {
  const t = document.createElement('div');
  t.innerHTML = view();
  morph($('#app'), t);
  $('#sheet').innerHTML = ui.sheet ? sheetView() : '';
}

function view() {
  if (!code) return landing();
  if (noRoom) return `${hero()}<div class="wrap"><h2 class="h">房间 ${code} 不存在</h2><p class="note">房间码可能输错了，或者房间已失效。</p><button class="btn" data-act="leave">返回首页</button></div>`;
  if (!S) return `${hero()}<div class="wrap"><h2 class="h">正在连接房间 ${code}…</h2></div>`;
  return bar() + `<div class="wrap" data-k="stage-${S.stage === 'setup' ? 'setup' : 'play'}">` + (S.stage === 'setup' ? setupView() : playView()) + '</div>';
}
const hero = () => `<div class="hero" data-k="hero"><button class="navb" data-act="leave">‹ 首页</button><div class="en">AVALON</div><h1>阿瓦隆面杀助手</h1><div class="orn"></div></div><div class="band"></div>`;
const bar = () => `<div class="bar" data-k="bar"><button class="navb" data-act="leave">‹ 首页</button><span class="ttl">阿瓦隆</span>
  ${seated() ? `<span class="mine">${esc(nm(myId()))}</span>` : ''}
  <button class="room" data-act="share"><small>房间</small>${code}<small>邀请</small></button><span class="conn ${online ? 'on' : ''}" title="${online ? '已连接' : '重新连接中'}"></span></div>`;

function landing() {
  const rooms = ui.rooms, my = mine();
  const stageText = r => r.stage === 'setup' ? `入座中 · ${r.names.length} 人` : r.stage === 'over' ? (r.win === 'good' ? '好人获胜' : '邪恶获胜') : `第 ${ZH[r.q] || r.q + 1} 个任务`;
  const listed = rooms && rooms.slice().sort((a, b) => my.includes(b.code) - my.includes(a.code));
  const unlisted = rooms ? my.filter(c => !rooms.some(r => r.code === c)) : [];
  const tag = c => my.includes(c) ? '<em>我的</em>' : '';
  const roomList = rooms === null ? '<div class="empty">加载中…</div>' : listed.length + unlisted.length ? listed.map(r => `
      <button class="card lobby" data-act="rejoin" data-code="${r.code}" data-k="lb-${r.code}">
        <span class="lc">${r.code}${tag(r.code)}</span>
        <span class="lp">${esc(r.names.slice(0, 6).join('、'))}${r.names.length > 6 ? ' 等' : ''}</span>
        <span class="ls"><b class="st st-${r.stage}">${stageText(r)}</b>${r.stage === 'play' ? `<span class="qs"><i class="g">${r.ok}</i><i class="e">${r.bad}</i></span>` : ''}<small>${r.online ? `<i class="od on"></i>${r.online} 人在线` : ago(r.updated)}</small></span>
      </button>`).join('') + unlisted.map(c => `
      <button class="card lobby" data-act="rejoin" data-code="${c}" data-k="lb-${c}">
        <span class="lc">${c}${tag(c)}</span><span class="lp"></span><span class="ls"><small>点击进入</small></span>
      </button>`).join('') : '<div class="empty">暂无进行中的房间</div>';
  return `<div class="hero-cover" data-k="hero"><a class="navb" href="https://boardgame.leisurecat.cloud">‹ 全部游戏</a><img class="bg" src="img/cover.jpg" alt=""><img class="box" src="img/cover.jpg" alt="《阿瓦隆》游戏盒封面">
      <div class="ht"><div class="hz">阿瓦隆面杀助手</div><div class="hs">手机看身份 · 票型不再忘</div></div></div>
    <div class="wrap" data-k="landing">
    <div class="card start">
      <button class="btn" data-act="create" ${ui.busy ? 'disabled' : ''}>创建新房间</button>
      <div class="or">或输入房间码加入</div>
      <div class="join"><input id="joinCode" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="房间码"><button class="btn navy" data-act="join">加入</button></div>
      ${ui.err ? `<div class="err">${esc(ui.err)}</div>` : ''}
    </div>
    <div class="feat">
      <div><b>免闭眼</b>每人手机看自己的身份和该看到的人</div>
      <div><b>记票型</b>每次组队、投票、任务结果一目了然</div>
      <div><b>防出错</b>人数、两张失败、五次否决自动提醒</div>
    </div>
    <div class="tiles">
      <a class="card tile" href="guide"><span class="ti"><img src="img/guide.jpg" alt=""></span><span><b>新手教程</b>规则 + 常见问题</span></a>
      <a class="card tile" href="history"><span class="ti rec">录</span><span><b>往期对局</b>身份与票型</span></a>
    </div>
    <h2 class="h">房间<small>${rooms && rooms.length ? `${rooms.length} 个` : ''}</small></h2>
    <div class="list">${roomList}</div>
    <footer>非官方玩家工具，线下对局仍需实体《阿瓦隆》或自备投票、任务卡<br>封面版权归出版社 Indie Boards &amp; Cards 所有 · 角色插画为本站原创</footer></div>`;
}

/* ---------- setup: seats and line-up ---------- */
function setupView() {
  const me = myId(), N = n(), c = config(S), { errors, warns } = check(S);
  const join = seated() ? '' : `<div class="card start" data-k="joinseat"><div class="jt">先入座</div>
      <div class="join"><input id="seatName" class="pn" maxlength="12" placeholder="你的名字" enterkeyhint="done" autocomplete="off"><button class="btn navy" data-act="sit" ${ui.joining ? 'disabled' : ''}>入座</button></div>
      <p class="note">每人用自己的手机入座，开局后才能看到自己的身份。</p></div>`;
  const seats = S.seats.map((p, i) => `
      <div class="card row" data-k="seat-${p.id}">
        <div class="stepn">${i + 1}</div>
        <div class="who">${p.id === me ? `<input class="pn" data-pk="name" value="${esc(p.name)}" maxlength="12" enterkeyhint="done"><div class="fg">这是你</div>` : `<div class="nm">${esc(p.name)}</div>`}</div>
        ${seated() ? `<button class="ib" data-act="move" data-i="${i}" data-j="${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
        <button class="ib" data-act="move" data-i="${i}" data-j="${i + 1}" ${i === N - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        <button class="ib x" data-act="kick" data-id="${p.id}" aria-label="移除">×</button>` : ''}
      </div>`).join('');
  const sides = SIDES[N];
  const roles = N >= MIN && N <= MAX ? lineup(N, c.roles) : null;
  const cnt = k => roles ? roles.filter(r => r === k).length : 0;
  const rest = [['servant', '亚瑟的忠臣'], ['minion', '莫德雷德的爪牙']].filter(([k]) => cnt(k)).map(([k, t]) => `${t} ×${cnt(k)}`).join('，');
  const chip = (r, on, fixed) => `<button class="rch ${ROLES[r].side} ${on ? 'on' : ''}" ${fixed || !seated() ? 'disabled' : `data-act="role" data-role="${r}"`}>${roleImg(r, 'xs')}<span>${ROLES[r].name}${fixed ? '<small>必有</small>' : ''}</span></button>`;
  return `${join}
    <h2 class="h">座位<small>${N} 人${N < MIN ? `，至少 ${MIN} 人` : ''}</small></h2>
    <p class="note">请按桌上实际座位<b>顺时针</b>排好：1 号的左手边是 2 号。队长和湖中仙女都按这个顺序传。</p>
    <div class="list" style="margin-top:8px">${seats || '<div class="empty">还没有人入座</div>'}</div>
    <h2 class="h">身份配置<small>${sides ? `${sides[0]} 好人 · ${sides[1]} 邪恶` : ''}</small></h2>
    <div class="card cfgc">
      <div class="rgrid">${chip('merlin', true, true)}${chip('assassin', true, true)}${OPTIONAL.map(r => chip(r, c.roles.includes(r))).join('')}</div>
      ${rest ? `<div class="rest">其余：${rest}</div>` : ''}
      <div class="preset">${S.opts.custom ? `<button class="lnk" data-act="preset" ${seated() ? '' : 'disabled'}>恢复推荐配置</button>` : '<span>推荐配置：中文玩家常用搭配，非官方</span>'}</div>
    </div>
    <h2 class="h">选项</h2>
    <div class="card opts">
      <label class="sw"><span><b>湖中仙女</b><small>第 2、3、4 个任务后查看一人阵营</small></span><input type="checkbox" data-opt="lady" ${c.lady ? 'checked' : ''} ${seated() ? '' : 'disabled'}><i></i></label>
      <label class="sw"><span><b>记录每人投票</b><small>关掉则只记通过或否决</small></span><input type="checkbox" data-opt="votes" ${c.votes ? 'checked' : ''} ${seated() ? '' : 'disabled'}><i></i></label>
      <div class="sw"><span><b>任务出牌</b><small>${c.quest === 'card' ? '用实物任务牌，翻开后记录失败张数' : '队员在自己手机上秘密出牌，只公布张数'}</small></span>
        <div class="seg sm">${[['card', '实物牌'], ['phone', '手机']].map(([k, t]) => `<button class="${c.quest === k ? 'on' : ''}" data-act="quest" data-v="${k}" ${seated() ? '' : 'disabled'}>${t}</button>`).join('')}</div></div>
    </div>
    ${errors.map(e => `<p class="note bad">${esc(e)}</p>`).join('')}${warns.map(w => `<p class="note">${esc(w)}</p>`).join('')}
    <button class="btn" data-act="start" ${!seated() || errors.length ? 'disabled' : ''}>发身份，开始游戏</button>
    <p class="note">开局后每人按住「我的身份」查看，不用闭眼念口令。</p>`;
}

/* ---------- in game ---------- */
function playView() {
  if (S.stage === 'over') return overView();
  const tabs = [['game', '对局'], ['rec', '票型']];
  return `<div class="tabs">${tabs.map(([k, t]) => `<button class="tab${ui.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${t}</button>`).join('')}</div>
    <div data-k="tab-${ui.tab}">${ui.tab === 'rec' ? recordTab() : gameTab()}</div>`;
}

function idCard() {
  if (!S.me?.role) return `<div class="card idc none" data-k="idc"><p>你没有入座，只能旁观公开信息。</p></div>`;
  const m = S.me;
  if (!ui.hold) return `<div class="idc back" data-k="idc" data-hold="1"><img src="img/emblem.jpg" alt=""><div><b>我的身份</b><span>按住查看，松手遮住</span></div></div>`;
  const cfg = S.cfg.roles, notes = [];
  if (m.role === 'merlin' && cfg.includes('mordred')) notes.push('本局有莫德雷德，你看不到他。');
  if (m.side === 'evil' && m.role !== 'oberon' && cfg.includes('oberon')) notes.push('本局有奥伯伦，你们互相不认识。');
  const who = m.sees.length ? `<div class="sees"><em>你看到的人</em>${m.sees.map(x => `<span class="tag ${x.tag}">${esc(nm(x.id))}<i>${TAG[x.tag]}</i></span>`).join('')}</div>`
    : m.role === 'servant' || m.role === 'oberon' ? '' : '<div class="sees"><em>你看到的人</em><span class="tag">无</span></div>';
  const lady = m.lady.length ? `<div class="sees"><em>湖中仙女</em>${m.lady.map(x => `<span class="tag ${x.side}">${esc(nm(x.target))}<i>${SIDE_ZH[x.side]}</i></span>`).join('')}</div>` : '';
  return `<div class="idc face ${m.side}" data-k="idc" data-hold="1">
    <div class="idh">${roleImg(m.role, 'lg')}<div><span class="side">${SIDE_ZH[m.side]}</span><b>${ROLES[m.role].name}</b></div></div>
    <p>${DESC[m.role]}</p>${who}${notes.map(x => `<p class="nt">${x}</p>`).join('')}${lady}</div>`;
}

// quest track + leader / attempt line
function statusBox() {
  const N = n(), c = S.cur, done = S.quests;
  const tok = [0, 1, 2, 3, 4].map(q => {
    const r = done[q], cur = q === c.q && S.stage === 'play';
    return `<div class="qt ${r ? (r.ok ? 'ok' : 'bad') : ''} ${cur ? 'cur' : ''}"><b>${r ? (r.ok ? '成' : '败') : TEAM[N][q]}</b><small>${r ? (r.fails ? `${r.fails} 张失败` : '全部成功') : `任务${ZH[q]}`}</small>${failsNeeded(N, q) > 1 ? '<i>需2败</i>' : ''}</div>`;
  }).join('');
  const pips = Array.from({ length: MAX_REJECTS }, (_, i) => `<i class="${i + 1 < c.att ? 'done' : i + 1 === c.att ? 'cur' : ''} ${i === MAX_REJECTS - 1 ? 'last' : ''}"></i>`).join('');
  return `<div class="qtrack">${tok}</div>
    ${S.stage === 'play' ? `<div class="status"><div style="flex:1;min-width:0"><div class="t">第${ZH[c.q]}个任务 · 队长 <span class="ldr">${esc(nm(c.leader))}</span></div>
      <div class="s">需 ${TEAM[N][c.q]} 人${failsNeeded(N, c.q) > 1 ? ' · <b>需 2 张失败才算失败</b>' : ''}${S.lady ? ` · 湖中仙女：${esc(nm(S.lady.holder))}` : ''}</div></div>
      <div class="att"><div class="pips">${pips}</div><small>第 ${c.att}/${MAX_REJECTS} 次组队</small></div></div>` : ''}
    ${S.stage === 'play' && c.att === MAX_REJECTS && ['team', 'vote'].includes(c.step) ? '<div class="banner alarm"><b>第 5 次组队</b>：这一队再被否决，邪恶方直接获胜</div>' : ''}`;
}

function gameTab() {
  return `${idCard()}${statusBox()}<div data-k="step-${S.stage}-${S.cur.step}">${S.stage === 'stab' ? stabStep() : stepView()}</div>
    <div class="btns"><button class="btn ghost" data-act="undo" ${S.canUndo && seated() ? '' : 'disabled'}>撤销上一步</button><button class="btn ghost" data-act="again" ${seated() ? '' : 'disabled'}>重新开局</button></div>`;
}

const seatChips = (ids, sel, act, dis = () => false) => `<div class="chips wrapc">${ids.map(id => `<button class="pc ${sel.includes(id) ? 'on' : ''}" data-act="${act}" data-id="${id}" ${dis(id) || !seated() ? 'disabled' : ''}>${esc(nm(id))}</button>`).join('')}</div>`;

function stepView() {
  const c = S.cur, N = n(), need = TEAM[N][c.q], me = myId();
  if (c.step === 'team') return `<h2 class="h">组队<small>队长 ${esc(nm(c.leader))} 选 ${need} 人</small></h2>
    <div class="card pad">${seatChips(S.seats.map(p => p.id), ui.pick, 'pick')}
      <button class="btn" data-act="team" ${ui.pick.length === need && seated() ? '' : 'disabled'}>确定队伍（已选 ${ui.pick.length}/${need}）</button>
      <p class="note">队长在桌上说出人选后，任何人都可以在这里点选。</p></div>`;
  const teamLine = `<div class="teamline">${c.team.map(id => `<span>${esc(nm(id))}</span>`).join('')}</div>`;
  if (c.step === 'vote') {
    if (!S.cfg.votes) return `<h2 class="h">投票<small>大家同时亮牌</small></h2><div class="card pad">${teamLine}
      <div class="btns"><button class="btn navy" data-act="pass" data-v="1" ${seated() ? '' : 'disabled'}>通过</button><button class="btn red" data-act="pass" data-v="0" ${seated() ? '' : 'disabled'}>否决</button></div>
      <p class="note">赞成超过半数才通过，平票算否决。</p></div>`;
    const yes = S.seats.filter(p => ui.votes[p.id] === true).length, no = S.seats.filter(p => ui.votes[p.id] === false).length, left = N - yes - no;
    return `<h2 class="h">投票<small>亮牌后照实记录</small></h2><div class="card pad">${teamLine}
      <div class="vlist">${S.seats.map(p => `<div class="vrow" data-k="v-${p.id}"><span class="nm">${esc(p.name)}${p.id === c.leader ? '<i class="crown">队长</i>' : ''}</span>
        <div class="seg yn"><button class="${ui.votes[p.id] === true ? 'on y' : ''}" data-act="v" data-id="${p.id}" data-v="1">赞成</button><button class="${ui.votes[p.id] === false ? 'on n' : ''}" data-act="v" data-id="${p.id}" data-v="0">反对</button></div></div>`).join('')}</div>
      <div class="btns"><button class="btn ghost" data-act="vall" data-v="1">其余都赞成</button><button class="btn ghost" data-act="vall" data-v="0">其余都反对</button></div>
      <div class="tally">赞成 <b>${yes}</b> · 反对 <b>${no}</b>${left ? ` · 未填 ${left}` : ` · ${yes * 2 > N ? '<em class="g">通过</em>' : '<em class="e">否决</em>'}`}</div>
      <button class="btn" data-act="vote" ${left || !seated() ? 'disabled' : ''}>记录投票</button>
      <p class="note">赞成超过半数才通过，平票算否决。</p></div>`;
  }
  if (c.step === 'quest') {
    if (S.cfg.quest === 'card') return `<h2 class="h">任务<small>队员出牌，洗混后翻开</small></h2><div class="card pad">${teamLine}
      <div class="stepper"><span>翻开了几张失败？</span><button class="ib" data-act="fails" data-d="-1" ${ui.fails <= 0 ? 'disabled' : ''}>−</button><b>${ui.fails}</b><button class="ib" data-act="fails" data-d="1" ${ui.fails >= c.team.length ? 'disabled' : ''}>+</button></div>
      <div class="tally">${ui.fails >= failsNeeded(N, c.q) ? '<em class="e">任务失败</em>' : '<em class="g">任务成功</em>'}${failsNeeded(N, c.q) > 1 ? '（本任务需 2 张失败）' : ''}</div>
      <button class="btn" data-act="qres" ${seated() ? '' : 'disabled'}>记录结果</button>
      <p class="note">好人只能出成功；邪恶可以出成功或失败。</p></div>`;
    const played = c.played, mine = c.team.includes(me);
    const status = `<div class="tally">已出牌 <b>${played.length}</b>/${c.team.length}${played.length ? `：${played.map(id => esc(nm(id))).join('、')}` : ''}</div>`;
    if (mine && !S.me.card) return `<h2 class="h">任务<small>在你自己的手机上出牌</small></h2><div class="card pad">${teamLine}
      <div class="cards"><button class="qc s ${ui.card === 'S' ? 'on' : ''}" data-act="card" data-v="S">成功</button><button class="qc f ${ui.card === 'F' ? 'on' : ''}" data-act="card" data-v="F">失败</button></div>
      <button class="btn" data-act="play" ${ui.card ? '' : 'disabled'}>${ui.card ? `确认出「${ui.card === 'S' ? '成功' : '失败'}」` : '先选一张'}</button>${status}
      <p class="note">挡好屏幕再出牌。好人只能出成功。服务器只公布成功和失败各几张，不记录是谁出的。</p></div>`;
    return `<h2 class="h">任务<small>${mine ? '你已出牌' : '等待队员出牌'}</small></h2><div class="card pad">${teamLine}${status}
      <p class="note">${mine ? '等其他队员出完，结果会自动公布。' : '队员各自在手机上出牌，出完自动公布结果。'}</p></div>`;
  }
  if (c.step === 'lady') {
    const holder = S.lady.holder;
    if (holder !== me) return `<h2 class="h">湖中仙女<small>${esc(nm(holder))} 正在选择</small></h2><div class="card pad"><p class="note">湖中仙女在 <b>${esc(nm(holder))}</b> 手里，他会在自己的手机上查看一名玩家的阵营，结果只有他能看到。</p></div>`;
    const ok = id => !S.lady.holders.includes(id);
    return `<h2 class="h">湖中仙女<small>查看一名玩家的阵营</small></h2><div class="card pad">
      ${seatChips(S.seats.map(p => p.id).filter(id => id !== me), ui.target ? [ui.target] : [], 'target', id => !ok(id))}
      <button class="btn" data-act="lady" ${ui.target ? '' : 'disabled'}>查看${ui.target ? ` ${esc(nm(ui.target))} 的阵营` : ''}</button>
      <p class="note">用过湖中仙女的人不能被查（灰色）。结果只显示在你的手机上，你可以公开说，也可以撒谎。查完湖中仙女交给被查的人。</p></div>`;
  }
  return '';
}

function stabStep() {
  const me = myId();
  if (S.me?.role !== 'assassin') return `<h2 class="h">刺杀梅林</h2><div class="card pad"><p class="note">好人完成了 3 个任务！现在邪恶方可以一起讨论，由<b>刺客</b>在自己的手机上指认一名好人为梅林。谁都不能亮身份牌。</p></div>`;
  const known = S.me.sees.map(x => x.id);
  return `<h2 class="h">刺杀梅林<small>你是刺客</small></h2><div class="card pad">
    <p class="note">和邪恶同伴商量后，指认一名好人。认出梅林，邪恶方获胜；认错，好人获胜。只有一次机会。</p>
    ${seatChips(S.seats.map(p => p.id).filter(id => id !== me && !known.includes(id)), ui.target ? [ui.target] : [], 'target')}
    <button class="btn red" data-act="stab" ${ui.target ? '' : 'disabled'}>${ui.target ? `指认 ${esc(nm(ui.target))} 是梅林` : '选择一名玩家'}</button></div>`;
}

/* ---------- vote record table (票型) ---------- */
function recordTable() {
  const A = S.attempts;
  if (!A.length) return '<div class="empty">还没有组队记录</div>';
  const quest = a => a.pass ? S.quests.find(q => q.q === a.q) : null;
  const head = A.map(a => `<th class="${a.pass ? 'ps' : ''}">${a.q + 1}-${a.att}</th>`).join('');
  const rows = S.seats.map(p => `<tr><th>${initial(p.id)}<span>${esc(p.name)}</span></th>${A.map(a => {
    const lead = a.leader === p.id, on = a.team.includes(p.id), v = a.votes ? a.votes[p.id] : null;
    return `<td class="${on ? 'on' : ''}">${lead ? '<i class="ld">★</i>' : ''}${v === true ? '<b class="y">✓</b>' : v === false ? '<b class="n">✗</b>' : ''}</td>`;
  }).join('')}</tr>`).join('');
  const res = A.map(a => { const q = quest(a); return `<td>${a.pass ? (q ? (q.ok ? `<em class="g">成</em>` : `<em class="e">败${q.fails}</em>`) : '<em>进行中</em>') : '<em class="x">否决</em>'}</td>`; }).join('');
  return `<div class="rtw"><table class="rt"><thead><tr><th>任务-次</th>${head}</tr></thead><tbody>${rows}<tr class="res"><th>结果</th>${res}</tr></tbody></table></div>
    <p class="legend">★ 队长　<span class="sw-on"></span> 在队伍里　<b class="y">✓</b> 赞成　<b class="n">✗</b> 反对${S.cfg.votes ? '' : '（本局没有记录每人投票）'}</p>`;
}
function recordTab() {
  const L = S.lady?.checks || [];
  return `${statusBox()}<h2 class="h">票型<small>每列是一次组队</small></h2>${recordTable()}
    ${L.length ? `<h2 class="h">湖中仙女</h2><div class="card pad">${L.map(x => `<div class="lrow">第${ZH[x.q]}个任务后：<b>${esc(nm(x.holder))}</b> 查看了 <b>${esc(nm(x.target))}</b>${x.side ? `：<span class="tag ${x.side}">${SIDE_ZH[x.side]}</span>` : ''}</div>`).join('')}
      <p class="note">结果只有查看的人知道，结束后公开。</p></div>` : ''}`;
}

/* ---------- game over ---------- */
function overView() {
  const r = S.result, R = S.roles;
  const order = S.seats.map(p => p.id);
  return `<div id="shot"><div class="win ${r.win}"><div class="crown">${r.win === 'good' ? '亚 瑟 的 忠 臣' : '莫 德 雷 德 的 爪 牙'}</div>
      <div class="wt">${r.win === 'good' ? '好人获胜' : '邪恶获胜'}</div><div class="ws">${WHY[r.why]}${r.target ? `：刺客指认了 ${esc(nm(r.target))}` : ''}</div></div>
    ${statusBox()}
    <h2 class="h">身份揭晓</h2>
    <div class="list rl">${order.map((id, i) => `<div class="card row ${ROLES[R[id]].side}" data-k="rv-${id}"><div class="stepn">${i + 1}</div>${roleImg(R[id])}
      <div class="who"><div class="nm">${esc(nm(id))}${id === myId() ? '<small>（我）</small>' : ''}</div><div class="fg">${ROLES[R[id]].name}</div></div><span class="sd ${ROLES[R[id]].side}">${SIDE_ZH[ROLES[R[id]].side]}</span></div>`).join('')}</div>
    <h2 class="h">票型复盘</h2>${recordTable()}
    ${(S.lady?.checks || []).length ? `<h2 class="h">湖中仙女</h2><div class="card pad">${S.lady.checks.map(x => `<div class="lrow">第${ZH[x.q]}个任务后：<b>${esc(nm(x.holder))}</b> 查看了 <b>${esc(nm(x.target))}</b>：<span class="tag ${x.side}">${SIDE_ZH[x.side]}</span></div>`).join('')}</div>` : ''}
  </div>
  <div class="btns"><button class="btn navy" data-act="save" ${ui.saving ? 'disabled' : ''}>${ui.saving ? '正在生成…' : '保存结算长图'}</button><button class="btn" data-act="again" ${seated() ? '' : 'disabled'}>再来一局</button></div>
  <p class="note">再来一局：保留座位，重新发身份。</p>
  ${reviewCard()}`;
}

/* ---------- rating this game (stars + comment), shown on the hub boardgame.leisurecat.cloud ---------- */
const REVIEW_API = 'https://boardgame.leisurecat.cloud/api/reviews';
const STAR_TXT = ['点星星打分', '不推荐', '一般', '还行', '好玩', '超好玩'];
const savedReview = () => { try { return JSON.parse(store.get('avl-rv-' + code)) || {}; } catch { return {}; } };
function reviewCard() {
  if (ui.rv?.room !== code) ui.rv = { who: seated() ? myId() : null, stars: 0, text: '', state: '', err: '', ...savedReview(), room: code };
  const rv = ui.rv;
  if (!rv.who && seated()) rv.who = myId();   // the seat is known only after the first (public) frame
  if (rv.state === 'sent') return `<div class="card rv" data-k="rv"><div class="rv-done">${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}</div>
    <p>谢谢 ${esc(nm(rv.who) || '')} 的评价！</p><div class="btns"><button class="btn ghost" data-act="rv-edit">修改评价</button><a class="btn navy" href="https://boardgame.leisurecat.cloud">看大家的评价</a></div></div>`;
  return `<h2 class="h">给这款游戏打个分</h2><div class="card rv" data-k="rv">
    <div class="rv-l">我是</div><div class="rv-who">${S.seats.map(p => `<button class="${rv.who === p.id ? 'on' : ''}" data-act="rv-who" data-id="${p.id}">${initial(p.id)}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <div class="rv-st">${[1, 2, 3, 4, 5].map(k => `<button class="${k <= rv.stars ? 'on' : ''}" data-act="rv-star" data-n="${k}" aria-label="${k} 星">★</button>`).join('')}<span>${STAR_TXT[rv.stars]}</span></div>
    <textarea data-rv placeholder="说说这局的感受（可不填）" maxlength="300">${esc(rv.text)}</textarea>
    <button class="btn" data-act="rv-send" ${!rv.who || !rv.stars || rv.state === 'sending' ? 'disabled' : ''}>${rv.state === 'sending' ? '提交中…' : '提交评价'}</button>
    ${rv.err ? `<p class="err">${esc(rv.err)}</p>` : ''}
    <p class="note">评价和玩家名会显示在「桌游小助手」首页，并计入这款游戏的整体评分。同一局再次提交会覆盖之前的评价。</p></div>`;
}
async function sendReview() {
  const rv = ui.rv;
  rv.state = 'sending'; rv.err = ''; render();
  try {
    const r = await fetch(REVIEW_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: 'avalon', stars: rv.stars, name: nm(rv.who), text: rv.text, room: code }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `提交失败（${r.status}）`);
    rv.state = 'sent';
    store.set('avl-rv-' + code, JSON.stringify({ who: rv.who, stars: rv.stars, text: rv.text, state: 'sent' }));
  } catch (e) {
    rv.state = ''; rv.err = e.message === 'Failed to fetch' ? '网络连接失败，请稍后再试' : e.message;
  }
  render();
}

/* ---------- results as one long image ---------- */
const loadScript = src => new Promise((ok, fail) => {
  if (window.html2canvas) return ok();
  const el = document.createElement('script');
  el.src = src; el.onload = ok; el.onerror = () => fail(new Error('截图组件加载失败'));
  document.head.appendChild(el);
});
async function saveImage() {
  ui.saving = true; render();
  try {
    await loadScript('vendor/html2canvas.min.js');
    const canvas = await window.html2canvas($('#shot'), {
      scale: Math.max(2, window.devicePixelRatio || 1), backgroundColor: '#ece7da',
      onclone: doc => {
        const c = doc.getElementById('shot');
        c.style.cssText = 'margin:0 -14px;padding:18px 14px 14px';
        c.querySelector('.rtw')?.style.setProperty('overflow', 'visible');
        c.insertAdjacentHTML('afterbegin', `<div style="text-align:center;padding-bottom:8px"><div style="font:900 22px var(--serif);color:var(--navy);letter-spacing:4px">阿瓦隆 · 对局结算</div>
          <div style="font:500 12px var(--sans);color:var(--ink2);margin-top:4px">房间 ${code} · ${n()} 人局 · ${new Date().toLocaleDateString('zh-CN')}</div></div>`);
        c.insertAdjacentHTML('beforeend', `<div style="text-align:center;font:500 11px var(--sans);color:var(--ink2);margin-top:16px">阿瓦隆面杀助手 · ${location.host}</div>`);
      }
    });
    showImage(canvas.toDataURL('image/jpeg', 0.92));
  } catch (e) { toast('生成长图失败：' + e.message); }
  ui.saving = false; render();
}
function showImage(url) {
  const el = document.createElement('div');
  el.className = 'shotv';
  el.innerHTML = `<div class="sv-top"><span>长按图片保存到相册</span><a href="${url}" download="阿瓦隆结算-${code}.jpg">下载</a><button type="button">关闭</button></div><img src="${url}" alt="结算长图">`;
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
}

/* ---------- sheets ---------- */
function sheetView() {
  const s = ui.sheet;
  if (s.kind === 'lady') return `<div class="mask" data-act="close"></div><div class="sheet lady-r"><img src="img/lady.jpg" alt="">
    <h3>湖中仙女</h3><p><b>${esc(nm(s.target))}</b> 的阵营是</p><div class="big ${s.side}">${SIDE_ZH[s.side]}</div>
    <p class="note">只有你看得到这个结果，之后也可以在「我的身份」里看。</p><button class="btn" data-act="close">知道了</button></div>`;
  if (s.kind === 'confirm') return `<div class="mask" data-act="close"></div><div class="sheet"><h3>${esc(s.title)}</h3><p class="hint">${esc(s.text)}</p>
    <div class="btns"><button class="btn ghost" data-act="close">取消</button><button class="btn red" data-act="confirm">确认</button></div></div>`;
  return '';
}
const confirmThen = (title, text, fn) => { ui.sheet = { kind: 'confirm', title, text, fn }; render(); };

/* ---------- events ---------- */
async function createRoom() {
  ui.busy = true; ui.err = ''; render();
  try {
    const r = await fetch('/api/room', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '创建失败');
    enterRoom(j.code);
  } catch (e) { ui.err = '创建房间失败：' + e.message; }
  ui.busy = false; render();
}
function enterRoom(c) {
  code = c; noRoom = false; S = null; ui.err = ''; ui.draftKey = '';
  history.replaceState(null, '', '/?r=' + c);
  connect(); render();
}
function leave() {
  code = null; S = null; noRoom = false; if (ws) { ws.onclose = null; ws.close(); }
  history.replaceState(null, '', '/'); ui.rooms = null; render(); loadRooms();
}
async function share() {
  const url = `${location.origin}/?r=${code}`;
  const text = `阿瓦隆面杀助手｜手机看身份，票型不再忘\n邀请你加入阿瓦隆房间 ${code}，点开链接入座（无需下载）：`;
  if (navigator.share) { try { await navigator.share({ title: '阿瓦隆 · 房间 ' + code, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('邀请已复制，发给朋友即可'); } catch { toast('房间码 ' + code); }
}
function sit() {
  const name = $('#seatName').value.trim();
  if (!name) { toast('先填你的名字'); return; }
  ui.joining = true; sendRaw({ join: name }); render();
}
function recordVote() {
  const votes = Object.fromEntries(S.seats.map(p => [p.id, ui.votes[p.id]]));
  const pass = S.seats.filter(p => votes[p.id]).length * 2 > n();
  const go = () => send({ t: 'vote', votes });
  if (!pass && S.cur.att === MAX_REJECTS) confirmThen('第 5 次否决', '这是本轮第 5 个被否决的队伍，确认后邪恶方直接获胜，并公开所有身份。', go); else go();
}
function recordPass(pass) {
  const go = () => send({ t: 'vote', pass });
  if (!pass && S.cur.att === MAX_REJECTS) confirmThen('第 5 次否决', '这是本轮第 5 个被否决的队伍，确认后邪恶方直接获胜，并公开所有身份。', go); else go();
}
function recordFails() {
  const k = ui.fails, bad = k >= failsNeeded(n(), S.cur.q), go = () => send({ t: 'fails', n: k });
  if (bad && S.quests.filter(q => !q.ok).length === 2) confirmThen('第 3 个失败的任务', '确认后邪恶方获胜，并公开所有身份。', go); else go();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  const d = t.dataset;
  switch (d.act) {
    case 'create': createRoom(); break;
    case 'join': { const c = cleanCode($('#joinCode').value); if (c) enterRoom(c); else { ui.err = '请输入 4 位房间码'; render(); } break; }
    case 'rejoin': enterRoom(d.code); break;
    case 'leave': leave(); break;
    case 'share': share(); break;
    case 'sit': sit(); break;
    case 'move': send({ t: 'move', i: +d.i, j: +d.j }); break;
    case 'kick': confirmThen('移除座位', `把「${nm(d.id)}」从座位上移除？他的手机需要重新入座。`, () => send({ t: 'kick', id: d.id })); break;
    case 'role': send({ t: 'opt', k: 'role', role: d.role }); break;
    case 'preset': send({ t: 'opt', k: 'preset' }); break;
    case 'quest': send({ t: 'opt', k: 'quest', v: d.v }); break;
    case 'start': send({ t: 'start' }); window.scrollTo(0, 0); break;
    case 'tab': ui.tab = d.tab; render(); window.scrollTo(0, 0); break;
    case 'pick': { const need = TEAM[n()][S.cur.q]; ui.pick = ui.pick.includes(d.id) ? ui.pick.filter(x => x !== d.id) : ui.pick.length < need ? [...ui.pick, d.id] : ui.pick; render(); break; }
    case 'team': send({ t: 'team', team: ui.pick }); break;
    case 'v': ui.votes[d.id] = d.v === '1'; render(); break;
    case 'vall': for (const p of S.seats) if (typeof ui.votes[p.id] !== 'boolean') ui.votes[p.id] = d.v === '1'; render(); break;
    case 'vote': recordVote(); break;
    case 'pass': recordPass(d.v === '1'); break;
    case 'fails': ui.fails = Math.max(0, Math.min(S.cur.team.length, ui.fails + +d.d)); render(); break;
    case 'qres': recordFails(); break;
    case 'card':
      if (d.v === 'F' && S.me.side === 'good') { toast('好人只能出成功'); break; }
      ui.card = d.v; render(); break;
    case 'play': send({ t: 'play', card: ui.card }); break;
    case 'target': ui.target = ui.target === d.id ? null : d.id; render(); break;
    case 'lady': send({ t: 'lady', target: ui.target }); break;
    case 'stab': confirmThen('指认梅林', `确认指认「${nm(ui.target)}」是梅林？只有一次机会。`, () => send({ t: 'stab', target: ui.target })); break;
    case 'undo': send({ t: 'undo' }); break;
    case 'again': S.stage === 'over' ? send({ t: 'again' }) : confirmThen('重新开局', '放弃这一局，回到入座和配置，所有人的身份作废。', () => send({ t: 'again' })); break;
    case 'save': if (!ui.saving) saveImage(); break;
    case 'rv-who': ui.rv.who = d.id; render(); break;
    case 'rv-star': ui.rv.stars = +d.n; render(); break;
    case 'rv-send': sendReview(); break;
    case 'rv-edit': ui.rv.state = ''; render(); break;
    case 'confirm': { const fn = ui.sheet.fn; ui.sheet = null; fn(); render(); break; }
    case 'close': ui.sheet = null; render(); break;
  }
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.opt;
  if (k) send({ t: 'opt', k, on: e.target.checked });
});
let nameTimer;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.rv !== undefined) ui.rv.text = el.value;
  else if (el.dataset.pk === 'name') { clearTimeout(nameTimer); nameTimer = setTimeout(() => el.value.trim() && send({ t: 'name', name: el.value }), 400); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'joinCode') document.querySelector('[data-act="join"]').click();
  if (e.key === 'Enter' && e.target.id === 'seatName') sit();
  if (e.key === 'Enter' && e.target.dataset?.pk) e.target.blur();
});
// "My role": shown only while pressed.
const hold = on => { if (ui.hold !== on) { ui.hold = on; render(); } };
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-hold]')) { e.preventDefault(); hold(true); } });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => hold(false));
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
window.addEventListener('blur', () => hold(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) hold(false); });

render();
connect();
loadRooms();
