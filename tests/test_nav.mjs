// Back buttons (top left). Usage: node tests/test_nav.mjs <base-url> <shots-dir>   (local `wrangler dev`)
// - landing: "‹ 全部游戏" → the hub
// - in a room (setup, in game, results): "‹ 首页" → back to the landing; the room is still there and can be entered again
// - guide / history: "‹ 返回" → /
// - at 390 px: the button is visible, at least 36 px tall, overlaps no other clickable element, and nothing scrolls sideways
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base, out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const api = p => new URL(p, base).href;
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const b = await chromium.launch({ channel: 'chrome' });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));

// the back button's box, and every other clickable element it overlaps
const layout = () => page.evaluate(() => {
  const nav = document.querySelector('.navb'), r = nav.getBoundingClientRect();
  const hits = [...document.querySelectorAll('a, button, input, textarea, select, [data-act], [data-hold]')]
    .filter(el => el !== nav && !nav.contains(el) && el.offsetParent !== null)
    .filter(el => { const q = el.getBoundingClientRect(); return q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; })
    .map(el => el.className || el.tagName);
  const st = getComputedStyle(nav);
  return { text: nav.textContent, h: Math.round(r.height), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth, visible: st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity > 0,
    hits, sideways: document.documentElement.scrollWidth > innerWidth };
});
const checkLayout = async (where, text) => {
  const l = await layout();
  eq(`${where}: "${text}" shown`, [l.text, l.visible, l.inView], [text, true, true]);
  eq(`${where}: at least 36 px tall`, l.h >= 36, true);
  eq(`${where}: overlaps no other clickable element`, l.hits, []);
  eq(`${where}: no sideways scroll at 390 px`, l.sideways, false);
};

// landing
await page.goto(base); await page.waitForSelector('.hero-cover .navb');
eq('landing: link to all games', await page.getAttribute('.navb', 'href'), 'https://boardgame.leisurecat.cloud');
await checkLayout('landing', '‹ 全部游戏');
await page.screenshot({ path: `${out}/nav-landing.png` });

// a room in setup: back to the landing, the room is still listed and can be entered again
await page.click('text=创建新房间'); await page.waitForSelector('#seatName');
const code = new URL(page.url()).searchParams.get('r');
await page.fill('#seatName', '小明'); await page.click('[data-act="sit"]'); await page.waitForSelector('text=这是你');
await checkLayout('room setup', '‹ 首页');
await page.screenshot({ path: `${out}/nav-setup.png` });
await page.click('.bar .navb'); await page.waitForSelector('.hero-cover');
eq('back on the landing', new URL(page.url()).pathname + new URL(page.url()).search, '/');
await page.waitForSelector(`[data-code="${code}"]`);
eq('the room is still listed', await page.isVisible(`[data-code="${code}"]`), true);
await page.click(`[data-code="${code}"]`); await page.waitForSelector('text=这是你');
eq('entering again: same seat, nothing cleared', await page.inputValue('[data-pk="name"]'), '小明');

// in game: four more players join over sockets and the game starts
const socks = [];
for (const n of ['阿花', '老王', '大卫', '珊珊']) {
  const ws = new WebSocket(api(`/api/room/${code}/ws`).replace(/^http/, 'ws'));
  await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({ join: n })); await wait(200); socks.push(ws);
}
socks[0].send(JSON.stringify({ action: { t: 'start' } }));
await page.waitForSelector('.idc.back');
await checkLayout('in game', '‹ 首页');
await page.screenshot({ path: `${out}/nav-game.png` });
await page.click('.bar .navb'); await page.waitForSelector('.hero-cover');
await page.click(`[data-code="${code}"]`); await page.waitForSelector('.idc.back');
eq('back in the game with the same seat', await page.textContent('.bar .mine'), '小明');

// results: the bar is outside the long-image area
const ids = await page.evaluate(() => [...document.querySelectorAll('.pc')].map(x => x.dataset.id));
for (let k = 0; k < 5; k++) {
  socks[0].send(JSON.stringify({ action: { t: 'team', team: ids.slice(0, 2) } })); await wait(150);
  socks[0].send(JSON.stringify({ action: { t: 'vote', votes: Object.fromEntries(ids.map(id => [id, false])) } })); await wait(150);
}
await page.waitForSelector('.win');
await checkLayout('results', '‹ 首页');
eq('results: back button not in the long-image area', await page.$('#shot .navb'), null);
await page.click('.bar .navb'); await page.waitForSelector('.hero-cover');

// a room code that doesn't exist: back still works
await page.goto(api('/?r=ZZZZ')); await page.waitForSelector('text=不存在');
eq('missing room: "‹ 首页" shown', await page.textContent('.navb'), '‹ 首页');
await page.click('.navb'); await page.waitForSelector('.hero-cover');

// separate pages
for (const p of ['guide', 'history']) {
  await page.goto(api(p)); await page.waitForSelector('.navb');
  eq(`${p}: back to the site's home`, await page.getAttribute('.navb', 'href'), '/');
  await checkLayout(p, '‹ 返回');
  await page.screenshot({ path: `${out}/nav-${p}.png` });
  await page.click('.navb'); await page.waitForSelector('.hero-cover');
}

eq('no page errors', errs, []);
socks.forEach(w => w.close()); await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
