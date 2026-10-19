/* 端到端：① 右侧「解说词」卡逐手显示引擎分析明细  ② 双方都由 KATAGO 走（自动对弈）
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_moveinfo.mjs
   ★ 这两块都不需要真引擎：
     · 分析明细——直接给 applyAnalysis 喂构造好的报文（走的是**真代码路径**：
       视角换算 / 快照 / 渲染全过一遍），只把"引擎算出来的数"换成已知值；
     · 自动对弈——只验"什么时候该落子"这套判据（needAIMove / isMyTurn / 暂停按钮），
       把 engineReadyPlay 临时置真即可，真落子由另外的探针跑。
   ★ 模板串里禁用反引号（项目纪律 #10）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 等端口 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT);
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errs.push((d.exception && d.exception.description) || d.text || '?');
  }
};
const send = (method, params) => new Promise(res => {
  const i = ++seq; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Runtime.enable');
async function js(expr, timeout) {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true, timeout: timeout || 30000,
  });
  if (r.result && r.result.exceptionDetails) {
    const e = r.result.exceptionDetails;
    return 'ERR:' + ((e.exception && e.exception.description) || e.text);
  }
  return r.result && r.result.result && r.result.result.value;
}

const out = await js(`(async () => {
  const steps = [];
  const step = (name, ok, detail) => steps.push((ok ? '✓ ' : '★ ') + name + (detail ? ' → ' + detail : ''));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- 0. 干净开局（双人摆棋：没有 AI 抢着落子，方便逐步构造） ---------- */
  localStorage.removeItem('rapacego.pset.progress');
  state.tsumegoSet = null;
  settings.mode = 'free';
  settings.autoBoth = false;
  applyNewGame(false);
  await sleep(200);

  /* ---------- 1. 逐手分析：构造报文 → 真代码路径 ----------
     报文里的 winrate / scoreLead 都是「**轮到走棋那一方**」的视角（引擎口径），
     故意让两次报文的 currentPlayer 不同（B / W / B），这样符号换算错了会立刻露馅。 */
  const P0 = {   // 空盘，轮到黑
    root: { currentPlayer: 'B', winrate: 0.50, scoreLead: 0.0, visits: 900 },
    moves: [
      { move: 'Q16', winrate: 0.55, scoreLead: 1.0, prior: 0.70, order: 0, visits: 600, pv: ['Q16', 'D4', 'Q4'] },
      { move: 'D16', winrate: 0.50, scoreLead: 0.2, prior: 0.20, order: 1, visits: 100, pv: ['D16'] },
    ],
  };
  applyAnalysis(P0, 0);

  tryPlay(15, 3, false);            // 第 1 手 B Q16
  await sleep(120);
  step('第 1 手落在盘上', state.moves.length === 1 && state.moves[0].color === 'b',
    '手数=' + state.moves.length + ' 颜色=' + (state.moves[0] && state.moves[0].color));

  /* 第 1 手之后的局面（轮到白）。最佳选点 = J13：白方视角 −2.0 → 黑方 +2.0 */
  const P1 = {
    root: { currentPlayer: 'W', winrate: 0.45, scoreLead: -1.6, visits: 900 },
    moves: [
      { move: 'J13', winrate: 0.40, scoreLead: -2.0, prior: 0.62, order: 0, visits: 700, pv: ['J13', 'L14', 'J14', 'O17'] },
      { move: 'D4', winrate: 0.42, scoreLead: -1.8, prior: 0.20, order: 1, visits: 150, pv: ['D4', 'Q4'] },
    ],
  };
  state.viewAt = 1; applyAnalysis(P1, 1);

  tryPlay(3, 15, false);            // 第 2 手 W D4
  await sleep(120);
  step('第 2 手落在盘上', state.moves.length === 2 && state.moves[1].color === 'w',
    '手数=' + state.moves.length);

  /* 第 2 手之后的局面（轮到黑）：黑领先 2.5 目 —— 用来算"目数损失"（2.0 → 2.5 差 0.5） */
  const P2 = {
    root: { currentPlayer: 'B', winrate: 0.62, scoreLead: 2.5, visits: 900 },
    moves: [
      { move: 'R14', winrate: 0.63, scoreLead: 3.0, prior: 0.5, order: 0, visits: 700, pv: ['R14'] },
    ],
  };
  applyAnalysis(P2, 2);

  state.viewAt = 2; syncUI(); await sleep(150);
  const txt = (document.getElementById('cbox').textContent || '').trim();
  const L = txt.split('\\n');
  step('解说词卡显示的是「第 2 手」的分析（标题也标了）',
    /第 2 手/.test(document.getElementById('cbox-at').textContent), document.getElementById('cbox-at').textContent);
  step('第 1 行 = 手数 + 执子方 + 坐标', L[0] === '手数 2: W D4', JSON.stringify(L[0]));
  step('分数：走完这一手之后的目差（黑领先 2.5）', L[1] === '分数: 黑+2.5', JSON.stringify(L[1]));
  step('胜率：领先那一方的胜率（黑 62.0%）', L[2] === '胜率: 黑 62.0%', JSON.stringify(L[2]));
  step('目数损失 = 最佳选点期望(黑+2.0) − 实际(黑+2.5) → 0.5', L[3] === '目数损失: 0.5', JSON.stringify(L[3]));
  step('推荐最佳选点 + 目差（J13 · 白方视角−2.0 换成年黑方 +2.0）',
    L[4] === '推荐最佳选点 J13 (黑+2.0)', JSON.stringify(L[4]));
  step('PV 第一手带颜色字母，后面只写坐标（轮白走 → W 开头）',
    L[5] === 'PV: WJ13 L14 J14 O17', JSON.stringify(L[5]));
  step('直觉选点排名：这一手在候选里按先验排第 2（20.00%）',
    L[6] === '直觉选点下该手棋是 #2 (20.00%)', JSON.stringify(L[6]));
  step('最佳直觉选点（先验最高）= J13 (62.0%)',
    L[7] === '最佳直觉选点是 J13 (62.0%)', JSON.stringify(L[7]));
  step('这块内容是只读的（「编辑」按钮置灰）',
    document.getElementById('cbox-edit').disabled === true, '禁用=' + document.getElementById('cbox-edit').disabled);

  /* 回看第 1 手：显示的是第 1 手自己的那一块（不是第 2 手的） */
  state.viewAt = 1; syncUI(); await sleep(120);
  const t1 = (document.getElementById('cbox').textContent || '').trim().split('\\n');
  step('回看第 1 手 → 换成第 1 手的分析块', t1[0] === '手数 1: B Q16', JSON.stringify(t1[0]));
  step('第 1 手那一块用的是**它之前**（空盘）的分析：推荐 Q16 / 目损 0.0',
    t1[3] === '目数损失: 0.0' && t1[4] === '推荐最佳选点 Q16 (黑+1.0)',
    JSON.stringify(t1[3]) + ' · ' + JSON.stringify(t1[4]));
  state.viewAt = 2; syncUI(); await sleep(80);

  /* ---------- 2. 双方都由 KATAGO 走：判据 ---------- */
  /* ★ needAIMove 只在「AI 对弈」模式下才为真 —— 前面为了不被 AI 抢着落子用的是双人摆棋，
     这里要先切回 play（盘面/手顺不动，只是换个模式判断）。 */
  settings.mode = 'play';
  setSeg('seg-mode', 'play');
  const savedReady = engineReadyPlay;
  engineReadyPlay = true;
  state.autoBoth = true; state.autoPaused = false;
  state.noGame = false; state.result = null; state.draft = null;
  state.viewAt = state.moves.length;
  state.myColor = 'b';                    // 故意设成"你执黑"，看自动对弈会不会被它挡住
  const need1 = needAIMove();
  state.myColor = 'w';
  const need2 = needAIMove();
  step('自动对弈：轮到黑/轮到白**都**要落子（不看"我执哪边"）', need1 === true && need2 === true,
    'myColor=b→' + need1 + ' myColor=w→' + need2);
  step('自动对弈时 isMyTurn() = false（人手落子会被 tryPlay 挡住）', isMyTurn() === false, 'isMyTurn=' + isMyTurn());
  state.autoPaused = true;
  step('按了「暂停」→ 不再落子', needAIMove() === false, 'needAIMove=' + needAIMove());

  /* ★ 上一条为了验"暂停就不落子"把 autoPaused 置真了 —— 这里先复位，
     否则按钮一上来就显示「继续」（判据会误判成"按钮文字不对"）。 */
  state.autoPaused = false;
  $('btn-auto').hidden = true; syncUI(); await sleep(80);
  step('开了自动对弈 → 底栏出现「暂停」按钮，文字 = 暂停',
    $('btn-auto').hidden === false && $('btn-auto').textContent === '暂停',
    '隐藏=' + $('btn-auto').hidden + ' 文字=' + $('btn-auto').textContent);
  $('btn-auto').click(); await sleep(80);
  step('点一下 → 变成「继续」并点亮（暂停中）',
    $('btn-auto').textContent === '继续' && $('btn-auto').classList.contains('on') && state.autoPaused === true,
    '文字=' + $('btn-auto').textContent + ' 点亮=' + $('btn-auto').classList.contains('on'));
  $('btn-auto').click(); await sleep(80);
  step('再点一下 → 回到「暂停」，继续下棋',
    $('btn-auto').textContent === '暂停' && state.autoPaused === false,
    '文字=' + $('btn-auto').textContent + ' autoPaused=' + state.autoPaused);

  /* 关掉自动对弈 → 按钮收起，回到「只让 AI 走另一方」的老行为 */
  state.autoBoth = false; state.autoPaused = false;
  state.myColor = 'b';
  state.viewAt = state.moves.length;      // 轮白 → 不是我的回合 → 该 AI 走
  const need3 = needAIMove();
  state.myColor = 'w';
  const need4 = needAIMove();
  syncUI(); await sleep(60);
  step('关掉之后恢复原样：轮白时你会下（needAIMove=false）、轮白给 AI 才落子',
    need3 === false && need4 === true, 'myColor=b→' + need3 + ' myColor=w→' + need4);
  step('关掉之后「暂停」按钮收起', $('btn-auto').hidden === true, '隐藏=' + $('btn-auto').hidden);
  engineReadyPlay = savedReady;
  clearTimeout(aiTimer);

  return JSON.stringify({ 步骤: steps }, null, 1);
})()`, 120000);

await new Promise(r => setTimeout(r, 400));
console.log(out);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');

/* 截图：解说词卡（看实际排版） */
try {
  await js('(function(){ state.viewAt = 2; syncUI(); return 1; })()');
  await new Promise(r => setTimeout(r, 500));
  await send('Page.enable');
  const box = await js('(function(){ const c = document.getElementById("cbox-card");'
    + ' const r = c.getBoundingClientRect();'
    + ' return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()');
  const clip = Object.assign(JSON.parse(box), { scale: 2 });
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  const outPng = path.join(ROOT_DIR, '_trash', '_moveinfo_shot.png');
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, 'base64'));
  console.log('截图: ' + outPng + '（解说词卡，2 倍）');
} catch (e) {
  console.log('（截图失败：' + ((e && e.message) || e) + '）');
}

ws.close();
process.exit(0);
