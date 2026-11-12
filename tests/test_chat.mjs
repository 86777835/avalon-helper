// Rules assistant. Usage: node tests/test_chat.mjs <base-url> <shots-dir> [--mock-upstream | --live]
//   --mock-upstream  local `wrangler dev --port 8861 --test-scheduled --var DEEPSEEK_API_KEY:fake --var DEEPSEEK_BASE:http://127.0.0.1:8862 --var CHAT_CF_MODEL:@cf/none/missing`
//                    (DeepSeek is a mock on 8862; the Cloudflare model points at a missing one so it always fails fast)
//                    checks: request validation, model fallback, stalls, the hourly check, no model name on the page,
//                    and that nothing about a room (names, roles) ever reaches the assistant — even from a seated player's page.
//   --mock-web       same wrangler dev flags as --mock-upstream: web search when the notes don't cover a question
//                    (run it at least a minute apart from --mock-upstream: 8 questions a minute per IP)
//   --live           the deployed site with a real key: one real question, and one asking for someone's role.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
const [base, out = './shots', mode = '--mock-upstream'] = process.argv.slice(2);
const api = p => new URL(p, base).href;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const post = body => fetch(api('/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const b = await chromium.launch({ channel: 'chrome' });
const ctx = () => b.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
async function ask(page, q) {
  await page.fill('.cin textarea', q); await page.press('.cin textarea', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.cin button').disabled, null, { timeout: 60000 });
  return page.$$eval('.cm.a', l => [l.at(-1).className.includes('err'), l.at(-1).textContent]);
}

if (mode === '--live') {
  const page = await (await ctx()).newPage();
  await page.goto(base); await page.click('.cfab');
  const [e1, a1] = await ask(page, '7 人局第 4 个任务只出了 1 张失败，算成功吗？');
  console.log('answer:', a1);
  eq('real answer, no error', e1, false);
  eq('answer says it succeeds', /成功/.test(a1), true);
  const [, a2] = await ask(page, '我们这局谁是梅林？');
  console.log('answer:', a2);
  eq('won\'t claim to know anyone\'s role', /不知道|看不到|无法/.test(a2), true);
  await b.close(); process.exit(fails ? 1 : 0);
}

if (mode === '--mock-web') {
  // The mock model asks to search for questions containing 「网上」; the mock search API answers per `search`.
  let search = 'ok', asked = [], searchBodies = [];   // search: 'ok' | 'empty' | 'fail'
  const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const j = JSON.parse(body);
      if (req.url === '/v1/tools/search') {
        asked.push(j.query); searchBodies.push(body);
        if (search === 'fail') { res.writeHead(500); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ results: search === 'empty' ? [] : [
          { title: 'Lady of the Lake timing <b>', url: 'https://boardgamegeek.com/thread/1', site_name: 'BoardGameGeek', summary: 'Publisher: right after the quest.' },
          { title: '湖中仙女讨论', url: 'https://example.cn/a', site_name: null, snippet: '网友说任务结束马上用。' }] }));
      }
      const sys = j.messages[0].content, q = j.messages.at(-1).content;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (sys.includes('联网搜索到的网页摘要')) return res.end(sse(`依据网上说法：任务结束马上用 [1]（摘要条数 ${(sys.match(/^\[\d\] /gm) || []).length}）`));
      if (q.includes('先解释')) {   // the model explains first and asks to search at the end
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '资料里没有提到这一点。' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('\n\n【需联网】The Resistance Avalon assassin timing')), 300);
      }
      if (q.includes('网上')) {   // the marker arrives split over two chunks, like a real stream
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '【需' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('联网】The Resistance Avalon lady of the lake timing')), 200);
      }
      res.end(sse(q.includes('无关') ? '我只解答阿瓦隆规则。' : q.includes('谁是') ? '我不知道本局任何人的身份。' : '资料里的回答'));
    });
  }).listen(8862);
  // a seated player in a running game asks
  const { code } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
  const socks = [];
  for (const name of ['甲甲', '乙乙', '丙丙', '丁丁']) {
    const ws = new WebSocket(api(`/api/room/${code}/ws`).replace(/^http/, 'ws'));
    await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({ join: name })); await wait(200); socks.push(ws);
  }
  const page = await (await ctx()).newPage();
  page.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  const bodies = []; page.on('request', r => r.url().endsWith('/api/chat') && bodies.push(JSON.parse(r.postData())));
  await page.goto(api(`/?r=${code}`)); await page.waitForSelector('#seatName');
  await page.fill('#seatName', '戊戊'); await page.click('[data-act="sit"]'); await page.waitForSelector('text=这是你');
  socks[0].send(JSON.stringify({ action: { t: 'start' } }));
  await page.waitForSelector('.idc.back');
  const box = await page.locator('.idc').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.waitForSelector('.idc.face');
  const myRole = await page.textContent('.idh b'); await page.mouse.up();
  await page.click('.cfab');
  eq('panel subtitle', await page.textContent('.chd div span'), '依据规则书作答，查不到会联网找');
  const askOnce = async (q, s) => {
    search = s; asked = [];
    await page.fill('.cin textarea', q); await page.press('.cin textarea', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.cin button').disabled);
    return page.$$eval('.cm.a', l => { const a = l.at(-1); return { err: a.className.includes('err'), label: !!a.querySelector('.cweb'),
      text: [...a.childNodes].filter(n => !n.classList?.contains('cweb') && !n.classList?.contains('csrc')).map(n => n.textContent).join(''),
      src: [...a.querySelectorAll('.csrc a')].map(x => [x.textContent, x.getAttribute('href'), x.target]) }; });
  };
  const SRC = [['[1] Lady of the Lake timing <b>BoardGameGeek', 'https://boardgamegeek.com/thread/1', '_blank'], ['[2] 湖中仙女讨论example.cn', 'https://example.cn/a', '_blank']];
  eq('covered by the notes: answered directly, no search', [await askOnce('平票怎么算？', 'ok'), asked],
    [{ err: false, label: false, text: '资料里的回答', src: [] }, []]);
  let t0 = Date.now();
  eq('not covered: searched with the model\'s words, labelled, sources listed', [await askOnce('网上怎么说湖中仙女的时机？', 'ok'), asked],
    [{ err: false, label: true, text: '依据网上说法：任务结束马上用 [1]（摘要条数 2）', src: SRC },
     ['The Resistance Avalon lady of the lake timing site:boardgamegeek.com', 'The Resistance Avalon lady of the lake timing']]);
  console.log('  took', Date.now() - t0, 'ms');
  await page.screenshot({ path: out + '/chat_web.png' });
  eq('the search request never reaches the page as text', (await page.$$eval('.cm.a', l => l.map(x => x.textContent).join(''))).includes('需联网'), false);
  const roomWords = [code, '甲甲', '乙乙', '丙丙', '丁丁', '戊戊', myRole];
  eq('search requests carry nothing about the room or roles', roomWords.filter(w => searchBodies.join('').includes(w)), []);
  eq('nothing found: says so, no label, nothing made up', [await askOnce('网上还有啥？', 'empty'), asked.length],
    [{ err: false, label: false, text: '本站资料里没有这一条，网上也没找到可靠的说法。建议翻一下规则书，或者问问桌上的老玩家。', src: [] }, 2]);
  eq('web answer goes back as plain history (no label, no sources)', bodies.at(-1).messages.slice(-3).map(m => m.content),
    ['网上怎么说湖中仙女的时机？', '依据网上说法：任务结束马上用 [1]（摘要条数 2）', '网上还有啥？']);
  eq('search API down: says so', (await askOnce('网上第三问？', 'fail')).text, '本站资料里没有这一条，联网查找也失败了，请过一会儿再问，或者翻一下规则书。');
  eq('off-topic: no search', [(await askOnce('无关的问题', 'ok')).text, asked], ['我只解答阿瓦隆规则。', []]);
  eq('asking who someone is: no search', [(await askOnce('谁是梅林？', 'ok')).text, asked], ['我不知道本局任何人的身份。', []]);
  await wait(61000);   // 8 questions a minute
  eq('search asked for at the end of an explanation: explanation dropped, searched', [await askOnce('先解释再查', 'ok'), asked],
    [{ err: false, label: true, text: '依据网上说法：任务结束马上用 [1]（摘要条数 2）', src: SRC },
     ['The Resistance Avalon assassin timing site:boardgamegeek.com', 'The Resistance Avalon assassin timing']]);
  eq('pages send only the conversation', bodies.every(x => Object.keys(x).join() === 'messages'), true);
  socks.forEach(w => w.close()); await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
}

// mock DeepSeek
let reply = {}, seen = [], bodies = [];
const srv = createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const j = JSON.parse(body); seen.push(j.model); bodies.push(body);
    const st = reply[j.model] ?? 200;
    if (st === 'queue' || st === 'stall') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (st === 'stall') res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${j.model} 答了一半` } }] })}\n\n`);
      const t = setInterval(() => res.write(': keep-alive\n\n'), 1000);
      return res.on('close', () => clearInterval(t));
    }
    if (st !== 200) { res.writeHead(st, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"mock"}}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `${j.model} 的回答` } }] })}\n\ndata: [DONE]\n\n`);
  });
}).listen(8862);

// request checks
eq('empty messages rejected', (await post({ messages: [] })).status, 400);
eq('system role rejected', (await post({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] })).status, 400);
eq('question over 500 chars rejected', (await post({ messages: [{ role: 'user', content: '长'.repeat(501) }] })).status, 400);
await wait(61000);   // the rate limit counts those too

// a seated player in a running game asks: nothing from the room goes along
const { code } = await (await fetch(api('/api/room'), { method: 'POST' })).json();
const socks = [];
for (const name of ['甲甲', '乙乙', '丙丙', '丁丁']) {
  const ws = new WebSocket(api(`/api/room/${code}/ws`).replace(/^http/, 'ws')), o = { ws };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'seat') o.token = m.token; if (m.type === 'state') o.S = m.state; };
  await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({ join: name })); await wait(200); socks.push(o);
}
const page = await (await ctx()).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const sent = []; page.on('request', r => r.url().endsWith('/api/chat') && sent.push(r.postData()));
await page.goto(base);
await page.goto(api(`/?r=${code}`)); await page.waitForSelector('#seatName');
await page.fill('#seatName', '戊戊'); await page.click('[data-act="sit"]'); await page.waitForSelector('text=这是你');
socks[0].ws.send(JSON.stringify({ action: { t: 'start' } }));
await page.waitForSelector('.idc.back');
const box = await page.locator('.idc').boundingBox();
await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.waitForSelector('.idc.face');
const myRole = await page.textContent('.idh b'); await page.mouse.up();
await page.click('.cfab');
reply = {}; seen = []; bodies = [];
eq('flash answers', [await ask(page, '一'), seen], [[false, 'deepseek-flash 的回答'], ['deepseek-flash']]);
const roomWords = [code, '甲甲', '乙乙', '戊戊', ...socks.map(s => s.S.me.id)];
eq('nothing about the room in the request from the page', [...roomWords, myRole].filter(w => sent.join('').includes(w)), []);
eq('nothing about the room in what reached the model', roomWords.filter(w => bodies.join('').includes(w)), []);   // role names are in the rules text itself
eq('the model is told it can\'t know anyone\'s role', bodies[0].includes('你看不到任何房间和对局，不知道谁是什么身份'), true);
eq('page sends only the conversation', Object.keys(JSON.parse(sent[0])), ['messages']);

// fallback order (the Cloudflare model is missing, so after Flash comes V4 Pro)
reply = { 'deepseek-flash': 503 }; seen = [];
eq('flash busy → v4-pro answers, no model named', [await ask(page, '二'), seen], [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
reply = { 'deepseek-flash': 503, 'deepseek-v4-pro': 503 }; seen = [];
eq('both busy → busy message', [await ask(page, '三'), seen], [[true, 'AI 服务器都在忙，请过一两分钟再问'], ['deepseek-flash', 'deepseek-v4-pro']]);
reply = { 'deepseek-flash': 'queue' }; seen = [];
let t0 = Date.now();
eq('flash queueing → v4-pro after 9 s', [(await ask(page, '四'))[0], seen], [false, ['deepseek-flash', 'deepseek-v4-pro']]);
console.log('  took', Date.now() - t0, 'ms');
await wait(61000);
reply = { 'deepseek-flash': 'stall' }; seen = []; t0 = Date.now();
eq('flash stalls mid-answer → partial dropped, v4-pro answers', [await ask(page, '五'), seen], [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
console.log('  took', Date.now() - t0, 'ms');
eq('no model name under any answer', (await page.textContent('.clog')).match(/DeepSeek|Qwen|Flash|Pro/), null);
await page.screenshot({ path: out + '/chat.png' });

// hourly check: DeepSeek down → noted in KV, the next hour asks Qwen first
reply = { 'deepseek-flash': 503 }; seen = [];
await fetch(api('/__scheduled'));
eq('hourly check asked flash', seen, ['deepseek-flash']);
reply = {}; seen = [];
const r3 = await post({ messages: [{ role: 'user', content: '检查之后' }] }); await r3.text();
eq('after a failed check the Cloudflare model goes first (missing here), then flash', [seen, r3.headers.get('x-chat-fallback')], [['deepseek-flash'], null]);
reply = {}; seen = [];
await fetch(api('/__scheduled'));   // DeepSeek back: normal order again
eq('hourly check ok again', seen, ['deepseek-flash']);
eq('errors on pages', errs, []);
socks.forEach(s => s.ws.close());
await b.close(); srv.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
