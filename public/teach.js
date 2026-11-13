// N-minute teach (ported from the Pittsburgh page): a script the teacher reads aloud to start a first game, written from the
// official rulebook (same wording as tools/讲解稿.md), then 注意事项 with written answers (from tools/faq.json).
// Terms in {text|id} open a note with a picture; the 「问」 buttons and each note's 「问规则助手」 ask the rules assistant (chat.js).
// Pictures: the components are cut from the official rulebook (img/teach/*.webp). The rulebook has no picture of the special
// roles or the Lady of the Lake token; those use the site's own role art (img/<role>.jpg), the same pictures 「我的身份」 shows.
const ICON = (src, cls = '') => src ? `<img class="ico ${cls}" src="img/${src.includes('.') ? src : `teach/${src}.webp`}" alt="">` : '';

// id: name, where you see it, what it means. icon: img/teach/<icon>.webp, or a file in img/ for the site's own art.
const TERMS = {
  good: { name: '好人 / 亚瑟的忠臣', icon: 'servant', where: '蓝底身份牌，印着亚瑟的纹章。本站在「我的身份」里显示“好人”。', what: '好人一方。普通好人叫亚瑟的忠臣，没有特殊能力，开局什么也看不到。好人完成 3 个任务就赢一半。' },
  evil: { name: '邪恶 / 莫德雷德的爪牙', icon: 'minion', where: '红底身份牌，印着莫德雷德的纹章。本站在「我的身份」里显示“邪恶”。', what: '邪恶一方，人比好人少，但开局互相认识（奥伯伦除外）。普通邪恶叫莫德雷德的爪牙。让 3 个任务失败就赢。' },
  merlin: { name: '梅林', icon: 'merlin.jpg', where: '好人的特殊身份，每局都有。', what: '开局能看到邪恶方，但看不到莫德雷德。要暗中引导好人，又不能暴露自己：好人完成 3 个任务后，刺客认出他，好人就输。' },
  percival: { name: '派西维尔', icon: 'percival.jpg', where: '好人的可选身份。', what: '开局能看到梅林。有莫甘娜时会看到两个人，分不清哪个是真梅林。他的任务是找出并保护梅林。' },
  assassin: { name: '刺客', icon: 'assassin.jpg', where: '邪恶的特殊身份，每局都有。', what: '平时和普通爪牙一样。好人完成 3 个任务后，由他指认一名好人是梅林，认对了邪恶翻盘。' },
  morgana: { name: '莫甘娜', icon: 'morgana.jpg', where: '邪恶的可选身份，通常和派西维尔一起加。', what: '在派西维尔眼里，她和梅林一模一样，用来骗派西维尔。' },
  mordred: { name: '莫德雷德', icon: 'mordred.jpg', where: '邪恶的可选身份。', what: '梅林看不到他。他和其他邪恶同伴照常互相认识。' },
  oberon: { name: '奥伯伦', icon: 'oberon.jpg', where: '邪恶的可选身份。', what: '他不认识邪恶同伴，同伴也不认识他；但梅林看得到他。' },
  myrole: { name: '我的身份', icon: 'emblem.jpg', where: '本站开局后，对局页最上面那张卡。', what: '按住才显示，松手就遮住：你的身份，以及按规则你能看到的人。代替实体游戏的闭眼认人。' },
  tableau: { name: '任务版图', icon: 'tableau', where: '桌子中间的长条板，按人数选对应的一面。', what: '上排 5 个圆圈是 5 个任务，数字是这个任务要几个人；下排 1 到 5 记这一轮第几次组队。本站的局面条显示同样的信息。' },
  leader: { name: '队长标记', icon: 'leader', where: '红底皇冠板块，在当前队长面前。', what: '队长负责挑人组队、叫大家投票。每次组队被否决、每个任务做完，都交给左手边的下一位。' },
  team: { name: '队伍标记', icon: 'team', where: '盾牌形状的板块，一共 5 个。', what: '队长把它发给选中的人，表示谁在这次的队伍里。' },
  votes: { name: '投票标记', icon: 'votes', where: '每人一套：一个赞成（APPROVE，白）、一个反对（REJECT，黑）。', what: '大家选好一张扣着，队长喊开时同时翻开，谁投了什么都公开。赞成超过一半才通过，平票算否决。' },
  questcards: { name: '任务牌', icon: 'questcards', where: '出任务时队长发给每个队员一张成功、一张失败。', what: '队员秘密打出一张。好人只能出成功；邪恶可以选。收齐洗乱再翻开，只看几张失败。' },
  score: { name: '计分标记', icon: 'score', where: '蓝色（亚瑟的纹章）和红色（莫德雷德的纹章）的圆片。', what: '任务成功放蓝色，失败放红色，盖在任务版图对应的任务上。' },
  round: { name: '回合标记', icon: 'round', where: '放在任务版图上正在进行的那个任务上。', what: '任务做完就挪到下一个任务。' },
  votemarker: { name: '否决标记', icon: 'votemarker', where: '任务版图下排 1 到 5 的格子上。', what: '记这一轮已经第几次组队。同一轮第 5 个队伍也被否决，邪恶直接赢。任务做完后从 1 重新数。' },
  lady: { name: '湖中仙女', icon: 'lady.jpg', where: '可选的令牌，开局交给第一任队长右手边的人。本站在手机上操作。', what: '第 2、3、4 个任务结束后，持有人查看一名玩家的阵营（好人或邪恶，不看具体身份），然后把令牌交给被查的人。' }
};

// The script: what to read aloud. Every important element gets one sentence; exact rulings are for the assistant.
const PARTS = [
  { title: '怎么赢', sec: 25, lines: [
    '这局玩《阿瓦隆》。我先讲一遍主流程，讲完再一条条过注意事项。',
    '我们分成两边：亚瑟的{好人|good}和莫德雷德的{邪恶|evil}。好人多，但互相不认识；邪恶人少，开局就互相认识。',
    '一共 5 个任务，摆在{任务版图|tableau}上。邪恶让 3 个任务失败就直接赢；好人要完成 3 个任务。',
    '好人完成 3 个任务后，邪恶还有最后一招：{刺客|assassin}认出{梅林|merlin}，邪恶翻盘。'
  ], ask: ['好人完成 3 个任务就赢了吗？', '刺客什么时候可以刺杀？'] },
  { title: '看身份', sec: 35, lines: [
    '每人在自己手机上按住{我的身份|myrole}，看自己是谁、能看到谁，看完松手。不用闭眼念口令。',
    '{梅林|merlin}能看到邪恶方，但看不到{莫德雷德|mordred}。',
    '{派西维尔|percival}能看到梅林；有{莫甘娜|morgana}时会看到两个人，分不清哪个是真梅林。',
    '邪恶方互相认识，只有{奥伯伦|oberon}谁也不认识，同伴也不认识他。普通好人什么也看不到。',
    '身份牌和手机屏幕不能给别人看，但嘴上可以说自己是任何身份。'
  ], ask: ['梅林能看到奥伯伦吗？', '邪恶同伴之间知道对方的具体身份吗？'] },
  { title: '组队和投票', sec: 45, lines: [
    '每轮由{队长|leader}挑人出任务，把{队伍标记|team}发给选中的人。人数看任务版图，队长可以选自己。',
    '大家讨论完，所有人同时亮出{赞成或反对|votes}，谁投了什么都公开。',
    '赞成超过一半，队伍出发；平票算否决。否决了，队长交给左手边下一位，重新组队。',
    '同一轮连续 5 次组队都被否决，邪恶直接赢，{否决标记|votemarker}记着这是第几次。',
    '本站「票型」页会记下每次谁当队长、带了谁、谁投了什么。'
  ], ask: ['投票平票怎么算？', '连续否决 5 次会怎样？是强制发车吗？'] },
  { title: '出任务', sec: 35, lines: [
    '队员每人秘密出一张{任务牌|questcards}：好人只能出成功，邪恶可以出成功，也可以出失败。',
    '收齐洗乱再翻开，只看几张失败，不知道是谁出的。有一张失败，任务就失败。',
    '例外：7 人及以上的第 4 个任务，要 2 张失败才算失败。',
    '结果用{计分标记|score}记在版图上，{回合标记|round}挪到下一个任务，队长交给下一位。'
  ], ask: ['好人能出失败牌吗？', '7 人局第 4 个任务只出了 1 张失败，算成功吗？'] },
  { title: '湖中仙女', sec: 25, lines: [
    '7 人及以上常加{湖中仙女|lady}：第 2、3、4 个任务结束后，拿着它的人查看一名玩家是好人还是邪恶。',
    '结果只有他自己知道，可以如实说，也可以撒谎。查完把湖中仙女交给被查的人；用过它的人不能再被查。'
  ], ask: ['湖中仙女一开始在谁手里？', '湖中仙女查到的是身份还是阵营？持有人能撒谎吗？'] },
  { title: '刺杀和结束', sec: 25, lines: [
    '好人完成 3 个任务后，邪恶方可以一起商量，最后由{刺客|assassin}指认一名好人是梅林。',
    '认对了邪恶赢，认错了好人赢。本站由刺客在自己手机上指认，然后全桌公开所有身份和票型。',
    '流程就这些，接下来过一遍注意事项。'
  ], ask: ['刺杀前邪恶方能商量吗？好人能插话吗？', '刺客认错了会怎样？'] }
];

// 注意事项: fine points outside the main flow that are easy to get wrong. Read them one by one after the script.
// Each has a written answer (from tools/faq.json, i.e. the rulebook and the publisher's answers); the rest goes to the assistant.
// [title, answer, question for the assistant]
const NOTES = [
  ['好人不能出失败牌', '好人只能出成功。邪恶可以自己选，出成功也行、出失败也行，有时邪恶故意出成功来藏身份。本站手机出牌时，好人点不了“失败”。', '好人能出失败牌吗？邪恶必须出失败吗？'],
  ['投票是公开的，任务牌才是秘密的', '组队投票大家同时亮牌，每个人投了什么都公开，可以拿来分析。只有任务牌是秘密的：洗乱再翻开，不知道是谁出的。', '组队投票是公开的还是秘密的？'],
  ['平票算否决', '赞成必须超过总人数的一半才通过。6 人局 3 票赞成、3 票反对，就是否决。', '投票平票怎么算？'],
  ['第 5 次否决不是“强制发车”', '同一轮里第 5 个队伍被否决，邪恶直接获胜。一个任务做完后重新从第 1 次数。“否决 4 次后强制发车”是流传很广的村规，不是官方规则。', '连续否决 5 次会怎样？是强制发车吗？'],
  ['队长要投票，也能选自己', '队长和其他人一样要投票。队长可以把自己选进队伍，也可以不选。被否决后，新队长可以提和上一个一样的队伍。', '队长要投票吗？队长能选自己吗？'],
  ['7 人及以上的第 4 个任务', '这个任务要至少 2 张失败才算失败。只出了 1 张失败，任务算成功，直接进入下一个任务，不用重做。其他任务 1 张失败就失败。', '7 人局第 4 个任务只出了 1 张失败，算成功吗？'],
  ['嘴上可以说谎，牌不能亮', '游戏中随时可以声称自己是任何身份，投票、讨论时说谎都行。但身份牌（本站是「我的身份」那一屏）不能给别人看，也不能描述牌面。', '能把身份牌给别人看，或者说出自己牌上画了什么吗？'],
  ['梅林看不到莫德雷德', '这正是莫德雷德的能力。莫德雷德和其他邪恶同伴（奥伯伦除外）照常互相认识。', '梅林能看到莫德雷德吗？'],
  ['梅林看得到奥伯伦', '奥伯伦不和邪恶同伴互认，但梅林看得到他。规则书这里写得有歧义，以出版社在 BGG 上的答复为准。', '梅林能看到奥伯伦吗？'],
  ['莫德雷德和奥伯伦同时在场', '梅林看不到莫德雷德、看得到奥伯伦；莫德雷德和其他邪恶同伴互相认识，但都不知道谁是奥伯伦；奥伯伦谁也不认识。', '莫德雷德和奥伯伦同时在场时，谁看得到谁？'],
  ['邪恶同伴只知道彼此是邪恶', '开局邪恶方只互相确认谁是邪恶，不知道谁是刺客、谁是莫甘娜。有些桌会让邪恶方知道具体身份，那是村规。', '邪恶同伴之间知道对方的具体身份吗？'],
  ['没有莫甘娜时的派西维尔', '派西维尔只看到梅林一个人，直接就能确认谁是梅林。所以加派西维尔时通常也加莫甘娜。5 人局带派西维尔，规则书要求同时加莫甘娜或莫德雷德。', '没有莫甘娜时，派西维尔看到什么？'],
  ['刺客只有一次机会，而且时机固定', '只有好人完成 3 个任务之后才能刺杀。“刺客任何时候都能刺”是误传。邪恶靠 3 次失败或 5 次否决获胜时，没有刺杀环节。刺客认错一次，好人就赢。', '刺客什么时候可以刺杀？'],
  ['刺杀前可以商量', '邪恶方可以一起讨论，最后由刺客一个人指认，谁都不能亮身份牌。按规则书字面只有邪恶方讨论；好人能不能插话，开局前约定好。', '刺杀前邪恶方能商量吗？好人能插话吗？'],
  ['湖中仙女查的是阵营', '只看好人还是邪恶，不看具体身份；莫甘娜、奥伯伦都显示邪恶。持有人可以撒谎，但不能把结果亮给别人看。', '湖中仙女查到的是身份还是阵营？持有人能撒谎吗？'],
  ['湖中仙女不能查谁', '不能查自己，也不能查用过湖中仙女的人，包括开局拿到它的人。整局最多用 3 次。', '湖中仙女能查自己，或者查以前的持有人吗？'],
  ['推荐配置不是官方的', '规则书只规定每种人数几个好人、几个邪恶，没给“几人用哪些身份”的表。开局页的推荐是中文玩家常用的搭配，可以自己增减。', '开局时手机上显示的“推荐配置”是官方的吗？']
];

// Icon guide, grouped the way things sit on the table.
const GROUPS = [
  ['桌上的配件', ['tableau', 'leader', 'team', 'votes', 'questcards', 'score', 'round', 'votemarker']],
  ['阵营', ['good', 'evil']],
  ['特殊身份', ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon']],
  ['可选与本站', ['lady', 'myrole']]
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const term = (text, id) => `<button type="button" class="term" data-t="${id}">${ICON(TERMS[id].icon)}${esc(text)}</button>`;
const line = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => term(t, id));
// inside a button the terms show their icon but are not buttons themselves
const label = s => esc(s).replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => `<span class="tlab">${ICON(TERMS[id].icon)}${esc(t)}</span>`);
const askBtn = (text, q) => `<button type="button" class="tq" data-q="${esc(q)}">问 <span>${label(text)}</span></button>`;

document.getElementById('teach').innerHTML = `
  <p class="tlead">讲的人先照着念主流程（三分钟左右），再一条条过注意事项。<b>带下划线的词</b>点一下看图和解释；有疑问点「问」，规则助手马上回答。</p>
  <nav class="tnav">${PARTS.map((p, i) => `<a href="#p${i + 1}"><i>${i + 1}</i>${p.title}</a>`).join('')}<a href="#later">注意事项</a><a href="#icons">图标速查</a></nav>
  ${PARTS.map((p, i) => `<section class="card tpart" id="p${i + 1}">
    <h2 class="h"><span><i>${i + 1}</i>${p.title}</span><small>约 ${p.sec} 秒</small></h2>
    ${p.lines.map(s => `<p class="tline">${line(s)}</p>`).join('')}
    <div class="tasks"><em>桌上常见疑问</em>${p.ask.map(q => askBtn(q, q)).join('')}</div>
  </section>`).join('')}
  <section class="card tpart" id="later">
    <h2 class="h"><span><i>✓</i>注意事项</span><small>${NOTES.length} 条</small></h2>
    <p class="tnote">流程讲完后，一条一条过一遍。都是规则书里写了、但最容易漏掉或吵起来的地方。点开就是答案。</p>
    <div class="tnotes">${NOTES.map(([t, a, q], i) => `<details class="tni"><summary><i>${i + 1}</i>${esc(t)}</summary><p>${line(a)}</p>${askBtn('还有疑问？问规则助手', q)}</details>`).join('')}</div>
    <p class="tnote">注意事项里没有的，点右下角「规则」问 AI，本站资料查不到会联网找。</p>
  </section>
  <a class="btn tgo" href="/">讲完了，去建房间</a>
  <h2 class="h" id="icons">图标速查<small>点图标看解释</small></h2>
  ${GROUPS.map(([g, ids]) => `<div class="card tgrid"><h3>${g}</h3><div>${ids.map(id => `<button type="button" class="tic" data-t="${id}">${ICON(TERMS[id].icon)}<span>${TERMS[id].name}</span></button>`).join('')}</div></div>`).join('')}
  <footer>依据 Indie Boards &amp; Cards 官方规则书 · 配件图片截自官方规则书（<a href="https://upload.snakesandlattes.com/rules/r/ResistanceAvalon.pdf" target="_blank" rel="noopener">原文</a>），版权归 Indie Boards &amp; Cards 所有 · 规则书里没有特殊身份和湖中仙女的图，这几张用的是本站「我的身份」里的原创插画 · 非官方玩家工具</footer>`;

// The note for a term: a sheet from the bottom with the picture, where it is and what it means.
const sheet = document.createElement('div');
sheet.className = 'tsheet hidden';
document.body.appendChild(sheet);
const close = () => sheet.classList.add('hidden');
function show(id) {
  const t = TERMS[id];
  sheet.innerHTML = `<div class="tsbg"></div><div class="tsbox" role="dialog" aria-label="${esc(t.name)}">
    <div class="tshd">${ICON(t.icon, 'big')}<b>${esc(t.name)}</b><button type="button" class="tsx" aria-label="关闭">×</button></div>
    <p><em>在哪儿看到</em>${esc(t.where)}</p><p><em>什么意思</em>${esc(t.what)}</p>
    <button type="button" class="btn navy tsask" data-q="${esc(`「${t.name}」是什么，怎么用？`)}">还不懂？问规则助手</button></div>`;
  sheet.classList.remove('hidden');
}
const ask = q => { close(); window.askRules?.(q); };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-t]');
  if (t) return show(t.dataset.t);
  const q = e.target.closest('[data-q]');
  if (q) return ask(q.dataset.q);
  if (e.target.closest('.tsx,.tsbg')) close();
});
addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
