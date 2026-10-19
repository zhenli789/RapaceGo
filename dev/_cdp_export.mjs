/* 端到端：导出命名 / 棋谱库列表 / 复盘按钮合并 / 连停一手终局 / 回看不显示胜负 / 导出带分析
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_export.mjs
   ★ 需要 RAPACEGO_RECORDS 指到临时棋谱库（脚本会往里写一份假复盘文件，绝不碰用户数据）。
   ★ 两段 js 之间要 Node 侧写文件 —— 所以分两次求值，别把 fs 写进模板串里（那是浏览器上下文）。
   ★ 模板串里禁用反引号（项目纪律 #10）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');

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

/* ---------- 第一段：导出命名 + 棋谱库列表 ---------- */
const p1 = await js(`(async () => {
  const steps = [];
  window.__steps = steps;
  window.__step = (name, ok, detail) => steps.push((ok ? '✓ ' : '★ ') + name + (detail ? ' → ' + detail : ''));
  const step = window.__step;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 1. 导出文件名 */
  settings.mode = 'free'; settings.autoBoth = false;
  applyNewGame(false); await sleep(150);
  const nFree = recordFileName();
  step('双人摆棋 → 文件名 = "P1 vs P2-时间"（12 位，年月日时分）',
    /^P1 vs P2-\\d{12}\\.sgf$/.test(nFree), nFree);

  settings.mode = 'play'; state.myColor = 'b'; setLevel('rank_3d');
  applyNewGame(false); await sleep(150);
  const nPlay = recordFileName();
  step('人机对弈 → 文件名 = "P1 vs AI(3段)-时间"（vs 连接、段位跟在 AI 名字后）',
    /^P1 vs AI\\(3段\\)-\\d{12}\\.sgf$/.test(nPlay), nPlay);
  const d = new Date(), p2 = x => String(x).padStart(2, '0');
  /* ★ 先剥掉 .sgf 再取尾 12 位 —— 直接对整串 slice(-12,-4) 会把 ".sgf" 算进去（踩过一次） */
  const core = nPlay.replace(/\.sgf$/i, '');
  step('时间那段真的是「年月日时分」：前 8 位 = 今天、后 4 位 = 时分',
    core.slice(-12, -4) === String(d.getFullYear()) + p2(d.getMonth() + 1) + p2(d.getDate())
    && core.slice(-4) === p2(d.getHours()) + p2(d.getMinutes()), nPlay);

  /* 双方都是 AI（自动对弈）→ **两边都带段位** */
  state.autoBoth = true;
  const nAuto = recordFileName();
  state.autoBoth = false;
  step('双方都是 AI → 两个 AI 名字后面都带段位：AI(3段) vs AI(3段)',
    /^AI\\(3段\\) vs AI\\(3段\\)-\\d{12}\\.sgf$/.test(nAuto), nAuto);

  /* ★ 真的存一份「人机对弈」的 → 括号不能被文件名清洗掉（(3段) 里的括号是合法的） */
  settings.mode = 'play'; applyNewGame(false); await sleep(120);
  tryPlay(15, 3, true); await sleep(80);
  const savedPlay = await saveToRecords(); await sleep(300);
  step('括号版文件名能真的写进棋谱库（没被清洗掉）',
    !!savedPlay && /^P1 vs AI\\(3段\\)-\\d{12}\\.sgf$/.test(savedPlay.name),
    savedPlay && savedPlay.name);

  /* 2~3. 棋谱库列表 */
  settings.mode = 'free';
  applyNewGame(false); await sleep(120);
  tryPlay(15, 3, false); tryPlay(3, 15, false); await sleep(150);
  const saved = await saveToRecords(); await sleep(400);
  window.__savedName = saved && saved.name;
  step('导出成功、文件名符合命名规则（同分钟撞名会加 (2)/(3) 后缀）',
    !!saved && /^P1 vs P2-\\d{12}( \\(\\d+\\))?\\.sgf$/.test(saved.name),
    saved && saved.name);

  await refreshRecords(); await sleep(300);
  const findRow = () => [...document.querySelectorAll('#reclist li')].find(li =>
    (li.textContent || '').indexOf(String(window.__savedName).replace(/\\.sgf$/i, '')) >= 0);
  const row = findRow();
  step('列表里能看得到这份新棋谱（文件名显示出来了）', !!row,
    row ? row.querySelector('.rec-name').textContent : '(没找到)');
  const rowTxt = row ? row.textContent : '';
  step('不再显示文件大小 / 时间 / 已复盘', !/KB|已复盘|月.*日/.test(rowTxt),
    JSON.stringify(rowTxt.slice(0, 60)));
  const btns = row ? [...row.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
  step('没复盘过 → 只有一个「AI 复盘」按钮（不再并排一个灰的「复盘报告」）',
    btns.filter(t => /复盘/.test(t)).join('|') === 'AI 复盘', '按钮=' + btns.join('|'));

  return window.__savedName || '';
})()`, 120000);
console.log('保存的文件: ' + p1);

/* ---------- Node 侧：造一份假复盘文件（模拟"已复盘"） ---------- */
let faked = false;
try {
  if (REC_DIR && p1 && p1.indexOf('ERR:') !== 0) {
    fs.writeFileSync(path.join(REC_DIR, p1 + '.review.json'),
      JSON.stringify({ text: '（测试用的假复盘报告）' }), 'utf8');
    faked = true;
  }
} catch (e) {
  console.log('写假复盘文件失败：' + ((e && e.message) || e));
}

/* ---------- 第二段：复盘按钮切换 + 终局 + 回看 + 导出带分析 ---------- */
const p2 = await js(`(async () => {
  const step = window.__step;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  if (${faked ? 'true' : 'false'}) {
    await refreshRecords(); await sleep(400);
    const row2 = [...document.querySelectorAll('#reclist li')].find(li =>
      (li.textContent || '').indexOf(String(window.__savedName).replace(/\\.sgf$/i, '')) >= 0);
    const btns2 = row2 ? [...row2.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
    step('复盘过 → 同一个按钮变成「复盘报告」（还是一个）',
      btns2.filter(t => /复盘/.test(t)).join('|') === '复盘报告', '按钮=' + btns2.join('|'));
    step('列表里仍然没有「已复盘」这行字', !/已复盘/.test(row2 ? row2.textContent : ''),
      JSON.stringify((row2 ? row2.textContent : '').slice(0, 60)));
  } else {
    step('（没写进假复盘文件，那一段跳过）', true, '');
  }

  /* 4. 连续两个 pass = 终局 */
  settings.mode = 'play'; applyNewGame(false); await sleep(120);
  tryPlay(15, 3, false); tryPlay(3, 15, false); await sleep(120);
  $('btn-pass').click(); await sleep(120);
  $('btn-pass').click(); await sleep(200);
  step('连停两手 → isTerminal() 成立', isTerminal() === true,
    '手数=' + state.moves.length + ' 末两手=' + state.moves.slice(-2).map(m => m.pass ? 'pass' : 'x').join(','));
  const savedReady = engineReadyPlay;
  engineReadyPlay = true;
  state.autoBoth = true; state.autoPaused = false; state.result = null;
  state.viewAt = state.moves.length; state.noGame = false; state.draft = null;
  step('自我对弈：终局之后**不再排下一手**（原来会一路 pass 下去）',
    needAIMove() === false, 'needAIMove=' + needAIMove());
  state.autoBoth = false; engineReadyPlay = savedReady;

  /* 5. 回看时不显示胜负条 */
  state.result = { winner: 'b', lead: 3.5, unit: '子', resign: false, by: 'score', terminal: true, at: state.moves.length };
  state.viewAt = state.moves.length; syncUI(); await sleep(150);
  step('在最后一手 → 结论条可见', $('verdict').hidden === false, 'hidden=' + $('verdict').hidden);
  state.viewAt = 2; syncUI(); await sleep(150);
  step('回看到第 2 手 → 结论条收起（不再挂在棋盘上）', $('verdict').hidden === true,
    'hidden=' + $('verdict').hidden);
  step('回看**不会**把结果清掉（导出还要用它写 RE[]）', !!state.result,
    'result=' + (state.result ? state.result.winner + '+' + state.result.lead : 'null'));
  state.viewAt = state.moves.length; syncUI(); await sleep(150);
  step('回到最后一手 → 结论又出现（不用重新数子）', $('verdict').hidden === false,
    'hidden=' + $('verdict').hidden);

  /* 6. 导出把每手分析写进 C[] */
  settings.mode = 'free'; applyNewGame(false); await sleep(120);
  tryPlay(15, 3, false); await sleep(80);
  const P0 = { root: { currentPlayer: 'B', winrate: 0.5, scoreLead: 0, visits: 900 },
    moves: [{ move: 'Q16', winrate: 0.55, scoreLead: 1.0, prior: 0.6, order: 0, visits: 600, pv: ['Q16', 'D4'] },
            { move: 'D16', winrate: 0.5, scoreLead: 0.2, prior: 0.2, order: 1, visits: 100, pv: ['D16'] }] };
  applyAnalysis(P0, 0);
  tryPlay(3, 15, false); await sleep(80);
  const P1 = { root: { currentPlayer: 'W', winrate: 0.45, scoreLead: -1.6, visits: 900 },
    moves: [{ move: 'J13', winrate: 0.40, scoreLead: -2.0, prior: 0.62, order: 0, visits: 700, pv: ['J13', 'L14'] }] };
  state.viewAt = 1; applyAnalysis(P1, 1);
  const P2 = { root: { currentPlayer: 'B', winrate: 0.62, scoreLead: 2.5, visits: 900 },
    moves: [{ move: 'R14', winrate: 0.63, scoreLead: 3.0, prior: 0.5, order: 0, visits: 700, pv: ['R14'] }] };
  applyAnalysis(P2, 2);

  const sgf = buildSGF();
  step('导出的 SGF 里带上了每手的 C[] 分析',
    sgf.indexOf('C[手数 1: B Q16') >= 0 && sgf.indexOf('C[手数 2: W D4') >= 0,
    'C[] 个数=' + (sgf.match(/C\\[手数/g) || []).length);
  const re = parseSGF(sgf);
  const c1 = String((re.comments || [])[1] || '').replace(/\\r/g, '');
  const c2 = String((re.comments || [])[2] || '').replace(/\\r/g, '');
  step('再解析回来，第 1/2 手的解说词就是那段分析',
    /手数 1: B Q16/.test(c1) && /推荐最佳选点 J13/.test(c2) && /最佳直觉选点是 J13/.test(c2),
    'c1[0]=' + JSON.stringify(c1.split('\\n')[0]) + ' · c2 行数=' + c2.split('\\n').length);

  /* 收尾：把弹窗都关掉 —— 后面的测试（比如 _cdp_tsumego）要自己开面板，
     留着一个开着的遮罩会干扰它们（测试之间要互不污染）。 */
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));

  return JSON.stringify({ 步骤: window.__steps }, null, 1);
})()`, 120000);

console.log(p2);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
