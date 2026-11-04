// No phone ever receives another player's secret. Usage: node tests/test_leak.mjs <base-url>   (local `wrangler dev`)
// For 5–10 players, real-card and phone-card quests, with and without the Lady of the Lake: every player joins on
// their own socket, a spectator socket watches, and a whole game is played through the server. Every frame each socket
// received is then checked:
//  - only whitelisted fields; roles only once the game is over;
//  - "me" is that socket's own seat, with exactly the people its role may see (checked against the rulebook matrix);
//  - outside "me", no role name, side, or quest card appears before the end;
//  - a quest card shows only on the phone that played it, a Lady of the Lake result only on the holder's phone.
// Also: spectators can't act, a wrong seat token gets nothing, nobody joins after the start, a good player can't play fail,
// a kicked seat loses its phone, secret steps can't be undone, finished games reach the archive.
import { ROLES, TEAM, sees } from '../public/logic.js';

const base = process.argv[2] || 'http://localhost:8861/';
const wsUrl = c => new URL(`/api/room/${c}/ws`, base).href.replace(/^http/, 'ws');
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
const wait = ms => new Promise(r => setTimeout(r, ms));
function rng(seed) { return n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * n); }; }

function open(code) {
  const ws = new WebSocket(wsUrl(code)), frames = [], inbox = [];
  let last = null, waiter = null;
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    frames.push(e.data); const m = JSON.parse(e.data); if (m.type === 'state') last = m.state;
    if (waiter) { const w = waiter; waiter = null; w(m); } else inbox.push(m);
  };
  const ready = new Promise(r => ws.onopen = r);
  const next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r, no) => { waiter = r; setTimeout(() => no(new Error('no reply in 10 s')), 10000); });
  const until = async f => { for (;;) { const m = await next(); if (f(m)) return m; } };
  // caught up with state v, nothing left unread
  const sync = async v => { while (!last || last.v < v) await next(); inbox.length = 0; };
  return { ws, frames, ready, next, until, sync, get last() { return last; }, send: o => ws.send(JSON.stringify(o)) };
}

const PUBLIC = ['v', 'stage', 'seats', 'opts', 'cfg', 'gid', 'leader0', 'quests', 'attempts', 'result', 'cur', 'lady', 'canUndo'];
const SECRET = [...Object.keys(ROLES), 'good', 'evil', '"S"', '"F"'];

async function play(n, quest, lady, seed) {
  const r = rng(seed), tag = `${n}p ${quest}${lady ? ' +lady' : ''}`;
  const { code } = await (await fetch(new URL('/api/room', base), { method: 'POST' })).json();
  const P = Array.from({ length: n }, () => open(code)), spy = open(code);
  await Promise.all([...P.map(p => p.ready), spy.ready]);
  await Promise.all([...P.map(p => p.next()), spy.next()]);   // initial public state
  const ids = [];
  for (const [i, p] of P.entries()) {
    p.send({ join: `玩家${'一二三四五六七八九十'[i]}` });
    const seat = await p.until(m => m.type === 'seat');
    p.id = seat.id; p.token = seat.token; ids.push(seat.id);
    await p.until(m => m.type === 'state' && m.state.seats.length === i + 1);
  }
  // a stray phone that joins and is then removed loses its seat
  const extra = n < 10 ? open(code) : null;
  if (extra) {
    await extra.ready; await extra.next();
    extra.send({ join: '路人' }); const s = await extra.until(m => m.type === 'seat');
    P[0].send({ action: { t: 'kick', id: s.id } });
    const gone = await extra.until(m => m.type === 'error');
    ok(`${tag}: a removed seat loses its phone`, gone.error === 'noseat');
    extra.send({ hello: s.token });
    ok(`${tag}: the old token gets nothing back`, (await extra.until(m => m.type === 'error')).error === 'noseat');
    extra.ws.close();
  }
  let S;
  // waits past the newest state any socket has seen (the acting socket may not have the last broadcast yet)
  const act = async (p, a) => { const v = Math.max(p.last.v, S?.v ?? 0); p.send({ action: a }); await p.until(m => m.type === 'state' && m.state.v > v); S = p.last; };
  const lp = P[0];
  if (quest === 'phone') await act(lp, { t: 'opt', k: 'quest', v: 'phone' });
  if (r(2)) await act(lp, { t: 'opt', k: 'votes', on: false });
  if (lady !== (n >= 7)) await act(lp, { t: 'opt', k: 'lady', on: lady });
  spy.send({ action: { t: 'start' } });
  ok(`${tag}: spectator can't act`, (await spy.until(m => m.type === 'error')).error === 'viewonly');
  const fake = open(code); await fake.ready; await fake.next();
  fake.send({ hello: 'f'.repeat(32) });
  ok(`${tag}: a made-up token isn't a seat`, (await fake.until(m => m.type === 'error')).error === 'noseat');
  await act(lp, { t: 'start' });
  await wait(100);
  fake.send({ join: '迟到' });
  ok(`${tag}: no joining after the start`, (await fake.until(m => m.type === 'error')).error === 'started');
  fake.ws.close();

  // the test, unlike any phone, collects everyone's own role
  const role = Object.fromEntries(P.map(p => [p.id, p.last.me.role]));
  const god = { seats: ids.map(id => ({ id })), roles: role };
  const by = id => P.find(p => p.id === id);
  ok(`${tag}: every seat got a role`, P.every(p => ROLES[role[p.id]]));
  const good = P.find(p => ROLES[role[p.id]].side === 'good');

  S = lp.last; let steps = 0, triedBadCard = false;
  while (S.stage !== 'over' && steps++ < 200) {
    const c = S.cur;
    if (S.stage === 'stab') {
      const a = P.find(p => role[p.id] === 'assassin'), known = sees(god, a.id).map(x => x.id);
      const pool = ids.filter(id => id !== a.id && !known.includes(id));
      await act(a, { t: 'stab', target: pool[r(pool.length)] });
    } else if (c.step === 'team') {
      const team = ids.slice().sort(() => r(3) - 1).slice(0, TEAM[n][c.q]);
      await act(P[r(n)], { t: 'team', team });
    } else if (c.step === 'vote') {
      const p = P[r(n)];
      await act(p, S.cfg.votes ? { t: 'vote', votes: Object.fromEntries(ids.map(id => [id, r(3) > 0])) } : { t: 'vote', pass: r(3) > 0 });
    } else if (c.step === 'quest' && quest === 'card') {
      await act(P[r(n)], { t: 'fails', n: r(2) ? 0 : r(c.team.length + 1) });
    } else if (c.step === 'quest') {
      const id = c.team.find(x => !c.played.includes(x)), p = by(id), evil = ROLES[role[id]].side === 'evil';
      if (!evil && !triedBadCard) {   // a good player trying to play fail is refused, and nothing changes for anyone
        triedBadCard = true; const v = S.v; await p.sync(v); p.send({ action: { t: 'play', card: 'F' } });
        const back = await p.until(m => m.type === 'state');
        ok(`${tag}: good player can't play fail`, back.state.v === v && back.state.me.card === null);
      }
      await act(p, { t: 'play', card: evil && r(2) ? 'F' : 'S' });
      if (p.last.cur.step === 'quest' && p.last.stage === 'play') ok(`${tag}: own card shows only on own phone`, p.last.me.card !== null, JSON.stringify({ v: p.last.v, me: p.last.me, cur: p.last.cur, u: p.last.canUndo }));
      if (p.last.canUndo !== false) { fails++; console.log('FAIL', tag, 'phone card can be undone'); }
    } else if (c.step === 'lady') {
      const h = by(S.lady.holder), pool = ids.filter(id => !S.lady.holders.includes(id));
      await act(h, { t: 'lady', target: pool[r(pool.length)] });
      ok(`${tag}: Lady check can't be undone`, h.last.canUndo === false);
    }
  }
  ok(`${tag}: game reached the end (${S.result?.win} by ${S.result?.why})`, S.stage === 'over', S.stage);
  await wait(300);

  // every frame every socket received
  let leak = null;
  const check = (sock, id) => {
    for (const f of sock.frames) {
      const m = JSON.parse(f);
      if (m.type !== 'state') continue;
      const st = m.state, over = st.stage === 'over';
      const extra = Object.keys(st).filter(k => !PUBLIC.includes(k) && !(k === 'me' && id) && !(k === 'roles' && over));
      if (extra.length) return `fields ${extra}`;
      if (!id && st.me) return 'spectator got "me"';
      if (id && st.me && st.me.id !== id) return `got seat ${st.me.id}`;
      if (!over) {
        const rest = JSON.stringify({ ...st, opts: 0, cfg: 0, me: 0 });
        const hit = SECRET.find(w => rest.includes(w));
        if (hit) return `"${hit}" outside "me" in ${rest.slice(0, 160)}`;
      }
      if (id && st.me?.role) {
        if (st.me.role !== role[id]) return 'role changed';
        if (JSON.stringify(st.me.sees) !== JSON.stringify(sees(god, id))) return `wrong "sees" for ${role[id]}`;
        if (st.me.card && !st.cur.team.includes(id)) return 'card off the team';
        if (st.me.lady.length !== (st.lady?.checks || []).filter(x => x.holder === id).length) return 'Lady result of someone else';
      }
      if (id && st.me && Object.keys(st.me).some(k => !['id', 'role', 'side', 'sees', 'lady', 'card'].includes(k))) return '"me" fields';
    }
    return null;
  };
  for (const p of P) { leak = check(p, p.id); if (leak) { leak = `${role[p.id]}: ${leak}`; break; } }
  if (!leak) leak = check(spy, null) && `spectator: ${check(spy, null)}`;
  ok(`${tag}: ${P.reduce((a, p) => a + p.frames.length, spy.frames.length)} frames carry no one else's secret`, !leak, leak);
  ok(`${tag}: roles public at the end`, JSON.stringify(spy.last.roles) === JSON.stringify(role));

  const g = await (await fetch(new URL(`/api/games?q=${code}`, base))).json();
  ok(`${tag}: archived with roles`, g.length === 1 && g[0].players.every(p => p.role === role[p.id]) && g[0].result.win === S.result.win);
  [...P, spy].forEach(p => p.ws.close());
}

let seed = 7;
for (const n of [5, 6, 7, 8, 9, 10]) for (const quest of ['card', 'phone']) await play(n, quest, n >= 7 ? quest === 'card' : n === 6 && quest === 'phone', seed++);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
