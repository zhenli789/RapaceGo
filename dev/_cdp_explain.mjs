/* 验证讲解卡：默认只剩一句指路 / 推荐落点（多推荐点）/ 讲解这手 / 讲过的不重讲 / 打谱也能用 */
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 400000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
}

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};

  /* ---------- ① 默认内容 ----------
     ★ 2026-10-24 用户要求：原来那两大段说明整段删掉，只留一句「点哪儿」。
       而且推荐落点那一页要**切过去**才看得见（三个按钮共用一块正文区）。 */
  const ex = $('explain-body').textContent || '';
  R['① 分析讲解默认内容'] = ex.replace(/\\s+/g, ' ').slice(0, 60);
  R['① 只剩一句指路（没把说明堆满）'] = (ex.length < 60 && ex.indexOf('讲解这手') >= 0)
    ? '✓ ' + ex.length + ' 字' : '★ ' + ex.length + ' 字';
  R['① 旧的长说明已删干净'] = (ex.indexOf('不会瞎夸') < 0 && ex.indexOf('点一次讲一次') < 0)
    ? '✓' : '★ 还有旧文案';
  state.coach.view = 'pick'; renderCoachPanels(true);
  const pk = $('pick-body').textContent || '';
  R['① 推荐落点默认内容'] = pk.replace(/\\s+/g, ' ').slice(0, 60);
  R['① 那一页的旧说明也删了'] = (pk.indexOf('虚线圆圈') < 0 && pk.indexOf('打谱时用不了') < 0)
    ? '✓' : '★ 还有旧文案';
  R['① 标题跟着页变'] = $('coach-title').textContent === '推荐落点讲解' ? '✓' : ('★ ' + $('coach-title').textContent);
  state.coach.view = 'explain'; renderCoachPanels(true);

  /* ---------- ② 加载两个引擎 ---------- */
  await window.api.engine.load('katago');
  await window.api.engine.load('coach');
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    await sleep(1000);
    if (engineReady && engineReadyPlay && coachReady) break;
  }
  R['② 引擎'] = (engineReady ? 'KataGo✓' : 'KataGo✗') + ' ' + (coachReady ? 'LoGos✓' : 'LoGos✗')
    + '（' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒）';
  if (!coachReady || !engineReady) return JSON.stringify(R, null, 1);

  /* ---------- ③ 开局落几手，等候选点 ---------- */
  settings.mode = 'free';
  applyNewGame();
  await sleep(300);
  const pts = [[3,3],[15,15],[3,15],[15,3],[9,9]];
  for (const p of pts) { tryPlay(p[0], p[1]); await sleep(160); }
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    await sleep(500);
    if (state.candAt === state.viewAt && state.candidates.length) break;
  }
  R['③ 棋盘候选点'] = state.candidates.length
    ? ('✓ ' + state.candidates.map(c => toGTP(c.x, c.y) + '(' + (c.win * 100).toFixed(0) + '%)').join(' '))
    : '★ 没算出来';
  if (!state.candidates.length) return JSON.stringify(R, null, 1);

  /* ---------- ④ 选点讲解（应该每个点一段） ---------- */
  const t2 = Date.now();
  $('btn-pick').click();
  while (Date.now() - t2 < 200000) { await sleep(400); if (!$('btn-pick').disabled) break; }
  await sleep(3200);        // ★ 再等一会儿：打字机还在逐字放（80 字/秒）
  const pickTxt = $('pick-body').textContent || '';
  R['④ 选点讲解'] = pickTxt.length > 60
    ? ('✓ ' + pickTxt.length + ' 字 · ' + ((Date.now() - t2) / 1000).toFixed(1) + ' 秒')
    : ('★ 太短：' + pickTxt.slice(0, 60));
  R['④ 讲到的点'] = (pickTxt.match(/推荐 \\d+ · [A-HJ-T][0-9]{1,2}/g) || []).join(' | ') || '（没匹配到）';
  R['④ 都是条件句'] = (pickTxt.match(/如果/g) || []).length >= 2 ? '✓ 每点都用「如果……」' : '★ 有断言句';
  R['④ 内容节选'] = pickTxt.slice(0, 260).replace(/\\s+/g, ' ');

  /* ---------- ⑤ 分析讲解（点评当前这一手） ---------- */
  const t3 = Date.now();
  $('btn-explain').click();
  while (Date.now() - t3 < 200000) { await sleep(400); if (!$('btn-explain').disabled) break; }
  await sleep(3000);        // ★ 同上：等打字机放完再读
  const exTxt = $('explain-body').textContent || '';
  R['⑤ 分析讲解'] = exTxt.length > 40
    ? ('✓ ' + exTxt.length + ' 字 · ' + ((Date.now() - t3) / 1000).toFixed(1) + ' 秒')
    : ('★ 太短：' + exTxt.slice(0, 60));
  R['⑤ 内容'] = exTxt.slice(0, 260).replace(/\\s+/g, ' ');
  /* ★ 2026-10-24 修判据：这里是「讲解这手」，讲的是**已经下出来的那一手**，
     开头就该是「这一手 X（…）下出来，」—— 原来查「有没有『如果』」是旧口径
     （2026-10-08 之前它讲的还是「该下哪」），模型不写「如果」反而判错。 */
  R['⑤ 开头是既成事实（这一手…下出来），不是「如果下在」'] =
    (exTxt.indexOf('这一手') >= 0 && exTxt.indexOf('如果') !== 0)
      ? '✓ ' + exTxt.slice(0, 24).replace(/\\s+/g, ' ') : '★ ' + exTxt.slice(0, 30);

  /* ---------- ⑥ 打谱也能用（2026-10-24 用户要求）----------
     清掉缓存、把 state.fromRecord 置真 → 它必须自己去取候选点（复盘没有，就现场问 KataGo），
     而不是像原来那样一句「别人的棋，不替人支招」挡住。 */
  state.coach.picks = {}; state.coach.pick = null;
  state.fromRecord = true;
  const t6 = Date.now();
  $('btn-pick').click();
  /* ★ 等「真的开始」再等「真的结束」：打谱这条路要先现场算候选点（~3 秒），
     这期间按钮还没置灰 —— 只盯 disabled 会在那 3 秒里误判成「已经讲完了」。 */
  while (Date.now() - t6 < 30000 && state.coach.busy.pick < 0) await sleep(150);
  while (Date.now() - t6 < 180000 && state.coach.busy.pick >= 0) await sleep(300);
  await sleep(2500);
  const pick6 = $('pick-body').textContent || '';
  R['⑥ 打谱时也能讲推荐落点'] = pick6.length > 60
    ? ('✓ ' + pick6.length + ' 字 · ' + ((Date.now() - t6) / 1000).toFixed(1) + ' 秒')
    : ('★ ' + pick6.slice(0, 80));
  R['⑥ 打谱时把推荐点画到盘上了'] = state.candAt === state.viewAt && state.candidates.length
    ? ('✓ ' + state.candidates.length + ' 个') : ('★ candAt=' + state.candAt + ' / ' + state.candidates.length);
  state.fromRecord = false;

  /* ---------- ⑦ 再点一次 = 直接显示缓存；Alt 点 = 重新生成（带打字机）----------
     ★ LoGos 偶尔会把某个点讲空（4 个点里有个把返回空文本）→ 「几点都讲完才存」就不成立，
       ⑥ 那次也就没留下缓存。缓存这条路本身由 _cdp_coach_reuse.mjs ⑩ 兜着，
       这里缺就补一份假的，别把「模型今天状态不好」记成功能 bug。 */
  /* ★ 等上一条（⑥）真的收工：按钮灰着时点它是点击无效的（真人点不动），
     不先等就会把「测试脚本自己点了一个 disabled 按钮」记成功能 bug。 */
  const tWait = Date.now();
  while ((state.coach.busy.pick >= 0 || $('btn-pick').disabled) && Date.now() - tWait < 30000) {
    await sleep(200);
  }
  const waited = Date.now() - tWait;
  const seeded = !Object.keys(state.coach.picks || {}).length;
  if (seeded) {
    const at0 = state.viewAt, key0 = pickPositionKey(at0);
    state.coach.picks[key0] = { at: at0, side: 'b', positionKey: key0, gen: gameGen,
      pts: [{ title: '推荐 1 · 假点（补的缓存）', body: '假缓存正文' }] };
    state.coach.pick = state.coach.picks[key0];
    renderCoachPanels(true);
  }
  const cacheTxt = $('pick-body').textContent;
  const before7 = {
    n: Object.keys(state.coach.picks || {}).length,
    pts: (state.coach.pick && state.coach.pick.pts) ? state.coach.pick.pts.length : -1,
    at: state.viewAt,
  };
  const disBefore = $('btn-pick').disabled;
  const keyStored = Object.keys(state.coach.picks || {})[0] || '(无)';
  const keyNow = pickPositionKey(state.viewAt);
  const t7 = Date.now();
  $('btn-pick').click();
  const d0 = $('btn-pick').disabled;      // 同步看：命中缓存就不会进入「讲解中…」
  await sleep(300);
  R['⑦ 再点一次不发请求（缓存命中）'] = (!d0 && $('pick-body').textContent === cacheTxt && !$('btn-pick').disabled)
    ? ('✓ ' + (Date.now() - t7) + 'ms' + (seeded ? '（⑥偶发没讲全 → 这份缓存是补的）' : '')
      + (waited > 500 ? '（先等上一条收工 ' + waited + 'ms）' : ''))
    : ('★ 又讲了一遍 · 缓存份数=' + before7.n + ' 点数=' + before7.pts + ' at=' + before7.at
      + ' 点前灰=' + disBefore + ' 点下即灰=' + d0
      + ' 键一致=' + (keyStored === keyNow) + ' busy=' + state.coach.busy.pick + ' 等了=' + waited + 'ms');
  /* Alt 点 = force → 真的重讲（这一条同时证明「重新生成」还留着） */
  state.coach.picks = {}; state.coach.pick = null;
  runPickExplain(true);
  await sleep(1600);
  const n1 = $('pick-body').children.length;
  const justN = $('pick-body').querySelectorAll('.just').length;
  R['⑦ Alt 点重讲：旧的清掉、新的建起来了'] = n1 >= 1 ? ('✓ ' + n1 + ' 个') : '★ 没重建';
  R['⑦ 打字机（淡入的字）'] = justN > 0
    ? ('✓ 演讲中有 ' + justN + ' 个淡入字（不是整段贴上去）') : '★ 没看到淡入字';
  /* 打断它，别让测试跑太久 */
  await window.api.coach.cancel();
  await sleep(400);

  return JSON.stringify(R, null, 1);
})()`);

console.log(out);
ws.close();
process.exit(0);
