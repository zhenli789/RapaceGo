/* 端到端：① 默认显示坐标 ② 回看中落子 = 开分支（手数卡变树、导出带分支）
             ③ 棋谱库的复盘按钮同宽 + 「复盘报告」白底
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_branch.mjs
   ★ 需要 RAPACEGO_RECORDS 指到临时棋谱库（会往里写一份假复盘文件，绝不碰用户数据）。
   ★ 分两段求值：中间要 Node 侧写文件（浏览器上下文里没有 fs）。
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

/* ---------- 第一段：坐标默认开 + 回看落子开分支 ---------- */
const p1 = await js(`(async () => {
  const steps = [];
  window.__steps = steps;
  window.__step = (name, ok, detail) => steps.push((ok ? '✓ ' : '★ ') + name + (detail ? ' → ' + detail : ''));
  const step = window.__step;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 1. 默认显示坐标（还没动过任何开关时看） */
  step('默认就显示棋盘坐标（showCoords = true，勾选框也是勾上的）',
    state.showCoords === true && $('chk-coords').checked === true,
    'showCoords=' + state.showCoords + ' 勾选=' + $('chk-coords').checked);

  /* 2. 回看中落子 → 开分支 */
  settings.mode = 'free'; settings.autoBoth = false;
  applyNewGame(false); await sleep(150);
  tryPlay(15, 3, false);   // 1 B Q16
  tryPlay(3, 15, false);   // 2 W D4
  tryPlay(15, 15, false);  // 3 B Q4
  tryPlay(3, 3, false);    // 4 W D16
  await sleep(120);
  step('先下一局 4 手、没有分支（varRoot 还是 null）',
    state.moves.length === 4 && !state.varRoot,
    '手数=' + state.moves.length + ' 树=' + !!state.varRoot);

  state.viewAt = 2; syncUI(); await sleep(120);
  const ok = tryPlay(16, 2, false);      // 在第 2 手之后另下一手（轮到黑）
  await sleep(200);
  step('回看中（第 2 手）落子**不再被挡**，而且真的落下去了',
    ok === true && state.moves.length === 3 && state.viewAt === 3,
    '返回值=' + ok + ' 手数=' + state.moves.length + ' viewAt=' + state.viewAt);
  step('落完自动建出变化树（后面的手留在树上）', !!state.varRoot,
    '树=' + !!state.varRoot);

  const rows = [...document.querySelectorAll('#movelist li[data-r]')];
  const nums = rows.map(li => +li.querySelector('.dot').textContent);
  const xs = [...new Set(rows.map(li => Math.round(li.getBoundingClientRect().left)))];
  /* ★ 2026-10-19 用户要求：新分支挂在**右边** —— 原来的那条留在主线（第 0 列），
     新下的一手才是第 1 列。所以行序是 1,2,3,4（原线）+ 3（新分支）。 */
  step('手数卡变成**两列**的分支树（5 个圈：原线 1,2,3,4 + 新分支 3）',
    rows.length === 5 && xs.length === 2 && nums.join(',') === '1,2,3,4,3',
    '圆圈=' + rows.length + ' 手数=' + nums.join(',') + ' 列=' + xs.join('/'));

  const sgf = buildSGF();
  const re = parseSGF(sgf);
  const countKids = nd => (nd ? (nd.children.filter(c => c.move).length > 1 ? 1 : 0)
    + nd.children.reduce((a, c) => a + countKids(c), 0) : 0);
  const allMoves = nd => (nd ? (nd.move ? 1 : 0)
    + nd.children.reduce((a, c) => a + allMoves(c), 0) : 0);
  step('导出带分支：导出的 SGF 里有一个分支点', !!re.tree && countKids(re.tree) === 1,
    '分支点=' + (re.tree ? countKids(re.tree) : '?') + ' · ' + sgf.slice(0, 70));
  /* ★ 导出的**主线还是原来那条**（4 手），新分支作为变体保留 —— 打开时看到的是原局，
     分支在「手数」卡里可以点回去。 */
  step('导出后**两条线都在**（原线 4 手是主线 + 新分支共 5 手）',
    allMoves(re.tree) === 5 && re.moves.length === 4,
    '树上共=' + allMoves(re.tree) + ' 主线=' + re.moves.length);

  /* ④ 列分配：后面再分叉时要**紧挨主线**（复用空出来的列），不能往外跳 ——
     用户截图里的毛病（第 6 手三条分支占 0/1/2 列，第 9 手再分叉却跑到第 3 列）。
     这里直接搭一棵形状相同的树来量：不依赖真下多少手，判据更干净。 */
  {
    const mk = (n, x, y) => ({ props: [], at: -1, end: -1, comment: '',
      move: { color: n % 2 ? 'b' : 'w', x, y, pass: false }, children: [] });
    const root = { props: [], at: -1, end: -1, move: null, comment: '', children: [] };
    const chain = [];
    let cur = root;
    for (let i = 1; i <= 9; i++) { const c = mk(i, i, 3); cur.children.push(c); chain.push(c); cur = c; }
    chain[5].children.push(mk(6, 10, 10));     // 第 6 手的第 2 条
    chain[5].children.push(mk(6, 11, 11));     // 第 6 手的第 3 条
    chain[8].children.push(mk(10, 4, 4));      // 原来的第 10 手（主线）
    chain[8].children.push(mk(10, 12, 12));    // 第 9 手之后新分出来的一条
    const saved = { moves: state.moves, viewAt: state.viewAt, vr: state.varRoot };
    state.varRoot = root;
    state.moves = chain.map(c => ({ color: c.move.color, x: c.move.x, y: c.move.y, pass: false }))
      .concat([{ color: 'w', x: 4, y: 4, pass: false }]);
    state.viewAt = 10;
    renderMoveList();
    const rr = [...document.querySelectorAll('#movelist li[data-r]')];
    const xAt = n => rr.filter(li => +li.dataset.n === n).map(li => Math.round(li.getBoundingClientRect().left));
    /* ⚠️ 行号是**按深度**算的（树里 n 从根往下 +1），不是我 mk() 里那个数字 */
    const x7 = xAt(7), x10 = xAt(10);
    /* ★ 规则（2026-10-19 定稿）：**越深的分支越贴近主线**，
       浅的分支被排到右边。所以第 10 手那条在 col1，第 7 手的两条在 col2/col3。 */
    step('列按"深浅"排：更深的那条贴主线（第 10 手 col1），浅的两条排右边（第 7 手 col2/col3）',
      x7.length === 3 && x10.length === 2 && x10[1] === 63 && x7[1] > 63 && x7[2] > x7[1],
      '第7手列=' + x7.join('/') + ' 第10手列=' + x10.join('/'));
    /* 没有两个圈落在同一个位置上（"重叠"最字面的那种） */
    const pos = rr.map(li => Math.round(li.getBoundingClientRect().left) + ',' + Math.round(li.getBoundingClientRect().top));
    step('树上没有任何两个圈叠在同一个位置', new Set(pos).size === pos.length,
      pos.length + ' 个圈 / ' + new Set(pos).size + ' 个位置');

    /* ⑤ ★ 用户 2026-10-19 报的"上下两条分支重叠"：
       主线 1..8，第 3 手后面挂一条（落到第 4 行），第 4 手后面再挂一条（第 5 行）——
       两条**上下相邻**的分支不能挤进同一列（挤进去就像同一条线接着往下走）。
       规则：同一列上一段结束之后**至少空一行**才允许复用。 */
    const root2 = { props: [], at: -1, end: -1, move: null, comment: '', children: [] };
    const ch2 = [];
    let cur2 = root2;
    for (let i = 1; i <= 8; i++) { const c = mk(i, i, 3); cur2.children.push(c); ch2.push(c); cur2 = c; }
    ch2[2].children.push(mk(4, 10, 10));       // 第 3 手后 → 落在第 4 行
    ch2[3].children.push(mk(5, 11, 11));       // 第 4 手后 → 落在第 5 行（紧挨着上一条）
    state.varRoot = root2;
    state.moves = ch2.map(c => ({ color: c.move.color, x: c.move.x, y: c.move.y, pass: false }));
    state.viewAt = 8;
    renderMoveList();
    const rr2 = [...document.querySelectorAll('#movelist li[data-r]')];
    const xs2 = n => rr2.filter(li => +li.dataset.n === n).map(li => Math.round(li.getBoundingClientRect().left));
    const a4 = xs2(4), a5 = xs2(5);
    step('上下相邻的两条分支**不会挤进同一列**（第 4 行在 0/1 列，第 5 行那条另起一列）',
      a4.length === 2 && a5.length === 2 && a5[1] !== a4[1],
      '第4行列=' + a4.join('/') + ' 第5行列=' + a5.join('/'));

    /* ⑥ ★ 用户 2026-10-19 报的第二种重叠：**上面的分支继续往下长**，
       长到下面那条分支占的那一格上。规则：把下面那条（整棵）往右挪，
       上面这条保持笔直 —— 不然自己正在下的线会半路拐弯。
       这里搭：主线 1..10；第 3 手后一条长到第 9 行（A）；第 8 手后一条落在第 9 行（B）。 */
    const root3 = { props: [], at: -1, end: -1, move: null, comment: '', children: [] };
    const ch3 = [];
    let cur3 = root3;
    for (let i = 1; i <= 10; i++) { const c = mk(i, i, 3); cur3.children.push(c); ch3.push(c); cur3 = c; }
    let aNd = mk(4, 10, 10);
    ch3[2].children.push(aNd);
    for (let r = 5; r <= 9; r++) { const nx = mk(r, 10, r); aNd.children.push(nx); aNd = nx; }
    const bNd = mk(9, 20, 20);
    ch3[7].children.push(bNd);
    state.varRoot = root3;
    state.moves = ch3.map(c => ({ color: c.move.color, x: c.move.x, y: c.move.y, pass: false }));
    state.viewAt = 10;
    renderMoveList();
    const rr3 = [...document.querySelectorAll('#movelist li[data-r]')];
    const xs3 = n => rr3.filter(li => +li.dataset.n === n).map(li => Math.round(li.getBoundingClientRect().left));
    const x4c = xs3(4), x9c = xs3(9);
    const pos3 = rr3.map(li => Math.round(li.getBoundingClientRect().left) + ',' + Math.round(li.getBoundingClientRect().top));
    /* ★ 2026-10-19：分配列时**按整棵子树的高度占位** —— A 这条（第 4 行起、长到第 9 行）
       先把 1 列占到底，所以 B 一开始就排到第 2 列，两者根本不会撞上；
       A 因此在第 4 行和第 9 行是同一列（笔直往下，不会半路跳走）。
       （万一还是撞上——比如 A 后来又长到 B 下面去了——才轮到 arrangeRight 把 A 整组往右让。） */
    step('上分支往下长不会和下面的分支重叠：A 保持原列笔直，B 一开始就排在右边',
      x4c.length === 2 && x9c.length === 3 && new Set(x9c).size === 3
      && x9c.indexOf(x4c[1]) >= 0,
      '第4行列=' + x4c.join('/') + ' 第9行列=' + x9c.join('/'));

    /* 切到别的线上时，列不能跟着变（之前有个 bug：白占一列会让整棵树横跳一格） */
    const beforeB = x9c.slice().sort((a, b) => a - b).join('/');
    state.moves = [{ color: 'b', x: 1, y: 3, pass: false }, { color: 'w', x: 2, y: 3, pass: false },
      { color: 'b', x: 10, y: 10, pass: false }, { color: 'w', x: 10, y: 5, pass: false }];
    state.viewAt = 4;
    renderMoveList();
    const rr3b = [...document.querySelectorAll('#movelist li[data-r]')];
    const afterB = rr3b.filter(li => +li.dataset.n === 9)
      .map(li => Math.round(li.getBoundingClientRect().left)).sort((a, b) => a - b).join('/');
    step('切到别的分支上看时，列不变（不会整棵树横跳一格）', beforeB === afterB,
      '主线当前=' + beforeB + ' 换线后=' + afterB);
    step('这种情况下也没有任何两个圈叠在同一个位置', new Set(pos3).size === pos3.length,
      pos3.length + ' 个圈 / ' + new Set(pos3).size + ' 个位置');

    state.moves = saved.moves; state.viewAt = saved.viewAt; state.varRoot = saved.vr;
    syncUI(); await sleep(150);
  }

  /* 存两份棋谱：一份带分支（也给它造复盘文件），一份干净，用来看按钮宽度 */
  const r1 = await saveToRecords(); await sleep(300);
  settings.mode = 'free'; applyNewGame(false); await sleep(120);
  tryPlay(15, 3, false); tryPlay(3, 15, false); await sleep(100);
  const r2 = await saveToRecords(); await sleep(300);
  window.__r1 = r1 && r1.name;
  window.__r2 = r2 && r2.name;

  /* ⑦ 右键 → 删除这一手及以后（2026-10-19 用户要求） */
  settings.mode = 'free'; applyNewGame(false); await sleep(120);
  tryPlay(15, 3, false); tryPlay(3, 15, false); tryPlay(15, 15, false); tryPlay(3, 3, false);
  await sleep(120);
  state.viewAt = 2; syncUI(); await sleep(120);
  tryPlay(10, 10, false); await sleep(250);          // 在第 2 手后开一条新分支
  const rows0 = [...document.querySelectorAll('#movelist li[data-r]')];
  const liBr = rows0[rows0.length - 1];              // 最后画出来的就是那条新分支（第 3 行右列）
  liBr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 130, clientY: 220 }));
  await sleep(150);
  step('右键分支上的圈 → 弹出菜单，按钮就写「删除」',
    $('mv-menu').hidden === false && $('mv-del').textContent === '删除',
    ($('mv-menu').hidden ? '没弹' : '弹了') + ' · ' + $('mv-del').textContent
    + ' · 悬停提示=' + $('mv-del').title);

  $('mv-del').click(); await sleep(350);
  const rows1 = [...document.querySelectorAll('#movelist li[data-r]')];
  step('点删除 → 那一手和它以下全没了，当前这盘棋退到它之前',
    rows1.length === 4 && state.moves.length === 2 && $('mv-menu').hidden === true,
    '圈=' + rows1.length + ' 手数=' + state.moves.length + ' 菜单收起了=' + $('mv-menu').hidden);

  /* 删一条**不在当前线上**的分支 → 当前局面不该动 */
  const li4 = [...document.querySelectorAll('#movelist li[data-r]')].find(li => +li.dataset.n === 4);
  li4.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 130, clientY: 240 }));
  await sleep(150);
  $('mv-del').click(); await sleep(300);
  const rows2 = [...document.querySelectorAll('#movelist li[data-r]')];
  step('删不在当前线上的分支 → 当前手数不变，只是树里少一个圈',
    rows2.length === 3 && state.moves.length === 2,
    '圈=' + rows2.length + ' 手数=' + state.moves.length);

  return JSON.stringify({ steps: steps, r1: window.__r1, r2: window.__r2 });
})()`, 120000);

let parsed = null;
try { parsed = JSON.parse(p1); } catch (e) { console.log('第一段异常：' + p1); }
if (parsed) {
  console.log('存的棋谱: ' + parsed.r1 + ' / ' + parsed.r2);
  /* 给 r1 造一份假复盘 → 它会显示「复盘报告」，r2 显示「AI 复盘」 */
  try {
    if (REC_DIR && parsed.r1) {
      fs.writeFileSync(path.join(REC_DIR, parsed.r1 + '.review.json'),
        JSON.stringify({ text: '（测试用的假报告）' }), 'utf8');
    }
  } catch (e) { console.log('写假复盘失败：' + ((e && e.message) || e)); }
}

/* ---------- 第二段：复盘按钮同宽 + 白底 ---------- */
const p2 = await js(`(async () => {
  const step = window.__step;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  $('btn-records').click(); await sleep(900);
  const rows = [...document.querySelectorAll('#reclist li')];
  const find = name => rows.find(li => li.querySelector('.rec-name')
    && li.querySelector('.rec-name').textContent === String(name).replace(/\\.sgf$/i, ''));
  const li1 = find(window.__r1), li2 = find(window.__r2);
  const btnOf = li => li ? li.querySelector('button.rec-review') : null;
  const b1 = btnOf(li1), b2 = btnOf(li2);
  const w = b => (b ? Math.round(b.getBoundingClientRect().width * 10) / 10 : -1);
  const bg = b => (b ? getComputedStyle(b).backgroundColor : '');
  step('两份棋谱都找到了', !!b1 && !!b2, '有复盘报告的=' + (b1 && b1.textContent) + ' / 没有的=' + (b2 && b2.textContent));
  step('两种状态用同一个按钮：复盘过 →「复盘报告」，没复盘 →「AI 复盘」',
    !!b1 && !!b2 && b1.textContent === '复盘报告' && b2.textContent === 'AI 复盘',
    (b1 && b1.textContent) + ' | ' + (b2 && b2.textContent));
  step('两个按钮**一样宽**（原来一宽一窄）', !!b1 && !!b2 && w(b1) === w(b2),
    '复盘报告=' + w(b1) + 'px · AI 复盘=' + w(b2) + 'px');
  step('「复盘报告」是白底（不再是主题绿）', bg(b1) === 'rgb(255, 255, 255)', '背景=' + bg(b1));
  step('「AI 复盘」仍是主题绿（引导用户去做这一步）', bg(b2) !== 'rgb(255, 255, 255)', '背景=' + bg(b2));
  /* 收尾：关掉弹窗，别干扰后面的测试 */
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  return JSON.stringify({ 步骤: window.__steps }, null, 1);
})()`, 60000);

console.log(p2);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
