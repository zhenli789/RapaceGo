/* 端到端：习题练习模式（2026-10-12 新增功能的验收入口）
   用法（macOS / Linux）：
     node dev/_cdp_tsumego.mjs          # 需要先有一个带 --remote-debugging-port=9333 的实例
   用法（Windows，走项目的启动器）：
     python dev/_rtest.py dev/_cdp_tsumego.mjs _trash/_shot_ts.png

   ★ 这个脚本验的是**我自己新加的那一整套**，断言尽量落在"可观察的状态"上，
     不依赖截图（截图在不同平台上实现不一样，见 _rtest.py 只在 Windows 上能截）。

   测试局面（19 路，右上角）：白 2×2 = Q16/Q17/R16/R17，被黑围住，只有 Q15、S16 两口气。
     黑先。黑走 Q15 → 白只剩一口气、做不出两只眼。
   （2026-10-17：判定 / 提示 / 题目目标 三块已按用户要求删掉 —— 所以这个形状现在
     只用来验「摆题 / 落子 / 框架 / 应手 / 正解」这条主链路，不再有"拿去判死活"那一步。）

   ★ 2026-10-12 第二轮（用户报的问题）新增第 4.5 段：
     ① 框架在**解题阶段必须固定**（旧实现把 state.moves 也算进外接矩形 → 落子会把框顶大；
        所以故意在"框内、但离题目棋子很远"的 (10,7) 落一手来卡这个 bug）；
     ② 框外落子要被挡下（人也受框架约束）；
     ③ 练习卡上的「框距 −/+」能当场调框。
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;

/* ★ 往**测试用**的棋谱库里放一份"像习题集"的棋谱（有 AB/AW 摆子），
   给下面「当题练」去重那一段用。用 RAPACEGO_RECORDS（启动命令里设的临时目录）——
   绝不碰用户的棋谱库（这是本项目踩过血的教训，见 main.js 的 refreshRecordsDir）。 */
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');
const REC_FIXTURE = '练习册-当题练测试.sgf';
try {
  if (REC_DIR) {
    fs.mkdirSync(REC_DIR, { recursive: true });
    const fxf = path.join(ROOT_DIR, 'dev', 'fixtures', '测试题集-3题.sgf');
    if (fs.existsSync(fxf)) fs.copyFileSync(fxf, path.join(REC_DIR, REC_FIXTURE));
  }
} catch (e) { /* 放不进去就让那一段自己跳过，不算失败 */ }

/* ★ 下面那段要在**渲染进程**里用这两个值，所以先在这里编成 JS 字面量再插进模板串
   （直接写 REC_FIXTURE 会 ReferenceError —— 渲染进程看不到 Node 侧的变量）。
   ⚠️ 插值写成 ${'${REC_FIX_LIT}'} 这种形式，_precheck 的第 ② 步会把 ${...} 换成 0 再查语法，两者不冲突。 */
const REC_FIX_LIT = JSON.stringify(REC_FIXTURE);
const REC_DIR_LIT = JSON.stringify(REC_DIR || '（未设 RAPACEGO_RECORDS）');

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 端口还没起来，继续等 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0; const pending = new Map();
const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push('未捕获异常: ' + (d.exception?.description || d.text || '?').split('\n')[0]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errs.push('log: ' + m.params.entry.text.slice(0, 200));
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Log.enable');

const out = await js(`(async function(){
  const steps = [];
  /* ★ 先把它挂到 window 上：万一表达式中途抛异常（比如某个 step 的**参数**里读到了 null，
     那一句在 step 的 try 之外），return 就走不到了 —— 但它还挂在 window 上，
     Node 侧照样能把"已经跑到哪一步"捞出来。
     （教训来自本项目：_rtest.py 里专门写过"别什么都看不到"。） */
  window.__tsSteps = steps;
  const step = (name, ok, extra) => steps.push((ok ? '✓ ' : '★ ') + name + (extra === undefined || extra === '' ? '' : ' → ' + extra));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const lit = id => { const b = $(id).querySelector('.on'); return b ? b.dataset.v : '无'; };
  const seg = (id, v) => $(id).querySelector('[data-v="' + v + '"]').click();

  /* ★ 「练习卡高度任何时刻不变」（2026-10-14 用户要求）——
     这是**跨阶段**的判据，所以把每次量到的卡片高度存下来，最后一起比。 */
  const cardH = [];
  const snapCardH = tag => {
    const h = Math.round($('ts-card').getBoundingClientRect().height);
    cardH.push({ tag: tag, h: h });
    return h;
  };

  /* 测试局面：内部坐标（0 起，y 从上往下） */
  const BLACK = [[14,4],[14,3],[14,2],[14,1],[15,1],[16,1],[17,2],[17,1],[16,4]];
  const WHITE = [[15,3],[15,2],[16,3],[16,2]];

  /* 把某个交叉点换算成画布上的像素，用来派发**真**鼠标事件（验点击分流，而不是绕过去直接调函数） */
  function clickAt(x, y, button) {
    const c = document.getElementById('board');
    const r = c.getBoundingClientRect();
    const gx = r.left + pad + x * gap, gy = r.top + pad + y * gap;
    const ev = new MouseEvent(button === 2 ? 'contextmenu' : 'click',
      { clientX: gx, clientY: gy, bubbles: true, cancelable: true, button: button || 0 });
    c.dispatchEvent(ev);
  }

  /* ---------- 0. 配置 + 手动加载分析引擎 ----------
     ★ 这个软件**打开时一个引擎都不加载**（不占显存、不拖启动），
       要用时得点顶栏那盏灯选「加载」。测试里直接走同一个 IPC
       （window.api.engine.load），等价于点那一下 —— 不绕过被测代码。 */
  const cfg = await window.api.settings.get();
  step('引擎路径已配置（settings.json 被读到）',
    !!(cfg && cfg.files && cfg.files.katago),
    (cfg && cfg.config && cfg.config.katago) || '（空）');
  if (!engineReady) {
    await window.api.engine.load('katago');
    const t1 = Date.now();
    while (!engineReady && Date.now() - t1 < 150000) await sleep(1000);
  }
  step('分析引擎就绪（含加载）', engineReady, 'analyze=' + engineReady + ' play=' + engineReadyPlay);

  /* ---------- 0.5 起点归零 ----------
     ★ 软件会把上次用的模式存进 settings（重启后还在那个模式）—— 这是**正常行为**，不是 bug。
       但本轮第一段要验的是"点顶栏按钮 → 只打开面板、模式还没切"，
       所以测试**必须先回到人机对弈**，否则一进来就已经是习题模式，
       那两条断言会以"看起来失败"的样子报 ★（2026-10-14 踩到：上一轮的截图脚本把它留在习题模式）。 */
  settings.mode = 'play';
  if (state.tsumego) exitTsumego();
  /* ★ 顺带把题集也摘掉：题集是**内存里的**（每次启动都是空的），
     但"起点归零"这一步要想的是"不依赖上一轮留下的任何东西"，
     所以这里显式清一下，免得以后加了持久化就悄悄串味。 */
  state.tsumegoSet = null;
  /* ★ 清掉题集进度（2026-10-16）：加了"打开题集时定位到上次练到的那题"之后，
     localStorage 里的进度会跨次跑测留下来 → "打开题集停在第 1 题"那条断言
     会莫名其妙地亮。测试必须从一个干净的进度开始（下面单独有一段验它）。 */
  try { localStorage.removeItem('rapacego.pset.progress'); } catch (e) {}
  applyNewGame(true);
  setSeg('seg-mode', 'play');
  syncUI();
  await sleep(300);
  step('起点归零：人机对弈 + 未开局（不依赖上一轮留下的模式）',
    settings.mode === 'play' && !state.tsumego && state.noGame,
    'mode=' + settings.mode + ' tsumego=' + !!state.tsumego + ' noGame=' + state.noGame);

  /* ---------- 1.0 模式按钮 = 单按钮 + 下拉菜单（2026-10-14 用户要求）----------
     原来是三个按钮并排（人机对弈 / 摆棋·双人 / 习题练习），现在合成一个按钮 + 下拉。
     判据四件事：① 按钮上写的是**当前模式**；② 菜单默认收起；③ 点按钮展开、点外面/按 Esc 收起；
               ④ 点菜单项 = 打开「新对局」面板（模式此时**还没**切）+ 菜单收起。
     ★ 位置也要量：它是绝对定位的右对齐菜单，得在按钮下方且不出窗口。 */
  {
    const cur = () => ($('mode-cur').textContent || '').trim();
    step('模式按钮收起成一个、文字 = 当前模式', cur() === '人机对弈',
      '按钮文字=' + JSON.stringify(cur()) + ' 菜单项数=' + $('seg-mode').querySelectorAll('button').length);
    /* ★ 菜单里那三项的**名字**（2026-10-14 用户要求把「摆棋 / 双人」改叫「双人摆棋」）。
       锁住"三种模式就叫这三个名字"，免得哪一处漏改（同一个模式出现两个叫法最坑）。 */
    step('菜单三项的名字 = 人机对弈 / 双人摆棋 / 习题练习',
      [...$('seg-mode').querySelectorAll('button')].map(b => b.textContent.trim()).join('|')
      === '人机对弈|双人摆棋|习题练习',
      [...$('seg-mode').querySelectorAll('button')].map(b => b.textContent.trim()).join(' / '));
    /* ★ 按钮宽度 = 老按钮那样（用户要求）+ **没有下拉三角**。
       判据不写死像素：拿探针量本机真实文字宽，再按**实算的**内边距/边框加回去
       （改了 padding 或去掉了边框，这里跟着算 —— 不会像写死"+24+2"那样悄悄失真）。 */
    {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;font-size:12px;';
      probe.textContent = cur();
      document.body.appendChild(probe);
      const tw = probe.getBoundingClientRect().width;
      probe.remove();
      const cs = getComputedStyle($('btn-mode'));
      const expW = tw + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
        + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const bw = $('btn-mode').getBoundingClientRect().width;
      step('模式按钮没有三角、宽度 = 文字 + 内边距 + 边框（本机实算）',
        !$('btn-mode').querySelector('.caret') && Math.abs(bw - expW) <= 1.5,
        '按钮宽=' + Math.round(bw) + ' 文字宽=' + Math.round(tw) + ' 期望≈' + Math.round(expW)
        + '（内边距 ' + cs.paddingLeft + '/' + cs.paddingRight
        + ' 边框 ' + cs.borderLeftWidth + '）· 三角=' + ($('btn-mode').querySelector('.caret') ? '还有' : '没有'));
    }
    /* ★ 改名之后**三个模式名都是 4 个字**（人机对弈 / 双人摆棋 / 习题练习）→ 按钮宽度不变。
       这条钉住它：只要有人再把某个模式名改长，按钮就会在切换时跳一下。 */
    {
      const el = $('mode-cur');
      const w0 = el.textContent;
      const ws = [];
      for (const t of ['人机对弈', '双人摆棋', '习题练习']) {
        el.textContent = t;
        ws.push(Math.round(el.getBoundingClientRect().width));
      }
      el.textContent = w0;
      step('三个模式名等宽 → 切换模式时按钮宽度不跳',
        new Set(ws).size === 1 && ws[0] > 0,
        '各名字宽=' + ws.join(' / ') + '（还应加上左右 12px 内边距才是按钮宽）');
    }
    step('下拉菜单默认是收着的', $('seg-mode').hidden && !$('modepick').classList.contains('open'),
      'hidden=' + $('seg-mode').hidden);

    /* ★ 用户要求：**浅绿底 / 深绿字 / 无边框** —— 一眼看出"当前是哪种对局模式"。
       颜色用探针解析 var(--accent-soft) / var(--accent) 再比（不写死 rgb）。
       ⚠️ 两个坑都避开了：
         ① 旧的判据是"描边色 = 主题绿" —— 去掉边框后它会**假绿**（border-style:none 时计算出的
            border-color 仍等于 currentColor），所以改成判"底色 + 边框宽度"；
         ② getComputedStyle() 返回的是**活对象** —— 点开之后再读就变成新值了，
            所以这里**先把字符串存下来**，再看展开后的值跟它比。 */
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.style.color = 'var(--accent-soft)';
    const soft = getComputedStyle(probe).color;
    probe.remove();
    const csC = getComputedStyle($('btn-mode'));
    const bgClosed = csC.backgroundColor, fg = csC.color;
    const bwTop = csC.borderTopWidth, bsTop = csC.borderTopStyle;
    step('模式按钮配色：浅绿底 / 深绿字 / 无边框',
      bgClosed === soft && fg === accent && parseFloat(bwTop) === 0 && bsTop === 'none',
      '底=' + bgClosed + '（浅绿 ' + soft + '）· 字=' + fg + '（深绿 ' + accent + '）'
      + ' · 边框=' + bwTop + '/' + bsTop);

    $('btn-mode').click(); await sleep(150);
    step('点按钮 → 菜单展开', !$('seg-mode').hidden && $('modepick').classList.contains('open'),
      'hidden=' + $('seg-mode').hidden);
    /* 展开时底色要跟收起时**不一样**（看得出"是我点的它"；只断言"有变化"，不锁具体色值） */
    const bgOpen = getComputedStyle($('btn-mode')).backgroundColor;
    step('展开时按钮底色变深（有可见的激活反馈）', bgOpen !== bgClosed,
      '收起=' + bgClosed + ' 展开=' + bgOpen);
    const mb = $('btn-mode').getBoundingClientRect();
    const mm = $('seg-mode').getBoundingClientRect();
    step('菜单贴在按钮下方、没出窗口',
      mm.top >= mb.bottom - 1 && mm.right <= innerWidth - 0.5 && mm.left >= 0 && mm.height > 60,
      '按钮底=' + Math.round(mb.bottom) + ' 菜单顶/右/高=' + Math.round(mm.top) + '/'
      + Math.round(mm.right) + '/' + Math.round(mm.height) + ' 窗口宽=' + innerWidth);
    $('btn-mode').click(); await sleep(150);
    step('再点按钮 → 菜单收起', $('seg-mode').hidden, 'hidden=' + $('seg-mode').hidden);
    $('btn-mode').click(); await sleep(120);
    $('status').click(); await sleep(180);          // 点菜单外面（用状态栏那块空白）
    step('点外面 → 菜单收起', $('seg-mode').hidden, 'hidden=' + $('seg-mode').hidden);
    $('btn-mode').click(); await sleep(120);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    step('按 Esc → 菜单收起', $('seg-mode').hidden, 'hidden=' + $('seg-mode').hidden);
  }

  /* ---------- 1. 进入习题练习 ---------- */
  /* ★ 模式菜单里选中一项 = **打开「新对局」设置面板**（2026-10-14 用户要求），
     模式要等面板里点「开始」才真的切 —— 所以这里分两步验：
     ① 点菜单项 → 面板开、类型预选对、**模式还没变**、菜单已收起；
     ② 点「开始」 → 才真的进习题练习，按钮文字跟着变。 */
  seg('seg-mode', 'tsumego');
  await sleep(400);
  step('菜单里选「习题练习」→ 弹出新对局面板、类型已预选、菜单收起',
    $('newgame').classList.contains('open') && lit('seg-ntype') === 'tsumego' && $('seg-mode').hidden,
    '面板开=' + $('newgame').classList.contains('open') + ' 类型=' + lit('seg-ntype')
    + ' 菜单收起=' + $('seg-mode').hidden);
  step('点按钮**不**立刻切模式（要等点「开始」）',
    !state.tsumego, 'mode=' + settings.mode + ' tsumego=' + !!state.tsumego);
  step('习题模式下「规则 / 贴目」收起来了，习题专用的行露出来',
    $('row-rules').hidden && $('row-komi').hidden
    && !$('row-tsplace').hidden && !$('row-tsfirst').hidden
    && !$('row-tsaicolor').hidden
    /* ★ 2026-10-17：「题目目标」那一行（row-tsgoal）随判定/提示一起删了 ——
       顺手补一条"它确实没了"的断言：留着旧的 $('row-tsgoal').hidden 会直接抛
       TypeError（Cannot read properties of null）—— 这次就是被它拦下来的。 */
    && !$('row-tsgoal'),
    '规则隐藏=' + $('row-rules').hidden + ' 贴目隐藏=' + $('row-komi').hidden
    + ' KATAGO执哪方这一行=' + (!$('row-tsaicolor').hidden ? '显示了' : '★没显示')
    + ' 目标行还在=' + !!$('row-tsgoal'));
  /* 面板里那个「框架距离」数字框必须还是窄的 —— 2026-10-14 瘦身练习卡时，
     我删 CSS 顺手把它那条「#row-tsframe #inp-tdist{width:58px}」一起删了
     （它跟卡片里那排控件长得像，但属于**面板**）。判据盯住真实宽度，别只看"元素在"。 */
  step('面板的「框架距离」输入框还是窄的（没被拉满整行）',
    $('inp-tdist').getBoundingClientRect().width <= 70,
    '宽=' + Math.round($('inp-tdist').getBoundingClientRect().width) + 'px（应 ≤70）');

  /* 顺手验「取消」：模式要还原（面板里其它项是即时生效的，但模式不能留着） */
  $('m-cancel').click(); await sleep(300);
  step('点「取消」→ 面板关掉、模式还原、顶栏亮回原样',
    !$('newgame').classList.contains('open') && settings.mode === 'play' && lit('seg-mode') === 'play' && !state.tsumego,
    'mode=' + settings.mode + ' 顶栏=' + lit('seg-mode'));
  /* ★ 按钮文字只认**真实模式**：上面那次点的是"习题练习"、又被「取消」掉了，
     按钮必须还写着「人机对弈」—— 要是被"点了哪一项"带跑，这里就会露馅。 */
  step('点「取消」→ 按钮文字仍是「人机对弈」（没被预选值带跑）',
    ($('mode-cur').textContent || '').trim() === '人机对弈' && lit('seg-mode') === 'play',
    '按钮=' + JSON.stringify($('mode-cur').textContent) + ' 菜单亮=' + lit('seg-mode'));

  seg('seg-mode', 'tsumego'); await sleep(300);
  $('m-start').click(); await sleep(700);
  step('点「开始」才真的进入习题练习', settings.mode === 'tsumego' && !!state.tsumego, 'mode=' + settings.mode);
  step('顶栏开关点亮', lit('seg-mode') === 'tsumego', lit('seg-mode'));
  step('模式切换后按钮文字跟着变（习题练习）',
    ($('mode-cur').textContent || '').trim() === '习题练习',
    '按钮=' + JSON.stringify($('mode-cur').textContent));
  step('练习卡出现且停在摆题阶段',
    !$('ts-card').hidden && !$('ts-setup-group').hidden && $('ts-solve-group').hidden,
    '卡片隐藏=' + $('ts-card').hidden + ' 阶段=' + (state.tsumego && state.tsumego.phase));
  step('棋盘清空、手顺为空', state.setup.length === 0 && state.moves.length === 0,
    'setup=' + state.setup.length + ' moves=' + state.moves.length);

  /* ---------- 1b. KATAGO 执哪一方：位置 + 两处同步（2026-10-14 用户报"没看到"） ----------
     ★ 原来这一行放在练习卡的**解题组**里 —— 摆题阶段看不到，
       而多数人是先在「新对局」面板里找设置。现在两处都有，且写同一个值。 */
  {
    step('摆题阶段就能看到「KATAGO 执黑/执白」',
      !$('ts-row-aicolor').hidden && state.tsumego.phase === 'setup',
      '阶段=' + state.tsumego.phase + ' 行隐藏=' + $('ts-row-aicolor').hidden);
    const d0 = settings.taicolor;
    seg('seg-tkaicolor', 'b'); await sleep(250);
    step('面板改「KATAGO 执黑」→ 练习卡跟着变、说明文字也跟着说"它先动手"',
      settings.taicolor === 'b' && lit('seg-tsaicolor') === 'b'
      && /它先动手/.test($('ts-role-note').textContent),
      'taicolor=' + settings.taicolor + ' 卡上亮=' + lit('seg-tsaicolor')
      + ' 说明=' + JSON.stringify(($('ts-role-note').textContent || '').slice(0, 26)));
    seg('seg-tsaicolor', 'w'); await sleep(250);
    step('练习卡改回「执白」→ 面板也跟着回来（同一个值）',
      settings.taicolor === 'w' && lit('seg-tkaicolor') === 'w',
      'taicolor=' + settings.taicolor + ' 面板亮=' + lit('seg-tkaicolor'));
    step('说明文字回到"你解题"口径', /你解题/.test($('ts-role-note').textContent),
      JSON.stringify(($('ts-role-note').textContent || '').slice(0, 30)));
    if (settings.taicolor !== d0) { settings.taicolor = d0; syncTkaicolorUI(); }
  }

  /* ---------- 1.5 左栏布局 + 状态栏（2026-10-12 用户报的两个界面问题）----------
     ★ 项目纪律：视觉问题必须**量真实几何**，不能只查 hidden === false
       （不然"提示浮层盖在棋盘正中间"那种会被"✓ 通过"放过去）。
       这里量每张卡的真实矩形、两两判重叠；再量「开始解题」按钮是否真在视口里。
     ★ 2026-10-23：两张讲解卡合并成一张 → 左栏可见卡从 4 张变 3 张
       （习题练习 / 手数 / 讲解卡）。卡数写死在这里，再拆再合都要跟着改。 */
  step('进模式时状态栏没有冒说明文字',
    !/先在棋盘上摆出题目的初始局面/.test($('status').textContent),
    JSON.stringify(($('status').textContent || '').slice(0, 40)));
  {
    const cards = [...document.querySelectorAll('.left > .card')].filter(c => !c.hidden);
    const bx = cards.map(c => {
      const r = c.getBoundingClientRect();
      const t = c.querySelector('.card-title');
      return { n: (t ? t.textContent : '?').replace(/\\s+/g, '').slice(0, 6), top: r.top, bottom: r.bottom, h: r.height };
    });
    const hits = [];
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
      if (bx[i].top < bx[j].bottom && bx[j].top < bx[i].bottom) hits.push(bx[i].n + '↔' + bx[j].n);
    }
    step('左栏 3 张卡都在且互不重叠', bx.length === 3 && hits.length === 0,
      bx.map(b => b.n + '=' + Math.round(b.h) + 'px').join(' · ') + (hits.length ? ' ★重叠:' + hits.join(',') : ''));
    step('每张卡高度都够（没有被压扁）', bx.length === 3 && bx.every(b => b.h >= 40),
      bx.length ? Math.min.apply(null, bx.map(b => Math.round(b.h))) + 'px 最小' : '（没量到卡）');
    const sb = $('btn-ts-start').getBoundingClientRect();
    step('「开始解题」按钮可见且在视口内',
      sb.height > 10 && sb.width > 10 && sb.top >= 0 && sb.bottom <= innerHeight,
      '按钮 ' + Math.round(sb.width) + '×' + Math.round(sb.height)
      + ' top=' + Math.round(sb.top) + ' bottom=' + Math.round(sb.bottom) + ' 视口高=' + innerHeight);
    /* 框架 / 框距 那一组：− / 4 / + 必须在**同一行**，且不越过卡片右边界。
       ★ 为什么量这个：第一版把它们塞成一行，卡片只有 ~200px 宽 →
         最右边的「+」被挤到第二行（截图里一眼看出来的）。 */
    const mi = $('btn-ts-dist-less').getBoundingClientRect();
    const pl = $('btn-ts-dist-more').getBoundingClientRect();
    const cd = $('ts-card').getBoundingClientRect();
    step('练习卡「框距 −/+」同一行、没有溢出卡片',
      Math.abs(mi.top - pl.top) < 2 && pl.right <= cd.right + 0.5 && mi.left >= cd.left - 0.5,
      '−top=' + Math.round(mi.top) + ' +top=' + Math.round(pl.top)
      + ' 按钮右=' + Math.round(pl.right) + ' 卡右=' + Math.round(cd.right));
    /* 「落子」那一行必须是**一行**里。
       ★ 判据是**行高**，不是"label 与按钮的 top 相等" —— 两者高度本来就不同
         （label 是 12px 文字、seg 里是 26px 按钮，align-items:center 会让 top 差几像素）。
         第一版按 top 比，结果报了个假 ★（label top=185 / 按钮 top=181，其实同一行）。
         本项目自己的教训："判据比被测代码更容易写错"——这次又踩了一次。 */
    const rowL = [...document.querySelectorAll('#ts-card .ts-row')].find(r => /落子/.test(r.textContent));
    const rowH = rowL ? rowL.getBoundingClientRect().height : 0;
    step('练习卡「落子」行没有换行（行高 = 单行）', !!rowL && rowH <= 32,
      '行高=' + Math.round(rowH) + 'px（单行约 26，换行会到 ~52）');

    /* ---------- 1.6 卡片瘦身（2026-10-14 用户要求）----------
       删了三处文字、把框架与框距并成一排。判据都用**量出来的几何**，
       不查"某个 id 还在不在"——不然改个 id 就能让测试假绿。 */
    step('「摆题中 / 解题中」那行文字已删掉', !$('ts-phase'),
      $('ts-phase') ? '★ 还在：' + $('ts-phase').textContent : '（元素不存在 ✓）');
    /* ★ 2026-10-14 第二版：卡上不该再有任何"会自己冒出来/变长"的文字了。
       上一次留了一条「#ts-solve-note」（已走 N 手 · …/判定结论），用户明确要求也删掉。 */
    step('练习卡上没有任何动态文字（说明/提示都清了）',
      document.querySelectorAll('#ts-card .ts-note').length === 0
      && !$('ts-solve-note') && !$('ts-setup-note') && !$('ts-phase')
      && document.querySelectorAll('#ts-card .ts-hint-sm').length === 0,
      'ts-note=' + document.querySelectorAll('#ts-card .ts-note').length + ' 条 · '
      + 'solve-note=' + !!$('ts-solve-note') + ' · setup-note=' + !!$('ts-setup-note')
      + ' · hint-sm=' + document.querySelectorAll('#ts-card .ts-hint-sm').length);
    /* 框架与框距在同一行（2026-10-31 起是「双列」的右半格）：量它们**同一行**（top 差 < 2）
       且整行没越出卡片。 */
    const frSeg = $('seg-tsframe').getBoundingClientRect();
    const rowF = $('seg-tsframe').closest('.ts-row');
    const rowFR = rowF ? rowF.getBoundingClientRect() : null;
    step('框架与框距并成一排（同一行、且没溢出卡片）',
      !!rowFR && Math.abs(frSeg.top - mi.top) < 2
      && rowFR.height <= 32 && rowFR.right <= cd.right + 0.5,
      '框架 top=' + Math.round(frSeg.top) + ' 框距 top=' + Math.round(mi.top)
      + ' · 行高=' + (rowFR ? Math.round(rowFR.height) : '?')
      + ' · 行右=' + (rowFR ? Math.round(rowFR.right) : '?') + ' 卡右=' + Math.round(cd.right));
    step('练习卡内容没有被撑出滚动条',
      $('ts-card').scrollHeight <= $('ts-card').clientHeight + 1,
      'scrollH=' + $('ts-card').scrollHeight + ' clientH=' + $('ts-card').clientHeight);

    /* ---------- 1.65 先手：常驻一行（2026-10-16 加；2026-10-17 那格「目标」被删了）----------
       用户 2026-10-16 报"卡片上看不到这道题谁先走"→ 做成常驻行。
       判据全用**量出来的几何**与**真读到的文字**，不查"某个 id 还在不在"。 */
    {
      const rowF1 = $('seg-tsfirst').closest('.ts-row');
      const segF = $('seg-tsfirst');
      const cd1 = $('ts-card').getBoundingClientRect();
      const rr = rowF1 ? rowF1.getBoundingClientRect() : null;
      step('摆题阶段就能看到「先手」行（常驻，不随阶段藏进解题组）',
        !!rowF1 && rowF1.offsetHeight > 0 && segF.offsetHeight > 0,
        '行高=' + (rr ? Math.round(rr.height) : '?') + ' 开关组高=' + segF.offsetHeight);
      step('「先手」两个按钮的文字 = 黑先 / 白先',
        [...segF.querySelectorAll('button')].map(b => b.textContent.trim()).join('|') === '黑先|白先',
        [...segF.querySelectorAll('button')].map(b => b.textContent.trim()).join('|'));
      step('「先手」那一行不换行、也没溢出卡片',
        !!rr && rr.height <= 32 && rr.right <= cd1.right + 0.5,
        '行高=' + (rr ? Math.round(rr.height) : '?') + ' 行右=' + (rr ? Math.round(rr.right) : '?')
        + ' 卡右=' + Math.round(cd1.right));
      /* 高亮只认 settings.tfirst 这一个口径（跟顶栏模式按钮同一个道理：
         面板那边写的是"预设置"，卡片这边是"当场这道题"，两边都得看同一个值） */
      step('「先手」高亮与 settings.tfirst 一致',
        lit('seg-tsfirst') === settings.tfirst, '高亮=' + lit('seg-tsfirst') + ' tfirst=' + settings.tfirst);
      /* ★ 2026-10-17 用户要求删掉「题目目标 / 提示 / 判定」→ 补一条"真的没了"的断言。
         只查 id 不存在是不够的（可能换个名字又加回来），所以同时查卡片正文里没有「目标」二字。 */
      step('卡上不再有「目标」那一格（随判定 / 提示一起删掉）',
        !$('ts-goal-txt') && !/目标/.test($('ts-card').textContent || ''),
        'ts-goal-txt=' + !!$('ts-goal-txt') + ' 卡正文含「目标」=' + /目标/.test($('ts-card').textContent || ''));
    }
    /* ★ 2026-10-31 用户选「C + A 组合」→ 双列：两格等宽、两格开关组左边缘对齐、
       都不越卡片右边界。只数行数不够 —— "看着对齐"必须量出来。 */
    {
      const cd2 = $('ts-card').getBoundingClientRect();
      const c0 = $('seg-tsfirst').closest('.ts-cell').getBoundingClientRect();
      const c1 = $('ts-row-aicolor').getBoundingClientRect();
      const s0 = $('seg-tsfirst').getBoundingClientRect();
      const s1 = $('seg-tsaicolor').getBoundingClientRect();
      step('双列·左格与右格等宽（差 ≤ 2px）',
        Math.abs(c0.width - c1.width) <= 2, '左格=' + Math.round(c0.width) + ' 右格=' + Math.round(c1.width));
      /* ★ 别拿两格的绝对 left 比 —— 右格本来就在右半边，比出来永远差一个格宽（我第一版就这么写错了）。
         要比的是**组相对自己格子左边缘的偏移**：两格的 label 等宽，这个偏移就必须相等。 */
      const off0 = s0.left - c0.left, off1 = s1.left - c1.left;
      step('双列·两格的开关组相对格子起点同偏移（差 ≤ 1px）—— 这就是"表格感"的来源',
        Math.abs(off0 - off1) <= 1,
        '左格偏移=' + Math.round(off0) + ' 右格偏移=' + Math.round(off1)
        + '（绝对 left ' + Math.round(s0.left) + ' / ' + Math.round(s1.left) + '）');
      step('双列·两个开关组都没溢出卡片右边界',
        s0.right <= cd2.right + 0.5 && s1.right <= cd2.right + 0.5,
        '左组右=' + Math.round(s0.right) + ' · 右组右=' + Math.round(s1.right) + ' · 卡右=' + Math.round(cd2.right));
    }
    /* ★ C 方案另外两条：落子那组开关拉满整行、「开始解题」独占一行宽度（清空缩在右边）。
       这两条是"右侧不再留白 + 主操作突出"的判据。
       ★ 2026-10-31 晚：落子那行最右边多了一个**纯图标**的旋转按钮（用户要求），
         所以"铺满"不能再拿 seg 的右边缘量（它现在离卡片右边还有 36px = 按钮 + 间距），
         改量**这一行最右边那个元素**（= 旋转按钮）。 */
    {
      const cd3 = $('ts-card').getBoundingClientRect();
      const sc = $('seg-tscolor').getBoundingClientRect();
      const rt = $('btn-ts-rotate').getBoundingClientRect();
      const st = $('btn-ts-start').getBoundingClientRect();
      const cl = $('btn-ts-clear').getBoundingClientRect();
      step('落子那一行铺满整行（最右边的旋转按钮离卡片右边 ≤ 16px）',
        cd3.right - rt.right <= 16, '差=' + Math.round(cd3.right - rt.right));
      step('旋转按钮在「擦」右边、且同一行（不是被挤到第二行去了）',
        rt.left >= sc.right - 0.5 && Math.abs(rt.top - sc.top) <= 2,
        '按钮 left=' + Math.round(rt.left) + ' · 开关组右=' + Math.round(sc.right)
        + ' · top 差=' + Math.round(Math.abs(rt.top - sc.top)));
      step('「开始解题」明显宽于「清空」（主操作占满一行，次按钮缩窄）',
        st.width > cl.width * 2, '开始=' + Math.round(st.width) + ' 清空=' + Math.round(cl.width));
    }
    /* ★ 每个阶段各自的控件行数固定 —— 这是"高度不变"的结构基础，所以直接量它。
       （原先「目标」单占一行 → 摆题 4 行/解题 5 行，卡片会差 34px。）
       ★ 2026-10-14 加「题集」行、2026-10-16 加「先手 + 目标」行 → 都常驻、两阶段仍相等。
       ★ 2026-10-17 删掉「题目目标」后**行数不变**（那一行还在，只是少了一格内容）→ 6。
       ★ 2026-10-31 用户选「C + A 组合」：先手/KATAGO、框架/框距 各并成一行双列 → **5 行**。 */
    const visRows = [...document.querySelectorAll('#ts-card .ts-row')]
      .filter(r => r.offsetHeight > 0).length;
    step('摆题阶段：可见的控件行 = 5（题集 / 先手+KATAGO / 框架+框距 / 落子 / 按钮）',
      visRows === 5, '可见行数=' + visRows);
    snapCardH('摆题');
  }

  /* ---------- 1.7 顶栏那行状态文字：位置（刷新右边）+ 颜色（主题绿）----------
     2026-10-14 用户要求把「引擎灯左边」那句挪到「刷新」右边并改成绿色。
     ★ 判据用**量出来的几何**和**计算后的颜色**，不去读 CSS 源码 ——
       读源码的话，改个选择器优先级就能让测试假绿而界面没变。 */
  {
    const st = $('status').getBoundingClientRect();
    const rf = $('btn-engine-refresh').getBoundingClientRect();
    const nw = $('btn-new').getBoundingClientRect();
    step('状态文字在「刷新」右边、且没跑到「新对局」后面去',
      st.left >= rf.right - 0.5 && st.right <= nw.left + 0.5 && st.width > 10,
      '状态 left=' + Math.round(st.left) + ' 刷新右=' + Math.round(rf.right)
      + ' 状态右=' + Math.round(st.right) + ' 新对局左=' + Math.round(nw.left));
    /* 拿一个临时探针把 var(--accent) 解析成 rgb 来比 —— 直接写死 'rgb(47,111,94)'
       会因为改了主题色而失效，比"和主题色一致"这个真实意图要脆。 */
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const got = getComputedStyle($('status')).color;
    step('状态文字的颜色 = 主题绿（--accent）', got === accent,
      '状态=' + got + ' 主题绿=' + accent);
  }

  /* ---------- 2. 摆题：自由摆棋（含真鼠标事件与右键擦子） ---------- */
  seg('seg-tscolor', 'b');
  await sleep(150);
  /* 第一颗用真点击 —— 验「画布点击在摆题阶段分流到 placeSetupStone」这条路 */
  clickAt(BLACK[0][0], BLACK[0][1], 0);
  await sleep(200);
  step('点棋盘能落子（走的是摆题分流）', state.setup.length === 1, 'setup=' + state.setup.length);
  /* 其余直接调（同一个函数，省时间） */
  for (let i = 1; i < BLACK.length; i++) placeSetupStone(BLACK[i][0], BLACK[i][1], false);
  seg('seg-tscolor', 'w');
  await sleep(150);
  for (const [x, y] of WHITE) placeSetupStone(x, y, false);
  await sleep(200);
  step('黑白各摆完', state.setup.length === BLACK.length + WHITE.length,
    'setup=' + state.setup.length + '（应为 ' + (BLACK.length + WHITE.length) + '）');
  step('摆的子没进手顺（关键：初局必须在 setup）', state.moves.length === 0, 'moves=' + state.moves.length);

  /* 右键擦一颗再补回来 */
  const n0 = state.setup.length;
  clickAt(WHITE[3][0], WHITE[3][1], 2);
  await sleep(200);
  const n1 = state.setup.length;
  placeSetupStone(WHITE[3][0], WHITE[3][1], false);
  await sleep(150);
  step('右键擦子', n1 === n0 - 1 && state.setup.length === n0, n0 + ' → ' + n1 + ' → ' + state.setup.length);

  /* ---------- 2.5 交替摆棋：颜色按钮藏起来，改由行内小字说「下一子」 ----------
     ★ 2026-10-14 卡片瘦身时删掉了原来那条摆法说明段落，所以"下一子是什么颜色"
       现在只剩这个行内小字（#ts-alt-next）能说 —— 它是**操作必需**的，必须验。 */
  {
    const tm0 = settings.tmode;
    settings.tmode = 'alt'; syncTsumegoUI(); await sleep(120);
    step('交替摆棋：颜色按钮收起来、行内小字说出「下一子」',
      $('seg-tscolor').hidden && !$('ts-alt-next').hidden && /下一子/.test($('ts-alt-next').textContent),
      '按钮隐藏=' + $('seg-tscolor').hidden + ' 小字=' + JSON.stringify($('ts-alt-next').textContent));
    snapCardH('交替摆棋');
    settings.tmode = tm0; syncTsumegoUI(); await sleep(120);
    step('改回自由摆棋：颜色按钮回来、行内小字收起来',
      !$('seg-tscolor').hidden && $('ts-alt-next').hidden,
      '按钮隐藏=' + $('seg-tscolor').hidden + ' 小字隐藏=' + $('ts-alt-next').hidden);
  }

  /* ---------- 3. 框架 ---------- */
  settings.tframe = 'auto'; settings.tdist = 4;
  draw();
  const fr = frameRect();
  /* 棋子外接矩形 x 14..17 / y 1..4，外扩 4 路并 clamp 到盘内 → 10..18 / 0..8 */
  step('框架 = 棋子外接矩形外扩 4 路',
    fr && fr.x0 === 10 && fr.y0 === 0 && fr.x1 === 18 && fr.y1 === 8,
    fr ? JSON.stringify(fr) : 'null');
  settings.tdist = 2; draw();
  const fr2 = frameRect();
  step('改框距后框架跟着变', fr2 && fr2.x0 === 12 && fr2.y1 === 6, JSON.stringify(fr2));
  settings.tdist = 4; draw();

  /* ---------- 4. 先手设置 + 开始解题 ---------- */
  settings.tfirst = 'b';
  state.myColor = 'b';
  tsStartSolve();
  await sleep(400);
  step('进入解题阶段', state.tsumego.phase === 'solve' && !$('ts-solve-group').hidden,
    '阶段=' + state.tsumego.phase);
  step('轮到黑（先手）', sideToMove(state.viewAt) === 'b', sideToMove(state.viewAt));

  /* 解题阶段的练习卡也要量（新加的「KATAGO 执黑/执白」行）——
     左栏卡片只有 ~200px 宽，多一行就可能换行/溢出。 */
  {
    const cdR = $('ts-card').getBoundingClientRect();
    const rowR = $('ts-row-aicolor').getBoundingClientRect();
    const segR = $('seg-tsaicolor').getBoundingClientRect();
    step('「KATAGO 执黑/执白」行在卡片内、不换行',
      segR.right <= cdR.right + 0.5 && rowR.height <= 32,
      '行高=' + Math.round(rowR.height) + ' seg右=' + Math.round(segR.right) + ' 卡右=' + Math.round(cdR.right));
    step('解题阶段练习卡也没被撑出滚动条',
      $('ts-card').scrollHeight <= $('ts-card').clientHeight + 1,
      'scrollH=' + $('ts-card').scrollHeight + ' clientH=' + $('ts-card').clientHeight);
    /* 右栏「对局信息」也要按习题口径显示 ——
       ★ 这一条是**看截图**才发现的：它原来把题目摆子写成「让 13 子」、
         贴目写 settings.komi（而实际发给引擎的是 0）。底栏状态行当时已经修了，
         但右栏是另一个渲染处。 */
    /* ★ 2026-10-25 改判据：贴目不再是固定的 0，而是**配平贴目**（tsKomi）。
       两种合法状态：① 探针还没落地 → 写「配平中…」（2026-10-28 起；以前写 0，
       用户会以为这题不贴目）；② 已落地 → 与 bal.komi 一致。
       （判据写成"跟真实状态一致"，而不是"必须等于某个数" —— 配平值取决于引擎对这道题的评估。） */
    const balNow = state.tsumego.bal;
    const komiTxt = $('info-komi').textContent;
    step('右栏「对局信息」按习题口径显示（题目摆子 / 贴目 = 配平值，未配平时写「配平中…」）',
      /题目摆子/.test($('info-hc').textContent)
      && (balNow ? komiTxt === String(balNow.komi) : komiTxt === '配平中…'),
      '贴目=' + komiTxt + ' · 配平=' + (balNow ? balNow.komi + '（lead0 ' + balNow.lead0.toFixed(1) + '）' : '未配平'));

    /* ★ 2026-10-25 P0「配平贴目」的纯函数判据（不需要真引擎，也不会改局面）。
       ★★ 2026-10-27 按**重写后**的算法改判据（用户报「框距 2/3 时配平后胜率差别仍很大」）：
         ① 网格 = 整数或半整数（不是强制 +0.5）   ② 解题阶段用配平值 / 摆题恒 0
         ③ SIDETOMOVE → 黑方视角                  ④ 上限按「引擎实际看到的那张盘」
         ⑤ 摆子 / **框距** / 裁切开关 三者都进签名（框距那条正是用户报的 bug）
         ⑥ noteBalProbe 的门槛 + 「改框距后必须能重折」（旧版在这里死锁）
         ⑦ noteBalWinrate 的目差残差优先 / 步长减半 / 轮次上限 / 不倒退 */
    {
      /* ⚠️ 先把裁切关掉再取签名/算上限：裁切面积小的时候（框距 1 → 0.9×16=14）
         mkBal(20) 会被上限截断，断言基准就不稳了。整盘上限恒 178。
         收工前一律还原（tc0 / tf0 / td0 在下面存着）。 */
      const N0 = N, tc0 = settings.tcrop, td0 = settings.tdist, tf0 = settings.tframe;
      settings.tcrop = 'off';
      const sig0 = setupSig();
      /* 网格：整数与半整数都要在。旧版强制 +0.5 把整数点全丢了，而裁切小盘上
         正解恰好落在整数点（实测 38.0 → 40%、38.5 → 10.7%）。 */
      const b182 = mkBal(18.2, sig0);          // round(36.4)/2 = 18
      const b186 = mkBal(18.6, sig0);          // round(37.2)/2 = 18.5
      const b188 = mkBal(18.9, sig0);          // round(37.8)/2 = 19
      const keepPh = state.tsumego.phase, keepBal = state.tsumego.bal, keepProbe = state.tsumego.probe;
      const keepH0 = state.history.slice(), keepL0 = state.leads.slice(), keepHV0 = state.histVisits.slice();
      state.tsumego.phase = 'solve'; state.tsumego.bal = b182;
      const kSolve = tsKomi();
      state.tsumego.phase = 'setup';
      const kSetup = tsKomi();
      state.tsumego.phase = keepPh; state.tsumego.bal = keepBal;
      const leadW = blackLeadFrom({ root: { currentPlayer: 'W', scoreLead: -7 } }, 0);
      const leadB = blackLeadFrom({ root: { currentPlayer: 'B', scoreLead: 7 } }, 0);
      /* 上限：**按引擎实际看到的那张盘**（2026-10-27）。
         整盘 = 40×N²/81（9 路 40 / 19 路 178）；裁切 = 0.9×W×H（8×9 → 65）。
         N 是模块级 let，临时改完必须还原。 */
      N = 9; const cap9 = tsBalMax();
      N = 19; const cap19 = tsBalMax();
      const capHi = mkBal(80, sig0).komi, capLo = mkBal(-80, sig0).komi;
      N = N0;
      /* 裁切分支：强制框架开着，否则 cropR = null，这一档就白验了 */
      settings.tcrop = 'on'; settings.tframe = 'auto'; settings.tdist = 2;
      const cropR = tsCropRect();
      const capCrop = tsBalMax();
      /* 签名：摆子 / 框距 / 裁切开关 —— 三者任一变化都必须换口径 */
      const sigT2 = setupSig();                 // 框距 2、裁切
      settings.tdist = 3; const sigT3 = setupSig();
      settings.tcrop = 'off'; const sigFull = setupSig();
      settings.tcrop = 'off'; settings.tdist = td0; settings.tframe = tf0;
      state.setup.push({ x: 0, y: 0, color: 'b' });
      const sig1 = setupSig();
      state.setup.pop();
      /* noteBalProbe：三条必须被拦的路 + 一条必须通过的路 + 一条「改框距后重折」 */
      const keepSig = anaSigAtSend;
      state.tsumego.phase = 'solve';
      /* 已按**当前口径**配过 → 同一份报文不再重折（防自引用） */
      state.tsumego.bal = mkBal(20, sig0); state.tsumego.probe = null;
      anaSigAtSend = sig0;
      const dup = noteBalProbe({ root: { currentPlayer: 'B', scoreLead: -30, visits: 200 } }, 0);
      const dupKomi = state.tsumego.bal.komi;
      state.tsumego.bal = null; state.tsumego.probe = null;
      anaSigAtSend = sig0;
      const lowV = noteBalProbe({ root: { currentPlayer: 'B', scoreLead: 20, visits: 20 } }, 0);
      anaSigAtSend = 'different-sig';
      const badSig = noteBalProbe({ root: { currentPlayer: 'B', scoreLead: 20, visits: 200 } }, 0);
      anaSigAtSend = sig0;
      const goodV = noteBalProbe({ root: { currentPlayer: 'B', scoreLead: 20, visits: 200 } }, 0);
      const foldedKomi = state.tsumego.bal ? state.tsumego.bal.komi : null;
      /* ★ 改框距之后：bal 的 sig 已经过期，但 tsKomi() 还拿着旧贴目（它故意不按 sig 回退）。
         旧版 noteBalProbe 的门是「tsKomi() !== 0 就 return」→ 永远不再探针 = 死锁。
         现在门是「tsKomi() !== 0 **且 bal.sig 与当前一致**」→ 这里必须能重新折出来。 */
      state.tsumego.bal = mkBal(20, 'stale-sig'); state.tsumego.probe = null;
      anaSigAtSend = setupSig();
      const reFold = noteBalProbe({ root: { currentPlayer: 'B', scoreLead: -12, visits: 200 } }, 0);
      const reKomi = state.tsumego.bal ? state.tsumego.bal.komi : null;
      state.tsumego.phase = keepPh; state.tsumego.bal = keepBal;
      state.tsumego.probe = keepProbe; anaSigAtSend = keepSig;
      state.history = keepH0; state.leads = keepL0; state.histVisits = keepHV0;
      settings.tcrop = tc0;
      step('配平：lead0 取整到「整数 / 半整数」网格（18.2→18、18.6→18.5、18.9→19）',
        b182.komi === 18 && b186.komi === 18.5 && b188.komi === 19,
        b182.komi + ' / ' + b186.komi + ' / ' + b188.komi);
      step('配平：解题阶段 tsKomi() 用配平值', kSolve === 18, 'tsKomi=' + kSolve);
      step('配平：摆题阶段 tsKomi() 恒 0（探针口径，防自引用）', kSetup === 0, 'tsKomi=' + kSetup);
      step('配平：scoreLead 从 SIDETOMOVE 换算成黑方视角（白走 −7 → 黑 +7 / 黑走 +7 → 黑 +7）',
        leadW === 7 && leadB === 7, '白走=' + leadW + ' 黑走=' + leadB);
      step('配平：上限按「哪张盘」分档 —— 整盘 9 路 40 / 19 路 178，裁切 0.9×W×H',
        cap9 === 40 && cap19 === 178
        && (!cropR || capCrop === Math.round(0.9 * cropR.w * cropR.h)),
        '9路=' + cap9 + ' 19路=' + cap19
        + ' 裁切=' + (cropR ? cropR.w + '×' + cropR.h + '→' + capCrop : '无框'));
      step('配平：整盘 19 路 +80 目不再被截到 40（80 / −80）',
        capHi === 80 && capLo === -80, '+80→' + capHi + ' −80→' + capLo);
      step('配平：摆子一变 setupSig 就变（旧配平自动失效）', sig1 !== sig0, '变了=' + (sig1 !== sig0));
      /* ★★ 用户 2026-10-27 报障的根因就在这条：旧版签名只带「裁切开/关」，
         改框距 → 引擎换了张盘 → 贴目没跟着换（拿 10×11 的值跑 8×9 的盘）。 */
      step('配平：改框距 → setupSig 就变（旧版改框距不重算 = 用户报的那个 bug）',
        sigT2 !== sigT3, '框距2 与 框距3 相同？' + (sigT2 === sigT3));
      step('配平：裁切开/关 → setupSig 也变（整盘与裁切各算各的贴目）',
        sigFull !== sigT2, '整盘与裁切相同？' + (sigFull === sigT2));
      step('配平：已按当前口径配平 → 同一份报文不再重折（防自引用）',
        dup === false && dupKomi === 20, '重折=' + dup + ' komi=' + dupKomi);
      step('配平：中间报告搜索量不够（20 步）不认', lowV === false, 'noteBalProbe=' + lowV);
      step('配平：发请求时的摆子签名对不上就不认（摆子刚改过）', badSig === false, 'noteBalProbe=' + badSig);
      step('配平：够 200 步 + 签名对上 → 立刻折出贴目（+20 目 → 20）',
        goodV === true && foldedKomi === 20, 'noteBalProbe=' + goodV + ' komi=' + foldedKomi);
      step('配平：框距变了（旧 bal 的 sig 过期）→ 新一次探针要能重折（旧版在这里死锁）',
        reFold === true && reKomi === -12, '重折=' + reFold + ' komi=' + reKomi);

      /* ⑨⑩ freeEngineForProbe：只该在「在飞的那趟算的不是现在这个局面」时掐。
         锁的是 2026-10-25 实测出来的死锁（_trash/_diag_bal_warm2.mjs）：
         翻题遗留的分析占着引擎 20+ 秒 → sig 对不上、整条被拒，而 runAnalysis 见 anaBusy
         又不肯发新请求 → 探针永远排不上，配平等于装饰（实测 25 秒里 probe 一直是 null）。
         ⚠️ 这里只验**返回值**（= 决策），不数 cancel 被调了几次：window.api 是 contextBridge
           暴露的，整个对象被冻结，赋值桩不上去（试过，改写静默失败 → 计数恒 0）。
         真"掐一下"也无害 —— 在飞的那趟走 cancelled 分支，自己会重排。 */
      const keepBusy2 = anaBusy;
      anaBusy = false; anaSigAtSend = 'different-sig';
      const fpIdle = freeEngineForProbe();
      anaBusy = true; anaSigAtSend = setupSig();
      const fpSame = freeEngineForProbe();
      anaBusy = true; anaSigAtSend = 'different-sig';
      const fpStale = freeEngineForProbe();
      anaBusy = keepBusy2; anaSigAtSend = keepSig;
      step('配平：没在飞 / 在飞的**就是当前局面** → 都不许掐（别掐掉现成答案）',
        fpIdle === false && fpSame === false, '没在飞=' + fpIdle + ' 同一局面=' + fpSame);
      step('配平：在飞的那趟算的是**别的局面** → 掐掉它，把引擎让给探针',
        fpStale === true, 'freeEngineForProbe=' + fpStale);

      /* ⑪~⑰ noteBalWinrate：第二级校正（2026-10-27 **重写**成「目差残差优先」）。
         锁住五件事，每条都是实测逼出来的（数据见 习题配平方案.md §14）：
         ① **目差残差优先**：裁切后第一级就偏 7~9 目，旧版只许 3 目根本够不着；
         ② 目差归零（|lead|<1）才退回胜率通道；
         ③ 靠近（|wr−50%|<35pp）步长**减半** —— 窄口处真实斜率是估的两倍，整步会跨过去；
         ④ 最多 6 轮（二分把 4.5 目压到半目要 3 步；fixN 太小会卡在半路）；
         ⑤ **不倒退** —— 本轮比上轮更差就退回上轮并收工（实测 38.5→34.5 越调越糟），
            但「二分步」和「手上已有跨 50% 的两样本」这两个例外不回退（否则把刚拿到的
            信息扔掉，实测会停在 24.1%）；
         ⚠️ 这里把 tcrop 关掉，让上限固定 178 —— 否则裁切面积小的时候
            mkBal(20) 会被上限截断（框距 1 时 0.9×16=14），断言基准就不稳了。 */
      const keepBal3 = state.tsumego.bal, keepPh3 = state.tsumego.phase;
      const tc3 = settings.tcrop;
      settings.tcrop = 'off';
      const sigW = setupSig();
      state.tsumego.phase = 'solve'; anaSigAtSend = sigW;
      const run = (bal, pkt) => {
        state.tsumego.bal = bal;
        const changed = noteBalWinrate(pkt, 0);
        const x = state.tsumego.bal;
        /* 诊断串：断言失败时能看出是哪道门先关（sig / anaSig / phase / 步数 / 上限） */
        const dbg = 'sig=' + (bal.sig === setupSig()) + ' ana=' + (anaSigAtSend === setupSig())
          + ' ph=' + tsPhase() + ' on=' + tsOn() + ' v=' + pkt.root.visits
          + ' need=' + Math.min(150, Math.max(60, Math.round((settings.visits || 500) * 0.8)))
          + ' wr=' + blackWinFrom(pkt, 0) + ' ld=' + blackLeadFrom(pkt, 0) + ' cap=' + tsBalMax();
        return { changed, komi: x.komi, komi2: x.komi2, fixN: x.fixN || 0, reverted: !!x.reverted, dbg };
      };
      const rOk = run(mkBal(20, sigW), { root: { currentPlayer: 'B', winrate: 0.52, visits: 200 } });
      const rWr = run(mkBal(20, sigW), { root: { currentPlayer: 'B', winrate: 0.80, visits: 200 } });
      const rLead = run(mkBal(20, sigW), { root: { currentPlayer: 'B', winrate: 0.65, scoreLead: 6, visits: 200 } });
      const rFlat = run(mkBal(20, sigW), { root: { currentPlayer: 'B', winrate: 0.30, scoreLead: 0.4, visits: 200 } });
      const rMax = (() => {
        const b = mkBal(20, sigW); b.fixN = 6;               // = TS_BAL_FIX_MAX
        return run(b, { root: { currentPlayer: 'B', winrate: 0.95, scoreLead: 8, visits: 300 } });
      })();
      const rBack = (() => {
        const b = mkBal(20, sigW); b.prevK = 22; b.prevErr = 0.05; b.komi = 20;
        return run(b, { root: { currentPlayer: 'B', winrate: 0.02, scoreLead: 8, visits: 300 } });
      })();
      const rLow = run(mkBal(20, sigW), { root: { currentPlayer: 'B', winrate: 0.95, visits: 50 } });
      state.tsumego.bal = mkBal(20, sigW);
      const wrAt1 = noteBalWinrate({ root: { currentPlayer: 'B', winrate: 0.90, visits: 300 } }, 1);
      /* ★ 恢复 tcrop / bal / phase 必须等到**下面所有 run() 都跑完**（2026-10-27 踩过）：
         原来这一行就写在这儿，而 ⑱⑲⑳（汇率 / 夹逼 / 不倒退例外）是后来追加在后面的，
         于是它们跑在「tcrop 已恢复」的口径下 → setupSig() 变了 → sig=false、ana=false →
         noteBalWinrate 一律返回 false，三条断言全挂在「改了=false」上。
         诊断串里的 cap=73（=0.9×9×9，裁切）vs 178（整盘）就是这条的指纹。 */
      step('配平：胜率已在 ±8pp 内且目差归零 → 不再校正（贴目不动）',
        rOk.changed === false && rOk.komi === 20, '改了=' + rOk.changed + ' komi=' + rOk.komi);
      step('配平：只有胜率信息时走胜率通道，且靠近后步长减半（0.80 → 只挪 1.5 → 21.5）',
        rWr.changed === true && rWr.komi === 21.5 && rWr.fixN === 1,
        '改了=' + rWr.changed + ' komi=' + rWr.komi + ' 轮次=' + rWr.fixN);
      step('配平：目差没归零 → 走目差通道（+6 目，减半 → 20+3=23），不再被旧的 3 目上限卡住',
        rLead.changed === true && rLead.komi === 23,
        '改了=' + rLead.changed + ' komi=' + rLead.komi);
      step('配平：目差已归零（0.4 目）→ 退回胜率通道（30% → 20−1=19）',
        rFlat.changed === true && rFlat.komi === 19, '改了=' + rFlat.changed + ' komi=' + rFlat.komi);
      step('配平：校正轮次用完（6 轮）→ 不再调（二分把 4.5 目压到半目要 3 步）',
        rMax.changed === false && rMax.komi === 20, '改了=' + rMax.changed + ' komi=' + rMax.komi);
      step('配平：本轮比上一轮更差 → 退回上一轮贴目并收工（实测 38.5→34.5 越调越糟）',
        rBack.changed === true && rBack.komi === 22 && rBack.reverted === true,
        '改了=' + rBack.changed + ' komi=' + rBack.komi + ' 回退=' + rBack.reverted);
      step('配平：校正要求够 150 步 / 且只认第 0 手（50 步和第 1 手都不认）',
        rLow.changed === false && wrAt1 === false, '50步=' + rLow.changed + ' 第1手=' + wrAt1);
      /* ⑱ 汇率（2026-10-27 正割法）：整盘大目差题上 Δlead/Δkomi 实测能到 **2.4**
         （xxqj 第 12 题：komi 65.5 → lead +8.3，komi 74 → lead −12.1）。
         按 1:1 折算就一步跨到对面（94.4% → 10.9%），回退保护只退一次 → 终点 18.3%。
         手上已有两个样本时必须按**实测汇率**折算步长。 */
      const rRatio = (() => {
        const b = mkBal(20, sigW);
        b.komi = 70;
        b.leadHist = [{ k: 60, lead: 10 }];      // 上一个样本：60 目时黑优 10 目
        return run(b, { root: { currentPlayer: 'B', winrate: 0.90, scoreLead: -10, visits: 300 } });
      })();
      step('配平：两个样本 → 按实测汇率折算（Δlead/Δkomi=2 → 目差 −10 只挪 −5，不是 −10）',
        rRatio.changed === true && rRatio.komi === 65,
        '改了=' + rRatio.changed + ' komi=' + rRatio.komi
          + (rRatio.changed && rRatio.komi === 65 ? '' : ' | ' + rRatio.dbg));
      /* ⑲ 夹逼：临界点附近**半目 = 30~50pp**（实测裁切 8×9：37.5→90.2%、38→41.7%、
         38.5→10.7%），按斜率外推必然整段跨过去 —— 实测同一题两次跑出 38.0→43.5% 与
         37.5→91.9%，差别只在 K1（45.5 vs 42）。所以一旦有「跨过 50% 的两个样本」，
         就只能取中点（二分），不再外推。中点还要对齐 0.5 网格：
         (37.5+42)/2 = 39.75 → 40（**不是** round((lo+hi)*2)/2 = 79.5 那种写错法）。 */
      const rBis = (() => {
        const b = mkBal(20, sigW);
        b.komi = 37.5;
        b.leadHist = [{ k: 42, lead: -3, wr: 0.065 }];    // 42 目时只有 6.5%（komi 太大）
        return run(b, { root: { currentPlayer: 'B', winrate: 0.902, scoreLead: 6.9, visits: 300 } });
      })();
      step('配平：两个样本跨过 50% → 取中点二分（37.5 的 90.2% 与 42 的 6.5% → 39.75→40）',
        rBis.changed === true && rBis.komi === 40,
        '改了=' + rBis.changed + ' komi=' + rBis.komi
          + (rBis.changed && rBis.komi === 40 ? '' : ' | ' + rBis.dbg));
      /* ⑳ 「不倒退」的两个例外（2026-10-27）：二分步、以及**已有跨过 50% 的样本**时，
         本轮变差也不算跑偏 —— 那是把区间夹小了，不是跳飞了。
         实测裁切 8×9：39（24.5%）→ 37.5（86.5%，跨过 50%）→ 旧规则判"更差"退回 39 →
         收工在 24.1%（差 26pp）；允许继续二分（37.5~39 → 38.5）就能落到 45% 附近。
         ⚠️ 中点 38.25 落在两个网格正中间，Math.round(76.5)/2 取上界 → 38.5（不是 38）。 */
      const rNoRev = (() => {
        const b = mkBal(20, sigW);
        b.komi = 37.5;
        b.prevK = 39; b.prevErr = 0.255;                  // 上一轮 39 目读 24.5%
        b.leadHist = [{ k: 39, lead: 0.6, wr: 0.245 }];
        return run(b, { root: { currentPlayer: 'B', winrate: 0.865, scoreLead: 0.7, visits: 300 } });
      })();
      step('配平：已有跨过 50% 的样本 → 变差也不回退，继续二分（37.5~39 → 38.5）',
        rNoRev.changed === true && rNoRev.komi === 38.5 && rNoRev.reverted === false,
        '改了=' + rNoRev.changed + ' komi=' + rNoRev.komi + ' 回退=' + rNoRev.reverted
          + (rNoRev.changed && rNoRev.komi === 38.5 ? '' : ' | ' + rNoRev.dbg));
      /* ★ 配平那一节的收尾：口径与状态一律还原（见上面「恢复必须等所有 run 跑完」）。 */
      settings.tcrop = tc3;
      state.tsumego.bal = keepBal3; state.tsumego.phase = keepPh3;

      /* ⑭⑮⑯ 超时预算与默认计算深度（2026-10-26）。
         为什么要把这组数字焊进测试：原来是固定 25 秒，而 19 路 300~500 步实测要
         18~46 秒 —— 每一趟都被判超时 → terminate 毁树 → 从 0 重算，用户看到的就是
         「算一半没了 / 胜率条抖」。这组断言锁的是「别再退回一个固定值」。
         ⚠️ 数字是 analyzeTimeoutMs 的算式结果（30000 + 步数 × 每步预算），
            每步预算 9 路 55ms / 19 路 95ms —— 见 renderer/app.js 的 analyzeVisitCost。 */
      const t9 = analyzeTimeoutMs(9, 300), t19 = analyzeTimeoutMs(19, 300);
      const tMax = analyzeTimeoutMs(19, 5000);
      step('超时：按棋盘放大（9 路 46.5 秒 / 19 路 58.5 秒），不再是一个固定的 25 秒',
        t9 === 46500 && t19 === 58500, '9路=' + t9 + ' 19路=' + t19);
      step('超时：搜索量也算进去，且有硬上限（19 路 × 5000 步 → 180 秒）',
        t19 > t9 && tMax === 180000, '19×300=' + t19 + ' 19×5000=' + tMax);
      step('默认计算深度 = 500（2026-10-26 一度降到 300，当天按用户要求改回 500）',
        settings.visits === 500 && ANALYZE_VISITS === 500,
        'settings.visits=' + settings.visits + ' ANALYZE_VISITS=' + ANALYZE_VISITS);
    }

    /* ★ 「先手 | KATAGO」这一行（2026-10-31 起是双列的一行，原来各占一行）。
       仍然量一次：nowrap + 不出卡片 —— 这一行是"卡片高度恒定"里最容易变异的一行。 */
    {
      const rowF2 = $('seg-tsfirst').closest('.ts-row');
      const r2 = rowF2.getBoundingClientRect();
      step('「先手 | KATAGO」那一行（解题阶段同样）不换行、也没溢出卡片',
        Math.round(r2.height) <= 32 && r2.right <= cdR.right + 0.5,
        '行高=' + Math.round(r2.height) + ' 行右=' + Math.round(r2.right)
        + ' 卡右=' + Math.round(cdR.right));
    }
    /* ★ 解题阶段的「对手」那一行（2026-10-16 由「应对」改名 —— 用户的原话就是"解题对手"）。
       两个按钮还是 KATAGO / 我下两边（我下两边 = 黑白交替、两边都由你走）。
       ★ 2026-10-17：这一行原来在「重来 / 重摆 / 提示 / 正解 / 判定」五个按钮上面 ——
         现在按钮只剩三个（提示 / 判定已删），顺手把它也验一遍。 */
    {
      const rowS2 = document.querySelector('#ts-card .ts-row-solve');
      step('解题阶段的「对手」行 = label「对手」+ 三个按钮 按正解 / KATAGO / 我下两边',
        !!rowS2 && /对手/.test(rowS2.querySelector('.ts-label').textContent)
        && [...rowS2.querySelectorAll('.seg button')].map(b => b.textContent.trim()).join('|') === '按正解|KATAGO|我下两边',
        'label=' + JSON.stringify(rowS2 ? rowS2.querySelector('.ts-label').textContent : '—')
        + ' 按钮=' + [...(rowS2 ? rowS2.querySelectorAll('.seg button') : [])]
          .map(b => b.textContent.trim()).join('|'));
      /* ★ 2026-10-17 新增：「按正解」这一档要有正解才可点。这里是**手摆的题**，
         题集里没有答案 → 必须置灰（不置灰的话，用户点下去会以为对手在按正解走，
         其实走的是 KATAGO —— 那是骗人）。 */
      const solBtn0 = rowS2 && rowS2.querySelector('.seg button[data-v="solution"]');
      step('手摆的题没有正解 → 「按正解」那一档置灰',
        !!solBtn0 && solBtn0.disabled === true,
        '在=' + !!solBtn0 + ' 禁用=' + (solBtn0 ? solBtn0.disabled : '—'));
      /* ★ 三个按钮挤在同一行（卡片内容宽 244px）—— 一换行卡片就会跳高，
         所以"行高没变 + 右边缘没出卡片"必须**量出来**，不能看着差不多就算过。 */
      const rs2 = rowS2 ? rowS2.getBoundingClientRect() : { height: 999, right: 9999 };
      const cdS2 = $('ts-card').getBoundingClientRect();
      step('「对手」三档不换行、也不溢出卡片',
        Math.round(rs2.height) <= 32 && rs2.right <= cdS2.right + 0.5,
        '行高=' + Math.round(rs2.height) + ' 行右=' + Math.round(rs2.right)
        + ' 卡右=' + Math.round(cdS2.right)
        + ' 按钮宽=' + [...rowS2.querySelectorAll('.seg button')].map(b => Math.round(b.getBoundingClientRect().width)).join('/'));
      const btns = [...document.querySelectorAll('#ts-card .ts-row-btns button')];
      step('解题阶段的按钮 = 重来 / 重摆 / 正解（提示、判定已删）',
        btns.map(b => b.textContent.trim()).join('|') === '重来|重摆|正解',
        '按钮=' + btns.map(b => b.textContent.trim()).join('|'));
      step('「提示」「判定」那两个按钮确实没了',
        !$('btn-ts-hint') && !$('btn-ts-judge'),
        'hint=' + !!$('btn-ts-hint') + ' judge=' + !!$('btn-ts-judge'));
    }

    /* ★ 每个阶段各自的控件行数固定 —— 同上，只数可见行。 */
    const visRows2 = [...document.querySelectorAll('#ts-card .ts-row')]
      .filter(r => r.offsetHeight > 0).length;
    step('解题阶段：可见的控件行 = 5（题集 / 先手+KATAGO / 框架+框距 / 对手 / 按钮）',
      visRows2 === 5, '可见行数=' + visRows2);
    snapCardH('解题');
  }

  /* ---------- 4.5 框架在解题阶段**固定不动** + 人也只能在框内落子（2026-10-12 用户报）
     ★ 这一段的落点 (10,7) 是特意挑的：它在**框内**（框是 10..18 / 0..8），
       但在题目棋子的外接矩形**之外**（棋子只占 14..17 / 1..4）。
       旧实现把 state.moves 也算进外接矩形 → 这一手会让框"长大"（y1 从 8 涨到 11）。
       所以这条断言正好卡住那个 bug，普通的框内落子是卡不住的。 */
  {
    const frA = JSON.stringify(frameRect());
    seg('seg-tsdefend', 'both'); await sleep(250);   // 先切成"我下两边"，免得 AI 中途应手干扰计数
    tryPlay(10, 7, false);
    await sleep(300);
    const frB = JSON.stringify(frameRect());
    step('解题时落子后框架不扩大（框已固定）', frA === frB, frA + ' → ' + frB);
    step('框内（虽然离题目很远）的落子能下', state.moves.length === 1, '手数=' + state.moves.length);

    const nOut = state.moves.length;
    tryPlay(18, 18, false);                           // 框外（y=18 远超框底 8）
    await sleep(250);
    step('框外落子被人挡下（人也受框架约束）', state.moves.length === nOut,
      nOut + ' → ' + state.moves.length + ' · 状态栏=' + JSON.stringify(($('status').textContent || '').slice(0, 16)));

    const d0 = settings.tdist;
    $('btn-ts-dist-more').click(); await sleep(300);
    const frC = JSON.stringify(frameRect());
    step('练习卡「框距 +」能当场把框调大', settings.tdist === d0 + 1 && frC !== frA,
      '框距 ' + d0 + '→' + settings.tdist + ' · ' + frC);
    $('btn-ts-dist-less').click(); await sleep(300);
    step('「框距 −」能调回原值', settings.tdist === d0 && JSON.stringify(frameRect()) === frA,
      '框距=' + settings.tdist + ' · ' + JSON.stringify(frameRect()));

    /* ★ 顺序是**故意**这样排的：先切回「AI 应对」（此刻盘上有一手黑子、轮到白方走
       → 立刻排一次防守请求），紧接着「重来」把局面清掉 ——
       这正是"应手落在已清空的盘上"的竞态（本次实测踩到过，已用 defendSeq 修掉）。 */
    seg('seg-tsdefend', 'ai'); await sleep(250);
    tsResetSolve(); await sleep(300);
    step('重来后框架仍然不变', JSON.stringify(frameRect()) === frA, JSON.stringify(frameRect()));
    /* 等一会儿，看有没有"迟到的应手"插进空盘（修好的话：一手都没有） */
    await sleep(5000);
    step('重来之后没有迟到的应手插进来（防守请求会核对局面）',
      state.moves.length === 0,
      '手数=' + state.moves.length + ' · 防守说明=' + (state.tsumego.defendNote || '（空）'));
  }

  /* ---------- 4.6 KATAGO 执哪一方（2026-10-14 用户要求） ---------- */
  {
    step('默认：KATAGO 执「先手的对方」→ 你来解题（黑先的题你走黑）',
      settings.taicolor === 'w' && state.myColor === 'b' && isMyTurn(),
      'KATAGO=' + settings.taicolor + ' 你=' + state.myColor + ' 轮到我=' + isMyTurn());
    step('右栏名字：你 / KATAGO',
      defaultName('b') === '你' && defaultName('w') === 'KATAGO',
      defaultName('b') + ' / ' + defaultName('w'));

    /* 改成「KATAGO 执黑」= 先手那一方 → 角色互换：它先动手，换成你防守 */
    seg('seg-tsaicolor', 'b'); await sleep(400);
    step('改成「KATAGO 执黑」→ 你执白、轮到它动手',
      settings.taicolor === 'b' && state.myColor === 'w' && !isMyTurn(),
      'KATAGO=' + settings.taicolor + ' 你=' + state.myColor + ' 轮到我=' + isMyTurn());
    /* ★ 原来这条读的是练习卡底部那行小字（#ts-solve-note）—— 那行字已按用户要求删掉了。
       "谁先动手"这句话现在只剩**两个地方**能读到，都不在练习卡上：
       ① 「新对局」面板的 #ts-role-note（下面这条）；② 右栏双方名字的顺序。 */
    step('说明文字（面板里那条）讲清了「谁先动手」',
      /KATAGO 执黑（黑先）/.test($('ts-role-note').textContent)
      && /先动手/.test($('ts-role-note').textContent),
      JSON.stringify($('ts-role-note').textContent));
    step('右栏名字跟着换（黑方成 KATAGO）',
      defaultName('b') === 'KATAGO' && defaultName('w') === '你',
      defaultName('b') + ' / ' + defaultName('w'));

    const t46 = Date.now();
    /* ★ 2026-10-26：默认深度回到 500 后，9 路一手 500 步最坏要三十几秒（还有配平那几趟排队）。
       判据不变（"最终会不会落子"），只是把等待窗口从 25 秒放宽到 60 秒 —— 这一条一直是
       "等不够"的假红（旧注释里就写着"等 25 秒的老 flake"）。 */
    while (state.moves.length < 1 && Date.now() - t46 < 150000) await sleep(500);
    step('KATAGO 先手会自己落第一子（而且是黑棋）',
      state.moves.length >= 1 && state.moves[0].color === 'b',
      '手数=' + state.moves.length + ' 首手色=' + (state.moves[0] && state.moves[0].color)
      + ' · ' + (state.tsumego.defendNote || '（空）'));

    /* ★ 2026-10-14 起：「我下两边」时那一行**不再藏起来，改成置灰** ——
       藏起来会让卡片高度跳一下，而用户要求"卡片高度任何时刻不变"。
       判据要同时验两件事：① 按钮 disabled（不上场）；② 那一行还在（高度不变）。 */
    seg('seg-tsdefend', 'both'); await sleep(300);
    step('「我下两边」时 KATAGO 颜色那一行**置灰**（不是藏起来，卡片高度才不跳）',
      !$('ts-row-aicolor').hidden
      && [...$('seg-tsaicolor').querySelectorAll('button')].every(b => b.disabled),
      '行隐藏=' + $('ts-row-aicolor').hidden
      + ' 按钮 disabled=' + [...$('seg-tsaicolor').querySelectorAll('button')].map(b => b.disabled).join(',')
      + ' 行高=' + Math.round($('ts-row-aicolor').getBoundingClientRect().height));
    step('...而且两边都算「你」',
      defaultName('b') === '黑（你）' && defaultName('w') === '白（你）',
      defaultName('b') + ' / ' + defaultName('w'));
    snapCardH('我下两边');
    seg('seg-tsdefend', 'ai'); await sleep(300);
    step('切回 KATAGO → 那一行恢复可点',
      !$('ts-row-aicolor').hidden
      && [...$('seg-tsaicolor').querySelectorAll('button')].every(b => !b.disabled),
      '行隐藏=' + $('ts-row-aicolor').hidden
      + ' 按钮 disabled=' + [...$('seg-tsaicolor').querySelectorAll('button')].map(b => b.disabled).join(','));

    /* 收尾：改回「KATAGO 执白」+ 重来，回到"你来解题"的状态，免得影响后面的用例 */
    seg('seg-tsaicolor', 'w'); await sleep(300);
    tsResetSolve(); await sleep(400);
    step('改回「KATAGO 执白」+ 重来 → 又轮到你解题',
      settings.taicolor === 'w' && state.moves.length === 0 && isMyTurn(),
      'KATAGO=' + settings.taicolor + ' 手数=' + state.moves.length + ' 轮到我=' + isMyTurn());
  }

  /* ---------- 5. 分析是否被框架约束住（allowMoves 生效的可观察证据） ---------- */
  /* ★ 轮询等结果，**不能固定 sleep(4000)**：引擎一次只算一个请求，
     前面 4.5 那一段连点了几次「框距」（每次都排一次分析），请求会排队。
     2026-10-12 改版后第一次跑就因为固定 4 秒报了「0 个候选」——
     而同一个 run 后面「提示③ 让候选点显示出来 → 4 个点」是过的，
     说明链路没问题、是等待时间不够。断言的应该是**候选点在哪**，不是它多快出来。 */
  const t5 = Date.now();
  while (!(state.candidates || []).length && Date.now() - t5 < 60000) await sleep(500);
  const cands = state.candidates || [];
  const inFrame = cands.filter(c => fr && c.x >= fr.x0 && c.x <= fr.x1 && c.y >= fr.y0 && c.y <= fr.y1);
  step('候选点全部落在框架内（allowMoves 生效）',
    cands.length > 0 ? inFrame.length === cands.length : false,
    cands.length + ' 个候选，' + inFrame.length + ' 个在框内');

  /* ---------- 5.5 引擎的搜索范围：从「整框」收成「框内 ∩ 棋子 2 路内」（2026-10-17）----------
     用户报的现象：KATAGO 老脱先、落子在框边。根因**不是** allowMoves 没生效 ——
     它一直生效，只是当时给的是「整个框」：框里几十上百个点、大半离战斗 4~6 路；
     而死活题的胜率几乎是常数（99.9% / 0.0%），引擎没有"必须应"的动机，就去挑大场了。
     实测《玄玄棋经》前 24 题：整框时 25~33% 的首选落在 >2 路外；收成 2 路后 **0%**。
     这里验的是**请求里那两个字段的来源** tsAnalyzeExtras() 产出的 allowMoves：
     每个点都必须贴着棋子，且点数确实比整框少。 */
  {
    const ex = tsAnalyzeExtras();
    const pts = (ex.allowMoves && ex.allowMoves[0] && ex.allowMoves[0].moves) || [];
    const f55 = frameRect();
    const area = f55 ? (f55.x1 - f55.x0 + 1) * (f55.y1 - f55.y0 + 1) : 0;
    const b55 = boardAt(state.moves.length);
    const st55 = [];
    for (let i = 0; i < N * N; i++) if (b55[i]) st55.push([i % N, Math.floor(i / N)]);
    const distOf = s => {
      const x = GTP_COLS.indexOf(String(s)[0]), y = N - parseInt(String(s).slice(1), 10);
      let d = 99;
      for (const [sx, sy] of st55) d = Math.min(d, Math.max(Math.abs(x - sx), Math.abs(y - sy)));
      return d;
    };
    const far = pts.filter(s => distOf(s) > 2).length;
    /* 框里本来就"全都贴着棋子"时不能要求点数变少（那种题收不收都一样） */
    const frameFar = (() => {
      let c = 0;
      for (let y = f55.y0; y <= f55.y1; y++)
        for (let x = f55.x0; x <= f55.x1; x++) {
          let d = 99;
          for (const [sx, sy] of st55) d = Math.min(d, Math.max(Math.abs(x - sx), Math.abs(y - sy)));
          if (d > 2) c++;
        }
      return c;
    })();
    step('引擎的 allowMoves = 框内 ∩「离棋子 2 路内」（不再整框）',
      pts.length > 0 && far === 0 && (frameFar === 0 ? pts.length === area : pts.length < area),
      '框内点=' + area + '（其中离棋子 >2 路的 ' + frameFar + ' 个）· 允许点=' + pts.length
      + ' · 允许点里离棋子 >2 路的 ' + far + ' 个');

    /* ★★ 2026-10-27：**取消两档** —— 对手（KATAGO 应手那一方）也改回 wide（用户要求）。
       背景：2026-10-26 曾把对手收成 tight（≤1 路 ∪ 腹地 2 路），治过了"外皮上的随手一手"；
       但 347 题实测里正解首手有 12 题（3.5%）正落在"离棋子 2 路、却在摆子外接矩形外"的那圈
       外皮上 —— 对手被按下 tight 就等于看不见最强的抵抗手段。退回 wide 后脱先仍由
       「2 路半径 + 人工框线上的点被 trim 剔掉」兜住。
       验三件事（两处口径必须一致，否则"请求允许、兜底又砍"会白丢一手）：
         ① 两个玩家都有条目、都不为空（空 moves 会被主进程丢掉 → 引擎完全不约束）；
         ② 两方点集**完全相同** —— 不再按角色收窄；
         ③ 与该局面 regionPoints(fr,false) 的 wide 逐点一致（防止哪天又偷偷加回"对手收紧"）。 */
    {
      const aiC = tsAIColor();
      const listOf = p => ((ex.allowMoves || []).find(e => e.player === p) || {}).moves || [];
      const myPts = listOf(aiC === 'b' ? 'W' : 'B');
      const aiPts = listOf(aiC === 'b' ? 'B' : 'W');
      const widePts = regionPoints(frameRect(), false).map(([x, y]) => toGTP(x, y));
      const same = (a, b) => a.length === b.length && a.every(s => b.includes(s));
      const offWide = myPts.concat(aiPts).filter(s => !widePts.includes(s)).length;
      step('allowMoves 两方都是 wide（2026-10-27 起不再按角色分档）',
        myPts.length > 0 && aiPts.length > 0 && same(myPts, aiPts)
          && myPts.length === widePts.length && offWide === 0,
        'KATAGO=' + aiC + ' · 我的允许点=' + myPts.length + ' · 对手的允许点=' + aiPts.length
        + ' · regionPoints(wide)=' + widePts.length + ' · 不在 wide 里的点=' + offWide + '（必须 0）');
    }

    /* ★★ 2026-10-26 二修：**人工框线（那道虚线框）上的点，不许进允许集合**。
       为什么单独验：用户说的"边框边缘"是**练习题自己画的框**，不是棋盘边。框距 4 时
       这条线离棋子至少 3 路（数学上不可能踩到，_trash/_probe_trim.mjs 347 题实测 0 个）；
       但框距 1~2 时框比引擎的战术半径还窄，旧规则下 342/347 题都有允许点正好落在框线上。
       这里**直接喂一个 bbox+1 的假框**给 regionPoints（不动 settings.tdist 的 UI 流程，
       只临时改这个数值，避免触发重算），两种狠度各验一次：
         · 框距 ≤2：只剔「离棋子 ≥2 路」的框线点（贴身的扳/立必须留）；
         · 框距 ≥3：框线上一律不踩（"棋飘出题目"的那一手不追）。
       撞 8 点地板时允许原样返回（宁可给引擎余地，也不能无点可选）——那种情况集合会 ≤8 点。 */
    {
      const b1 = stoneBox();
      if (b1) {
        const fake = {
          x0: Math.max(0, b1.x0 - 1), y0: Math.max(0, b1.y0 - 1),
          x1: Math.min(N - 1, b1.x1 + 1), y1: Math.min(N - 1, b1.y1 + 1),
        };
        const onEdge = (x, y) => x === 0 || x === N - 1 || y === 0 || y === N - 1;
        const onLine = ([x, y]) => !onEdge(x, y)
          && (x === fake.x0 || x === fake.x1 || y === fake.y0 || y === fake.y1);
        const dStone = ([x, y]) => {
          let d = 99;
          for (const [sx, sy] of st55) d = Math.min(d, Math.max(Math.abs(x - sx), Math.abs(y - sy)));
          return d;
        };
        const keepTd = settings.tdist;

        /* ① 框距 ≤2 的档：框线上的"贴身点"留下，其余剔掉 */
        settings.tdist = 1;
        const small = [regionPoints(fake, true), regionPoints(fake, false)];
        const badNear = small.flat().filter(p => onLine(p) && dStone(p) >= 2).length;
        const keptNear = small.flat().filter(p => onLine(p) && dStone(p) < 2).length;
        const nSmall = small.map(a => a.length);
        /* ② 框距 ≥3 的档：框线上一个都不留 */
        settings.tdist = 4;
        const big = regionPoints(fake, true);
        const badLine = big.filter(onLine).length;
        settings.tdist = keepTd;                       // ★ 无论如何都要还原

        step('人工框线上的点不进允许集合（框距 ≤2：只留贴身；≥3：一个不留）',
          (badNear === 0 || nSmall[0] <= 8 || nSmall[1] <= 8) && (badLine === 0 || big.length <= 8),
          '假框=bbox+1 ' + JSON.stringify(fake) + ' · 框距1 时 tight/wide='
          + nSmall[0] + '/' + nSmall[1] + ' 点（框线上≥2 路的违规 ' + badNear + '，留着的贴身点 ' + keptNear + '）'
          + ' · 框距4 时 tight=' + big.length + ' 点（框线上 ' + badLine + ' 个 ← 必须 0）');
      }
    }
  }

  /* ---------- 6. 落正解 → AI 应对 ---------- */
  const before = state.moves.length;
  tryPlay(15, 4, false);       // Q15：白棋的杀着
  /* 等 AI 应手 —— 给足时间：引擎一次只算一个请求，防守请求可能要排队/重试 */
  const t2 = Date.now();
  while (state.moves.length < 2 && Date.now() - t2 < 60000) await sleep(500);
  step('我方落子成功', state.moves.length > before, before + ' → ' + state.moves.length);
  step('对方由 AI 应对（强引擎）', state.moves.length >= 2,
    '手数=' + state.moves.length + ' · 防守说明=' + (state.tsumego.defendNote || '（空）'));
  step('AI 应手也守框架',
    state.moves.slice(1).every(m => m.pass || (fr && m.x >= fr.x0 && m.x <= fr.x1 && m.y >= fr.y0 && m.y <= fr.y1)),
    state.moves.map(m => m.pass ? 'pass' : (m.x + ',' + m.y)).join(' / '));

  /* ---------- 9. 重来 / 重摆 / 防守方切换 ---------- */
  tsResetSolve(); await sleep(300);
  step('重来：手顺清空、摆子保留',
    state.moves.length === 0 && state.setup.length === BLACK.length + WHITE.length,
    'moves=' + state.moves.length + ' setup=' + state.setup.length);
  seg('seg-tsdefend', 'both'); await sleep(300);
  step('切「我下两边」', state.tsumego.defend === 'both', state.tsumego.defend);
  seg('seg-tsdefend', 'ai'); await sleep(300);
  tsBackToSetup(); await sleep(300);
  step('重摆：回到摆题阶段', state.tsumego.phase === 'setup' && !$('ts-setup-group').hidden,
    '阶段=' + state.tsumego.phase);
  seg('seg-tscolor', 'erase'); await sleep(150);
  clickAt(BLACK[1][0], BLACK[1][1], 0); await sleep(200);
  step('「擦」工具能删子', state.setup.length === BLACK.length + WHITE.length - 1,
    'setup=' + state.setup.length);

  /* ---------- 10. 切走 / 切回（顶栏按钮 = 打开面板，再点「开始」才切） ---------- */
  seg('seg-mode', 'free'); await sleep(300);
  step('顶栏选「双人摆棋」→ 面板预选到它', lit('seg-ntype') === 'free', lit('seg-ntype'));
  $('m-start').click(); await sleep(500);
  step('切到摆棋 → 练习状态被收掉', settings.mode === 'free' && !state.tsumego && $('ts-card').hidden,
    'mode=' + settings.mode + ' tsumego=' + state.tsumego + ' 卡片隐藏=' + $('ts-card').hidden);
  seg('seg-mode', 'tsumego'); await sleep(300);
  $('m-start').click(); await sleep(700);
  step('切回习题练习 = 一道新题（空盘、摆题中）',
    settings.mode === 'tsumego' && !!state.tsumego && state.tsumego.phase === 'setup' && state.setup.length === 0,
    '阶段=' + (state.tsumego && state.tsumego.phase) + ' setup=' + state.setup.length);

  /* ---------- 10.5 导入题集（2026-10-14，SGF 习题）----------
     夹具 dev/fixtures/测试题集-3题.sgf 由启动脚本复制进 puzzles/（测试用的是**临时目录**，
     见 RAPACEGO_PUZZLES）。三道题的形态是特意配的：
       ① 9 路、黑先、主变化 3 手 —— 而且**带一个变体**（验"走的是主变化"）；
       ② 9 路、白先（PL[W]）、正解 3 手 —— 还带根节点 C[]（验注释不会被当成一手棋）；
       ③ 9 路、**没写 PL** —— 首手是白 → 必须靠"首手颜色"推出先手（这条最容易做错）。
     ★ 这里**不点**「导入题集…」（会弹系统文件框，CDP 驱不动，和作者验「导入棋谱」时一样的限制），
       只验入口在；真正会用到的是「打开题集 → 翻题 → 正解」。 */
  {
    /* 起点：还没打开过题集 —— 题集行应该是"未打开"、翻题按钮置灰 */
    step('没打开题集时：题集行显示「未打开」、翻题按钮置灰',
      $('btn-pset').textContent === '未打开' && $('pset-pos').textContent === '—'
      && $('btn-ts-prev').disabled && $('btn-ts-next').disabled,
      '名字=' + JSON.stringify($('btn-pset').textContent) + ' 位置=' + $('pset-pos').textContent
      + ' prev/next 禁用=' + $('btn-ts-prev').disabled + '/' + $('btn-ts-next').disabled);

    openPuzzles();
    await sleep(900);
    step('题集面板能打开、列出夹具题集',
      $('puzzles').classList.contains('open')
      && [...document.querySelectorAll('#puzlist li .rec-name')].some(e => /测试题集/.test(e.textContent)),
      '列表=' + [...document.querySelectorAll('#puzlist li .rec-name')].map(e => e.textContent).join(' / '));
    step('面板报出了每份题集的题数 —— 由界面自己数（347 / 3）',
      ['347 题', '3 题'].every(k => [...document.querySelectorAll('#puzlist li .rec-meta')]
        .some(e => e.textContent.startsWith(k))),
      'meta=' + [...document.querySelectorAll('#puzlist li .rec-meta')].map(e => e.textContent).join(' | '));
    step('「导入题集…」入口在（不点：会弹系统文件框）',
      !!$('puz-import') && typeof $('puz-import').onclick === 'function', '有入口');

    /* 打开这份题集 */
    const puzLi = [...document.querySelectorAll('#puzlist li')].find(l => /测试题集/.test(l.textContent));
    [...puzLi.querySelectorAll('button')].find(b => /打开|正在练/.test(b.textContent)).click();
    await sleep(1200);
    step('打开题集 → 进入习题练习、摆好第 1 题（停在摆题阶段）',
      settings.mode === 'tsumego' && !!state.tsumego && !!state.tsumegoSet
      && state.tsumegoSet.idx === 0 && state.tsumego.phase === 'setup',
      'mode=' + settings.mode + ' idx=' + (state.tsumegoSet && state.tsumegoSet.idx)
      + ' 阶段=' + state.tsumego.phase + ' 面板开=' + $('puzzles').classList.contains('open'));
    step('第 1 题：按 SGF 摆好子（8 颗）、先手黑、正解 3 手',
      state.setup.length === 8 && settings.tfirst === 'b'
      && tsSetProblem().answer.length === 3 && tsSetProblem().answer[0].color === 'b',
      '摆子=' + state.setup.length + ' 先手=' + settings.tfirst
      + ' 正解=' + tsSetProblem().answer.length + ' 手（首手=' + tsSetProblem().answer[0].color + '）');
    step('题集带的 9 路尺寸生效（题集里可能混着小盘题）',
      settings.size === 9 && N === 9, 'settings.size=' + settings.size + ' N=' + N);
    step('题集行同步：名字 + 第 1/3 题',
      /测试题集/.test($('btn-pset').textContent) && $('pset-pos').textContent === '1/3'
      && $('btn-ts-prev').disabled && !$('btn-ts-next').disabled,
      '名字=' + JSON.stringify($('btn-pset').textContent) + ' 位置=' + $('pset-pos').textContent);
    step('框架按题目的摆子算出来了，且把摆子都圈在里面',
      !!frameRect() && state.setup.every(s => {
        const f = frameRect();
        return s.x >= f.x0 && s.x <= f.x1 && s.y >= f.y0 && s.y <= f.y1;
      }), JSON.stringify(frameRect()) + ' · 摆子=' + state.setup.length);
    snapCardH('题集·摆题');

    /* ★ 2026-10-17：变化树。夹具第 1 题**第二手就分叉**（白有两个应法），
       旧解析层把第二条整块跳过 → 这里直接量树的结构（不看内部变量，只看 parseSGF 的产物）。 */
    {
      const tr = tsSetProblem().tree;
      const rootKids = tr ? tr.children.filter(c => c.move) : [];
      const branch = rootKids[0] ? rootKids[0].children.filter(c => c.move) : [];
      step('第 1 题的变化树读出来了：第一手下面有 2 条分支',
        !!tr && rootKids.length === 1 && branch.length === 2,
        '树=' + !!tr + ' 根下有手的节点=' + rootKids.length
        + ' 第一手的分支=' + branch.length + ' 主线=' + tsSetProblem().answer.length + ' 手');
    }

    /* 翻到第 2 题（白先、带根节点 C[]）*/
    $('btn-ts-next').click(); await sleep(700);
    step('「下一题」→ 第 2 题：白先、9 颗摆子、正解 3 手',
      state.tsumegoSet.idx === 1 && settings.tfirst === 'w' && state.setup.length === 9
      && tsSetProblem().answer.length === 3 && $('pset-pos').textContent === '2/3',
      'idx=' + state.tsumegoSet.idx + ' 先手=' + settings.tfirst + ' 摆子=' + state.setup.length
      + ' 正解=' + tsSetProblem().answer.length + ' 位置=' + $('pset-pos').textContent);
    step('翻题时手顺被清空（不能把上一题的手顺带过来）',
      state.moves.length === 0 && state.tsumego.phase === 'setup', 'moves=' + state.moves.length);
    step('翻题时「谁坐哪边」重置成默认（你来解题）',
      settings.taicolor === 'b' && state.myColor === 'w',
      'KATAGO=' + settings.taicolor + ' 你=' + state.myColor);

    /* 第 3 题：SGF 里**没写 PL** → 先手必须靠"正解第一手的颜色"推出来 */
    $('btn-ts-next').click(); await sleep(700);
    step('第 3 题没写 PL，先手由「正解第一手是白」推出 = 白先',
      state.tsumegoSet.idx === 2 && settings.tfirst === 'w'
      && tsSetProblem().answer.length === 4 && $('pset-pos').textContent === '3/3',
      '先手=' + settings.tfirst + ' 正解=' + tsSetProblem().answer.length + ' 手'
      + ' 首手=' + tsSetProblem().answer[0].color);
    step('最后一题：「下一题」置灰、「上一题」可用',
      $('btn-ts-next').disabled && !$('btn-ts-prev').disabled,
      'next 禁用=' + $('btn-ts-next').disabled + ' prev 禁用=' + $('btn-ts-prev').disabled);
    $('btn-ts-prev').click(); await sleep(600);
    step('「上一题」能回退', state.tsumegoSet.idx === 1 && $('pset-pos').textContent === '2/3',
      'idx=' + state.tsumegoSet.idx + ' 位置=' + $('pset-pos').textContent);
    $('btn-ts-next').click(); await sleep(600);

    /* ---------- 10.6 「正解」按钮：手动按才摆出来 ---------- */
    /* ★ 判据要**同时**看"按钮是可点的"和"点了会提示" ——
       第一版只判"手数没变、showAnswer 还是 false"，结果**假绿**了：
       那一刻按钮其实是 disabled（上一阶段留下的旧状态），点击根本不触发，
       什么都不发生，判据却当成了"正确地没越阶段硬摆"。 */
    const abBefore = $('btn-ts-answer').disabled;
    $('btn-ts-answer').click(); await sleep(200);
    step('摆题阶段「正解」是可点的，但按下去只提示「先开始解题」（不越阶段硬摆）',
      !abBefore && state.moves.length === 0 && !state.tsumego.showAnswer
      && /先点「开始解题」/.test($('status').textContent || ''),
      '按下前禁用=' + abBefore + ' 手数=' + state.moves.length
      + ' 文案=' + JSON.stringify(($('status').textContent || '').slice(0, 24)));
    seg('seg-tsdefend', 'both');        // 先切成"我下两边"，免得 AI 应手插一脚干扰计数
    await sleep(250);
    $('btn-ts-start').click(); await sleep(800);
    step('进入解题阶段（第 3 题：白先、正解 4 手）',
      state.tsumego.phase === 'solve' && settings.tfirst === 'w',
      '阶段=' + state.tsumego.phase + ' 先手=' + settings.tfirst);

    step('「正解」按钮可用（这道题有答案）', !$('btn-ts-answer').disabled, '禁用=' + $('btn-ts-answer').disabled);
    $('btn-ts-answer').click(); await sleep(500);
    step('按「正解」→ 把正解顺序摆出来（4 手）',
      state.tsumego.showAnswer === true && state.moves.length === 4
      && state.moves.every((m, i) => m.color === tsSetProblem().answer[i].color
        && m.x === tsSetProblem().answer[i].x && m.y === tsSetProblem().answer[i].y),
      '手数=' + state.moves.length + ' · 与 SGF 正解逐个一致=' +
      state.moves.every((m, i) => m.x === tsSetProblem().answer[i].x && m.y === tsSetProblem().answer[i].y));
    step('展示答案时：KATAGO 不许应手、人也不许落子',
      !stillNeedDefend() && (() => { tryPlay(0, 8, false); return state.moves.length === 4; })(),
      'stillNeedDefend=' + stillNeedDefend() + ' 手数=' + state.moves.length);
    /* ★ 为什么加这条：正解摆在盘上之后，「手数」卡和底部滑块**也得跟上** ——
       第一版只调了 draw()+syncTsumegoUI()，于是盘上有 4 手、右下角还写着"还没有落子"、
       滑块停在 0/0（截图里看出来的，断言当时没覆盖 → 用户按 ← → 会一头雾水）。 */
    step('展示答案时「手数」卡与底部滑块也跟着走（不写着"还没有落子"）',
      $('counter').textContent === '4 / 4' && $('slider').max === '4'
      && !/还没有落子/.test($('movelist').textContent),
      '计数=' + $('counter').textContent + ' 滑块max=' + $('slider').max
      + ' 列表=' + JSON.stringify(($('movelist').textContent || '').slice(0, 14)));
    step('展示答案时「正解」按钮高亮（再按一次就是收起）',
      $('btn-ts-answer').classList.contains('on'), '按钮类=' + $('btn-ts-answer').className);
    snapCardH('正解中');

    $('btn-ts-answer').click(); await sleep(500);
    step('再按一次「正解」→ 收起答案、回到初始局面',
      state.tsumego.showAnswer === false && state.moves.length === 0,
      'showAnswer=' + state.tsumego.showAnswer + ' 手数=' + state.moves.length);
    seg('seg-tsdefend', 'ai'); await sleep(250);

    /* ---------- 10.65 对手三档：按正解（2026-10-17 新增）----------
       用户报的现象：KATAGO 老脱先、落子在框边。实测下来，光把引擎的搜索收紧
       只能做到"贴题"（与正解一致 42%），做不到"正解" —— 死活题的胜率是常数，
       引擎没有"必须应"的动机。所以补了这一档：对手照**题集自带的主变化**应手。
       这里验两件事：① 你走正解 → 它按正解应（不脱先、也不等引擎）；
       ② 你走偏 → 它不再按正解摆，自动退回 KATAGO。 */
    {
      const ans65 = tsSetProblem().answer;
      seg('seg-tsdefend', 'solution'); await sleep(250);
      tryPlay(ans65[0].x, ans65[0].y, false);
      const t65 = Date.now();
      while (state.moves.length < 2 && Date.now() - t65 < 10000) await sleep(150);
      step('「按正解」：你走正解第一手 → 对手按正解应第二手（不脱先、也不等引擎算）',
        state.moves.length === 2
        && state.moves[1].x === ans65[1].x && state.moves[1].y === ans65[1].y
        && /按正解/.test(state.tsumego.defendNote || ''),
        '手数=' + state.moves.length
        + ' 应手=' + (state.moves[1] ? state.moves[1].x + ',' + state.moves[1].y : '—')
        + ' 期望=' + ans65[1].x + ',' + ans65[1].y
        + ' · ' + (state.tsumego.defendNote || '（空）'));

      /* ② 走偏：重来后落一个**不在正解上**的点（框内、空格、且不是正解第一手） */
      tsResetSolve(); await sleep(300);
      const b65 = boardAt(0);
      const f65 = frameRect();
      let off65 = null;
      for (let yy = f65.y0; yy <= f65.y1 && !off65; yy++)
        for (let xx = f65.x0; xx <= f65.x1 && !off65; xx++) {
          if (b65[idx(xx, yy)]) continue;
          if (xx === ans65[0].x && yy === ans65[0].y) continue;
          off65 = { x: xx, y: yy };
        }
      const tr65 = solutionFallbacks;
      tryPlay(off65.x, off65.y, false);
      /* ★ 2026-10-28 方案 A（应手让路）：配平窗口内 AI 应手会等，最多 TS_BAL_WAIT_MS=25 秒
         —— 这里改成轮询等，别写死 4 秒（写死的话窗口一挡就假失败）。
         断言本身**没放松**：退回计数必须 +1。 */
      const tAwait65 = Date.now();
      while (solutionFallbacks <= tr65 && Date.now() - tAwait65 < 32000) await sleep(200);
      step('走偏了 → 不再按正解摆，自动退回 KATAGO（退回计数 +1）',
        solutionFallbacks > tr65,
        '落下 ' + off65.x + ',' + off65.y + ' · 手数=' + state.moves.length
        + ' · 退回次数 ' + tr65 + '→' + solutionFallbacks
        + ' · 说明=' + (state.tsumego.defendNote || '（空）'));
      tsResetSolve(); await sleep(300);
    }

    /* ---------- 10.7 切走再切回来：接着同一道题（而不是空盘） ---------- */
    seg('seg-mode', 'free'); await sleep(300);
    $('m-start').click(); await sleep(500);
    seg('seg-mode', 'tsumego'); await sleep(300);
    $('m-start').click(); await sleep(900);
    step('切走再切回习题练习 → 接着刚才那道题（不是空盘、也不翻回第 1 题）',
      settings.mode === 'tsumego' && state.tsumegoSet && state.tsumegoSet.idx === 2
      && state.setup.length === 8 && state.tsumego.phase === 'setup',
      'idx=' + (state.tsumegoSet && state.tsumegoSet.idx) + ' 摆子=' + state.setup.length
      + ' 阶段=' + state.tsumego.phase);

    /* ---------- 10.9 打开题集时定位到上次练到的那一题（2026-10-16 用户要求）----------
       ★ 判据不能拿"内存里的 idx"糊过去 —— 那在修之前也成立（切模式回来本来就接着那道题）。
         这里要验的是**进度被记下来了**：先练到第 3 题 → 把题集摘掉（＝关掉这份练习册）→
         重新打开 → 必须落在第 3 题。347 道题的练习册不记进度，每次都得按上百次 ‹ 才能接着练。 */
    {
      const idxNow = state.tsumegoSet.idx;
      const nmNow = state.tsumegoSet.name;
      const raw = (() => { try { return localStorage.getItem('rapacego.pset.progress') || ''; } catch (e) { return ''; } })();
      step('进度写进了 localStorage（键里有题集名、值 = 做到第几题）',
        raw.indexOf(nmNow) >= 0 && idxNow > 0,
        '键里含题集名=' + (raw.indexOf(nmNow) >= 0) + ' 当前 idx=' + idxNow + ' 原始=' + raw.slice(0, 70));
      state.tsumegoSet = null; syncTsumegoUI(); await sleep(250);
      await openPuzzleSet(nmNow); await sleep(900);
      step('重新打开这份题集 → 直接落在上次那一题（不是第 1 题）',
        !!state.tsumegoSet && state.tsumegoSet.idx === idxNow
        && $('pset-pos').textContent === (idxNow + 1) + '/' + state.tsumegoSet.list.length,
        '上次 idx=' + idxNow + ' 现在 idx=' + (state.tsumegoSet && state.tsumegoSet.idx)
        + ' 位置=' + $('pset-pos').textContent);
    }

    /* ---------- 10.95 「当题练」不再重复复制（2026-10-16 用户报的 bug）----------
       原来 puzzles:importRecord 无条件走"重名加序号"→ 同一份棋谱每点一次「当题练」，
       puzzles/ 里就多一份 xxx (2).sgf / xxx (3).sgf（用户实测：连点三次出现三份）。
       现在同名且**内容相同** → 直接复用。
       ★ 判据只看**题集份数**：它不关心是"复用"还是"本来就没有"——
         连点两次份数必须一样（修之前第二次会 +1）。两次调用都走**真实 IPC**，
         就是「当题练」那个按钮点下去会走的那条路。 */
    {
      const FIX = ${REC_FIX_LIT};
      const hasRec = ((await window.api.records.list()) || []).some(r => r.name === FIX);
      if (!hasRec) {
        step('（测试用棋谱没放进棋谱库，这一段跳过 —— 不算失败）', true,
          '需要 ' + ${REC_DIR_LIT} + '/' + FIX);
      } else {
        /* 先把可能的残留清掉：这份夹具名固定，上一次跑测可能已经在 puzzles/ 里 */
        const before = ((await window.api.puzzles.list()) || []).map(p => p.name);
        if (before.indexOf(FIX) >= 0) await window.api.puzzles.remove(FIX);
        const n0 = ((await window.api.puzzles.list()) || []).length;
        const r1 = await window.api.puzzles.importRecord(FIX);
        const n1 = ((await window.api.puzzles.list()) || []).length;
        const r2 = await window.api.puzzles.importRecord(FIX);
        const n2 = ((await window.api.puzzles.list()) || []).length;
        step('第一次「当题练」→ 题集 +1（复制进来了）',
          !!r1 && r1.ok === true && n1 === n0 + 1, 'n0=' + n0 + ' n1=' + n1 + ' name=' + (r1 && r1.name));
        step('第二次「当题练」同一份棋谱 → 题集份数**不再增加**（复用已有那份，修前会多出 xxx (2).sgf）',
          !!r2 && r2.ok === true && r2.reused === true && n2 === n1,
          'n1=' + n1 + ' n2=' + n2 + ' reused=' + (r2 && r2.reused) + ' name=' + (r2 && r2.name));
        /* 棋谱库那行确实有「当题练」这个按钮（不点：点了会弹面板、切模式，影响后面几段） */
        await refreshRecords(); await sleep(300);
        step('棋谱库每行都有「当题练」入口',
          [...document.querySelectorAll('#reclist li')].some(li =>
            [...li.querySelectorAll('button')].some(b => /当题练/.test(b.textContent))),
          '棋谱库行数=' + document.querySelectorAll('#reclist li').length);
        /* 清掉这份测试题集，别影响后面的段（尤其是"题集份数"这类将来可能加的断言） */
        await window.api.puzzles.remove(FIX);
        await refreshPuzzles(); await sleep(200);
      }
    }

    /* ---------- 10.8 真实题集（347 题）----------
       ★ 只有 puzzles/ 里放了那份真实题集时才跑（夹具 _trash/fixtures/xxqj.sgf，
         由 dev/README.md 里那条启动命令复制进去）——
         外面拿不到那份文件时**不能算失败**，只报一行信息。
       ★ 为什么值得单独验：玩具夹具只有 3 道题、每道十几颗子；
         真实题集是**347 棵并列顶层树**、摆子动辄几十个、还有整盘题（113~127 颗摆子）。
         "切分算法在真实数据上会不会错位"是玩具夹具测不出来的。 */
    {
      const pz = await window.api.puzzles.list();
      const big = pz.find(p => /xxqj/i.test(p.name));
      if (!big) {
        step('（没找到真实题集夹具 xxqj.sgf，这一小段跳过 —— 不算失败）', true,
          '想跑它：把那份 347 题的题集放到 _trash/fixtures/xxqj.sgf');
      } else {
        await openPuzzleSet(big.name);
        await sleep(1500);
        step('打开真实题集《玄玄棋经》：347 道题全部解析出来（一棵树一道题、零跳过）',
          !!state.tsumegoSet && state.tsumegoSet.list.length === 347 && state.tsumegoSet.skipped === 0,
          '题数=' + (state.tsumegoSet && state.tsumegoSet.list.length)
          + ' 跳过=' + (state.tsumegoSet && state.tsumegoSet.skipped)
          + ' 文件=' + big.name);
        step('第 1 题按 SGF 摆好（6 颗摆子、白先、正解 11 手）',
          state.setup.length === 6 && settings.tfirst === 'w' && tsSetProblem().answer.length === 11,
          '摆子=' + state.setup.length + ' 先手=' + settings.tfirst
          + ' 正解=' + tsSetProblem().answer.length + ' 手');
        /* 抽查：含"没写 PL 的第 316 题"和最后一题（347）。
           ★ 判据 = 「先手」与「正解第一手的颜色」必须一致 —— 这是全局自洽性，
             玩具夹具只能验到 3 道，全 347 道都由解析层保证（_probe_set 探针里也校过一遍）。 */
        let bad = 0; const det = [];
        for (const i of [0, 50, 315, 346]) {
          tsLoadProblem(i);
          await sleep(120);
          const p = tsSetProblem();
          const ok = p.setup.length > 0 && p.answer.length > 0 && p.first === p.answer[0].color;
          if (!ok) bad += 1;
          det.push('#' + (i + 1) + '摆' + p.setup.length + '/先' + p.first + '/解' + p.answer.length + (ok ? '' : '★'));
        }
        step('抽查 4 道题（含最后一题）：摆子 / 先手 / 正解都自洽', bad === 0,
          det.join(' · ') + ' · 不自洽=' + bad);

        /* ---------- 10.8.5 换一道题 → 必须重新配平（2026-10-28 用户报障）----------
           以前 tsLoadProblem 不清 t.bal，而 tsKomi() 故意不按 sig 回退 →
           新题的探针是**按上一题的贴目**发出去的，折出来的贴目整整差一个旧贴目
           （实测 xxqj 第 2 题折成 −25.5，真值 ≈ +12）；同时右侧胜率卡被上一题残留的
           state.anaAt[0] 顶着，看起来就是「没重新配平」。
           现在的判据三条：换题后 bal 置空 + tsKomi 回 0 目口径（探针才准）+ 卡片写「计算中…」；
           再换回去要命中缓存（不重算）。 */
        {
          tsLoadProblem(0); await sleep(250);
          $('btn-ts-start').click();
          const tFold = Date.now();
          while (!(state.tsumego.bal && state.tsumego.bal.sig === setupSig())
            && Date.now() - tFold < 60000) await sleep(200);
          const k1 = state.tsumego.bal ? state.tsumego.bal.komi : null;
          const foldMs = Math.round((Date.now() - tFold) / 100) / 10;
          tsLoadProblem(1); await sleep(250);
          const bal2 = state.tsumego.bal;
          const komi2 = tsKomi();
          const wr2 = $('eval-wr').textContent || '';
          tsLoadProblem(0); await sleep(250);
          const backKomi = state.tsumego.bal ? state.tsumego.bal.komi : null;
          step('换到第 2 题：贴目置空 + 回 0 目口径（探针才按 0 目发）+ 胜率卡不残留上一题的数',
            Number.isFinite(k1) && bal2 === null && komi2 === 0 && wr2.indexOf('计算中') >= 0,
            '第 1 题配平=' + k1 + '（' + foldMs + ' 秒）→ 换题后 bal=' + String(bal2)
            + ' tsKomi=' + komi2 + ' 卡片=' + JSON.stringify(wr2));
          step('换回第 1 题：命中缓存，配平值原样回来（不重算）',
            backKomi === k1, '回来=' + backKomi + ' 原来=' + k1);
          tsLoadProblem(0); await sleep(200);
        }

        /* ★★ 2026-10-17：变化树（新增）。两件事一起验：
           ① 树的主链必须与「正解」主线**逐手一致** —— 建树时把变体接错位置/漏接节点，
              这条会立刻亮（347 题逐题比，不是抽一道）；
           ② 「按正解」走**非主线分支**时也要能照那一支应（旧实现只读主线，会当成走偏）。 */
        {
          let mismatch = 0, withVar = 0;
          for (const pp of state.tsumegoSet.list) {
            const flat = [];
            let nd = pp.tree && pp.tree.children[0];
            while (nd && nd.move) { flat.push(nd.move); nd = nd.children[0]; }
            const same = flat.length === pp.answer.length && flat.every((m, i) =>
              m.color === pp.answer[i].color && !!m.pass === !!pp.answer[i].pass
              && (m.pass || (m.x === pp.answer[i].x && m.y === pp.answer[i].y)));
            if (!same) mismatch++;
            const walk = x => {
              if (!x) return 0;
              let n = x.children.length > 1 ? 1 : 0;
              for (const c of x.children) n += walk(c);
              return n;
            };
            if (walk(pp.tree) > 0) withVar++;
          }
          step('347 题：树的主链与「正解」主线逐手一致（建树没接错位置）',
            mismatch === 0, '不一致=' + mismatch + ' / ' + state.tsumegoSet.list.length);
          step('347 题里有 ' + withVar + ' 题带变体分支（旧解析层整块丢掉）',
            withVar > 0, '带分支=' + withVar);
        }
        {
          /* 第 31 题：第一手就有 3 条并列分支 —— 正好用来验「非主线分支」。 */
          tsLoadProblem(30); await sleep(300);
          $('btn-ts-start').click(); await sleep(700);
          seg('seg-tsdefend', 'solution'); await sleep(250);
          const p31 = tsSetProblem();
          const kids = p31.tree.children.filter(c => c.move);
          const alt = kids[1];
          const expect = alt && alt.children.find(c => c.move);
          const fb0 = solutionFallbacks;
          if (!alt || !expect) {
            step('（第 31 题没有第二条分支，这一段跳过）', true, '分支数=' + kids.length);
          } else {
            tryPlay(alt.move.x, alt.move.y, false);
            const t85 = Date.now();
            while (state.moves.length < 2 && Date.now() - t85 < 9000) await sleep(120);
            step('「按正解」：走第二条分支（不在主线上）也能照这一支应',
              state.moves.length === 2
              && state.moves[1].x === expect.move.x && state.moves[1].y === expect.move.y
              && solutionFallbacks === fb0,
              '第一手分支数=' + kids.length + ' 手数=' + state.moves.length
              + ' 应手=' + (state.moves[1] ? state.moves[1].x + ',' + state.moves[1].y : '—')
              + ' 该分支应手=' + expect.move.x + ',' + expect.move.y
              + ' 退回次数=' + fb0 + '→' + solutionFallbacks);
            tsResetSolve(); await sleep(200);
          }
        }
        tsLoadProblem(0);
        await sleep(300);
      }
    }

    /* 收尾前把题集摘掉：下面那段要用手摆的题（截图用）——
       ⚠️ 不摘的话 enterTsumego 会"接着题集那道题"，手摆的摆子会叠在题目上。 */
    state.tsumegoSet = null;
    syncTsumegoUI();
    step('摘掉题集后：题集行回到「未打开」、正解按钮置灰',
      $('btn-pset').textContent === '未打开' && $('pset-pos').textContent === '—'
      && $('btn-ts-answer').disabled,
      '名字=' + JSON.stringify($('btn-pset').textContent) + ' 正解禁用=' + $('btn-ts-answer').disabled);
  }

  /* 收尾：**故意停在「习题练习 · 摆题中」**（而不是复位成未开局）——
     脚本最后那张截图正好能看到左栏练习卡与「开始解题」按钮，
     不然截出来是一片"未开局"的中性界面，什么也看不出来。 */
  seg('seg-mode', 'tsumego'); await sleep(300);
  $('m-start').click(); await sleep(600);
  seg('seg-tscolor', 'b'); await sleep(120);
  for (const [x, y] of BLACK) placeSetupStone(x, y, false);
  seg('seg-tscolor', 'w'); await sleep(120);
  for (const [x, y] of WHITE) placeSetupStone(x, y, false);
  await sleep(500);
  step('收尾：停在摆题状态（供截图）',
    state.tsumego.phase === 'setup' && state.setup.length === BLACK.length + WHITE.length,
    '阶段=' + state.tsumego.phase + ' setup=' + state.setup.length);

  /* ---------- 11. ★ 练习卡高度：任何时刻都一样（2026-10-14 用户要求）----------
     卡着这条的是几处改动：① 会"冒出来/变长"的文字全删；② 常驻行不随阶段显隐；
     ③ 「我下两边」时 KATAGO 那一行改置灰（原来藏起来）；④ 每行 min-height 统一 28px。
     只要其中任一被改回去，这条就会亮 —— 这是唯一能真正守住"高度不变"的断言。 */
  {
    const hs = cardH.map(o => o.h);
    const same = hs.length >= 4 && hs.every(h => h === hs[0]);
    step('练习卡高度在任何状态下都不变（摆题/解题/交替摆棋/我下两边/题集/正解中）',
      same, cardH.map(o => o.tag + '=' + o.h).join(' · ')
      + (same ? '' : ' ★ 高度不一致'));
  }

  return JSON.stringify({
    步骤: steps,
    /* ★ 应手链路的诊断轨迹（app.js 里的 defendTrace）。挂在这里是因为那条链路有
       "被掐断 / 重试 / 作废"好几种正常路径，只看最终一句 defendNote 判断不出卡在哪。 */
    应手轨迹: (typeof defendTrace === 'undefined' ? '（没有这个变量）' : defendTrace.slice()),
  }, null, 1);
})()`);

await new Promise(r => setTimeout(r, 1500));
/* 表达式抛异常时，把挂在 window 上的已跑步骤捞回来 —— 否则什么都看不到 */
if (typeof out === 'string' && out.startsWith('ERR:')) {
  let still = '（也没捞到）';
  try { still = await js('JSON.stringify({ 步骤: (window.__tsSteps || []) }, null, 1)'); } catch (e) { /* 尽力而为 */ }
  console.log('！！表达式抛异常了。下面是**已经跑到**的步骤：');
  console.log(still);
  console.log(out);
} else {
  console.log(out);
}
console.log('');
console.log('=== 运行时错误（未捕获异常 / console.error）===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');

/* ★ 顺带截一张图。用 CDP 的 Page.captureScreenshot —— 跨平台；
   （项目原来的截图在 _rtest.py 里，用的是 Windows 的 PrintWindow，mac 上跑不了。）
   界面类问题光看断言不够，有图能一眼确认排版。 */
try {
  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outPng = path.join(ROOT_DIR, '_trash', '_tsumego_shot.png');
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, 'base64'));
  console.log('截图: ' + outPng);
} catch (e) {
  console.log('（截图失败：' + ((e && e.message) || e) + '）');
}

ws.close();
process.exit(0);
