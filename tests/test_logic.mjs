// Rules engine (public/logic.js), no server needed. Usage: node tests/test_logic.mjs
// Tables against the rulebook, line-up checks, who sees whom, votes and rejections, quests, Lady of the Lake,
// the assassination, and thousands of random games checking that views never carry someone else's secret.
import { initialState, reduce, config, lineup, check, sees, publicView, seatView, gameRecord, ROLES, SIDES, TEAM, PRESET, failsNeeded, OPTIONAL } from '../public/logic.js';

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; if (!ok || !eq.quiet) console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); return ok; };
function rng(seed) { return n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * n); }; }

// a table of n with names 甲, 乙, 丙… (ids a, b, c…)
function table(n, opts = {}) {
  let s = initialState();
  for (let i = 0; i < n; i++) s = reduce(s, { t: 'join', id: 'abcdefghij'[i], name: '甲乙丙丁戊己庚辛壬癸'[i] });
  for (const [k, v] of Object.entries(opts)) s = { ...s, opts: { ...s.opts, [k]: v } };
  return s;
}
const act = (s, a, by = 'a', rnd) => reduce(s, a, by, rnd);
// a started game with roles forced (deal order is the seat order when rnd always returns the top)
function game(roles, opts = {}, leader = 0) {
  let s = table(roles.length, opts);
  s = act(s, { t: 'start' }, 'a', rng(1));
  const ids = s.seats.map(p => p.id);
  const lid = ids[leader];
  return { ...s, roles: Object.fromEntries(ids.map((id, i) => [id, roles[i]])), leader0: lid, cur: { ...s.cur, leader: lid },
    lady: s.lady && { holder: ids[(leader - 1 + ids.length) % ids.length], holders: [ids[(leader - 1 + ids.length) % ids.length]], checks: [] } };
}

/* ---------- tables (RB p.2, p.3, p.5) ---------- */
eq('good/evil per player count', Object.values(SIDES), [[3, 2], [4, 2], [4, 3], [5, 3], [6, 3], [6, 4]]);
eq('team sizes, 5 players', TEAM[5], [2, 3, 2, 3, 3]);
eq('team sizes, 6 players', TEAM[6], [2, 3, 4, 3, 4]);
eq('team sizes, 7 players', TEAM[7], [2, 3, 3, 4, 4]);
eq('team sizes, 8–10 players', [TEAM[8], TEAM[9], TEAM[10]], [[3, 4, 4, 5, 5], [3, 4, 4, 5, 5], [3, 4, 4, 5, 5]]);
eq('two fails only on quest 4 with 7+', [5, 6, 7, 8, 9, 10].map(n => [0, 1, 2, 3, 4].map(q => failsNeeded(n, q))),
  [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 2, 1], [1, 1, 1, 2, 1], [1, 1, 1, 2, 1], [1, 1, 1, 2, 1]]);
for (const n of [5, 6, 7, 8, 9, 10]) {
  const l = lineup(n, PRESET[n]);
  eq(`${n} players: preset fills the table with the right sides`, [l.length, l.filter(r => ROLES[r].side === 'good').length, l.includes('merlin'), l.includes('assassin')], [n, SIDES[n][0], true, true]);
  eq(`${n} players: preset passes the checks`, check(table(n)).errors, []);
}

/* ---------- line-up checks ---------- */
eq('4 players can\'t start', check(table(4)).errors.length > 0, true);
eq('4 players: start refused', act(table(4), { t: 'start' }), null);
let s6 = act(table(6), { t: 'opt', k: 'role', role: 'oberon' });
eq('6 players with Morgana + Oberon: too many evil roles', check(s6).errors[0].includes('最多再选 1 个邪恶身份'), true);
eq('too many evil roles: start refused', act(s6, { t: 'start' }), null);
let s5 = act(table(5), { t: 'opt', k: 'role', role: 'morgana' });   // preset 5 = Percival + Morgana; drop Morgana
eq('5 players with Percival but no Morgana/Mordred: blocked (RB p.7)', check(s5).errors, ['5 人局带派西维尔时，规则书要求同时加入莫甘娜或莫德雷德']);
eq('…and warned that Percival sees Merlin at once', check(s5).warns.includes('没有莫甘娜时，派西维尔一眼就能认出梅林'), true);
s5 = act(s5, { t: 'opt', k: 'role', role: 'mordred' });
eq('5 players Percival + Mordred: allowed', check(s5).errors, []);
eq('changed line-up sticks when a player joins', config(reduce(s5, { t: 'join', id: 'f', name: 'F' })).roles, ['percival', 'mordred']);
eq('back to the preset', config(act(s5, { t: 'opt', k: 'preset' })).roles, PRESET[5]);
eq('Lady of the Lake on by default from 7', [config(table(6)).lady, config(table(7)).lady], [false, true]);
eq('Lady under 7: warning only', check(act(table(6), { t: 'opt', k: 'lady', on: true })).warns, ['规则书建议 7 人及以上再用湖中仙女']);
eq('not seated: can\'t change options', act(table(5), { t: 'opt', k: 'votes', on: false }, 'zz'), null);
eq('join refused after the start', reduce(game(lineup(5, PRESET[5])), { t: 'join', id: 'z', name: 'Z' }), null);
eq('11th player refused', reduce(table(10), { t: 'join', id: 'z', name: 'Z' }), null);
eq('empty name refused', reduce(table(3), { t: 'join', id: 'z', name: '   ' }), null);
eq('move swaps seats', act(table(5), { t: 'move', i: 0, j: 1 }).seats.map(p => p.id).join(''), 'bacde');
eq('kick', act(table(5), { t: 'kick', id: 'c' }).seats.map(p => p.id).join(''), 'abde');

/* ---------- who sees whom ---------- */
// seats a..j get these roles in order
const R = ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'servant', 'minion'];
const g10 = game(R);
const seen = id => sees(g10, id).map(x => x.id + ':' + x.tag).join(' ');
eq('Merlin sees all evil but Mordred, Oberon included', seen('a'), 'e:evil f:evil h:evil j:evil');
eq('Percival sees Merlin and Morgana, can\'t tell which', seen('b'), 'a:mm f:mm');
eq('servant sees nobody', seen('c'), '');
eq('Assassin sees evil but Oberon (Mordred included)', seen('e'), 'f:evil g:evil j:evil');
eq('Morgana sees the same', seen('f'), 'e:evil g:evil j:evil');
eq('Mordred sees the same', seen('g'), 'e:evil f:evil j:evil');
eq('Oberon sees nobody', seen('h'), '');
eq('minion sees evil but Oberon', seen('j'), 'e:evil f:evil g:evil');
const g5 = game(['merlin', 'percival', 'servant', 'assassin', 'mordred']);
eq('no Morgana: Percival knows Merlin', sees(g5, 'b'), [{ id: 'a', tag: 'merlin' }]);
eq('Merlin can\'t see Mordred', sees(g5, 'a'), [{ id: 'd', tag: 'evil' }]);

/* ---------- views ---------- */
const pv = publicView(g10);
eq('public view: no roles before the end', ['roles', 'me'].filter(k => k in pv), []);
const sv = seatView(g10, 'a');
eq('seat view: own role only', [sv.me.role, sv.me.side, 'roles' in sv], ['merlin', 'good', false]);
eq('seat view of Percival: no tag naming Morgana', JSON.stringify(seatView(g10, 'b').me).includes('morgana'), false);

/* ---------- team, votes, rejections ---------- */
let g = game(lineup(5, PRESET[5]));
eq('team of the wrong size refused', act(g, { t: 'team', team: ['a', 'b', 'c'] }), null);
eq('unknown seat refused', act(g, { t: 'team', team: ['a', 'zz'] }), null);
eq('a viewer can\'t act', act(g, { t: 'team', team: ['a', 'b'] }, null), null);
g = act(g, { t: 'team', team: ['c', 'a'] });
eq('team kept in seat order', [g.cur.team, g.cur.step], [['a', 'c'], 'vote']);
eq('votes must cover every seat', act(g, { t: 'vote', votes: { a: true, b: true, c: true } }), null);
const V = (...ys) => Object.fromEntries('abcde'.split('').map((id, i) => [id, ys.includes(id)]));
const leader0 = g.cur.leader;
let r1 = act(g, { t: 'vote', votes: V('a', 'b') });
eq('2 of 5 approve: rejected, next leader clockwise, attempt 2', [r1.cur.step, r1.cur.att, r1.cur.leader, r1.attempts.at(-1).pass], ['team', 2, g.seats[(g.seats.findIndex(p => p.id === leader0) + 1) % 5].id, false]);
eq('3 of 5 approve: on to the quest', act(g, { t: 'vote', votes: V('a', 'b', 'c') }).cur.step, 'quest');
let g6 = game(lineup(6, PRESET[6]));
g6 = act(g6, { t: 'team', team: ['a', 'b'] });
eq('3 of 6 approve: a tie rejects (RB p.4)', act(g6, { t: 'vote', votes: Object.fromEntries('abcdef'.split('').map((id, i) => [id, i < 3])) }).cur.step, 'team');
// five rejections in one round
let gr = game(lineup(5, PRESET[5]));
for (let k = 1; k <= 5; k++) { gr = act(gr, { t: 'team', team: ['a', 'b'] }); gr = act(gr, { t: 'vote', votes: V() }); if (k < 5) eq(`rejection ${k}: game goes on`, gr.stage, 'play'); }
eq('5th rejection: evil wins at once', [gr.stage, gr.result], ['over', { win: 'evil', why: 'rejects' }]);
eq('…and the roles become public', 'roles' in publicView(gr), true);
// the count starts over after a quest
let gq = game(lineup(5, PRESET[5]), { quest: 'card' });
for (let k = 0; k < 4; k++) { gq = act(gq, { t: 'team', team: ['a', 'b'] }); gq = act(gq, { t: 'vote', votes: V() }); }
gq = act(gq, { t: 'team', team: ['a', 'b'] }); gq = act(gq, { t: 'vote', votes: V('a', 'b', 'c') });
gq = act(gq, { t: 'fails', n: 0 });
eq('after a quest the rejection count starts over', [gq.cur.q, gq.cur.att, gq.stage], [1, 1, 'play']);
eq('votes off: pass/fail only', (() => { let x = game(lineup(5, PRESET[5]), { votes: false }); x = act(x, { t: 'team', team: ['a', 'b'] }); return [act(x, { t: 'vote', votes: V() }), act(x, { t: 'vote', pass: true }).cur.step]; })(), [null, 'quest']);

/* ---------- quests ---------- */
let g7 = game(['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'], { quest: 'card', custom: true, roles: [], lady: false });
const go = (x, team, fails) => { x = act(x, { t: 'team', team }); x = act(x, { t: 'vote', votes: Object.fromEntries(x.seats.map(p => [p.id, true])) }); return act(x, { t: 'fails', n: fails }); };
eq('fail count above team size refused', (() => { let x = act(g7, { t: 'team', team: ['a', 'b'] }); x = act(x, { t: 'vote', votes: Object.fromEntries(x.seats.map(p => [p.id, true])) }); return act(x, { t: 'fails', n: 3 }); })(), null);
g7 = go(g7, ['a', 'b'], 0); g7 = go(g7, ['a', 'b', 'c'], 1); g7 = go(g7, ['a', 'b', 'c'], 0);
const q4one = go(g7, ['a', 'b', 'c', 'e'], 1);
eq('7 players, quest 4, one fail: success', [q4one.quests[3].ok, q4one.quests[3].need], [true, 2]);
eq('…3 successes: assassination', q4one.stage, 'stab');
const q4two = go(g7, ['a', 'b', 'e', 'f'], 2);
eq('7 players, quest 4, two fails: failed', q4two.quests[3].ok, false);
const three = go(go(game(lineup(5, PRESET[5]), { quest: 'card' }), ['a', 'b'], 1), ['a', 'b', 'c'], 1);
eq('3 failed quests: evil wins', go(three, ['a', 'b'], 1).result, { win: 'evil', why: 'quests' });

// quest cards on the phones
const RP = ['merlin', 'percival', 'servant', 'assassin', 'morgana'];
let gp = game(RP, { quest: 'phone' });
gp = act(gp, { t: 'team', team: ['a', 'd'] }); gp = act(gp, { t: 'vote', votes: V('a', 'b', 'c', 'd', 'e') });
eq('card-count entry refused in phone mode', act(gp, { t: 'fails', n: 0 }), null);
eq('a good player can\'t play fail', act(gp, { t: 'play', card: 'F' }, 'a'), null);
eq('only team members play', act(gp, { t: 'play', card: 'S' }, 'b'), null);
gp = act(gp, { t: 'play', card: 'S' }, 'a');
eq('can\'t play twice', act(gp, { t: 'play', card: 'S' }, 'a'), null);
eq('public view shows who played, not what', publicView(gp).cur.played, ['a']);
eq('a player sees their own card', [seatView(gp, 'a').me.card, seatView(gp, 'd').me.card], ['S', null]);
eq('nobody else sees it', JSON.stringify(seatView(gp, 'd')).includes('"S"'), false);
gp = act(gp, { t: 'play', card: 'F' }, 'd');
eq('all played: only the count is kept', [gp.quests[0].fails, gp.quests[0].ok, gp.cur.played, JSON.stringify(gp).includes('"F"')], [1, false, {}, false]);

/* ---------- Lady of the Lake (RB p.8) ---------- */
const L = ['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'oberon'];
let gl = game(L, { quest: 'card', custom: true, roles: ['oberon'], lady: true }, 2);   // leader c → Lady starts with b (to the right)
eq('Lady starts to the right of the first leader', gl.lady.holder, 'b');
gl = go(gl, ['a', 'b'], 0);
eq('not after the first quest', gl.cur.step, 'team');
gl = go(gl, ['a', 'b', 'c'], 0);
eq('after the second quest: Lady', gl.cur.step, 'lady');
eq('only the holder uses it', act(gl, { t: 'lady', target: 'g' }, 'a'), null);
eq('can\'t check yourself', act(gl, { t: 'lady', target: 'b' }, 'b'), null);
gl = act(gl, { t: 'lady', target: 'g' }, 'b');
eq('Oberon shows as evil, only to the holder', [seatView(gl, 'b').me.lady, seatView(gl, 'g').me.lady], [[{ q: 1, target: 'g', side: 'evil' }], []]);
eq('public view: who checked whom, not the result', publicView(gl).lady.checks, [{ q: 1, holder: 'b', target: 'g' }]);
eq('the Lady moves to the checked player', [gl.lady.holder, gl.cur.step], ['g', 'team']);
gl = go(gl, ['a', 'b', 'c'], 1);
eq('a previous holder can\'t be checked', act(gl, { t: 'lady', target: 'b' }, 'g'), null);
gl = act(gl, { t: 'lady', target: 'e' }, 'g');
eq('second check', seatView(gl, 'g').me.lady, [{ q: 2, target: 'e', side: 'evil' }]);

/* ---------- the assassination ---------- */
let ga = game(['merlin', 'percival', 'servant', 'assassin', 'morgana'], { quest: 'card' });
for (let k = 0; k < 3; k++) ga = go(ga, ga.seats.slice(0, TEAM[5][k]).map(p => p.id), 0);
eq('three successes: assassination', ga.stage, 'stab');
eq('only the Assassin names Merlin', act(ga, { t: 'stab', target: 'a' }, 'b'), null);
eq('can\'t name a known evil teammate', act(ga, { t: 'stab', target: 'e' }, 'd'), null);
eq('Merlin named: evil wins', act(ga, { t: 'stab', target: 'a' }, 'd').result, { win: 'evil', why: 'stab', target: 'a' });
eq('wrong guess: good wins', act(ga, { t: 'stab', target: 'b' }, 'd').result, { win: 'good', why: 'missed', target: 'b' });
const done = act(ga, { t: 'stab', target: 'b' }, 'd');
eq('archive record has roles and the result', [gameRecord(done).players.map(p => p.role).join(','), gameRecord(done).result.win], ['merlin,percival,servant,assassin,morgana', 'good']);
eq('again: back to setup with the same seats and no roles', (() => { const x = act(done, { t: 'again' }); return [x.stage, x.seats.length, 'roles' in x]; })(), ['setup', 5, false]);

/* ---------- random games: no view ever carries someone else's secret ---------- */
const SECRET_WORDS = [...Object.keys(ROLES), 'good', 'evil', '"S"', '"F"'];
let games = 0, frames = 0, bad = null;
eq.quiet = true;
for (let seed = 1; seed <= 3000 && !bad; seed++) {
  const r = rng(seed), n = 5 + r(6);
  let s = table(n, { quest: r(2) ? 'card' : 'phone', votes: !!r(4) });
  if (r(2)) for (const o of OPTIONAL) if (r(2)) s = act(s, { t: 'opt', k: 'role', role: o }) || s;
  if (r(2)) s = act(s, { t: 'opt', k: 'lady', on: true });
  if (check(s).errors.length) continue;
  s = act(s, { t: 'start' }, 'a', r); games++;
  for (let step = 0; step < 300 && s.stage !== 'over'; step++) {
    const ids = s.seats.map(p => p.id), c = s.cur;
    let next = null;
    if (s.stage === 'stab') { const by = ids.find(id => s.roles[id] === 'assassin'); next = act(s, { t: 'stab', target: ids.filter(id => id !== by && !sees(s, by).some(x => x.id === id))[r(n - 1 - sees(s, by).length)] }, by); }
    else if (c.step === 'team') next = act(s, { t: 'team', team: shuffleIds(ids, r).slice(0, TEAM[n][c.q]) });
    else if (c.step === 'vote') next = act(s, s.cfg.votes ? { t: 'vote', votes: Object.fromEntries(ids.map(id => [id, r(3) > 0])) } : { t: 'vote', pass: r(3) > 0 });
    else if (c.step === 'quest' && s.cfg.quest === 'card') next = act(s, { t: 'fails', n: r(2) ? 0 : r(c.team.length + 1) });
    else if (c.step === 'quest') { const by = c.team.find(id => !c.played[id]); next = act(s, { t: 'play', card: ROLES[s.roles[by]].side === 'evil' && r(2) ? 'F' : 'S' }, by); }
    else if (c.step === 'lady') { const by = s.lady.holder; next = act(s, { t: 'lady', target: ids.filter(id => !s.lady.holders.includes(id))[0] }, by); }
    if (!next) { bad = `seed ${seed}: stuck at ${s.stage}/${c.step}`; break; }
    s = next;
    if (s.stage === 'over') break;
    // every view a phone would get right now
    const pub = JSON.stringify({ ...publicView(s), opts: 0, cfg: 0 });
    frames++;
    const hit = SECRET_WORDS.find(w => pub.includes(w));
    if (hit) { bad = `seed ${seed}: public view has ${hit}`; break; }
    for (const id of ids) {
      const v = seatView(s, id), me = v.me;
      const rest = JSON.stringify({ ...v, opts: 0, cfg: 0, me: 0 });
      if (rest !== JSON.stringify({ ...publicView(s), opts: 0, cfg: 0, me: 0 })) { bad = `seed ${seed}: seat view differs from public outside "me"`; break; }
      if (me.role !== s.roles[id] || JSON.stringify(me.sees) !== JSON.stringify(sees(s, id))) { bad = `seed ${seed}: wrong "me"`; break; }
      if (me.card && !(c.team.includes(id))) { bad = `seed ${seed}: card shown off the team`; break; }
      if (me.lady.some(x => s.lady.checks.find(k => k.q === x.q).holder !== id)) { bad = `seed ${seed}: someone else's Lady result`; break; }
    }
    if (bad) break;
  }
  if (!bad && s.stage !== 'over') bad = `seed ${seed}: game didn't end`;
  if (!bad && !('roles' in publicView(s))) bad = `seed ${seed}: roles not public at the end`;
}
eq.quiet = false;
function shuffleIds(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = r(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
eq(`random games (${games} games, ${frames} states): views carry no one else's secret`, bad, null);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
