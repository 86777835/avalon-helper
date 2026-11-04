// Whole games on separate phones, through the pages. Usage: node tests/test_game.mjs <base-url> <shots-dir>   (local `wrangler dev`)
// Game 1 — 7 phones, quest cards on the phones, Lady of the Lake: join by link, reorder seats, hold "我的身份",
//   a rejected team, a failed quest, two Lady checks (result only on the holder's phone), quest 4 with one fail
//   (still a success at 7 players), the assassination, the reveal, the record table, the long image, history.
// Game 2 — 5 phones, real quest cards: five rejected teams in one round (with the confirmation) → evil wins.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const yes = (name, v) => eq(name, !!v, true);
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROLE_NAMES = ['梅林', '派西维尔', '亚瑟的忠臣', '刺客', '莫甘娜', '莫德雷德', '奥伯伦', '莫德雷德的爪牙'];
const EVIL = ['刺客', '莫甘娜', '莫德雷德', '奥伯伦', '莫德雷德的爪牙'];

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function phones(k) {
  const ps = [];
  for (let i = 0; i < k; i++) { const p = await (await b.newContext(phone)).newPage(); p.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); }); ps.push(p); }
  return ps;
}
// what the page shows outside the identity card and the rules assistant
const shown = p => p.evaluate(() => { const c = document.querySelector('#app').cloneNode(true); c.querySelectorAll('.idc').forEach(x => x.remove()); return c.textContent; });
async function hold(p) {   // press "我的身份", read it, let go
  const box = await p.locator('.idc').boundingBox();
  await p.mouse.move(box.x + 40, box.y + 20); await p.mouse.down();
  await p.waitForSelector('.idc.face');
  const r = { role: await p.textContent('.idh b'), side: await p.textContent('.idh .side'), sees: await p.$$eval('.idc .sees .tag', l => l.map(x => x.textContent)) };
  await p.mouse.up(); await p.waitForSelector('.idc.back');
  return r;
}

/* ---------- game 1 ---------- */
const P = await phones(7);
const names = ['小明', '阿花', '老王', '大卫', '珊珊', '凯文', '莉莉'];
await P[0].goto(base);
await P[0].click('text=创建新房间'); await P[0].waitForSelector('#seatName');
const url = P[0].url(), code = new URL(url).searchParams.get('r');
for (const [i, p] of P.entries()) {
  if (i) await p.goto(url);
  await p.waitForSelector('#seatName'); await p.fill('#seatName', names[i]); await p.click('[data-act="sit"]'); await p.waitForSelector('text=这是你');
}
await P[0].waitForFunction(() => document.querySelectorAll('[data-k^="seat-"]').length === 7);
// 莉莉 actually sits between 老王 and 大卫: move her up three places
for (let k = 0; k < 3; k++) { await P[0].click(`[data-k^="seat-"]:nth-child(${7 - k}) [aria-label="上移"]`); await wait(250); }
const order = await P[3].$$eval('[data-k^="seat-"] .nm, [data-k^="seat-"] input', l => l.map(x => x.value || x.textContent));
eq('seat order synced to every phone', order, ['小明', '阿花', '老王', '莉莉', '大卫', '珊珊', '凯文']);
eq('7 players: preset line-up shown', await P[2].$$eval('.rch.on > span:last-child', l => l.map(x => x.textContent.replace('必有', ''))), ['梅林', '刺客', '派西维尔', '莫甘娜', '奥伯伦']);
yes('Lady of the Lake on by default at 7', await P[1].isChecked('[data-opt="lady"]'));
await P[1].click('[data-act="quest"][data-v="phone"]');
await P[0].waitForSelector('.seg.sm button.on:has-text("手机")');
await P[0].screenshot({ path: `${out}/g1-setup.png`, fullPage: true });
await P[4].click('[data-act="start"]');
await Promise.all(P.map(p => p.waitForSelector('.idc.back')));
await P[0].screenshot({ path: `${out}/g1-start.png` });

// the test reads everyone's card; no phone shows any role while not held
const who = {};
for (const [i, p] of P.entries()) who[names[i]] = await hold(p);
eq('every role dealt once (7 players: 4 good, 3 evil)', Object.values(who).map(x => x.side).sort(), ['好人', '好人', '好人', '好人', '邪恶', '邪恶', '邪恶']);
const nameOf = role => Object.keys(who).find(k => who[k].role === role);
const merlin = nameOf('梅林'), assassin = nameOf('刺客'), morgana = nameOf('莫甘娜'), oberon = nameOf('奥伯伦'), perc = nameOf('派西维尔');
eq('Merlin sees the three evil players', who[merlin].sees.map(t => t.replace('邪恶', '')).sort(), [assassin, morgana, oberon].sort());
eq('Percival sees Merlin and Morgana, unlabelled', who[perc].sees.map(t => t.replace('梅林或莫甘娜', '')).sort(), [merlin, morgana].sort());
eq('Assassin sees Morgana only (not Oberon)', who[assassin].sees, [`${morgana}邪恶`]);
eq('Oberon sees nobody', who[oberon].sees, []);
const pageOf = nm => P[names.indexOf(nm)];
for (const p of P) { const t = await shown(p); const hit = ROLE_NAMES.find(r => t.includes(r)); if (hit) { fails++; console.log('FAIL role on screen while not held:', hit); } }
console.log('PASS no role on any screen while not held');
const good = Object.keys(who).filter(k => who[k].side === '好人'), evil = Object.keys(who).filter(k => who[k].side === '邪恶');

const leader = async () => P[0].textContent('.ldr');
const pickTeam = async (p, team) => { for (const t of team) await p.click(`.pc:text-is("${t}")`); await p.click('[data-act="team"]'); await P[0].waitForSelector('.vlist'); };
const voteAll = async (p, no = []) => {
  for (const nm of no) await p.click(`.vrow:has(.nm:has-text("${nm}")) [data-v="0"]`);
  await p.click('[data-act="vall"][data-v="1"]'); await p.click('[data-act="vote"]');
};
const playCards = async (team, failBy = []) => {
  for (const t of team) { const p = pageOf(t); await p.waitForSelector('.qc'); await p.click(failBy.includes(t) ? '.qc.f' : '.qc.s'); await p.click('[data-act="play"]'); }
};

// quest 1: two good players, one reject vote recorded, both play success
const l1 = await leader();
eq('quest 1: leader shown on every phone', new Set(await Promise.all(P.map(p => p.textContent('.ldr')))).size, 1);
await pickTeam(P[2], good.slice(0, 2));
await voteAll(P[5], [evil[0]]);
await pageOf(good[0]).waitForSelector('.qc');
yes('team member: card buttons on own phone', await pageOf(good[0]).isVisible('.qc.f'));
yes('non-member: waiting', await pageOf(evil[1]).isVisible('text=等待队员出牌'));
await pageOf(good[0]).click('.qc.f');
await pageOf(good[0]).waitForSelector('.toast:has-text("好人只能出成功")');
console.log('PASS good player tapping 失败 is stopped on the phone');
await playCards(good.slice(0, 2));
await P[0].waitForSelector('.qt.ok');
eq('quest 1 succeeded', await P[3].$$eval('.qt.ok', l => l.length), 1);

// quest 2: first team rejected by everyone, then a team with an evil player who fails it
const l2 = await leader();
await pickTeam(P[0], [good[0], good[1], good[2]]);
await voteAll(P[1], names);
await P[0].waitForFunction(l => document.querySelector('.ldr')?.textContent !== l, l2);
eq('rejected: next leader clockwise', await leader(), order[(order.indexOf(l2) + 1) % 7]);
eq('rejection counted', await P[0].textContent('.att small'), '第 2/5 次组队');
await pickTeam(P[3], [good[0], evil[0], good[1]]);
await voteAll(P[3]);
await playCards([good[0], evil[0], good[1]], [evil[0]]);
await P[0].waitForSelector('.qt.bad');
eq('quest 2 failed with 1 fail card', await P[0].textContent('.qt.bad small'), '1 张失败');
// Lady of the Lake: the holder checks someone; only the holder sees the result
const holderName = async () => (await P[0].textContent('h2.h small')).replace(' 正在选择', '');
await P[0].waitForSelector('text=湖中仙女');
const pickLady = async () => {
  for (const p of P) if (await p.isVisible('[data-act="lady"]')) return p;
};
const h1 = await pickLady(), h1n = names[P.indexOf(h1)];
eq('Lady starts to the right of the first leader', h1n, order[(order.indexOf(l1) + 6) % 7]);
const t1 = (await h1.$$eval('.pc:not([disabled])', l => l.map(x => x.textContent)))[0];
await h1.click(`.pc:text-is("${t1}")`); await h1.click('[data-act="lady"]');
await h1.waitForSelector('.lady-r .big');
eq('holder sees the checked side', await h1.textContent('.lady-r .big'), who[t1].side);
await h1.screenshot({ path: `${out}/g1-lady.png` });
await h1.click('.lady-r [data-act="close"]');
for (const p of P.filter(p => p !== h1)) if (await p.isVisible('.lady-r')) { fails++; console.log('FAIL Lady result on another phone'); }
await P[0].click('[data-act="tab"][data-tab="rec"]');
const recText = await P[0].textContent('#app');
yes('record tab: who checked whom', recText.includes(`${h1n} 查看了 ${t1}`));
if (h1 !== P[0]) yes('record tab of others: no result', !recText.includes(`${t1}：好人`) && !recText.includes(`${t1}：邪恶`));
await P[0].screenshot({ path: `${out}/g1-record.png`, fullPage: true });
await P[0].click('[data-act="tab"][data-tab="game"]');

// quest 3: good team succeeds; second Lady check
const q3 = good.slice(0, 3);
await pickTeam(P[1], q3); await voteAll(P[1]); await playCards(q3);
await P[0].waitForFunction(() => document.querySelectorAll('.qt.ok').length === 2);
const h2 = await (async () => { for (let k = 0; k < 20; k++) { for (const p of P) if (await p.isVisible('[data-act="lady"]')) return p; await wait(200); } })();
eq('the Lady moved to the checked player', names[P.indexOf(h2)], t1);
const banned = await h2.$$eval('.pc[disabled]', l => l.map(x => x.textContent));
yes('previous holder can\'t be checked', banned.includes(h1n));
const t2 = (await h2.$$eval('.pc:not([disabled])', l => l.map(x => x.textContent)))[0];
await h2.click(`.pc:text-is("${t2}")`); await h2.click('[data-act="lady"]'); await h2.waitForSelector('.lady-r'); await h2.click('.lady-r [data-act="close"]');

// quest 4 at 7 players needs two fails: one fail card still succeeds → third success → assassination
const q4 = [...good.slice(0, 3), evil[0]];
await P[2].waitForSelector('text=需 2 张失败才算失败');
console.log('PASS quest 4 shows "需 2 张失败"');
await pickTeam(P[2], q4); await voteAll(P[2]); await playCards(q4, [evil[0]]);
await P[0].waitForSelector('text=刺杀梅林');
eq('quest 4 with one fail: success', await P[0].$$eval('.qt.ok', l => l.length), 3);
yes('assassin gets the choice', await pageOf(assassin).isVisible('[data-act="stab"]'));
yes('others wait', !(await pageOf(merlin).isVisible('[data-act="stab"]')));
const options = await pageOf(assassin).$$eval('.pc', l => l.map(x => x.textContent));
yes('assassin can\'t name himself or known teammates', !options.includes(assassin) && !options.includes(morgana));
const wrong = good.find(g => g !== merlin);
await pageOf(assassin).click(`.pc:text-is("${wrong}")`); await pageOf(assassin).click('[data-act="stab"]');
await pageOf(assassin).click('[data-act="confirm"]');
await Promise.all(P.map(p => p.waitForSelector('.win')));
eq('good wins', await P[0].textContent('.win .wt'), '好人获胜');
eq('every role revealed', (await P[5].$$eval('.rl .row', l => l.map(x => [x.querySelector('.nm').textContent.replace('（我）', ''), x.querySelector('.fg').textContent]))).map(([a, r]) => r === who[a].role).every(Boolean), true);
eq('Lady results public at the end', (await P[0].textContent('#shot')).includes(`${h1n} 查看了 ${t1}：${who[t1].side}`), true);
eq('record table: 5 attempts', await P[0].$$eval('.rt thead th', l => l.length - 1), 5);
yes('review card on the results', await P[0].isVisible('.rv'));
await P[0].screenshot({ path: `${out}/g1-over.png`, fullPage: true });
await P[0].click('[data-act="save"]'); await P[0].waitForSelector('.shotv img', { timeout: 20000 });
yes('long image made', (await P[0].getAttribute('.shotv img', 'src')).startsWith('data:image/jpeg'));
await P[0].click('.shotv button');
await P[1].goto(new URL('history', base).href); await P[1].waitForSelector('.game');
await P[1].fill('#q', code); await P[1].click('#search button'); await P[1].waitForSelector('.game');
eq('history finds the game by room code', await P[1].$$eval('.game .gh b', l => l.map(x => x.textContent)), [code]);
// again: same seats, back to setup
await P[3].click('[data-act="again"]');
await P[0].waitForSelector('[data-act="start"]');
eq('again: same seats', await P[0].$$eval('[data-k^="seat-"]', l => l.length), 7);
for (const p of P) await p.context().close();

/* ---------- game 2: five rejections ---------- */
const Q = await phones(5);
await Q[0].goto(base); await Q[0].click('text=创建新房间'); await Q[0].waitForSelector('#seatName');
const url2 = Q[0].url();
for (const [i, p] of Q.entries()) { if (i) await p.goto(url2); await p.waitForSelector('#seatName'); await p.fill('#seatName', '甲乙丙丁戊'[i]); await p.click('[data-act="sit"]'); await p.waitForSelector('text=这是你'); }
await Q[0].waitForFunction(() => document.querySelectorAll('[data-k^="seat-"]').length === 5);
await Q[0].click('[data-act="start"]'); await Q[0].waitForSelector('.idc.back');
for (let k = 1; k <= 5; k++) {
  await Q[0].click('.pc:text-is("甲")'); await Q[0].click('.pc:text-is("乙")'); await Q[0].click('[data-act="team"]');
  await Q[0].waitForSelector('.vlist');
  if (k === 5) yes('5th team: warning banner', await Q[2].isVisible('.banner.alarm'));
  await Q[0].click('[data-act="vall"][data-v="0"]'); await Q[0].click('[data-act="vote"]');
  if (k === 5) { await Q[0].waitForSelector('.sheet'); yes('5th rejection asks first', (await Q[0].textContent('.sheet')).includes('邪恶方直接获胜')); await Q[0].click('[data-act="confirm"]'); }
  else await Q[0].waitForFunction(k => document.querySelector('.att small')?.textContent === `第 ${k + 1}/5 次组队`, k);
}
await Q[1].waitForSelector('.win');
eq('five rejections: evil wins', [await Q[1].textContent('.win .wt'), await Q[1].textContent('.win .ws')], ['邪恶获胜', '同一轮 5 次组队都被否决']);
await Q[1].screenshot({ path: `${out}/g2-over.png`, fullPage: true });

// card mode: undo of a recorded vote
await Q[0].click('[data-act="again"]'); await Q[0].waitForSelector('[data-act="start"]'); await Q[0].click('[data-act="start"]'); await Q[0].waitForSelector('.idc.back');
await Q[0].click('.pc:text-is("甲")'); await Q[0].click('.pc:text-is("乙")'); await Q[0].click('[data-act="team"]'); await Q[0].waitForSelector('.vlist');
await Q[0].click('[data-act="vall"][data-v="1"]'); await Q[0].click('[data-act="vote"]'); await Q[0].waitForSelector('.stepper');
await Q[3].click('[data-act="undo"]'); await Q[0].waitForSelector('.vlist');
console.log('PASS undo takes back a recorded vote');
await Q[0].click('[data-act="vall"][data-v="1"]'); await Q[0].click('[data-act="vote"]'); await Q[0].waitForSelector('.stepper');
await Q[0].click('[data-act="fails"][data-d="1"]'); await Q[0].click('[data-act="qres"]');
await Q[2].waitForSelector('.qt.bad');
eq('card mode: fail count recorded', await Q[2].textContent('.qt.bad small'), '1 张失败');
for (const p of Q) await p.context().close();

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
