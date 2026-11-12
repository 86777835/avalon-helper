import { DurableObject } from 'cloudflare:workers';
import { initialState, reduce, publicView, seatView, gameRecord, UNDOABLE, ROLES } from '../public/logic.js';
import GUIDE from '../tools/讲解稿.md';
import FAQ from '../tools/faq.json';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const hex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/room' && req.method === 'POST') {
      for (let i = 0; i < 6; i++) {
        const code = newCode();
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: code });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: '暂时无法创建房间，请重试' }, { status: 503 });
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, env);
    if (url.pathname === '/api/chat-log' && req.method === 'POST') {   // a reply the page lost mid-way (see chat.js)
      console.log('chat client error', (await req.text()).slice(0, 300), req.headers.get('user-agent')?.slice(-60), req.cf?.colo);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/api/rooms' && req.method === 'GET') return lobby(env).fetch('https://lobby/list');
    if (url.pathname === '/api/games' && req.method === 'GET') return archive(env).fetch('https://archive/list' + url.search);

    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket 连接', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env) { await checkDeepSeek(env); }
};

// Rules assistant: answers from the tutorial script and FAQ (both written from the official rulebook) via DeepSeek.
// It never sees any room: the request carries only the conversation, so it cannot know anyone's role.
// Tried in order. The next one answers when the one before is overloaded, queueing, erroring, unreachable or stalls mid-answer;
// the log records which one answered (also sent to the page as an x-chat-fallback header or a reset event mid-stream).
// The Cloudflare model runs on Workers AI (free plan), so it still works when DeepSeek's own servers are overloaded.
const CHAT_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'Qwen3.8 27B (Cloudflare)' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
];
const FIRST_DATA_MS = 9000;   // three models × 9 s stays under the page's 30 s wait
const STALL_MS = 8000;        // an answer that pauses this long mid-way is dropped and asked again of the next model
// Hourly check (cron): when DeepSeek doesn't answer, Qwen goes first until the next check.
const DEEPSEEK_DOWN = 'deepseek-down';   // KV key; expires on its own a little after the next hourly check
const ORDER = { normal: [0, 1, 2], deepseekDown: [1, 0, 2] };   // indexes into CHAT_MODELS

async function checkDeepSeek(env) {
  const fails = [];
  const o = await openModel(0, env, [{ role: 'user', content: '你好' }], fails);
  if (o) {
    o.reader.cancel().catch(() => {});
    await env.CHAT_STATE.delete(DEEPSEEK_DOWN);
    console.log('deepseek check: ok');
  } else {
    await env.CHAT_STATE.put(DEEPSEEK_DOWN, JSON.stringify({ at: new Date().toISOString(), fails }), { expirationTtl: 3900 });
    console.log('deepseek check: down, Qwen first for the next hour', fails.join('/'));
  }
}
// Web search (2026-11-12, ported from the Pittsburgh pilot): when the tutorial and FAQ don't cover a rules question, the model
// replies only with WEB_MARK + English search words. The server then asks DeepSeek's search API and answers again from the results.
// Those answers are labelled by the page as web discussion the site has not checked, with their sources.
// Like the first round, the search knows nothing about any room: only the question and the model's search words go out.
const WEB_MARK = '【需联网】';
const WEB_RESULTS = 6;
const WEB_NONE = '本站资料里没有这一条，网上也没找到可靠的说法。建议翻一下规则书，或者问问桌上的老玩家。';
const webSystem = results => `你是「阿瓦隆规则助手」，帮玩家解答桌游《阿瓦隆》（The Resistance: Avalon）基础版的规则问题。本站整理的资料里没有这个问题的答案，下面是联网搜索到的网页摘要。

回答要求：
- 只依据这些摘要作答，用 [1] [2] 这样的编号注明依据哪条。
- 优先采信设计者、出版社或规则书原文的说法；网友的说法要说明是网友观点；不同版本或说法冲突时直接指出来。
- 本站只讲基础版。摘要里的说法如果来自兰斯洛特、王者之剑、阵谋卡等扩展，或者来自《抵抗组织》（The Resistance）而不是阿瓦隆，要明确指出来。
- 你不知道任何人的身份，不替任何人推理或给建议。
- 摘要里没有可靠答案就直接说没找到，不要自己推测规则。
- 用简体中文，简短直接：先给结论，再补一两句理由。可以用短列表，不要用表格和标题。

${results.map((r, i) => `[${i + 1}] ${r.title}（${r.site}）\n${r.summary}`).join('\n\n')}`;

const CHAT_SYSTEM = `你是「阿瓦隆规则助手」，帮玩家解答桌游《阿瓦隆》（The Resistance: Avalon）基础版的规则问题，也可以解释本网站「阿瓦隆面杀助手」怎么用。

回答要求：
- 只依据下面的「讲解稿」和「常见问题」作答，它们整理自官方规则书和出版社在 BGG 上的答复，不要编造规则。
- 资料里找不到答案的阿瓦隆基础版规则问题，不要自己回答，也不要解释为什么查不到：整个回复只有一行，以${WEB_MARK}开头，后面接一组英文搜索词，以 The Resistance Avalon 开头，例如：${WEB_MARK}The Resistance Avalon lady of the lake reveal timing。网站会去网上查。只要你的回答会是“资料里没写”“规则书没有单独说明”这一类，就改为只输出这一行。搜索词只写规则问题本身，不要写进任何玩家名字、座位或对局情况。
- 你看不到任何房间和对局，不知道谁是什么身份。有人问"谁是梅林""某某是不是坏人""帮我分析这局"之类，只回答你不知道本局任何人的身份，也不替任何人推理或给建议，然后可以讲讲相关规则；这类问题不要输出${WEB_MARK}。
- 兰斯洛特、王者之剑、阵谋卡等扩展内容不在资料里，说明本站只讲基础版，不要输出${WEB_MARK}。
- 与本游戏无关的问题，礼貌说明你只解答阿瓦隆规则，不要输出${WEB_MARK}。
- 用简体中文，简短直接：先给结论，再补一两句理由或例子。可以用短列表，不要用表格和标题。

本网站怎么用：一桌人扫码或点链接进同一个房间，每人在自己手机上入座，按实际座位顺时针排好座次。开局后每人按住「我的身份」卡就能看到自己的身份，以及按规则能看到的人，不用再闭眼念口令。组队投票照旧在桌上同时亮牌，由任意一人在手机上记录；任务出牌可以用实物牌（翻开后记录失败张数），也可以每人在自己手机上秘密出牌，网站只公布张数。湖中仙女的查验结果只显示在持有人手机上。刺杀由刺客在自己手机上指认。「票型」页记录每次组队和投票，结束后公开所有身份和完整记录。

# 讲解稿
${GUIDE}

# 常见问题
${FAQ.map(f => `【${f.cat}】问：${f.q}\n答：${f.a}`).join('\n\n')}`;

async function chat(req, env) {
  if (!env.DEEPSEEK_API_KEY) return Response.json({ error: '规则助手还没有配置好，请稍后再试' }, { status: 503 });
  const { success } = await env.CHAT_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') || 'local' });
  if (!success) return Response.json({ error: '问得有点快，请过一分钟再问' }, { status: 429 });
  let msgs;
  try { msgs = (await req.json()).messages; } catch { msgs = null; }
  const valid = Array.isArray(msgs) && msgs.length > 0 && msgs.length <= 20 && msgs.at(-1).role === 'user' && msgs.at(-1).content?.length <= 500
    && msgs.every(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim() && m.content.length <= 3000);
  if (!valid) return Response.json({ error: '问题格式不对，请刷新页面再试' }, { status: 400 });
  console.log('chat question', JSON.stringify(msgs.at(-1).content));   // what players ask, for the usage brief
  const history = msgs.slice(-10).map(m => ({ role: m.role, content: m.content }));
  let messages = [{ role: 'system', content: CHAT_SYSTEM }, ...history];
  const fails = [];   // HTTP status, 0 = unreachable or error, 'queue' = no answer started in time or stalled
  const order = await env.CHAT_STATE.get(DEEPSEEK_DOWN) ? ORDER.deepseekDown : ORDER.normal;
  let cur = await firstAnswer(order, 0, env, messages, fails);
  if (!cur) return Response.json({ error: chatFailed(fails) }, { status: 502 });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const event = o => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const say = text => event({ choices: [{ delta: { content: text } }] });
  let lastData = Date.now(), searched = false, raw = '', pend = '';   // raw: the current model's stream so far, as text
  // Only whole lines go to the page, so dropping the rest of a model's stream (search, backup model) never leaves it half a line.
  // Returns whether anything went out.
  const forward = (c, text) => {
    pend += text;
    const cut = pend.lastIndexOf('\n') + 1;
    if (cut) { c.enqueue(enc.encode(pend.slice(0, cut))); pend = pend.slice(cut); }
    return cut > 0;
  };
  const headText = () => cur.head.map(v => dec.decode(v, { stream: true })).join('');
  // The model asked to search: tell the page, search, then answer again from the results. Returns false when the
  // stream is finished (nothing found, or no model answered), true when `cur` is the answer from the results.
  async function web(c, query) {
    cur.reader.cancel().catch(() => {});
    searched = true;
    c.enqueue(event({ searching: true }));
    const found = await webSearch(env, query, history.at(-1).content);
    console.log('chat web search', JSON.stringify(query), found ? found.length : 'failed');   // for the usage brief: questions the FAQ lacks
    if (!found?.length) {
      c.enqueue(event({ web: [] }));
      c.enqueue(say(found ? WEB_NONE : '本站资料里没有这一条，联网查找也失败了，请过一会儿再问，或者翻一下规则书。'));
      c.close(); return false;
    }
    messages = [{ role: 'system', content: webSystem(found) }, ...history];
    const next = await firstAnswer(order, 0, env, messages, fails);
    if (!next) { c.enqueue(event({ error: chatFailed(fails) })); c.close(); return false; }
    cur = next; lastData = Date.now(); raw = ''; pend = '';
    c.enqueue(event({ web: found.map(r => ({ title: r.title, url: r.url, site: r.site })) }));
    return true;
  }
  // Before anything reaches the page, look at how the answer starts. The search itself runs in the first pull:
  // Workers starts pulling without waiting for an async start().
  let query = await webQuery(cur);
  const body = new ReadableStream({
    start(c) { if (query === null) { raw = headText(); forward(c, raw); } },
    async pull(c) {
      if (query !== null) {
        const q = query; query = null;
        if (await web(c, q)) forward(c, headText());
        return;
      }
      // A pull that sends nothing is never followed by another one: read on until a whole line can go out.
      for (;;) {
      // Keep-alive comments don't count as progress: only data lines do.
      let timer, r;
      const stall = new Promise(ok => { timer = setTimeout(() => ok('stall'), Math.max(0, lastData + STALL_MS - Date.now())); });
      try { r = await Promise.race([cur.reader.read(), stall]); } catch (e) { r = 'broken'; console.log('chat model broke mid-answer', CHAT_MODELS[cur.i].id, String(e).slice(0, 200)); }
      clearTimeout(timer);
      if (r === 'stall' || r === 'broken') {
        if (r === 'stall') console.log(`chat model stalled ${STALL_MS / 1000}s mid-answer`, CHAT_MODELS[cur.i].id);
        fails.push(r === 'stall' ? 'queue' : 0);
        cur.reader.cancel().catch(() => {});
        const next = await firstAnswer(order, cur.k + 1, env, messages, fails);
        if (!next) { c.enqueue(event({ error: chatFailed(fails) })); return c.close(); }
        cur = next; lastData = Date.now(); raw = ''; pend = '';
        c.enqueue(event({ reset: CHAT_MODELS[cur.i].name }));   // the page drops the partial answer and starts over
        // the backup model may ask to search too (only from the tutorial-and-FAQ round)
        const q2 = searched ? null : await webQuery(cur);
        if (q2 !== null && !(await web(c, q2))) return;
        const head = headText();
        if (!searched) raw = head;
        forward(c, head);
        return;
      }
      if (r.done) { if (pend) c.enqueue(enc.encode(pend)); return c.close(); }
      const piece = dec.decode(r.value, { stream: true });
      if (piece.includes('data:')) lastData = Date.now();
      if (!searched) {
        // The model sometimes explains first and asks to search at the end: stop there and search instead
        // (the page clears what it showed when the search starts).
        raw += piece;
        const text = sseText(raw), at = text.indexOf(WEB_MARK);
        if (at >= 0) {
          const q = (text.slice(at + WEB_MARK.length) + await restText(cur)).trim().split('\n')[0].trim().slice(0, 120);
          console.log('chat web mark mid-answer');
          if (await web(c, q)) forward(c, headText());
          return;
        }
      }
      if (forward(c, piece)) return;
      }
    },
    cancel() { cur.reader.cancel().catch(() => {}); }
  });
  const h = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' };
  if (cur.i) h['x-chat-fallback'] = CHAT_MODELS[cur.i].name;
  return new Response(body, { headers: h });
}

// Text of the answer in a model's raw stream (DeepSeek and Workers AI both send OpenAI-style chunks).
function sseText(raw) {
  let text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { const j = JSON.parse(line.slice(5)); text += j.choices?.[0]?.delta?.content ?? j.response ?? ''; } catch {}
  }
  return text;
}
const streamText = chunks => { const dec = new TextDecoder(); return sseText(chunks.map(v => dec.decode(v, { stream: true })).join('')); };

// The rest of a model's answer as text (for the search words after the marker), waiting at most STALL_MS.
async function restText(cur) {
  const dec = new TextDecoder(), until = Date.now() + STALL_MS;
  let raw = '';
  for (;;) {
    let r;
    try { r = await Promise.race([cur.reader.read(), new Promise(ok => setTimeout(() => ok({ done: true }), Math.max(0, until - Date.now())))]); } catch { r = { done: true }; }
    if (r.done) return sseText(raw);
    raw += dec.decode(r.value, { stream: true });
  }
}

// Reads ahead (into cur.head) until the answer's first characters show whether it is a search request.
// Returns the search words, or null for an ordinary answer. Stops reading after STALL_MS; the stream's own stall check takes over.
async function webQuery(cur) {
  const until = Date.now() + STALL_MS;
  for (;;) {
    const text = streamText(cur.head).trimStart();
    const marked = text.startsWith(WEB_MARK);
    if (!marked && (text.length >= WEB_MARK.length || !WEB_MARK.startsWith(text))) return null;
    let r;
    try { r = await Promise.race([cur.reader.read(), new Promise(ok => setTimeout(() => ok('late'), Math.max(0, until - Date.now())))]); } catch { r = { done: true }; }
    if (r === 'late') return marked ? text.slice(WEB_MARK.length).trim().slice(0, 120) : null;
    if (r.done) return marked ? text.slice(WEB_MARK.length).trim().slice(0, 120) : null;
    cur.head.push(r.value);
  }
}

// DeepSeek's search API. Rules questions are best answered in BoardGameGeek's forums (designers often reply there),
// so BGG goes first; with fewer than 3 results there, the whole web. Returns [{ title, url, site, summary }]
// (possibly empty), or null when the search failed.
async function webSearch(env, query, question) {
  query ||= `The Resistance Avalon ${question}`;
  const bgg = await searchOnce(env, `${query} site:boardgamegeek.com`.slice(0, 128), question);
  if (bgg === null || bgg.length >= 3) return bgg;
  const all = await searchOnce(env, query.slice(0, 128), question);
  if (all === null) return bgg;
  const seen = new Set(bgg.map(r => r.url));
  return [...bgg, ...all.filter(r => !seen.has(r.url))].slice(0, WEB_RESULTS);
}
async function searchOnce(env, query, question) {
  const base = env.DEEPSEEK_BASE || 'https://api.deepseek.com';   // DEEPSEEK_BASE: set only by the local tests
  try {
    const r = await fetch(`${base}/v1/tools/search`, {
      method: 'POST', signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ query, ori_question: question.slice(0, 128), count: 10 })
    });
    if (!r.ok) { console.log('chat web search error', r.status, (await r.text()).slice(0, 300)); return null; }
    const { results = [] } = await r.json();
    return results.filter(x => x.url && (x.summary || x.snippet)).slice(0, WEB_RESULTS)
      .map(x => ({ title: x.title || x.url, url: x.url, site: x.site_name || new URL(x.url).hostname, summary: (x.summary || x.snippet).slice(0, 900) }));
  } catch (e) { console.log('chat web search failed', String(e).slice(0, 200)); return null; }
}

const chatFailed = fails => fails.some(f => f === 503 || f === 429 || f === 'queue')   // overloaded / throttled / queueing
  ? 'AI 服务器都在忙，请过一两分钟再问' : `规则助手暂时不可用（${fails.join('/')}），请稍后再试`;

// The first model from position `from` in `order` that starts answering:
// { k: position, i: index into CHAT_MODELS, reader, head (chunks read so far) }, or null.
async function firstAnswer(order, from, env, messages, fails) {
  for (let k = from; k < order.length; k++) {
    const i = order[k], o = await openModel(i, env, messages, fails);
    if (o) { if (i) console.log('chat fallback answered', CHAT_MODELS[i].id); return { k, i, ...o }; }
  }
  return null;
}

// Starts model i and waits up to FIRST_DATA_MS for its first data line. An overloaded DeepSeek may accept the request
// and then only send keep-alive comments while it waits in a queue. On failure, logs it, adds to `fails`, returns null.
async function openModel(i, env, messages, fails) {
  const { id } = CHAT_MODELS[i];
  const model = id.startsWith('@cf/') ? env.CHAT_CF_MODEL || id : id;   // CHAT_CF_MODEL: set only by the local tests
  const base = env.DEEPSEEK_BASE || 'https://api.deepseek.com';         // DEEPSEEK_BASE: set only by the local tests
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FIRST_DATA_MS);
  const late = new Promise((_, no) => ctl.signal.addEventListener('abort', () => no(new Error('timeout'))));
  let reader;
  try {
    let stream;
    if (model.startsWith('@cf/')) {
      stream = await Promise.race([env.AI.run(model, { messages, stream: true, max_tokens: 900, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }), late]);
    } else {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model, stream: true, thinking: { type: 'disabled' }, max_tokens: 900, temperature: 0.3, messages })
      });
      if (!r.ok) { clearTimeout(timer); fails.push(r.status); console.log('chat model error', model, r.status, (await r.text()).slice(0, 500)); return null; }
      stream = r.body;
    }
    reader = stream.getReader();
    const dec = new TextDecoder(), head = [];
    let seen = '';
    while (!seen.includes('data:')) {
      const { done, value } = await Promise.race([reader.read(), late]);
      if (done) break;
      head.push(value); seen += dec.decode(value, { stream: true });
    }
    clearTimeout(timer);
    if (!seen.includes('data:')) { fails.push(502); console.log('chat model empty reply', model); return null; }
    return { reader, head };
  } catch (e) {
    clearTimeout(timer); reader?.cancel().catch(() => {});
    const queued = ctl.signal.aborted;
    fails.push(queued ? 'queue' : 0);
    console.log('chat model', queued ? `queued over ${FIRST_DATA_MS / 1000}s` : 'failed', model, String(e).slice(0, 300));
    return null;
  }
}

const lobby = env => env.LOBBY.get(env.LOBBY.idFromName('lobby'));
const archive = env => env.ARCHIVE.get(env.ARCHIVE.idFromName('archive'));
const LIST_SETUP_IDLE_MS = 30 * 60 * 1000;        // a room whose game hasn't started stays listed this long after everyone leaves
const LIST_GAME_IDLE_MS = 7 * 24 * 3600 * 1000;   // a started or finished game stays listed this long after its last activity

// Lobby: one Durable Object holding a short summary of every recently active room (names and progress only).
export class Lobby extends DurableObject {
  async fetch(req) {
    const rooms = (await this.ctx.storage.get('rooms')) || {};
    const now = Date.now();
    if (req.method === 'POST') { const r = await req.json(); rooms[r.code] = { ...r, updated: now }; }
    for (const [c, r] of Object.entries(rooms)) {
      if (now - r.updated > LIST_GAME_IDLE_MS || (r.stage === 'setup' && r.online === 0 && now - r.updated > LIST_SETUP_IDLE_MS)) delete rooms[c];
    }
    await this.ctx.storage.put('rooms', rooms);
    if (req.method === 'POST') return new Response('ok');
    return Response.json(Object.values(rooms).sort((a, b) => b.online - a.online || b.updated - a.updated).slice(0, 30));
  }
}

// Archive: one Durable Object holding every finished game (roles are public once a game is over).
export class Archive extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/put') {
      const r = await req.json(), key = 'g:' + r.gid;
      const old = await this.ctx.storage.get(key);
      await this.ctx.storage.put(key, { ...r, ended: old?.ended ?? Date.now() });
      return new Response('ok');
    }
    // list: newest first, optionally filtered by room code, player name or role name; searches the latest 1000 games
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const all = await this.ctx.storage.list({ prefix: 'g:', reverse: true, limit: 1000 });
    const out = [];
    for (const g of all.values()) {
      if (!q || g.code.toLowerCase() === q || g.players.some(p => p.name.toLowerCase().includes(q) || ROLES[p.role].name.includes(q))) out.push(g);
      if (out.length >= 50) break;
    }
    return Response.json(out);
  }
}

const MAX_UNDO = 30;

// One room = one Durable Object holding one game. A phone joins by sending its name and gets back a private seat token
// (kept in its localStorage); a phone that sends a known token becomes that seat again. Each socket only ever receives
// seatView() for its own seat, or publicView() when it isn't seated, so no other player's role reaches it.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get('s')) ?? null;
      this.code = (await ctx.storage.get('code')) ?? null;
      this.tokens = (await ctx.storage.get('tokens')) ?? {};   // token -> seat id
      this.undo = (await ctx.storage.get('undo')) ?? [];
    });
  }

  async fetch(req) {
    if (new URL(req.url).pathname === '/init') {
      if (this.s) return new Response('exists', { status: 409 });
      this.s = initialState(); this.code = await req.text(); this.tokens = {}; this.undo = [];
      await this.ctx.storage.put({ s: this.s, code: this.code, tokens: {}, undo: [] });
      await this.report();
      return new Response('ok');
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null });
    server.send(this.s ? this.msg(null) : JSON.stringify({ type: 'error', error: 'noroom' }));
    if (this.s) await this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  seatOf(ws) { return ws.deserializeAttachment()?.seat ?? null; }
  msg(seat) {
    const state = seat ? seatView(this.s, seat) : publicView(this.s);
    return JSON.stringify({ type: 'state', state: { ...state, canUndo: this.undo.length > 0 } });
  }
  broadcast() { for (const w of this.ctx.getWebSockets()) { try { w.send(this.msg(this.seatOf(w))); } catch {} } }
  // seat token lookup in constant time per character
  tokenSeat(t) {
    if (typeof t !== 'string' || t.length !== 32) return null;
    for (const [k, id] of Object.entries(this.tokens)) {
      let d = 0; for (let i = 0; i < 32; i++) d |= k.charCodeAt(i) ^ t.charCodeAt(i);
      if (d === 0) return this.s.seats.some(p => p.id === id) ? id : null;
    }
    return null;
  }

  async webSocketMessage(ws, raw) {
    if (!this.s || typeof raw !== 'string' || raw.length > 4000) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.hello !== undefined) {   // a phone coming back with its seat token
      const id = this.tokenSeat(m.hello);
      ws.serializeAttachment({ seat: id });
      if (!id) ws.send(JSON.stringify({ type: 'error', error: 'noseat' }));
      ws.send(this.msg(id));
      return;
    }
    if (m.join !== undefined) {    // a new phone takes a seat
      if (this.seatOf(ws)) return;
      const id = 'p' + hex(4), next = reduce(this.s, { t: 'join', id, name: m.join });
      if (!next) { ws.send(JSON.stringify({ type: 'error', error: this.s.stage !== 'setup' ? 'started' : 'nojoin' })); ws.send(this.msg(null)); return; }
      const token = hex(16);
      this.tokens[token] = id;
      ws.serializeAttachment({ seat: id });
      ws.send(JSON.stringify({ type: 'seat', token, id }));
      return this.commit(next, true);
    }
    const by = this.seatOf(ws), a = m.action;
    if (!by) { ws.send(JSON.stringify({ type: 'error', error: 'viewonly' })); return; }
    let next;
    if (a?.t === 'undo') next = this.undo.length ? { ...this.undo.pop(), v: this.s.v + 1 } : null;
    else {
      next = reduce(this.s, a, by);
      if (next) {
        if (UNDOABLE.has(a.t) && next.stage !== 'over') { this.undo.push(this.s); if (this.undo.length > MAX_UNDO) this.undo.shift(); }
        else this.undo = [];
      }
    }
    if (!next) { ws.send(this.msg(by)); return; }   // rejected: resync the sender only
    await this.commit(next, false);
  }

  async commit(next, joined) {
    const before = this.s;
    this.s = next;
    // seats that left the table (kicked, or taken back by undo) lose their token; their phones become viewers
    const ids = new Set(next.seats.map(p => p.id));
    for (const [t, id] of Object.entries(this.tokens)) if (!ids.has(id)) delete this.tokens[t];
    for (const w of this.ctx.getWebSockets()) {
      const seat = this.seatOf(w);
      if (seat && !ids.has(seat)) { w.serializeAttachment({ seat: null }); try { w.send(JSON.stringify({ type: 'error', error: 'noseat' })); } catch {} }
    }
    if (joined) this.undo = [];   // undo never removes someone who just sat down
    await this.ctx.storage.put({ s: next, tokens: this.tokens, undo: this.undo });
    this.broadcast();
    if (next.stage === 'over' && before.stage !== 'over') {
      const rec = gameRecord(next);
      await archive(this.env).fetch('https://archive/put', { method: 'POST', body: JSON.stringify({ ...rec, code: this.code }) });
    }
    await this.report();
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, 'closed'); } catch {}
    if (this.s) await this.report(ws);
  }

  // Tell the lobby who is here and how far the game is (names and public progress only).
  async report(leaving) {
    if (!this.code) return;
    const s = this.s;
    const online = this.ctx.getWebSockets().filter(w => w !== leaving && w.readyState === WebSocket.OPEN).length;
    const summary = { code: this.code, stage: s.stage, online, names: s.seats.map(p => p.name),
      q: s.cur?.q ?? 0, ok: (s.quests || []).filter(x => x.ok).length, bad: (s.quests || []).filter(x => !x.ok).length, win: s.result?.win || null };
    try { await lobby(this.env).fetch('https://lobby/update', { method: 'POST', body: JSON.stringify(summary) }); } catch {}
  }
}
