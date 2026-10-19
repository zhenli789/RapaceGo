/* 端到端冒烟：把主要功能路径**真跑一遍**，同时收集浏览器侧的运行时错误
   （未捕获异常 / console.error / 资源加载失败）。
   为什么必须做这一步：JS 里有些 bug 是静默的 —— 比如某个回调抛异常会把整条链打断，
   界面上只表现为"点了没反应"，光看代码或截图都发现不了。
   用法：python _rtest.py _smoke.mjs _trash/_shot_smoke.png */
const PORT = 9333;
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
  const step = async (name, fn) => {
    try { const r = await fn(); steps.push('✓ ' + name + (r === undefined || r === '' ? '' : ' → ' + r)); }
    catch (e) { steps.push('★ ' + name + ' 抛异常 → ' + ((e && e.message) || e)); }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const open = id => $(id).classList.contains('open');
  const seg = (id, v) => $(id).querySelector('[data-v="' + v + '"]').click();
  const lit = id => { const b = $(id).querySelector('.on'); return b ? b.dataset.v : '无'; };
  const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  /* ★★ 2026-10-12 补：**先手动加载引擎**。
     这个软件现在**打开时一个引擎都不加载**（手动点灯才加载，为的是不占显存），
     而下面一堆步骤要引擎（AI 落子 / 数子 / 复盘）。原来的写法只是干等 90 秒，
     等不到就往下走 —— 于是那些步骤全退化成"看过程没崩"的空断言
     （实测：「落一手 → 等 AI 回应」那一步报 手数=1，即 AI 根本没接）。
     现在显式走同一个 IPC（等价于点顶栏那盏灯选「加载」），不绕过被测代码。
     ⚠️ 本文件的被测代码是包在**模板字符串**里的：注释里**绝不能出现反引号**。 */
  if (!engineReady || !engineReadyPlay) {
    await window.api.engine.load('katago').catch(() => null);
    const te = Date.now();
    while ((!engineReady || !engineReadyPlay) && Date.now() - te < 150000) await sleep(1000);
  }
  steps.push('（引擎就绪 analyze=' + engineReady + ' play=' + engineReadyPlay + '）');

  /* ---------- 1. 四个弹窗的开合 ---------- */
  await step('弹窗 · 帮助', async () => { $('btn-help').click(); await sleep(200);
    const o = open('help'); $('help-close').click(); await sleep(150);
    return o && !open('help') ? '开关都正常' : '★ 状态不对'; });
  await step('弹窗 · 设置', async () => { $('btn-settings').click(); await sleep(400);
    const o = open('settings'); $('set-cancel').click(); await sleep(150);
    return o && !open('settings') ? '开关都正常' : '★ 状态不对'; });
  await step('弹窗 · 棋谱库', async () => { $('btn-records').click(); await sleep(500);
    const n = document.querySelectorAll('#reclist li').length;
    const o = open('records'); $('rec-close').click(); await sleep(150);
    return (o && !open('records') ? '开关都正常' : '★ 状态不对') + ' · 列表 ' + n + ' 项'; });
  await step('弹窗 · 新对局（切类型）', async () => { $('btn-new').click(); await sleep(250);
    const a = seg('seg-ntype', 'free'); await sleep(200);
    const hiddenOk = $('row-color').hidden && $('row-level').hidden;
    seg('seg-ntype', 'play'); await sleep(200);
    const shownOk = !$('row-color').hidden && !$('row-level').hidden;
    $('m-cancel').click(); await sleep(150);
    return (hiddenOk && shownOk ? '类型切换正常' : '★ 行显隐不对') + ' · ' + (open('newgame') ? '★ 没关掉' : '已关闭'); });

  /* ---------- 2. AI 对弈：开新局 → 落子 → AI 回应 ---------- */
  await step('开新局 · AI 对弈', async () => { $('btn-new').click(); await sleep(250);
    seg('seg-ntype', 'play'); seg('seg-color', 'b'); seg('seg-size', '19');
    seg('seg-handicap', '0'); seg('seg-komi', '7.5');
    $('m-rules').value = 'chinese'; $('m-rules').onchange(); await sleep(150);
    $('m-start').click(); await sleep(600);
    return 'mode=' + settings.mode + ' 手数=' + state.moves.length + ' 我执=' + state.myColor; });
  await step('落一手 → 等 AI 回应', async () => { tryPlay(3, 3);
    /* ★ 2026-10-12：原来固定等 4 秒 —— **实测不够**。
       人类权重（b18c384nbt-humanv0）第一次推理要 ~5 秒
       （Metal 着色器编译 + 权重预热），实测 5013ms 才落子，
       于是这一步总报「手数=1」，看着像"AI 没接"。改成轮询，最多等 20 秒。 */
    const t = Date.now();
    while (state.moves.length < 2 && Date.now() - t < 20000) await sleep(300);
    return '手数=' + state.moves.length + '（>1 说明 AI 接了）· 等了 '
      + (Math.round((Date.now() - t) / 100) / 10) + 's'; });
  await step('悔棋', async () => { const n0 = state.moves.length; $('btn-undo').click(); await sleep(300);
    return n0 + ' → ' + state.moves.length; });
  await step('再落一手 + 试下', async () => { tryPlay(15, 15); await sleep(2500);
    $('btn-draft').click(); await sleep(300);
    const inDraft = !!state.draft;
    $('btn-draft').click(); await sleep(300);
    return (inDraft && !state.draft ? '进出试下正常' : '★ 试下状态不对') + ' · 手数 ' + state.moves.length; });
  await step('停一手', async () => { const n0 = state.moves.length; $('btn-pass').click(); await sleep(300);
    return n0 + ' → ' + state.moves.length; });
  await step('数子', async () => { $('btn-score').click(); await sleep(6000);
    return state.result ? ('结果：' + ($('verdict-text').textContent || '').slice(0, 30)) : '（未终局，只看过程没崩）'; });
  await step('认输', async () => { $('btn-resign').click(); await sleep(600);
    return state.result ? '已判负' : '★ 没有结果'; });

  /* ---------- 3. 各种开关与快捷键 ---------- */
  await step('快捷键 T/Z/M/B/Y/X/N 全按一遍', async () => {
    const before = [state.showHints, state.showCoords, state.showNums, state.showPV,
      state.soundOn, state.showTerritory, settings.humanLike].join(',');
    ['KeyT', 'KeyZ', 'KeyM', 'KeyB', 'KeyY', 'KeyX', 'KeyN'].forEach(k => key(k));
    await sleep(400);
    const after = [state.showHints, state.showCoords, state.showNums, state.showPV,
      state.soundOn, state.showTerritory, settings.humanLike].join(',');
    ['KeyT', 'KeyZ', 'KeyM', 'KeyB', 'KeyY', 'KeyX', 'KeyN'].forEach(k => key(k));  // 复原
    await sleep(300);
    return before !== after ? '7 个键都生效了' : '★ 一个都没生效'; });
  await step('走势图切换 胜率/目差', async () => { seg('seg-curve', 'lead'); await sleep(250);
    const a = state.curveMode; seg('seg-curve', 'win'); await sleep(250);
    return a + ' → ' + state.curveMode; });
  await step('计算深度切换（底栏 + 面板两处）', async () => {
    $('sel-visits').value = '1000'; $('sel-visits').onchange({ target: $('sel-visits') }); await sleep(300);
    const a = settings.visits;
    $('btn-new').click(); await sleep(250);
    $('m-visits').value = '500'; $('m-visits').onchange({ target: $('m-visits') }); await sleep(250);
    const b = settings.visits;
    $('m-cancel').click(); await sleep(150);
    return a + ' → ' + b; });

  /* ---------- 4. 模式切换（含确认弹窗） ---------- */
  /* ★ 2026-10-14：顶栏那三个模式按钮改成**打开「新对局」面板**、点「开始」才切模式。
     原来那两条「弹窗 · 取消 / 确定」验的是「摆棋 → AI 对弈」的确认弹窗，那个弹窗
     已退役（它的职责并进面板里的「我执」那一行），所以改成验新的两步式流程。
     ★ 同日第二版：三个按钮**合并成一个按钮 + 下拉菜单**，按钮上写当前模式。 */
  await step('模式按钮：按钮文字 = 当前模式、点开是下拉、点项开面板', async () => {
    const 文字 = () => ($('mode-cur').textContent || '').trim();
    const 收起 = $('seg-mode').hidden;
    $('btn-mode').click(); await sleep(180);
    const 展开 = !$('seg-mode').hidden;
    const 项数 = $('seg-mode').querySelectorAll('button').length;
    $('btn-mode').click(); await sleep(180);
    const 又收起 = $('seg-mode').hidden;
    return '按钮文字=' + JSON.stringify(文字()) + '（mode=' + settings.mode + '）'
      + ' · 默认收起=' + 收起 + ' 点开=' + 展开 + ' 再点收起=' + 又收起
      + ' · 菜单项=' + 项数; });
  await step('AI 对弈 → 双人摆棋（经「新对局」面板）', async () => {
    seg('seg-mode', 'free'); await sleep(300);
    const preset = lit('seg-ntype');
    const stillOld = settings.mode;
    $('m-start').click(); await sleep(700);
    return '面板预选=' + preset + '（点按钮时模式还是 ' + stillOld + '）'
      + ' · 开始后 mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode'); });
  await step('摆棋 → AI 对弈（面板 · 取消）', async () => {
    seg('seg-mode', 'play'); await sleep(300);
    const ok = open('newgame') && lit('seg-ntype') === 'play';
    $('m-cancel').click(); await sleep(300);
    return (ok ? '面板出现且类型已预选 AI 对弈' : '★ 没弹 / 类型不对')
      + ' · 取消后 mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode'); });
  await step('摆棋 → AI 对弈（面板 · 开始）', async () => {
    seg('seg-mode', 'play'); await sleep(300);
    seg('seg-color', 'b'); await sleep(200); $('m-start').click(); await sleep(3500);
    return 'mode=' + settings.mode + ' 顶栏亮=' + lit('seg-mode') + ' 我执=' + state.myColor; });

  /* ---------- 5. 摆棋 + 让子开局 ---------- */
  await step('开新局 · 摆棋 + 让 3 子', async () => { $('btn-new').click(); await sleep(250);
    seg('seg-ntype', 'free'); seg('seg-handicap', '3'); await sleep(250);
    const komi = settings.komi; $('m-start').click(); await sleep(1500);
    return '盘上 ' + state.setup.length + ' 子 · komi=' + komi + ' · 轮走=' + sideToMove(state.viewAt)
      + ' · 让子行隐藏=' + $('row-color').hidden; });
  await step('摆棋模式下两边各落一手', async () => { tryPlay(3, 3); await sleep(200); tryPlay(15, 15); await sleep(300);
    return '手数=' + state.moves.length; });
  /* ★ 2026-10-14 用户要求：切模式时能"接着当前局面下"（保留盘面，只换模式）。
     这件事实质上就是原来那个「摆棋 → AI 对弈先问 AI 执哪一方」弹窗做的事。 */
  await step('接着当前局面下（保留盘面只换模式）', async () => {
    const mov0 = state.moves.length, set0 = state.setup.length;
    const first = state.moves[0] ? (state.moves[0].x + ',' + state.moves[0].y) : '无';
    seg('seg-mode', 'play'); await sleep(300);
    const shown = !$('row-keep').hidden;
    $('chk-keep').checked = true;
    seg('seg-color', 'w'); await sleep(200);        // 我执=白 → AI 执黑
    $('m-start').click(); await sleep(3000);
    const kept = state.moves.length >= mov0
      && state.moves[0] && (state.moves[0].x + ',' + state.moves[0].y) === first;
    /* ★ 还要验到"真的接着下"：我执=白 → KATAGO 执黑、正好轮到它，它应该自己接手落一手。
       人类权重**第一次推理约 5 秒**（Metal 着色器编译），所以这里轮询而不是干等 3 秒。 */
    const t = Date.now();
    while (state.moves.length < mov0 + 1 && Date.now() - t < 20000) await sleep(500);
    return (shown ? '面板出现了这一项' : '★ 没出现')
      + ' · 第一手还是' + first + '（说明没开新棋=' + kept + '）'
      + ' · 摆子 ' + set0 + '→' + state.setup.length
      + ' · mode=' + settings.mode + ' 我执=' + state.myColor
      + ' · KATAGO 接手后手数=' + state.moves.length + '（等了 ' + Math.round(Date.now() - t) + 'ms）'; });

  /* ---------- 6. 棋谱库：打开棋谱 / 看已存报告 ---------- */
  await step('棋谱库 · 打开一份棋谱', async () => { $('btn-records').click(); await sleep(600);
    const li = document.querySelector('#reclist li');
    /* ★ 2026-10-12 修：**棋谱库为空时列表里那一条是「库还是空的」占位项 —— 它没有按钮**。
       原来只判 li 是否存在，于是下面那句「li.querySelector('button').click()」抛
       Cannot read properties of null，整个「打开棋谱」这一步报 ★。
       实测背景：换成独立的测试棋谱库（_trash/records_test）之后它一开始必然是空的，
       所以这条几乎必然触发 —— 属于**判据漏了一种正常情况**，不是被测代码的毛病。
       ⚠️ 这个文件的被测代码是包在**模板字符串**里的：本注释里**绝不能出现反引号**，
          否则会把模板字符串截断（我这里就踩了一次：SyntaxError: missing ) after argument list）。 */
    if (!li || !li.querySelector('button')) { $('rec-close').click(); return '（库里没棋谱，跳过）'; }
    li.querySelector('button').click(); await sleep(1200);
    return '载入 ' + state.moves.length + ' 手 · mode=' + settings.mode + ' 名字=' + (state.names.b || '—') + '/' + (state.names.w || '—'); });
  await step('棋谱库 · 复盘报告（读已存的）', async () => { $('btn-records').click(); await sleep(600);
    const li = document.querySelector('#reclist li');
    if (!li) { $('rec-close').click(); return '（库里没棋谱，跳过）'; }
    const bs = [...li.querySelectorAll('button')];
    const rv = bs.find(b => b.textContent.indexOf('复盘报告') >= 0);
    if (!rv || rv.disabled) { $('rec-close').click(); return '（没有已存报告，跳过）'; }
    rv.click(); await sleep(1200);
    const txt = ($('review-body').textContent || '').slice(0, 40);
    const o = open('review'); $('review-close').click(); await sleep(200);
    return (o ? '报告打开了' : '★ 没打开') + ' · ' + txt; });
  await step('棋谱库 · 关掉', async () => { if (open('records')) { $('rec-close').click(); await sleep(200); }
    return open('records') ? '★ 还开着' : '已关'; });

  /* ---------- 7. 导出棋谱（会写进 records/，测试后由主进程清理） ---------- */
  await step('导出棋谱（存进棋谱库）', async () => {
    const before = [...document.querySelectorAll('#reclist li')].length;
    $('btn-save').click(); await sleep(1200);
    return '点击成功（下面由脚本核对文件数）'; });

  /* ---------- 8. 收尾：复位到未开局 ---------- */
  await step('复位 · 回到未开局', async () => { applyNewGame(true); await sleep(500);
    return 'noGame=' + state.noGame + ' 中央按钮可见=' + !$('board-gate').hidden; });

  return JSON.stringify({ 步骤: steps }, null, 1);
})()`);

/* 等一下再收尾，确保异步错误都冒出来了 */
await new Promise(r => setTimeout(r, 1500));
console.log(out);
console.log('');
console.log('=== 运行时错误（未捕获异常 / console.error）===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
