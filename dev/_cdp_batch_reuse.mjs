/* 验证「全盘讲解」的两件事（2026-10-22 用户报障）：
   ① 已经复盘过的棋局，点全盘讲解**不再让 KataGo 重算**（直接复用复盘数据）
   ② 跑完把**整盘**摊开（原来只显示当前那一手，看着像「只讲了一步」）

   需要一个临时的 6 手棋谱：先用 reviewLineJob 直接给它做一份正式复盘，
   再点全盘讲解 —— 阶段①应该秒过、状态栏说「已经复盘过」。
   ★ 2026-10-23 行为变更：把 settings.reviewVisits 改一档**仍然要复用**（沿用复盘那一档），
   因为老的复盘文件搜索量和现在的默认设置常常不同（用户报障的根因）。
   真正不能借的是**环境**变了（权重 / 贴目 / 规则 / 棋盘 / 摆子）。

   判据都是**能量到的数**：走没走引擎看「有没有出现过『正在让 KataGo 算一遍』」，
   不看代码分支（那等于自己证明自己）。 */
const PORT = 9333;
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 900000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  const nm = '_batch_reuse.sgf';
  const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]RU[Chinese]GN[复用测试]'
    + ';B[pd];W[dp];B[pp];W[dd];B[fq];W[cn])';
  const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
  /* 跑一次全盘讲解，同时把状态栏和进度条上出现过的文字都记下来 ——
     判据靠它们，不靠读代码。 */
  async function runBatch(limitMs) {
    const seen = { status: [], bar: [] };
    const t = Date.now();
    $('btn-batch').click();
    let firstHand = 0;
    while (Date.now() - t < (limitMs || 600000)) {
      await sleep(120);
      const s = clean($('status').textContent);
      const b = $('batch-bar').hidden ? '' : clean($('batch-txt').textContent);
      if (s && seen.status.indexOf(s) < 0) seen.status.push(s);
      if (b && seen.bar.indexOf(b) < 0) seen.bar.push(b);
      if (!firstHand && b.indexOf('讲第') === 0) firstHand = Date.now() - t;
      if (state.coach.batch === null && !$('btn-batch').disabled) break;
    }
    seen.secs = ((Date.now() - t) / 1000).toFixed(1);
    seen.firstHand = firstHand;
    await sleep(300);
    return seen;
  }
  try {

  /* ---------- 引擎 ---------- */
  await window.api.engine.load('katago');
  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) { await sleep(900); if (engineReady && coachReady) break; }
  R['① 引擎'] = (engineReady ? 'KataGo✓' : 'KataGo✗') + ' ' + (coachReady ? 'LoGos✓' : 'LoGos✗')
    + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）';
  if (!engineReady || !coachReady) return JSON.stringify(R, null, 1);

  /* ---------- 造棋谱 + 先做一份正式复盘 ---------- */
  /* 先删干净（records:remove 会把 .review.json / .coach.json 一起进回收站），
     再从零造一份 —— 免得上一轮跑剩下的文件把判据搞成假的。 */
  try { await window.api.records.remove(nm); } catch (e) { }
  await sleep(500);
  await window.api.records.save(nm, sgf);
  await openRecord(nm);
  await sleep(1200);
  R['② 载入'] = (state.fromRecord && state.moves.length === 6) ? '✓ 6 手' : ('★ ' + state.moves.length);

  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi, size: N, maxVisits: reviewVisits(),
  };
  const envSig = reviewEnvSig(base, analyzeModelName);
  const mlist = lineGtpOf(state.moves);
  const doc0 = emptyReviewDoc(nm);
  rvRun = { t0: Date.now(), visitsDone: 0, visits: base.maxVisits, total: 7,
            doneSet: new Set(), doneBase: 0, lineIdx: 0, lineCount: 1, scope: 'line', name: nm };
  const rt = Date.now();
  let one = null;
  try {
    one = await reviewLineJob({ name: nm, doc: doc0, partLines: {},
      t: { list: mlist, key: lineKeyOfList(mlist), n: mlist.length, cur: true },
      idx: 0, base: base, envSig: envSig, gen: gameGen });
  } catch (e) { R['③ 复盘异常'] = String((e && e.message) || e); }
  const reviewMs = Date.now() - rt;
  R['③ 先做一份正式复盘'] = one && one.whole
    ? ('✓ ' + one.done + ' 回合 · ' + (reviewMs / 1000).toFixed(1) + 's') : ('★ ' + JSON.stringify(one));
  const rv = await window.api.records.readReview(nm);
  let tv = null;
  try { tv = JSON.parse((rv && rv.text) || ''); } catch (e) { }
  const L0 = tv && tv.lines && tv.lines[lineKeyOfList(mlist)];
  R['④ 复盘文件有 turns'] = (L0 && L0.turns && Object.keys(L0.turns).length >= 6)
    ? ('✓ ' + Object.keys(L0.turns).length + ' 个回合 · env 一致=' + (L0.env === envSig)) : '★ 没存上';
  R['⑤ 候选点存了胜率'] = (function () {
    const t1 = L0 && L0.turns && L0.turns[0];
    const mv = t1 && t1.moves && t1.moves[0];
    return (mv && typeof mv.winrate === 'number') ? ('✓ ' + mv.move + ' ' + mv.winrate.toFixed(3))
      : ('★ moves[0]=' + JSON.stringify(mv));
  })();
  const repHistory = (L0 && L0.history) || [];

  /* ---------- ① 全盘讲解：应该复用复盘、不重算 ---------- */
  state.coach.explain = {};                 // 清掉内存里的，确保要走一遍流程
  /* ★ 判据：进度条上出现「正在让 KataGo 算一遍」或「KataGo 算整盘 N/M」= 真发过引擎请求。
     （后一种更常见：主进程的 onReviewProgress 每算完一个回合就把进度条文字改写成「KataGo 算整盘 3/7」，
      所以只看前一句会漏判 —— 第一版就是这么漏的，㉑ 报了个假 ★。） */
  const engineRan = bar => bar.some(x => x.indexOf('正在让 KataGo') >= 0 || x.indexOf('KataGo 算整盘') >= 0);
  const a = await runBatch(600000);
  R['⑥ 阶段① 没走引擎'] = engineRan(a.bar)
    ? ('★ 又让引擎整盘算了：' + a.bar.slice(0, 2).join(' ／ '))
    : ('✓ 进度条没出现任何「让 KataGo 算」 · 第 1 手讲完在第 ' + a.firstHand + 'ms（复盘本身 ' + reviewMs + 'ms）');
  R['⑦ 状态栏说了复用'] = a.status.some(x => x.indexOf('已经复盘过') >= 0)
    ? '✓ ' + a.status.filter(x => x.indexOf('已经复盘过') >= 0)[0] : ('★ 没这句话：' + a.status.join(' ／ '));
  R['⑧ 走势用的是复盘数据'] = (state.history.length === 7
      && repHistory.length === 7
      && Math.abs((state.history[6] || 0) - (repHistory[6] || 0)) < 1e-6)
    ? ('✓ 末手胜率一致（' + (repHistory[6] * 100).toFixed(1) + '%）')
    : ('★ 内存 ' + JSON.stringify(state.history) + ' ／ 文件 ' + JSON.stringify(repHistory));
  R['⑨ 六手都讲了'] = (Object.keys(state.coach.explain).length === 6)
    ? ('✓ 6 手 · ' + a.secs + 's') : ('★ ' + Object.keys(state.coach.explain).length + ' 手');
  R['⑩ 讲稿落盘'] = await (async function () {
    const f = await window.api.records.readCoach(nm);
    try { const d = JSON.parse((f && f.text) || ''); return ((d.list || []).filter(Boolean).length === 6) ? '✓ 6 条' : '★ ' + d.list.length; }
    catch (e) { return '★ 读不出来'; }
  })();

  /* ---------- ② 跑完自动摊成「全盘」 ---------- */
  R['⑪ 自动切全盘'] = state.coach.allView ? '✓ allView 开了' : '★ 还停在单手视图';
  R['⑫ 全盘里有几行'] = (function () {
    const rows = document.querySelectorAll('#explain-body .all-row');
    return rows.length === 6 ? ('✓ 6 行') : ('★ ' + rows.length + ' 行');
  })();
  R['⑫ 抬头小字'] = clean(document.querySelector('#explain-body .src') && document.querySelector('#explain-body .src').textContent);
  R['⑬ 标题旁链接'] = (function () {
    const b = $('btn-all');
    return (b && !b.hidden) ? ('✓ 露出 · 文字「' + b.textContent.trim() + '」') : '★ 没露出来';
  })();
  R['⑭ 第一行长什么样'] = clean(document.querySelector('#explain-body .all-row .pnt') && document.querySelector('#explain-body .all-row .pnt').textContent);

  /* ---------- ③ 点一行 → 跳过去，视图不关 ---------- */
  const rows = document.querySelectorAll('#explain-body .all-row');
  if (rows[1]) rows[1].click();
  await sleep(400);
  R['⑮ 点第二行'] = (state.viewAt === 2) ? '✓ 跳到第 2 手' : ('★ viewAt=' + state.viewAt);
  R['⑯ 视图没关'] = state.coach.allView ? '✓ 还开着' : '★ 被关掉了';
  R['⑰ 高亮跟过去了'] = (function () {
    const cur = document.querySelector('#explain-body .all-row.cur');
    return (cur && cur.dataset.at === '2') ? '✓ 高亮在第 2 行' : ('★ ' + (cur ? cur.dataset.at : '没有 .cur'));
  })();
  R['⑱ 正文里是第 2 手'] = (function () {
    const cur = document.querySelector('#explain-body .all-row.cur');
    return (cur && clean(cur.textContent).indexOf('第 2 手') === 0) ? '✓' : '★ ' + clean(cur && cur.textContent).slice(0, 40);
  })();

  /* ---------- ④ 「返回」→ 回到只看这一手 ---------- */
  $('btn-all').click();
  await sleep(300);
  R['⑲ 返回单手视图'] = (!state.coach.allView && !document.querySelector('#explain-body .all-row'))
    ? ('✓ 正文：' + clean($('explain-body').textContent).slice(0, 30)) : '★ 没退出来';
  R['⑲ 链接文字变回来'] = $('btn-all').textContent.trim() === '看全盘' ? '✓' : ('★ ' + $('btn-all').textContent.trim());

  /* ---------- ⑤ 全部讲过再点「全盘讲解」→ 不发请求、直接摊开 ---------- */
  const b2 = await runBatch(90000);
  R['⑳ 再点一次'] = (b2.secs < 3 && b2.bar.length === 0)
    ? ('✓ ' + b2.secs + 's 就回来了（一个请求都没发）') : ('★ ' + b2.secs + 's · 进度条文字 ' + b2.bar.join(' ／ '));
  R['⑳ 摊开了'] = state.coach.allView ? '✓' : '★';
  R['⑳ 状态栏'] = b2.status.join(' ／ ');

  /* ---------- ⑥ 换搜索量 → **仍然复用**（★ 2026-10-23 用户报障后的行为变更） ----------
     原来的判据是「搜索量变了 → 环境签名变了 → 必须重算」。用户实测报的就是这个：
     老复盘文件是每手 100 次，默认设置 500 次 → 一比对就不等 → 整盘白算一遍（几十分钟）。
     现在的规矩：环境（权重/贴目/规则/棋盘/摆子）一致就允许借，**整盘沿用复盘那一档搜索量**。 */
  const repVisits = (L0 && L0.visits) || reviewVisits();
  const oldVisits = settings.reviewVisits;
  settings.reviewVisits = 300;
  const b3 = await runBatch(300000);
  settings.reviewVisits = oldVisits;
  R['㉑ 换搜索量后仍然复用（不再白算）'] = !engineRan(b3.bar)
    ? ('✓ 一个请求都没发 · ' + b3.secs + 's') : ('★ 又算了：' + b3.bar.slice(0, 2).join(' ／ '));
  R['㉑ 手数没变'] = Object.keys(state.coach.explain).length === 6 ? '✓ 6 手还在' : '★ 丢了';
  R['㉑ 用的是复盘那一档搜索量'] = (function () {
    /* 注意 500 请求回来的是 505~507（引擎按预算多跑一点），所以判「和复盘同一档」用 ±20，
       关键是**不能变成刚设的 300**。 */
    const hv = state.histVisits || [];
    const ok = hv.length === 7 && hv.every(v => v !== 300 && Math.abs(v - repVisits) <= 20);
    return ok ? ('✓ 全是 ' + hv[0] + ' 次（复盘那档 ' + repVisits + '，不是 300）')
      : ('★ ' + JSON.stringify(hv));
  })();
  /* 真正不能借的是**环境**变了（权重/贴目/规则/棋盘/摆子）—— 用纯函数验一下这条边界 */
  R['㉑ 环境核心不含搜索量'] = (function () {
    const a = { initialStones: [], rules: 'chinese', komi: 7.5, size: 19, maxVisits: 100 };
    const b = { initialStones: [], rules: 'chinese', komi: 7.5, size: 19, maxVisits: 500 };
    return envCoreOf(reviewEnvSig(a, 'w.bin.gz')) === envCoreOf(reviewEnvSig(b, 'w.bin.gz'))
      ? '✓ 100 与 500 的核心相同' : '★ 核心把搜索量也算进去了';
  })();
  R['㉑ 换权重就不能借'] = (function () {
    const a = { initialStones: [], rules: 'chinese', komi: 7.5, size: 19, maxVisits: 500 };
    return envCoreOf(reviewEnvSig(a, 'w1.bin.gz')) !== envCoreOf(reviewEnvSig(a, 'w2.bin.gz'))
      ? '✓ 核心不同' : '★ 权重没进核心';
  })();

  /* 收尾 */
  applyNewGame(true);
  } catch (e) { R['㉒ 脚本异常'] = String((e && e.message) || e); }
  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
