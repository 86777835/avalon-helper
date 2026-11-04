// Rating card on the results screen. Usage: node tests/test_review.mjs <base-url> <shots-dir>
// (local `wrangler dev`; the hub endpoint is mocked with page.route, nothing is posted for real)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const api = p => new URL(p, base).href;
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); };

// a finished 5-player game: five rejected teams
const { code } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
const socks = [];
for (let i = 0; i < 5; i++) {
  const ws = new WebSocket(api(`/api/room/${code}/ws`).replace(/^http/, 'ws')), o = { ws, S: null };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') o.S = m.state; if (m.type === 'seat') o.token = m.token; };
  await new Promise(r => ws.onopen = r); await wait(150);
  ws.send(JSON.stringify({ join: ['小明', '阿花', '老王', '大卫', '珊珊'][i] })); await wait(200);
  socks.push(o);
}
const A = socks[0], send = async a => { const v = A.S.v; A.ws.send(JSON.stringify({ action: a })); for (let i = 0; i < 100 && A.S.v === v; i++) await wait(30); };
await send({ t: 'start' });
const ids = A.S.seats.map(p => p.id);
for (let k = 0; k < 5; k++) { await send({ t: 'team', team: ids.slice(0, 2) }); await send({ t: 'vote', votes: Object.fromEntries(ids.map(id => [id, false])) }); }
eq('game over', [A.S.stage, A.S.result.win], ['over', 'evil']);

const b = await chromium.launch({ channel: 'chrome' });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errs = [], posted = [];
const mock = async page => {
  page.on('pageerror', e => errs.push(e.message));
  await page.route('https://boardgame.leisurecat.cloud/api/reviews', async r => {
    posted.push(JSON.parse(r.request().postData()));
    await r.fulfill({ json: { ok: true, avg: 4, count: posted.length, dist: [0, 0, 0, 1, 0] }, headers: { 'access-control-allow-origin': '*' } });
  });
};

// 阿花's phone (her seat token in localStorage, as after joining)
const p = await (await b.newContext(phone)).newPage();
await mock(p);
await p.goto(base);
await p.evaluate(([c, t]) => localStorage.setItem('avl-seat-' + c, t), [code, socks[1].token]);
await p.goto(api(`/?r=${code}`)); await p.waitForSelector('.rv');
eq('card outside the long-image area', await p.$('#shot .rv'), null);
eq('"我是" lists the seats, own seat chosen', await p.$$eval('.rv-who button', l => l.map(x => [x.textContent.slice(1), x.classList.contains('on')])), [['小明', false], ['阿花', true], ['老王', false], ['大卫', false], ['珊珊', false]]);
eq('send disabled until stars', await p.isDisabled('[data-act="rv-send"]'), true);
await p.click('[data-act="rv-star"][data-n="4"]');
eq('4 stars lit, label', [await p.$$eval('.rv-st button.on', l => l.length), await p.textContent('.rv-st span')], [4, '好玩']);
await p.fill('[data-rv]', '投票记录太方便了');
await p.click('[data-act="rv-star"][data-n="5"]');   // a re-render must keep the typed text
eq('text kept across re-render', await p.inputValue('[data-rv]'), '投票记录太方便了');
await p.screenshot({ path: `${out}/review.png`, fullPage: true });
await p.click('[data-act="rv-send"]'); await p.waitForSelector('.rv-done');
eq('posted to the hub', posted[0], { game: 'avalon', stars: 5, name: '阿花', text: '投票记录太方便了', room: code });
eq('thanks shown', (await p.textContent('.rv p')).includes('谢谢 阿花'), true);
eq('link to everyone\'s reviews', await p.getAttribute('.rv a', 'href'), 'https://boardgame.leisurecat.cloud');
await p.reload(); await p.waitForSelector('.rv');
eq('sent state remembered after reload', !!(await p.$('.rv-done')), true);
await p.click('[data-act="rv-edit"]');
eq('edit restores the form', [await p.$$eval('.rv-st button.on', l => l.length), await p.inputValue('[data-rv]')], [5, '投票记录太方便了']);
await p.click('[data-act="rv-who"]:nth-child(3)'); await p.click('[data-act="rv-send"]'); await p.waitForSelector('.rv-done');
eq('another name can be chosen', posted.at(-1).name, '老王');

// a phone that isn't seated (a spectator) chooses who they are
const v = await (await b.newContext(phone)).newPage();
await mock(v);
await v.goto(api(`/?r=${code}`)); await v.waitForSelector('.rv');
eq('spectator: nobody chosen', await v.$$eval('.rv-who button.on', l => l.length), 0);
await v.click('[data-act="rv-star"][data-n="3"]');
eq('send disabled until "我是"', await v.isDisabled('[data-act="rv-send"]'), true);

// hub refuses → the reason is shown
await p.unroute('https://boardgame.leisurecat.cloud/api/reviews');
await p.route('https://boardgame.leisurecat.cloud/api/reviews', r => r.fulfill({ status: 429, json: { error: '评价太频繁，请稍后再试' }, headers: { 'access-control-allow-origin': '*' } }));
await p.click('[data-act="rv-edit"]'); await p.click('[data-act="rv-send"]'); await p.waitForSelector('.rv .err');
eq('hub error shown', await p.textContent('.rv .err'), '评价太频繁，请稍后再试');

eq('no page errors', errs, []);
socks.forEach(s => s.ws.close()); await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
