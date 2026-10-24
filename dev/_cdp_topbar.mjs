/* 顶栏状态区（#status）的「只有一行」回归测试
   ------------------------------------------------------------------
   背景（2026-10-24 用户报障）：
     顶栏 `.topbar` 是 `flex-wrap: wrap`，折行判断看的是 flex-basis。
     状态文字原来是 `flex: 0 1 auto` —— 一句 60 字的话会**参与折行计算**，
     把右边「新对局 / 对局模式 / 对手棋力」挤到第二行：顶栏变高、排布临时变形。

   修法（style.css）：状态文字改成 `flex: 1 1 0`（basis 0 ⇒ 折行时宽度视为 0），
   长文只会被省略号截断（全文在 title 里），**永远不会把顶栏挤成两行**。

   ★ 这个脚本守的就是这件事：三档窗口宽度 × 一批最长文案，逐个量真实几何。
     「量真实几何」是本项目纪律：不查 hidden、不查 CSS 属性，只量 offsetHeight /
     clientWidth / scrollWidth。
*/
const PORT = 9333;

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT + '（Electron 起了吗？端口对不对？）');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

/* 采样文案：改过文案就同步这里（挑最长的 + 最坏叠加的常驻摘要） */
const TEXTS = [
  '已换分支 · 294 手（第 188 手 3 个） · 有复盘 · 讲解没讲过（另有 12 条）',
  '带逐手讲解（294 手 · 另有 12 条也讲过）—— 已摊成「全盘」，点一行跳过去',
  '讲解在别的分支上（这条线没讲）—— Alt+←/→ 切到带「变」的分支',
  '这份棋谱的另外 12 条分支有复盘 —— 跳到分叉处，Alt+←/→ 切过去看',
  '已更新棋谱库 · 20261024-对局1.sgf（同一份，没另存副本） · 要复盘就在「棋谱库」点它',
  '自检 294 手/看 188 · 选点 187 · 搜 500 · 在跑 · 欠 12 · 超时 3 · 引擎就绪 · 全文见控制台',
  '每条分支都复盘过了 —— 想重算就选「当前这条线」或「全部分支」',
  '设置已保存 · 引擎重启中 棋谱复制了 128 份（3 份同名没覆盖）',
  /* 常驻摘要（syncUI 拼出来的），最坏叠加两三种 */
  '未开局 · 点棋盘中间「新建对局」开始',
  '13 路 · 让 9 子 · 贴目 7.5 · 进行中 · 第 188 手 · 轮黑走 · 引擎加载中 · 试下中 · 拟人落子',
  '19 路 · 贴目 7.5 · 进行中 · 第 188 手 · 轮黑走 · 第 3/347 题 · 引擎加载中 · 试下中 · 拟人落子',
  /* ★ 注意：`让 N 子` 和 `第 N 题` **不可能同时出现** ——
     习题模式下 hcTxt 被显式压掉（摆子是题目初始局面，不是让子，见 syncUI 的注释），
     所以「让子 + 题集 + 引擎加载 + 试下」那条是构造不出来的，不拿它当判据。 */
];
const SUMM_N = 3;                       // 末尾 3 条是常驻摘要（允许在 1020 下省略）

const IDS = { 1020: '1020（窗口下限 minWidth）', 1280: '1280', 1460: '1460（默认）' };
const R = {};
let fail = 0;

/* ---------- ① 品牌文字已删 ---------- */
const brand = await js(`(function(){
  const bar = document.querySelector('.topbar');
  return {
    brand: document.querySelectorAll('.brand').length,
    first: bar && bar.firstElementChild ? (bar.firstElementChild.id || bar.firstElementChild.className) : '(空)',
    title: document.title,
  };
})()`);
R['① 顶栏里没有 .brand（「玄清围弈」字样已删）'] = brand.brand === 0 ? '✓' : ('★ 还剩 ' + brand.brand + ' 个');
R['① 顶栏第一项是「棋谱库」按钮'] = brand.first === 'btn-records' ? '✓' : ('★ 第一个是 ' + brand.first);
R['① 窗口标题仍然是「玄清围弈」'] = brand.title === '玄清围弈' ? '✓' : ('★ ' + brand.title);

/* ---------- ②③④ 三档宽度逐个量 ---------- */
for (const W of [1020, 1280, 1460]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 860, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 260));

  const res = await js(`(function(list){
    const bar = document.querySelector('.topbar');
    const st = document.getElementById('status');
    const out = [];
    for (const t of list) {
      flash(t);                                  // 同步写入，flash 里的 1.8s 定时器还没到
      const bb = bar.getBoundingClientRect();
      const kids = [...bar.children].filter(el => !el.hidden && el.offsetParent !== null);
      const lowest = Math.max(...kids.map(el => el.getBoundingClientRect().bottom));
      /* 文字要多少 px / 这一格能给多少 px —— 用探针量真实宽度（scrollWidth 含 padding，
         直接相减会差 8~10px，判据就跟着偏）。 */
      const cs = getComputedStyle(st);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:nowrap;visibility:hidden';
      probe.style.font = cs.font;
      probe.textContent = t;
      document.body.appendChild(probe);
      const need = Math.ceil(probe.getBoundingClientRect().width);
      probe.remove();
      const room = st.clientWidth - parseFloat(cs.paddingLeft);
      out.push({
        t: t,
        barH: Math.round(bb.height),
        overflowBottom: Math.round(lowest - bb.bottom),   // > 0 = 有东西掉到第二行
        clipped: need > room + 1,
        need: need, room: Math.round(room), slack: Math.round(room - need),
        title: st.title === t,
      });
    }
    syncUI();                                     // 还原成局面摘要
    return out;
  })(${JSON.stringify(TEXTS)})`);

  if (typeof res === 'string') { R['★ ' + W + ' 报错'] = res; continue; }
  const barH = [...new Set(res.map(r => r.barH))];
  const bad = res.filter(r => r.overflowBottom > 0);
  R['② ' + IDS[W] + '：顶栏始终只有一行（高度 ' + barH.join('/') + '）'] =
    barH.length === 1 && barH[0] <= 52 && !bad.length
      ? ('✓ ' + res.length + ' 条文案全试过')
      : ('★ 高度=' + barH.join('/') + ' 掉落=' + bad.map(b => b.t.slice(0, 12)).join('、'));

  const clippedFlash = res.slice(0, res.length - SUMM_N).filter(r => r.clipped);
  if (W === 1020) {
    R['③ ' + IDS[W] + '：窄窗口允许省略号，但全文必须在 title 里'] =
      res.every(r => r.title) ? ('✓ 省略 ' + res.filter(r => r.clipped).length + '/' + res.length + ' 条（可悬浮看全）')
        : ('★ 有 ' + res.filter(r => !r.title).length + ' 条没挂 title');
  } else {
    const tight = res.reduce((a, b) => (b.slack < a.slack ? b : a));
    R['③ ' + IDS[W] + '：不省略（' + res.length + ' 条最长文案都放得下）'] = clippedFlash.length === 0
      ? ('✓ 最紧的一条还余 ' + tight.slack + 'px')
      /* ★ 失败时必须把**是哪条**打出来（2026-10-24：只写"差 4px"根本无从下手，
         还得自己一条条量）。带上开头 14 个字 + 缺多少。 */
      : ('★ 省略了 ' + clippedFlash.length + ' 条（'
        + clippedFlash.map(r => -r.slack + 'px: ' + r.t.slice(0, 14) + '…').join(' / ') + '）');
  }
}

/* ---------- ⑤ 摘要写入也带 title（省略时能看全） ---------- */
const sumTitle = await js(`(function(){
  flash('临时'); syncUI();
  const st = document.getElementById('status');
  return { ok: st.title === st.textContent && !!st.textContent, txt: st.textContent };
})()`);
R['⑤ 局面摘要也挂了 title（和正文一致）'] = sumTitle.ok ? ('✓ ' + sumTitle.txt) : ('★ ' + JSON.stringify(sumTitle));

/* ---------- 输出 ---------- */
console.log('');
for (const k of Object.keys(R)) {
  if (String(R[k]).indexOf('★') === 0) fail++;
  console.log(k.padEnd(48) + '  ' + R[k]);
}
console.log('\n' + (fail ? '★ ' + fail + ' 项没过' : '全部通过（' + Object.keys(R).length + ' 项）'));
await send('Emulation.clearDeviceMetricsOverride', {});
ws.close();
process.exit(fail ? 1 : 0);
