/* 端到端：棋谱变体浏览 + 导出保留分支（2026-10-17）
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_variation.mjs
   ★ 需要 records 目录里有两份夹具（本脚本会自己从 _trash/fixtures/tree/ 复制过去，
     用的是 RAPACEGO_RECORDS 指定的**临时**棋谱库，绝不碰用户数据）。
   ★ 模板串里的注释禁用反引号（项目纪律 #10）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');
const FIX_A = '03-branch-mid.sgf';
const FIX_B = '05-comments.sgf';
const FIX_C = '10-nested-branch.sgf';
for (const f of [FIX_A, FIX_B, FIX_C]) {
  try {
    if (!REC_DIR) break;
    fs.mkdirSync(REC_DIR, { recursive: true });
    const src = path.join(ROOT_DIR, '_trash', 'fixtures', 'tree', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(REC_DIR, f));
  } catch (e) { /* 放不进去就让那一段自己跳过 */ }
}
const A_LIT = JSON.stringify(FIX_A);
const B_LIT = JSON.stringify(FIX_B);
const C_LIT = JSON.stringify(FIX_C);

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
    const d = m.params.exceptionDetails || {};
    errs.push('未捕获异常: ' + (d.exception?.description || d.text || '?').split('\n')[0]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const steps = [];
  window.__varSteps = steps;
  const step = (n, ok, x) => steps.push((ok ? '✓ ' : '★ ') + n + (x === undefined || x === '' ? '' : ' → ' + x));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const A = ${A_LIT}, B = ${B_LIT};
  const key = code => window.dispatchEvent(new KeyboardEvent('keydown',
    { key: code, code: code, altKey: true, bubbles: true, cancelable: true }));
  const line = () => state.moves.map(m => m.pass ? 'pass' : (m.x + ',' + m.y)).join(' ');
  const branchCount = nd => {
    if (!nd) return 0;
    let n = nd.children.length > 1 ? 1 : 0;
    for (const c of nd.children) n += branchCount(c);
    return n;
  };
  const allMoves = nd => {
    let n = 0;
    const w = x => { if (!x) return; if (x.move) n++; x.children.forEach(w); };
    w(nd);
    return n;
  };

  /* ---------- 1. 打开带变体的棋谱 ---------- */
  await openRecord(A);
  await sleep(900);
  step('打开棋谱 → 读到了变化树', !!state.varRoot,
    '树=' + !!state.varRoot + ' 手数=' + state.moves.length + ' 主线=' + line());
  const root = state.varRoot;
  const first = root ? root.children.find(c => c.move) : null;
  const kids = first ? first.children.filter(c => c.move) : [];
  step('第一手下面有 2 条变体（SGF 里写的两条线）', kids.length === 2, '分支数=' + kids.length);
  step('主分支 = SGF 的第一条线（4 手）', state.moves.length === 4, '手数=' + state.moves.length);

  /* ---------- 2. 手数卡 = 棋子圆圈 + 折线分支树（2026-10-18 第三次改版）----------
     03 的树：主线 1→2→3→4；第 2 手还有一条分支（2'→3'）。
     布局：row = 第几手（同一手的两种走法落在**同一行**），col = 第几列（每条分支独占一列）。
     判据全部量**真实几何**：圆圈坐标、连线的段数（折线 = 3 段 L，竖线 = 1 段）。 */
  const lis = [...document.querySelectorAll('#movelist li[data-r]')];
  const dots = lis.map(li => li.querySelector('.dot'));
  const nums = dots.map(d => +d.textContent);
  const pos = lis.map(li => {
    const r = li.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  const listTxt = $('movelist').textContent;
  step('手数卡画成棋子圆圈：主线 4 手 + 分支 2 手 = 6 个圈',
    lis.length === 6 && nums.join(',') === '1,2,3,4,2,3',
    '圆圈数=' + lis.length + ' 手数=' + nums.join(','));
  step('圆圈颜色跟执子方一致（黑先 → 第 1 手黑、第 2 手白，分支第 2 手也是白）',
    dots[0].classList.contains('b') && dots[1].classList.contains('w')
    && dots[4].classList.contains('w'),
    '1=' + dots[0].className + ' 2=' + dots[1].className + ' 2′=' + dots[4].className);
  step('不再显示坐标（列表文字里没有落点）',
    !/Q16|D4|Q4|D16/.test(listTxt), JSON.stringify(listTxt.replace(/\s+/g, ' ').slice(0, 40)));
  /* ★ 树的样子：分支的「2」跟主线的「2」**同一行**、**右边一列**；
     它的「3」跟主线的「3」也是同一行 —— 这正是用户画的那张图。 */
  step('分支跟被替代的那一手**同一行**、往右一列（竖向树，不是缩进列表）',
    pos[4].y === pos[1].y && pos[4].x > pos[1].x + 10
    && pos[5].y === pos[2].y && pos[5].x === pos[4].x,
    '主线2=(' + pos[1].x + ',' + pos[1].y + ') 分支2=(' + pos[4].x + ',' + pos[4].y + ')'
    + ' 主线3=(' + pos[2].x + ',' + pos[2].y + ') 分支3=(' + pos[5].x + ',' + pos[5].y + ')');
  /* 连线：5 条边（6 个节点），其中 1 条是折线（M…L…L…L…）——分支那一支 */
  {
    const paths = [...document.querySelectorAll('#movelist svg.tree-lines path')];
    const segs = paths.map(p => (p.getAttribute('d').match(/L/g) || []).length);
    const elbow = paths.filter(p => (p.getAttribute('d').match(/L/g) || []).length === 3);
    const elbowD = elbow[0] ? elbow[0].getAttribute('d') : '';
    /* 取折线 d 里所有坐标，看横跨了多远（同一列的话 dx 只有 0） */
    /* ★ 别在这里写带反斜杠的正则：这段代码包在模板串里，反斜杠会被先吃掉
       （本项目纪律 #10 的变种）→ 直接按"非数字"切开，一个转义都不用。 */
    const nums2 = elbowD.split(/[^0-9.]+/).filter(x => x !== '').map(Number);
    const xsv = nums2.filter((v, i) => i % 2 === 0);
    const dx = xsv.length ? Math.max.apply(null, xsv) - Math.min.apply(null, xsv) : 0;
    step('圆圈之间用折线连起来：5 条边，其中 1 条是「竖→横→竖」的分支折线',
      paths.length === 5 && elbow.length === 1 && segs.filter(n => n === 1).length === 4,
      '边数=' + paths.length + ' 段数=' + segs.join('/'));
    step('分支折线真的往右拐出去（横线从主列走到分支列）',
      dx > 20, '折线=' + elbowD + ' 横跨=' + dx + 'px');
  }

  /* ---------- 3. 点分支圆圈 = 切到那条线 ---------- */
  lis[4].click(); await sleep(500);
  step('点分支的圆圈 → 换到那条线，并停在第 2 手',
    state.viewAt === 2 && state.moves.length === 3
    && state.moves[1].x === 15 && state.moves[1].y === 15,
    'viewAt=' + state.viewAt + ' 手数=' + state.moves.length + ' 第2手=' + line());

  /* ---------- 4. 快捷键仍然可用：Alt+← 回主线、Alt+→ 再过去 ---------- */
  key('ArrowLeft'); await sleep(500);
  step('Alt+← 从另一条分支切回主线', state.moves.length === 4 && state.moves[1].x === 3, line());
  key('ArrowRight'); await sleep(500);
  step('Alt+→ 再切到另一条分支', state.moves.length === 3 && state.moves[1].x === 15, line());

  /* ---------- 5. 解说词跟着分支走 ---------- */
  await openRecord(B); await sleep(900);
  state.viewAt = 2; syncUI(); await sleep(200);
  const c0 = (state.sgfComments || [])[2] || '';
  key('ArrowRight'); await sleep(500);
  const c1 = (state.sgfComments || [])[2] || '';
  step('切分支后解说词换成另一条线的（不是停在旧的那句）',
    c0 !== c1 && c0.indexOf('变体一') >= 0 && c1.indexOf('变体二') >= 0,
    '换前=' + JSON.stringify(c0) + ' 换后=' + JSON.stringify(c1));

  /* ---------- 6. 导出：分支要保住 ---------- */
  await openRecord(A); await sleep(900);
  const txt = buildSGF();
  const re = parseSGF(txt);
  step('导出的 SGF 能被自己再解析', !!re && re.ok, '长度=' + txt.length);
  step('导出的 SGF 保住了变体（分支数一致）',
    !!re.tree && branchCount(re.tree) === branchCount(state.varRoot),
    '导出=' + (re.tree ? branchCount(re.tree) : '?') + ' 原始=' + branchCount(state.varRoot));
  step('导出的总手数一致（主变 + 变体都写进去了）',
    allMoves(re.tree) === allMoves(state.varRoot),
    '导出=' + allMoves(re.tree) + ' 原始=' + allMoves(state.varRoot));
  step('导出后主线还是原来那条', re.moves.length === 4 && re.moves[1].x === 3,
    '手数=' + re.moves.length);

  /* ---------- 7. 树上没有的「自己续下的手」也要出现在列表里 ---------- */
  tryPlay(10, 10, false);       // 接着下一手（K10，空点）
  await sleep(500);
  const rows2 = [...document.querySelectorAll('#movelist li[data-r]')];
  const p5 = rows2[4] ? Math.round(rows2[4].getBoundingClientRect().left) : -1;
  const p4 = rows2[3] ? Math.round(rows2[3].getBoundingClientRect().left) : -2;
  step('自己续下的手接在当前线末尾、**跟主线同一列**（不是挂到分支后面）',
    rows2.length === 7 && rows2[4].dataset.n === '5' && state.moves.length === 5
    && p5 === p4,
    '行数=' + rows2.length + ' 第5行=' + (rows2[4] && rows2[4].dataset.n)
    + ' 手数=' + state.moves.length + ' x(4手)=' + p4 + ' x(5手)=' + p5);

  /* ---------- 8. 三层分支（分支里再分叉）—— 用户手绘的那种树 ----------
     10-nested-branch：主线 1-6；第 3 手分出 A 线（4'-7'）；A 线的第 5 手再分出 B 线（6''-8''）。
     期望：三列（35 / 63 / 91），两条折线，其余全是竖线。 */
  try {
    await openRecord('10-nested-branch.sgf'); await sleep(900);
    const l2 = [...document.querySelectorAll('#movelist li[data-r]')];
    const cols2 = [...new Set(l2.map(li => Math.round(li.getBoundingClientRect().left)))].sort((a, b) => a - b);
    const edges = [...document.querySelectorAll('#movelist svg.tree-lines path')];
    const elbows = edges.filter(p => (p.getAttribute('d').match(/L/g) || []).length === 3);
    step('三层分支：13 个圆圈排在 3 列上（主线 / A 线 / A 线里的 B 线）',
      l2.length === 13 && cols2.length === 3 && cols2[1] - cols2[0] === cols2[2] - cols2[1],
      '圆圈=' + l2.length + ' 列 x=' + cols2.join('/'));
    step('两条分支折线（第 3 手分出 A、A 的第 5 手分出 B），其余 10 条是竖线',
      edges.length === 12 && elbows.length === 2,
      '边=' + edges.length + ' 折线=' + elbows.length);
    step('深层分支也落在"被替代的那一手"同一行（树是按手数分层的）',
      Math.round(l2[10].getBoundingClientRect().top) === Math.round(l2[8].getBoundingClientRect().top),
      'A线第6手 y=' + Math.round(l2[8].getBoundingClientRect().top)
      + ' B线第6手 y=' + Math.round(l2[10].getBoundingClientRect().top));
  } catch (e) {
    /* ★ 这里**不能**记成 ✓：夹具没放进去就等于这段没验，却会显示"通过"（假绿）。 */
    step('三层分支那一段跑得起来', false, '抛异常：' + ((e && e.message) || e));
  }

  return JSON.stringify({ 步骤: steps }, null, 1);
})()`);

await new Promise(r => setTimeout(r, 800));
if (typeof out === 'string' && out.startsWith('ERR:')) {
  const still = await js('JSON.stringify({ 步骤: (window.__varSteps || []) }, null, 1)');
  console.log('！！表达式抛异常：' + out);
  console.log(still);
} else {
  console.log(out);
}
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');

/* 截一张「手数卡」的局部图（放大 2 倍，看圆圈和竖线） */
try {
  await js('(function(){ state.viewAt = 2; syncUI(); return 1; })()');
  await new Promise(r => setTimeout(r, 700));
  const geo = await js('(function(){'
    + ' const d = document.querySelector("#movelist .dot");'
    + ' const r = d ? d.getBoundingClientRect() : null;'
    + ' const cs = d ? getComputedStyle(d) : null;'
    + ' return JSON.stringify({ w: r && Math.round(r.width), h: r && Math.round(r.height),'
    + ' font: cs && cs.fontSize, clipped: d ? d.scrollWidth > d.clientWidth + 1 : null }); })()');
  console.log('圆圈尺寸: ' + geo);
  await send('Page.enable');
  const box = await js('(function(){ const c = document.getElementById("movelist").closest(".card")'
    + ' || document.getElementById("movelist"); const r = c.getBoundingClientRect();'
    + ' return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()');
  const clip = Object.assign(JSON.parse(box), { scale: 2 });
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  const outPng = path.join(ROOT_DIR, '_trash', '_variation_shot.png');
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, 'base64'));
  console.log('截图: ' + outPng + '（手数卡局部，2 倍）');
} catch (e) {
  console.log('（截图失败：' + ((e && e.message) || e) + '）');
}
ws.close();
process.exit(0);
