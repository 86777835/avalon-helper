// Rules assistant: a floating button (bottom right) that opens a chat panel. Answers stream from /api/chat.
// Rules only: the request carries the conversation and nothing about the room, so the assistant can't know anyone's role.
const SUGGEST = ['连续否决 5 次会怎样？', '7 人局第 4 个任务要几张失败？', '湖中仙女怎么用？', '梅林能看到奥伯伦吗？'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

// Browser messages for a dropped connection (request or mid-answer): Chrome, Safari, Firefox.
const NET_ERRS = ['Failed to fetch', 'network error', 'Load failed', 'NetworkError when attempting to fetch resource.'];

const msgs = [];   // conversation sent to the server: {role, content}
let busy = false;

document.body.classList.add('has-chat');
document.body.insertAdjacentHTML('beforeend', `
<button class="cfab" type="button" aria-label="打开规则助手"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.6 21l4.3-2.4c1 .3 2 .4 3.1.4 5.5 0 10-3.6 10-8s-4.5-8-10-8zm-4 9.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>规则</button>
<div class="cpanel hidden" role="dialog" aria-label="规则助手">
  <div class="chd"><span class="cav">规</span><div><b>阿瓦隆规则助手</b><span><i class="con"></i>依据规则书作答，查不到会联网找</span></div><button class="cx" type="button" aria-label="关闭">×</button></div>
  <div class="band"></div>
  <div class="clog">
    <div class="cwel"><img src="img/chat.jpg" alt=""><div><b>有规则问题，尽管问</b><span>组队、投票、任务、湖中仙女、刺杀……桌上起了争议也可以问我</span></div></div>
    <div class="csug"><em>大家常问</em>${SUGGEST.map(q => `<button type="button">${q}</button>`).join('')}</div>
  </div>
  <form class="cin"><textarea rows="1" maxlength="500" placeholder="问规则，比如：平票怎么算？" enterkeyhint="send"></textarea><button type="submit" aria-label="发送"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.1 2-12.1 2z"/></svg></button></form>
  <div class="cfoot">AI 回答仅供参考，以官方规则书为准</div>
</div>`);

const $c = s => document.querySelector(s);
const fab = $c('.cfab'), panel = $c('.cpanel'), log = $c('.clog'), form = $c('.cin'), box = form.querySelector('textarea'), sendBtn = form.querySelector('button');
const open = on => { panel.classList.toggle('hidden', !on); fab.classList.toggle('hidden', on); if (on) box.focus(); };
fab.onclick = () => open(true);
$c('.cx').onclick = () => open(false);
$c('.csug').onclick = e => { const b = e.target.closest('button'); if (b) ask(b.textContent); };
form.onsubmit = e => { e.preventDefault(); ask(box.value); };
// Other pages (the teach page) open the panel and ask a question in one tap.
window.askRules = q => { open(true); ask(q); };
box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(box.value); } };

// One message row; assistant rows carry the avatar. Returns the bubble.
function bubble(cls, html) {
  log.insertAdjacentHTML('beforeend', `<div class="cr ${cls}">${cls === 'a' ? '<span class="cav sm">规</span>' : ''}<div class="cm ${cls}">${html}</div></div>`);
  log.scrollTop = log.scrollHeight;
  return log.lastElementChild.lastElementChild;
}

async function ask(q) {
  q = q.trim();
  if (!q || busy) return;
  busy = true; sendBtn.disabled = true; box.value = '';
  $c('.csug')?.remove();
  bubble('u', fmt(q));
  msgs.push({ role: 'user', content: q });
  const out = bubble('a', '<i class="cdots"><b></b><b></b><b></b></i>');
  let text = '', fb = null, web = null;   // web: sources when the answer comes from a web search
  const t0 = Date.now();
  // When DeepSeek is overloaded it queues the request and sends nothing; stop waiting if no text in 30 s.
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), 30000);
  // An answer from the web is labelled as unchecked by this site, with its sources under it.
  const show = () => {
    const head = web?.length ? '<div class="cweb">本站资料没有这一条，以下来自网上讨论，<b>本站未核对</b>，请自行判断</div>' : '';
    const src = web?.length ? `<div class="csrc">来源：${web.map((w, i) => `<a href="${esc(w.url)}" target="_blank" rel="noopener">[${i + 1}] ${esc(w.title)}<i>${esc(w.site)}</i></a>`).join('')}</div>` : '';
    out.innerHTML = head + fmt(text) + src; log.scrollTop = log.scrollHeight;
  };
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: msgs.slice(-10) }), signal: ctl.signal });   // the server keeps only the last 10 and rejects over 20
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `出错了（${r.status}）`);
    fb = r.headers.get('x-chat-fallback');   // a backup model answered (only for the error report below)
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const j = JSON.parse(data);
        if (j.error) throw new Error(j.error);
        if (j.reset) { text = ''; fb = j.reset; out.innerHTML = '<i class="cdots"><b></b><b></b><b></b></i>'; continue; }   // the model stalled; the next one starts over
        const piece = j.choices?.[0]?.delta?.content;
        if (j.searching) {   // not in this site's notes: the server is searching the web, which takes a few more seconds
          clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 30000); text = '';   // drop anything shown before the search
          out.innerHTML = '<span class="cwait">本站资料里没有，正在联网查找…</span><i class="cdots"><b></b><b></b><b></b></i>'; continue;
        }
        if (j.web) { web = j.web; continue; }
        if (piece) { clearTimeout(timer); text += piece; show(); }
      }
    }
    if (!text) throw new Error('没有收到回答，请再问一次');
    msgs.push({ role: 'assistant', content: text });
  } catch (e) {
    msgs.pop();   // drop the unanswered question so the next request stays well formed
    out.classList.add('err');
    const net = NET_ERRS.includes(e.message);
    out.innerHTML = (text ? fmt(text) + '<br>' : '') + esc(ctl.signal.aborted ? 'DeepSeek 服务器正忙，30 秒还没开始回答，请过一两分钟再问'
      : net ? `网络连接失败，请检查网络后再试（${e.name}: ${e.message}）` : e.message);
    // Dropped connections are hard to see from the server: report what the page saw to the server log.
    if (net) navigator.sendBeacon?.('/api/chat-log', JSON.stringify({ err: `${e.name}: ${e.message}`, got: text.length, ms: Date.now() - t0, fb }));
  }
  clearTimeout(timer);
  busy = false; sendBtn.disabled = false;
}
