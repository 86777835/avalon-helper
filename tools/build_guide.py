# Builds public/guide.html (rules guide + FAQ) from the guide script and the FAQ list.
# Usage: python3 tools/build_guide.py tools/讲解稿.md public/guide.html tools/faq.json
# 讲解稿.md: one section per "## title", bullets as points.
import re, html, sys, json
src, out, faq_src = sys.argv[1], sys.argv[2], sys.argv[3]
SRC = {
    'rb': ('官方规则书', 'https://upload.snakesandlattes.com/rules/r/ResistanceAvalon.pdf'),
    'tw864973': ('出版社在 BGG 的答复', 'https://boardgamegeek.com/thread/864973/article/10198885'),
    'tw874478': ('出版社在 BGG 的答复', 'https://boardgamegeek.com/thread/874478/article/10364026'),
    'bgg2435756': ('BGG 规则区讨论', 'https://boardgamegeek.com/thread/2435756'),
    'site': ('本站说明', './'),
}
faq = json.load(open(faq_src))
cats = list(dict.fromkeys(f['cat'] for f in faq))
faq_html = ''.join(f'<h3 class="fq-cat">{html.escape(c)}</h3>' + ''.join(
    f'<details class="card fq"><summary>{html.escape(f["q"])}</summary><p>{html.escape(f["a"])} <a href="{SRC[f["src"]][1]}" target="_blank" rel="noopener">来源：{SRC[f["src"]][0]}{html.escape(f.get("ref", ""))}</a></p></details>'
    for f in faq if f['cat'] == c) for c in cats)
secs = re.findall(r'^## (.+?)\n(.*?)(?=^## |\Z)', open(src).read(), re.M | re.S)
toc = '<a class="fqa" href="#faq">常见问题</a>' + ''.join(f'<a href="#s{i}">{html.escape(t)}</a>' for i, (t, _) in enumerate(secs, 1))
body = ''
for i, (t, b) in enumerate(secs, 1):
    pts = ''.join(f'<li>{html.escape(x)}</li>' for x in re.findall(r'^- (.+)$', b, re.M))
    body += f'''<section class="card gs" id="s{i}"><h2 class="h"><span><i>{i:02d}</i>{html.escape(t)}</span></h2><ul>{pts}</ul></section>\n'''
open(out, 'w').write(f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111a30">
<title>新手教程 · 阿瓦隆面杀助手</title>
<meta property="og:title" content="新手教程 · 阿瓦隆面杀助手">
<meta property="og:image" content="https://avalon.leisurecat.cloud/img/icon-512.jpg">
<link rel="icon" href="img/icon-64.png">
<link rel="apple-touch-icon" href="img/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Noto+Serif+SC:wght@600;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div style="position:absolute;width:0;height:0;overflow:hidden"><img src="img/icon-512.jpg" alt=""></div>
<div class="hero-art" style="height:calc(env(safe-area-inset-top) + 190px)"><a class="navb" href="/">‹ 返回</a><img src="img/guide.jpg" alt="" style="object-position:50% 50%"><div class="ht"><div class="hz">新手教程</div><div class="hs">阿瓦隆 · 基础版规则</div></div></div>
<div class="wrap guide">
<p class="note">依据官方英文规则书整理，用自己的话概括，页码按规则书页序。身份名称用中文玩家常用的译名。只讲基础版，不含兰斯洛特、王者之剑等扩展。</p>
<h2 class="h"><span>规则讲解</span><small>{len(secs)} 节</small></h2>
<nav class="toc">{toc}</nav>
<div class="roles">{''.join(f'<div><span class="por sm"><img src="img/{k}.jpg" alt=""></span><b>{n}</b></div>' for k, n in [('merlin','梅林'),('percival','派西维尔'),('servant','忠臣'),('assassin','刺客'),('morgana','莫甘娜'),('mordred','莫德雷德'),('oberon','奥伯伦'),('minion','爪牙')])}</div>
{body}<h2 class="h" id="faq"><span>常见问题</span><small>{len(faq)} 条</small></h2>
<p class="note">依据官方规则书和出版社在 BGG 上的答复整理，点开查看答案和来源。规则书没写清的地方，答案里写明了依据。</p>
{faq_html}
<a class="btn" href="./">返回首页</a>
<footer>非官方玩家工具 · 规则依据 Indie Boards &amp; Cards 官方规则书 · 角色插画为本站原创</footer>
</div>
<script type="module" src="chat.js"></script>
</body>
</html>
''')
print(len(secs), len(faq))
