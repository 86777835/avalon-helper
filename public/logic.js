// Rules and state for one Avalon table. The server (src/worker.js) runs reduce() on every action and is the only
// one that ever holds the whole state; each phone gets seatView() (its own identity + public facts) or publicView().
// Rules follow the official rulebook (Indie Boards & Cards); page numbers ("RB p.N") are those of the printed rulebook.

export const ROLES = {
  merlin:   { name: '梅林', side: 'good' },
  percival: { name: '派西维尔', side: 'good' },
  servant:  { name: '亚瑟的忠臣', side: 'good' },
  assassin: { name: '刺客', side: 'evil' },
  morgana:  { name: '莫甘娜', side: 'evil' },
  mordred:  { name: '莫德雷德', side: 'evil' },
  oberon:   { name: '奥伯伦', side: 'evil' },
  minion:   { name: '莫德雷德的爪牙', side: 'evil' }
};
export const SIDE_ZH = { good: '好人', evil: '邪恶' };
export const OPTIONAL = ['percival', 'morgana', 'mordred', 'oberon'];
export const MIN = 5, MAX = 10;
// good / evil per player count (RB p.2)
export const SIDES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
// team size of quests 1–5 per player count (RB p.3)
export const TEAM = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
// the 4th quest needs two fail cards with 7 or more players (RB p.5)
export const failsNeeded = (n, q) => n >= 7 && q === 3 ? 2 : 1;
export const MAX_REJECTS = 5;   // the 5th rejected team in one round: evil wins at once (RB p.4)
// Commonly used line-ups (community habit, not from the rulebook): optional roles on top of Merlin and the Assassin.
export const PRESET = {
  5: ['percival', 'morgana'], 6: ['percival', 'morgana'], 7: ['percival', 'morgana', 'oberon'],
  8: ['percival', 'morgana'], 9: ['percival', 'morgana', 'mordred'], 10: ['percival', 'morgana', 'mordred', 'oberon']
};

const secureInt = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const clean = (v, max = 12) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function initialState() {
  return { v: 0, stage: 'setup', seats: [], opts: { custom: false, roles: [], lady: false, quest: 'card', votes: true }, gid: null };
}

// The line-up in effect: the preset for this many players until someone changes it.
export function config(s) {
  const n = s.seats.length;
  if (!s.opts.custom) return { roles: PRESET[n] || PRESET[n < MIN ? MIN : MAX], lady: n >= 7, quest: s.opts.quest, votes: s.opts.votes };
  return { roles: s.opts.roles, lady: s.opts.lady, quest: s.opts.quest, votes: s.opts.votes };
}
// Every role in the game: Merlin + Assassin + chosen optional roles, the rest loyal servants / minions.
export function lineup(n, roles) {
  const [g, e] = SIDES[n];
  const good = ['merlin', ...roles.filter(r => ROLES[r].side === 'good')], evil = ['assassin', ...roles.filter(r => ROLES[r].side === 'evil')];
  return [...good, ...Array(Math.max(0, g - good.length)).fill('servant'), ...evil, ...Array(Math.max(0, e - evil.length)).fill('minion')];
}
// Problems that block the start, and warnings that don't.
export function check(s) {
  const n = s.seats.length, c = config(s), errors = [], warns = [];
  if (n < MIN) errors.push(`至少 ${MIN} 人才能开局，现在 ${n} 人`);
  if (n > MAX) errors.push(`最多 ${MAX} 人`);
  if (n >= MIN && n <= MAX) {
    const evil = 1 + c.roles.filter(r => ROLES[r].side === 'evil').length;
    if (evil > SIDES[n][1]) errors.push(`${n} 人局只有 ${SIDES[n][1]} 名邪恶，刺客之外最多再选 ${SIDES[n][1] - 1} 个邪恶身份`);
    if (n === 5 && c.roles.includes('percival') && !c.roles.includes('morgana') && !c.roles.includes('mordred'))
      errors.push('5 人局带派西维尔时，规则书要求同时加入莫甘娜或莫德雷德');
    if (c.roles.includes('percival') && !c.roles.includes('morgana')) warns.push('没有莫甘娜时，派西维尔一眼就能认出梅林');
    if (c.roles.includes('morgana') && !c.roles.includes('percival')) warns.push('没有派西维尔时，莫甘娜的能力用不上');
    if (c.lady && n < 7) warns.push('规则书建议 7 人及以上再用湖中仙女');
  }
  return { errors, warns };
}

const idx = (s, id) => s.seats.findIndex(p => p.id === id);
const nextOf = (s, id) => s.seats[(idx(s, id) + 1) % s.seats.length].id;   // seats are listed clockwise
const rightOf = (s, id) => s.seats[(idx(s, id) - 1 + s.seats.length) % s.seats.length].id;
const sideOf = (s, id) => ROLES[s.roles[id]].side;
const count = (s, ok) => s.quests.filter(q => q.ok === ok).length;

// Actions that can be taken back. Anything that showed someone secret information (a dealt hand, a card played on a phone,
// a Lady of the Lake check, the assassination) or ended the game cannot; nor can removing a seat (its phone loses the seat).
export const UNDOABLE = new Set(['move', 'opt', 'team', 'vote', 'fails']);

// by: the seat id of the phone that sent the action (the server knows it from the connection).
// Returns the next state, or null when the action isn't allowed now.
export function reduce(s, a, by, rnd = secureInt) {
  if (!a || typeof a.t !== 'string') return null;
  const seated = by && idx(s, by) >= 0;
  const out = x => ({ ...x, v: s.v + 1 });
  switch (a.t) {
    case 'join': {   // the server adds a.id; a phone that isn't seated yet
      if (s.stage !== 'setup' || s.seats.length >= MAX || !a.id || idx(s, a.id) >= 0) return null;
      const name = clean(a.name); if (!name) return null;
      return out({ ...s, seats: [...s.seats, { id: a.id, name }] });
    }
    case 'name': {
      const name = clean(a.name); if (!seated || !name) return null;
      return out({ ...s, seats: s.seats.map(p => p.id === by ? { ...p, name } : p) });
    }
    case 'move': {
      const { i, j } = a; if (!seated || s.stage !== 'setup' || ![i, j].every(k => Number.isInteger(k) && k >= 0 && k < s.seats.length)) return null;
      const seats = s.seats.slice(); [seats[i], seats[j]] = [seats[j], seats[i]];
      return out({ ...s, seats });
    }
    case 'kick': {
      if (!seated || s.stage !== 'setup' || idx(s, a.id) < 0) return null;
      return out({ ...s, seats: s.seats.filter(p => p.id !== a.id) });
    }
    case 'opt': {
      if (!seated || s.stage !== 'setup') return null;
      const c = config(s), o = { ...s.opts };
      if (a.k === 'role' && OPTIONAL.includes(a.role)) { o.custom = true; o.lady = c.lady; o.roles = c.roles.includes(a.role) ? c.roles.filter(r => r !== a.role) : [...c.roles, a.role]; }
      else if (a.k === 'lady') { o.custom = true; o.roles = c.roles; o.lady = !!a.on; }
      else if (a.k === 'preset') { o.custom = false; }
      else if (a.k === 'quest' && ['card', 'phone'].includes(a.v)) o.quest = a.v;
      else if (a.k === 'votes') o.votes = !!a.on;
      else return null;
      return out({ ...s, opts: o });
    }
    case 'start': {
      if (!seated || s.stage !== 'setup' || check(s).errors.length) return null;
      const n = s.seats.length, c = config(s);
      const deck = shuffle(lineup(n, c.roles), rnd);
      const roles = Object.fromEntries(s.seats.map((p, k) => [p.id, deck[k]]));
      const leader = s.seats[rnd(n)].id;
      const lady = c.lady ? { holder: rightOf(s, leader), holders: [rightOf(s, leader)], checks: [] } : null;
      return out({
        ...s, stage: 'play', gid: `${Date.now()}-${rnd(1e6)}`, cfg: { ...c, roles: OPTIONAL.filter(r => c.roles.includes(r)) },
        roles, leader0: leader, quests: [], attempts: [], lady, result: null,
        cur: { q: 0, att: 1, leader, team: [], step: 'team', played: {} }
      });
    }
    case 'team': {   // the leader's pick, entered on any phone
      if (!seated || s.stage !== 'play' || s.cur.step !== 'team') return null;
      const team = Array.isArray(a.team) ? [...new Set(a.team)] : [];
      if (team.length !== TEAM[s.seats.length][s.cur.q] || team.some(id => idx(s, id) < 0)) return null;
      return out({ ...s, cur: { ...s.cur, team: s.seats.map(p => p.id).filter(id => team.includes(id)), step: 'vote' } });
    }
    case 'vote': {   // the votes everyone showed at the table
      if (!seated || s.stage !== 'play' || s.cur.step !== 'vote') return null;
      let votes = null, pass;
      if (s.cfg.votes) {
        if (!a.votes || s.seats.some(p => typeof a.votes[p.id] !== 'boolean')) return null;
        votes = Object.fromEntries(s.seats.map(p => [p.id, a.votes[p.id]]));
        pass = Object.values(votes).filter(Boolean).length * 2 > s.seats.length;   // a tie rejects (RB p.4)
      } else { if (typeof a.pass !== 'boolean') return null; pass = a.pass; }
      const c = s.cur, attempts = [...s.attempts, { q: c.q, att: c.att, leader: c.leader, team: c.team, votes, pass }];
      if (pass) return out({ ...s, attempts, cur: { ...c, step: 'quest', played: {} } });
      if (c.att >= MAX_REJECTS) return out({ ...s, attempts, stage: 'over', result: { win: 'evil', why: 'rejects' } });
      return out({ ...s, attempts, cur: { ...c, att: c.att + 1, leader: nextOf(s, c.leader), team: [], step: 'team' } });
    }
    case 'fails': {   // real quest cards: how many fail cards were revealed
      if (!seated || s.stage !== 'play' || s.cur.step !== 'quest' || s.cfg.quest !== 'card') return null;
      const k = a.n; if (!Number.isInteger(k) || k < 0 || k > s.cur.team.length) return null;
      return out(resolve(s, k));
    }
    case 'play': {   // quest cards on the phones: each team member plays on their own phone
      if (!seated || s.stage !== 'play' || s.cur.step !== 'quest' || s.cfg.quest !== 'phone') return null;
      if (!s.cur.team.includes(by) || s.cur.played[by] || !['S', 'F'].includes(a.card)) return null;
      if (a.card === 'F' && sideOf(s, by) === 'good') return null;   // good players can only play success (RB p.5)
      const played = { ...s.cur.played, [by]: a.card };
      if (Object.keys(played).length < s.cur.team.length) return out({ ...s, cur: { ...s.cur, played } });
      return out(resolve(s, Object.values(played).filter(x => x === 'F').length));   // only the count is kept
    }
    case 'lady': {
      if (!seated || s.stage !== 'play' || s.cur.step !== 'lady' || by !== s.lady.holder) return null;
      const t = a.target; if (idx(s, t) < 0 || s.lady.holders.includes(t)) return null;
      const lady = { holder: t, holders: [...s.lady.holders, t], checks: [...s.lady.checks, { q: s.cur.q, holder: by, target: t, side: sideOf(s, t) }] };
      return out(nextQuest({ ...s, lady }));
    }
    case 'stab': {
      if (!seated || s.stage !== 'stab' || s.roles[by] !== 'assassin') return null;
      const t = a.target; if (idx(s, t) < 0 || t === by || sees(s, by).some(x => x.id === t)) return null;   // name a good player (RB p.6)
      return out({ ...s, stage: 'over', result: { win: s.roles[t] === 'merlin' ? 'evil' : 'good', why: s.roles[t] === 'merlin' ? 'stab' : 'missed', target: t } });
    }
    case 'again': {   // a new game with the same table; an unfinished game is dropped
      if (!seated || s.stage === 'setup') return null;
      const { seats, opts } = s;
      return out({ ...initialState(), seats, opts });
    }
  }
  return null;
}

// A quest is done: record the fail count only, then go on.
function resolve(s, fails) {
  const c = s.cur, n = s.seats.length;
  const quests = [...s.quests, { q: c.q, leader: c.leader, team: c.team, fails, need: failsNeeded(n, c.q), ok: fails < failsNeeded(n, c.q) }];
  const t = { ...s, quests, cur: { ...c, played: {} } };
  if (count(t, false) >= 3) return { ...t, stage: 'over', result: { win: 'evil', why: 'quests' } };
  if (count(t, true) >= 3) return { ...t, stage: 'stab' };
  if (s.lady && c.q >= 1 && c.q <= 3) return { ...t, cur: { ...t.cur, step: 'lady' } };   // after quests 2, 3, 4 (RB p.8)
  return nextQuest(t);
}
const nextQuest = s => ({ ...s, cur: { q: s.cur.q + 1, att: 1, leader: nextOf(s, s.cur.leader), team: [], step: 'team', played: {} } });

// Who a seat sees at the start (RB p.2, p.7; Merlin sees Oberon per the publisher's answer, BGG thread 864973).
// tag: 'evil' = known evil; 'mm' = Merlin or Morgana (Percival can't tell which); 'merlin' = Merlin (no Morgana in play).
export function sees(s, id) {
  const r = s.roles[id], others = s.seats.map(p => p.id).filter(x => x !== id);
  if (r === 'merlin') return others.filter(x => sideOf(s, x) === 'evil' && s.roles[x] !== 'mordred').map(x => ({ id: x, tag: 'evil' }));
  if (r === 'percival') {
    const m = others.filter(x => ['merlin', 'morgana'].includes(s.roles[x]));
    return m.map(x => ({ id: x, tag: m.length > 1 ? 'mm' : 'merlin' }));
  }
  if (ROLES[r].side === 'evil' && r !== 'oberon') return others.filter(x => sideOf(s, x) === 'evil' && s.roles[x] !== 'oberon').map(x => ({ id: x, tag: 'evil' }));
  return [];
}

// What every phone may know. Roles appear only once the game is over.
export function publicView(s) {
  const v = { v: s.v, stage: s.stage, seats: s.seats, opts: s.opts };
  if (s.stage === 'setup') return v;
  const over = s.stage === 'over';
  Object.assign(v, {
    cfg: s.cfg, gid: s.gid, leader0: s.leader0, quests: s.quests, attempts: s.attempts, result: s.result,
    cur: { q: s.cur.q, att: s.cur.att, leader: s.cur.leader, team: s.cur.team, step: s.cur.step, played: Object.keys(s.cur.played) },
    lady: s.lady && { holder: s.lady.holder, holders: s.lady.holders, checks: s.lady.checks.map(c => over ? c : { q: c.q, holder: c.holder, target: c.target }) }
  });
  if (over) v.roles = s.roles;
  return v;
}
// One seat's phone: the public view plus its own role, who it sees, its Lady of the Lake results and its own quest card.
export function seatView(s, id) {
  const v = publicView(s);
  if (s.stage === 'setup' || !s.roles[id]) return { ...v, me: { id } };
  return { ...v, me: {
    id, role: s.roles[id], side: sideOf(s, id), sees: sees(s, id),
    lady: (s.lady?.checks || []).filter(c => c.holder === id).map(c => ({ q: c.q, target: c.target, side: c.side })),
    card: s.cur.played[id] || null
  } };
}

// For the archive of finished games.
export function gameRecord(s) {
  if (s.stage !== 'over') return null;
  return { gid: s.gid, n: s.seats.length, players: s.seats.map(p => ({ id: p.id, name: p.name, role: s.roles[p.id] })),
    cfg: s.cfg, result: s.result, quests: s.quests, attempts: s.attempts, lady: s.lady?.checks || [] };
}
