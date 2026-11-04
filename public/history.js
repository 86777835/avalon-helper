import { ROLES, SIDE_ZH } from './logic.js';

const WHY = { quests: '3 个任务失败', rejects: '同一轮 5 次组队被否决', stab: '刺客认出了梅林', missed: '刺客没有认出梅林' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const por = r => `<span class="por xs" style="--c:var(--${ROLES[r].side})"><img src="img/${r}.jpg" alt=""></span>`;
const when = t => new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function game(g) {
  const name = id => g.players.find(p => p.id === id)?.name ?? '?';
  const win = g.result.win;
  return `<details class="card game">
    <summary><div class="gh"><b>${esc(g.code)}</b><span>${when(g.ended)} · ${g.n} 人局</span></div>
      <div class="gw ${win}">${win === 'good' ? '好人获胜' : '邪恶获胜'}<small>${WHY[g.result.why]}</small></div>
      <div class="gp">${g.players.map(p => `<span class="${ROLES[p.role].side === win ? 'wn' : ''}">${por(p.role)}<i>${esc(p.name)}</i></span>`).join('')}</div></summary>
    <div class="gd">
      ${g.players.map(p => `<div class="row">${por(p.role)}<div class="who"><div class="nm">${esc(p.name)}</div><div class="fg">${ROLES[p.role].name}</div></div><span class="sd ${ROLES[p.role].side}">${SIDE_ZH[ROLES[p.role].side]}</span></div>`).join('')}
      <div class="gq">${g.quests.map((q, i) => `<div><b class="${q.ok ? 'g' : 'e'}">任务${i + 1} ${q.ok ? '成功' : `失败（${q.fails} 张）`}</b>：${q.team.map(name).map(esc).join('、')}</div>`).join('')}
        <div>共组队 ${g.attempts.length} 次，否决 ${g.attempts.filter(a => !a.pass).length} 次${g.result.target ? `；刺客指认 ${esc(name(g.result.target))}` : ''}</div>
        ${g.lady.map(x => `<div>湖中仙女：${esc(name(x.holder))} 查看 ${esc(name(x.target))}（${SIDE_ZH[x.side]}）</div>`).join('')}</div>
    </div>
  </details>`;
}

async function load(q) {
  const box = document.getElementById('games');
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await fetch('/api/games' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    box.innerHTML = list.length ? list.map(game).join('') : `<div class="empty">${q ? '没有找到相关对局' : '暂无记录'}</div>`;
  } catch {
    box.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
  }
}

document.getElementById('search').addEventListener('submit', e => { e.preventDefault(); load(document.getElementById('q').value.trim()); });
load('');
