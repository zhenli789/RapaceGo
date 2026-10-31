/* 判据：摆题阶段「落子」那行最右边的**旋转**按钮（2026-10-31 用户要求）。
   测什么（全部量界面几何 / 读内存里的摆子，不去读源码）：
     ① 按钮是**纯图标**（没有文字）、有 title / aria-label、里面只有一个 svg；
     ② 在「落子」这一行：跟「擦」同一行（top 差 ≤ 2）、在它右边、右边缘贴卡片右边；
     ③ 空盘置灰，有子可点；
     ④ 功能：点一次 → 每个点变成 (N−1−y, x)，颜色/数量/顺序不变；点四次回原位；
     ⑤ 题集里的题（9 路、带正解）：摆子 / 正解 / 正解树**一起转**，
        转完三条主线仍然互相对得上（"按正解"不会应到别处），再点四次回原位；
     ⑥ 解题阶段看不到它（它在 #ts-setup-group 里，那一组整块藏起来）；
     ⑦ 卡片高度转前转后一样（加按钮不许把卡片撑高）。

   用法（和别的 _probe 一样：先起实例，再跑本脚本）：
     RAPACEGO_RECORDS=$PWD/_trash/_rot_rec RAPACEGO_PUZZLES=$PWD/_trash/_rot_puz \
       npx electron . --remote-debugging-port=9334 ... &
     RAPACEGO_PUZZLES=$PWD/_trash/_rot_puz node dev/_probe_ts_rotate.mjs
   夹具：_trash/_rot_puz/测试题集-3题.sgf（= dev/fixtures/测试题集-3题.sgf）。 */
const PORT = 9334;

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr, tmo) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const PAGE = `(async function(){
  const steps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const step = (name, ok, extra) => steps.push((ok ? 'OK  ' : 'BAD ') + name
    + (extra === undefined || extra === '' ? '' : ' -> ' + extra));
  async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (fn()) return true; await sleep(80); } return false; }

  await waitFor(() => typeof state === 'object' && !!$('ts-card'), 20000);
  if (typeof state !== 'object' || !$('ts-card')) return { steps: ['BAD 页面没加载出来'], bad: 1 };

  /* 每轮从干净状态起步：题集是内存里的，进度在 localStorage */
  try { localStorage.removeItem('rapacego.pset.progress'); } catch (e) {}
  state.tsumegoSet = null;

  /* ============ ① 手工摆题（19 路、空盘起）============ */
  settings.size = 19; settings.tmode = 'free';
  enterTsumego();
  await sleep(500);

  const btn = $('btn-ts-rotate');
  step('摆题阶段：旋转按钮在（#btn-ts-rotate）', !!btn);
  if (!btn) return { steps, bad: steps.filter(s => s.indexOf('BAD') === 0).length };

  step('按钮是**纯图标**：里面一个文字都没有',
    (btn.textContent || '').trim() === '', '文字=' + JSON.stringify((btn.textContent || '').trim()));
  step('没有文字就必须有 title + aria-label（否则说不出它是干什么的）',
    !!(btn.title && btn.title.length > 6) && !!btn.getAttribute('aria-label'),
    'title=' + JSON.stringify((btn.title || '').slice(0, 24)) + ' aria=' + JSON.stringify(btn.getAttribute('aria-label')));
  step('按钮里是一个 inline svg（不是图片）',
    btn.querySelectorAll('svg').length === 1 && btn.querySelectorAll('img').length === 0,
    'svg=' + btn.querySelectorAll('svg').length + ' img=' + btn.querySelectorAll('img').length);

  /* 空盘：置灰 */
  step('空盘时置灰（点了也没反应的那种状态要能看出来）',
    btn.disabled === true && state.setup.length === 0, 'disabled=' + btn.disabled + ' 摆子=' + state.setup.length);

  /* 摆三颗（已知坐标） */
  const card0 = $('ts-card').getBoundingClientRect();
  placeSetupStone(2, 3); await sleep(120);
  placeSetupStone(4, 3); await sleep(120);
  placeSetupStone(3, 4); await sleep(200);
  step('摆了三颗之后按钮可点', btn.disabled === false && state.setup.length === 3,
    'disabled=' + btn.disabled + ' 摆子=' + state.setup.length);

  /* ============ ② 位置：在「落子」那行最右边 ============ */
  {
    const row = btn.parentElement;
    const segEl = $('seg-tscolor');
    const segR = segEl.getBoundingClientRect();
    const erase = segEl.querySelector('button[data-v="erase"]').getBoundingClientRect();
    const bR = btn.getBoundingClientRect();
    const rowR = row.getBoundingClientRect();
    step('和「擦」在同一行（top 差 ≤ 2px）',
      Math.abs(bR.top - erase.top) <= 2, '按钮 top=' + Math.round(bR.top) + ' 擦 top=' + Math.round(erase.top));
    step('在「擦」的右边（不是挤在左边、也不是换到第二行）',
      bR.left >= erase.right - 0.5 && bR.left > segR.right - 0.5,
      '按钮 left=' + Math.round(bR.left) + ' 擦右=' + Math.round(erase.right) + ' 开关组右=' + Math.round(segR.right));
    step('整行铺满：按钮右边缘离卡片右边 ≤ 16px',
      card0.right - bR.right <= 16, '差=' + Math.round(card0.right - bR.right));
    step('按钮不撑高这一行（行高 ≤ 32px，和其它行一样）',
      rowR.height <= 32, '行高=' + Math.round(rowR.height));
    step('按钮等于图标大小（正方小钮，不是带内边距的文字钮）',
      Math.round(bR.width) <= 30 && Math.round(bR.height) <= 28,
      Math.round(bR.width) + '×' + Math.round(bR.height));
  }

  /* ============ ③ 功能：顺时针 90°，四次回原位 ============ */
  {
    const before = state.setup.map(s => ({ x: s.x, y: s.y, c: s.color }));
    const h0 = Math.round($('ts-card').getBoundingClientRect().height);
    btn.click();
    await sleep(500);
    const okMap = state.setup.length === before.length && state.setup.every((s, i) =>
      s.x === (19 - 1 - before[i].y) && s.y === before[i].x && s.color === before[i].c);
    step('点一次：每个点都变成 (N−1−y, x)，颜色不变、数量不变',
      okMap, state.setup.map(s => s.color + s.x + ',' + s.y).join(' '));
    const fr = frameRect();
    step('框架跟着转（转完所有摆子仍在框内）',
      !!fr && state.setup.every(s => s.x >= fr.x0 && s.x <= fr.x1 && s.y >= fr.y0 && s.y <= fr.y1),
      JSON.stringify(fr));
    /* 三次补足 360° */
    btn.click(); await sleep(250);
    btn.click(); await sleep(250);
    btn.click(); await sleep(500);
    step('再点三次（共 360°）→ 回到原位',
      state.setup.length === before.length && state.setup.every((s, i) =>
        s.x === before[i].x && s.y === before[i].y && s.color === before[i].c),
      state.setup.map(s => s.color + s.x + ',' + s.y).join(' '));
    const h1 = Math.round($('ts-card').getBoundingClientRect().height);
    step('卡片高度转前转后一样（加这个按钮不许把卡片撑高）',
      h0 === h1, h0 + 'px → ' + h1 + 'px');
  }

  /* ============ ④ 题集里的题（9 路、带正解）：摆子 / 正解 / 正解树一起转 ============ */
  {
    await openPuzzleSet('测试题集-3题.sgf');
    await sleep(1500);
    const pb = tsSetProblem();
    step('打开夹具题集：9 路 / 8 颗摆子 / 正解 3 手',
      N === 9 && state.setup.length === 8 && !!pb && pb.answer.length === 3,
      'N=' + N + ' 摆子=' + state.setup.length + ' 正解=' + (pb ? pb.answer.length : -1));
    if (pb) {
      /* 正解 = 正解树的主线（转之前先确认这条关系成立，转之后再确认一次） */
      const mainLine = nd => {
        const out = []; let cur = nd, guard = 0;
        while (cur && guard++ < 500) {
          const nx = (cur.children || []).find(c => c.move);
          if (!nx) break;
          out.push(nx.move); cur = nx;
        }
        return out;
      };
      const sameSeq = (a, b) => a.length === b.length && a.every((m, i) =>
        (!m.pass) ? (m.color === b[i].color && m.x === b[i].x && m.y === b[i].y) : (b[i].pass && m.color === b[i].color));
      step('转之前：正解(数组) 与 正解树的主线 一致（这是后面那条断言的基准）',
        !!pb.tree && sameSeq(pb.answer, mainLine(pb.tree)),
        '数组=' + pb.answer.map(m => m.color + m.x + ',' + m.y).join(' ')
        + ' · 树=' + (pb.tree ? mainLine(pb.tree).map(m => m.color + m.x + ',' + m.y).join(' ') : '无'));

      const s0 = pb.setup.map(s => ({ x: s.x, y: s.y, c: s.color }));
      const a0 = pb.answer.map(m => ({ x: m.x, y: m.y, c: m.color, pass: !!m.pass }));
      btn.click();
      await sleep(700);
      const n9 = 9;
      step('转一次：题集摆子也跟着转（(x,y) → (N−1−y, x)）',
        pb.setup.length === s0.length && pb.setup.every((s, i) =>
          s.x === (n9 - 1 - s0[i].y) && s.y === s0[i].x && s.color === s0[i].c),
        pb.setup.map(s => s.color + s.x + ',' + s.y).join(' '));
      step('★ 正解数组也转了 —— 只转摆子的话「正解」会摆到别处',
        pb.answer.length === a0.length && pb.answer.every((m, i) =>
          m.pass ? a0[i].pass : (m.x === (n9 - 1 - a0[i].y) && m.y === a0[i].x && m.color === a0[i].c)),
        pb.answer.map(m => m.color + m.x + ',' + m.y).join(' '));
      step('★ 转完之后 正解数组 仍等于 正解树的主线（「按正解」那一档才不会应错）',
        sameSeq(pb.answer, mainLine(pb.tree)),
        '数组=' + pb.answer.map(m => m.color + m.x + ',' + m.y).join(' ')
        + ' · 树=' + mainLine(pb.tree).map(m => m.color + m.x + ',' + m.y).join(' '));
      step('转完之后 盘上的摆子 与 题集里的摆子 仍是同一套坐标',
        state.setup.length === pb.setup.length && state.setup.every((s, i) =>
          s.x === pb.setup[i].x && s.y === pb.setup[i].y && s.color === pb.setup[i].color),
        '盘上=' + state.setup.map(s => s.color + s.x + ',' + s.y).join(' ')
        + ' · 题集=' + pb.setup.map(s => s.color + s.x + ',' + s.y).join(' '));

      /* 三次补足 360° → 全部回原位 */
      btn.click(); await sleep(250);
      btn.click(); await sleep(250);
      btn.click(); await sleep(700);
      step('再点三次 → 摆子 / 正解 都回到原样',
        pb.setup.every((s, i) => s.x === s0[i].x && s.y === s0[i].y)
        && pb.answer.every((m, i) => m.pass ? a0[i].pass : (m.x === a0[i].x && m.y === a0[i].y)));
    }
  }

  /* ============ ⑤ 解题阶段没有它 ============ */
  {
    $('btn-ts-start').click();
    await sleep(900);
    step('点「开始解题」→ 进解题阶段，旋转按钮跟着整组藏起来（高度 0）',
      state.tsumego.phase === 'solve' && $('btn-ts-rotate').offsetHeight === 0,
      '阶段=' + state.tsumego.phase + ' 按钮高=' + $('btn-ts-rotate').offsetHeight);
  }

  return { steps: steps, bad: steps.filter(s => s.indexOf('BAD') === 0).length, n: steps.length };
})()`;

const res = await js(PAGE, 180000);
if (typeof res === 'string') {
  console.log(res);
} else {
  for (const s of (res.steps || [])) console.log(s);
  console.log('\n=== ' + (res.n || 0) + ' 项，失败 ' + (res.bad || 0) + ' 项 ===');
}
ws.close();
process.exit(typeof res === 'object' && res.bad ? 1 : 0);
