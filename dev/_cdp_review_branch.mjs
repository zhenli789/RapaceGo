/* 验收 2026-10-22 的两件事（用户要求）：
 *   ① **有分支的棋谱**：复盘按「线」存 —— 换到另一条分支能接着复盘（共享前缀直接复用），
 *      两条线的报告存在**同一个** <棋谱名>.review.json 里；
 *      看报告时按「当前站在哪条线上」显示对应那份。
 *   ② 本程序下的棋 → 导出棋谱时同时存一份 AI 分析（source='live'），
 *      下次打开这份棋谱**不用再复盘**就有目损。
 *   ③ ⑦ 号块：**对弈棋局带分支**时导出只存当前那条线（用户 2026-10-22 问的），
 *      顺带回归「换线后逐手快照不许留着别的线的局面」（否则 live 报告会串线）。
 *
 * 夹具：12 手主线 + 第 7 手处分出另一条 12 手的分支（标准 SGF 变体写法）。
 *   两条线前 6 手完全相同 → 分支复盘应当只算后面的 6 个回合（+第 7 回合那个分叉局面）。
 *
 * 运行（必须同一条 bash 里起实例 + 跑测试，抄 dev/README.md）：
 *   export RAPACEGO_RECORDS="$PWD/_trash/records_test" RAPACEGO_PUZZLES="$PWD/_trash/puzzles_test"
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     --remote-debugging-port=9333 --user-data-dir="$PWD/_trash/userdata_test" \
 *     --no-sandbox --disable-gpu --in-process-gpu . > _trash/_mac_run.log 2>&1 &
 *   sleep 16; node dev/_cdp_review_branch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const RECORDS = process.env.RAPACEGO_RECORDS;

if (!RECORDS) {
  console.log('★ 没有 RAPACEGO_RECORDS —— 这一轮会写到真实棋谱库里，拒绝运行');
  process.exit(1);
}
fs.mkdirSync(RECORDS, { recursive: true });

/* 夹具：前 6 手共用，第 7 手分两条线（主分支先出现 = SGF 的主线）。
   ★ 两条线**手数相同、只有第 7/8 手对调**，正好检验「线指纹」不是拿手数糊弄的。 */
const MAIN = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'np', 'qf', 'cc', 'dc', 'cd', 'cf'];
/* ★ 分支故意走得**明显差**（第 7 手 1-1 角部、后面一路低位）：
   这样两条线的胜率曲线才会真的分叉 —— ⑨ 号块要量的就是「切分支后曲线换了」，
   两条线如果只是把第 7/8 手对调，曲线几乎一模一样，测不出"没换"这个 bug。 */
const BRANCH = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'aa', 'qq', 'bb', 'ab', 'ba', 'ca'];
const SHARED = 6;                        // 前 6 手相同 → 第 7 手（下标 6）开始分叉

const sgfOf = (main, branch, gn) => '(;GM[1]FF[4]DT[2026-10-22]SZ[19]KM[6.5]RU[chinese]'
  + 'PB[分支测试]PW[分支测试]RE[B+3.5]CA[UTF-8]GN[' + gn + ']'
  + main.slice(0, SHARED).map((m, i) => ';' + (i % 2 ? 'W' : 'B') + '[' + m + ']').join('')
  + '(;' + main.slice(SHARED).map((m, i) => (i ? ';' : '') + ((SHARED + i) % 2 ? 'W' : 'B') + '[' + m + ']').join('') + ')'
  + '(;' + branch.slice(SHARED).map((m, i) => (i ? ';' : '') + ((SHARED + i) % 2 ? 'W' : 'B') + '[' + m + ']').join('') + ')'
  + ')';

const NAME = '分支复盘_12手.sgf';
const repFile = path.join(RECORDS, NAME + '.review.json');
const partFile = path.join(RECORDS, NAME + '.review.part.json');

/* ② 用的夹具（自己下的棋 → 导出时要把 AI 分析一起存下来） */
const EXPORT_SRC = '导出带分析_24手.sgf';
const MOVES_E = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'np', 'qf', 'cc', 'dc', 'cd', 'cf',
  'ce', 'de', 'bf', 'cb', 'bb', 'be', 'df', 'cg', 'bd', 'bg', 'ef', 'eb'];
const sgfPlain = (moves, gn) => '(;GM[1]FF[4]DT[2026-10-22]SZ[19]KM[6.5]RU[chinese]'
  + 'PB[P1]PW[AI]RE[B+2.5]CA[UTF-8]GN[' + gn + ']'
  + moves.map((m, i) => ';' + (i % 2 ? 'W' : 'B') + '[' + m + ']').join('') + ')';

fs.writeFileSync(path.join(RECORDS, NAME), sgfOf(MAIN, BRANCH, '分支复盘'), 'utf8');
fs.writeFileSync(path.join(RECORDS, EXPORT_SRC), sgfPlain(MOVES_E, '导出带分析'), 'utf8');
for (const f of [repFile, partFile]) { try { fs.rmSync(f); } catch (e) { /* 没有就算了 */ } }
/* 上一轮 ⑤ 导出的棋谱（"P1 vs AI-…"）连同它的复盘文件一起清掉，否则会越攒越多 */
for (const f of fs.readdirSync(RECORDS)) {
  if (f.indexOf('P1 vs AI-') === 0) { try { fs.rmSync(path.join(RECORDS, f)); } catch (e) { /* 忽略 */ } }
}

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 还没起来 */ }
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: tmo || 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');

/* 引擎就绪（软件启动默认不加载；两个键名都要认，见 _cdp_review.mjs 的教训） */
const load = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  if (engineReady) return { 已就绪: true };
  await window.api.engine.load('analyze');
  var t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 180000) await sleep(1000);
  return { 就绪: engineReady, 等了秒: Math.round((Date.now()-t0)/1000) };
})()`, 300000);
console.log('引擎 ' + JSON.stringify(load));
if (!load || !(load.就绪 || load.已就绪)) {
  console.log('★ 引擎没起来，后面的断言都没意义');
  ws.close(); process.exit(1);
}

/* ---------- ① 先复盘主线（12 手 → 13 回合），存成 v3 文档 ---------- */
const step1 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME)};
  settings.reviewVisits = 20;
  await openRecord(NAME);
  await sleep(300);
  out.手数 = state.moves.length;
  out.第7手 = state.moves[6] ? ((state.moves[6].color === 'w' ? 'W' : 'B') + toGTP(state.moves[6].x, state.moves[6].y)) : null;
  out.有树 = !!state.varRoot;
  runReview(NAME);
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  var t1 = Date.now();
  while (reviewBusy && Date.now() - t1 < 240000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t1) / 1000);
  out.线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  out.目损 = state.review ? state.review.losses.length : null;
  out.报告线指纹 = state.review ? state.review.lineKey : null;
  out.当前线指纹 = lineKeyOfMoves(state.moves);
  out.标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  return out;
})()`, 300000);
if (typeof step1 === 'string') { console.log('① 运行失败: ' + step1); ws.close(); process.exit(1); }

const doc1 = JSON.parse(fs.readFileSync(repFile, 'utf8'));
const keys1 = Object.keys(doc1.lines || {});
console.log('\n① 主线复盘（12 手，第 7 手处分叉）');
console.log('   手数=' + step1.手数 + '  第7手=' + step1.第7手 + '  有变化树=' + step1.有树 + '  跑完=' + step1.跑完秒 + 's');
console.log('   目损条数=' + step1.目损 + '  文件版本=' + doc1.v + '  文件里的线数=' + keys1.length
  + '（界面 ' + step1.线数 + '）');
console.log('   标题="' + step1.标题 + '"  线指纹对得上=' + (step1.报告线指纹 === step1.当前线指纹));
const okA = step1.起来了 && step1.手数 === MAIN.length && step1.有树
  && step1.目损 === MAIN.length
  && doc1.v === 3 && keys1.length === 1
  && step1.线数 === 1 && step1.报告线指纹 === step1.当前线指纹
  && !!(doc1.lines[keys1[0]] && doc1.lines[keys1[0]].turns);

/* ---------- ② 切到另一条分支：这条线还没复盘 ---------- */
const step2 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  gotoView(7);
  out.有分支 = !!varAt(7);
  switchVariation(1);
  await sleep(400);
  out.手数 = state.moves.length;
  out.第7手 = state.moves[6] ? ((state.moves[6].color === 'w' ? 'W' : 'B') + toGTP(state.moves[6].x, state.moves[6].y)) : null;
  out.换线后复盘为空 = !state.review;
  out.文件里的线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  out.当前线指纹 = lineKeyOfMoves(state.moves);
  await openSavedReview(${JSON.stringify(NAME)});
  out.面板标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  out.面板文案 = (document.getElementById('review-body').textContent || '').slice(0, 300);
  out.有开算键 = !!document.getElementById('rv-line-go');
  return out;
})()`, 90000);
if (typeof step2 === 'string') { console.log('② 运行失败: ' + step2); ws.close(); process.exit(1); }

console.log('\n② 切到另一条分支（Alt+→）');
console.log('   有分支点=' + step2.有分支 + '  手数=' + step2.手数 + '  第7手=' + step2.第7手
  + '（主线第7手是 ' + step1.第7手 + '）');
console.log('   换线后复盘为空=' + step2.换线后复盘为空 + '  文件里的线数仍为=' + step2.文件里的线数);
console.log('   面板标题="' + step2.面板标题 + '"');
console.log('   面板文案="' + step2.面板文案 + '"');
const okB = step2.有分支 && step2.手数 === BRANCH.length
  && step2.第7手 !== step1.第7手
  && step2.换线后复盘为空                    // ★ 不能拿主线那份报告冒充这条线
  && step2.文件里的线数 === 1
  && step2.有开算键 && String(step2.面板标题 || '').indexOf('还没复盘') >= 0
  && String(step2.面板文案 || '').indexOf('第 7 手') >= 0;

/* ---------- ③ 点「复盘这条分支」：共享前缀复用 + 结果写进同一个文件 ---------- */
const step3 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var st = document.getElementById('status');
  var seen = [];
  var note = function(){ if (st) { var t = st.textContent || ''; if (t && seen.indexOf(t) < 0) seen.push(t); } };
  var btn = document.getElementById('rv-line-go');
  out.有开算键 = !!btn;
  if (btn) btn.click();
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) { await sleep(50); note(); }
  out.起来了 = reviewBusy;
  /* flash 只挂 1.8 秒，靠密集采样抓住「复用前面共享的 N 手」那句 */
  var t1 = Date.now();
  while (Date.now() - t1 < 8000) { await sleep(80); note(); }
  out.状态采样 = seen;
  var t2 = Date.now();
  while (reviewBusy && Date.now() - t2 < 240000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t2) / 1000);
  out.线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  out.目损 = state.review ? state.review.losses.length : null;
  out.报告线指纹 = state.review ? state.review.lineKey : null;
  out.当前线指纹 = lineKeyOfMoves(state.moves);
  out.正文 = (document.getElementById('review-body').textContent || '').slice(0, 300);
  return out;
})()`, 300000);
if (typeof step3 === 'string') { console.log('③ 运行失败: ' + step3); ws.close(); process.exit(1); }

const doc2 = JSON.parse(fs.readFileSync(repFile, 'utf8'));
const keys2 = Object.keys(doc2.lines || {});
const lineMain = doc2.lines[keys1[0]];
const lineBr = keys2.filter(k => k !== keys1[0]).map(k => doc2.lines[k])[0] || null;
const reusedTxt = (step3.状态采样 || []).find(t => String(t).indexOf('复用') >= 0) || '';
console.log('\n③ 点「复盘这条分支」（应当只算分叉之后的 6 个回合）');
console.log('   起来=' + step3.起来了 + '  跑完=' + step3.跑完秒 + 's');
console.log('   状态文案（复用）="' + reusedTxt + '"');
console.log('   文件里的线数=' + keys2.length + '（界面 ' + step3.线数 + '）'
  + '  主线键=' + keys1[0] + '  分支键=' + (lineBr && lineBr.key));
console.log('   分支这份目损=' + (lineBr && lineBr.report ? lineBr.report.losses.length : null)
  + '  主线那份仍在=' + (lineMain && lineMain.report ? lineMain.report.losses.length : null));
console.log('   两条线的手顺不同=' + !!(lineBr && lineBr.moves && lineMain.moves
  && lineBr.moves.join(',') !== lineMain.moves.join(',')));
console.log('   报告线指纹对得上=' + (step3.报告线指纹 === step3.当前线指纹)
  + '  正文提到分支=' + (String(step3.正文 || '').indexOf('当前这条分支') >= 0));
const okC = step3.起来了 && step3.目损 === BRANCH.length
  && keys2.length === 2 && step3.线数 === 2
  && !!lineBr && lineBr.report && lineBr.report.losses.length === BRANCH.length
  && !!lineMain && lineMain.report && lineMain.report.losses.length === MAIN.length
  && lineBr.moves.join(',') !== lineMain.moves.join(',')
  && step3.报告线指纹 === step3.当前线指纹
  && String(reusedTxt).indexOf('复用前面共享的 7 手') >= 0;    // 6 手共享 → 回合 0..6 = 7 个

/* ---------- ④ 切回主线：显示的是主线那份，不是刚才那条分支的 ---------- */
const step4 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  gotoView(7);
  switchVariation(-1);
  await sleep(400);
  out.手数 = state.moves.length;
  out.第7手 = state.moves[6] ? ((state.moves[6].color === 'w' ? 'W' : 'B') + toGTP(state.moves[6].x, state.moves[6].y)) : null;
  out.有复盘 = !!state.review;
  out.目损 = state.review ? state.review.losses.length : null;
  out.报告线指纹 = state.review ? state.review.lineKey : null;
  out.当前线指纹 = lineKeyOfMoves(state.moves);
  await openSavedReview(${JSON.stringify(NAME)});
  out.有开算键 = !!document.getElementById('rv-line-go');
  out.标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  return out;
})()`, 90000);
if (typeof step4 === 'string') { console.log('④ 运行失败: ' + step4); ws.close(); process.exit(1); }

console.log('\n④ 切回主线（Alt+←）');
console.log('   手数=' + step4.手数 + '  第7手=' + step4.第7手
  + '  有复盘=' + step4.有复盘 + '  目损=' + step4.目损);
console.log('   报告线指纹对得上=' + (step4.报告线指纹 === step4.当前线指纹)
  + '  和分支那份不同=' + (step4.报告线指纹 !== (lineBr && lineBr.key)));
console.log('   报告标题="' + step4.标题 + '"  弹的是"还没复盘"面板=' + step4.有开算键);
const okD = step4.手数 === MAIN.length && step4.第7手 === step1.第7手
  && step4.有复盘 && step4.目损 === MAIN.length
  && step4.报告线指纹 === step4.当前线指纹
  && step4.报告线指纹 !== (lineBr && lineBr.key)
  && !step4.有开算键;                          // ★ 主线有报告 → 直接显示，不该再问"要不要算"

/* ---------- ⑤ 导出棋谱时把「下棋时攒的分析」一起存成复盘 ---------- */
const step5 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  await openRecord(${JSON.stringify(EXPORT_SRC)});
  await sleep(300);
  var n = state.moves.length;
  out.手数 = n;
  /* 伪造「下棋时每一手都分析过」的快照（真实对局里由 applyAnalysis 填 state.anaAt） */
  state.anaAt = {};
  for (var t = 0; t <= n; t++) {
    state.anaAt[t] = {
      at: t, side: (t % 2 === 0 ? 'b' : 'w'),
      blackWin: 0.5 + 0.02 * Math.sin(t), lead: 4 - 0.1 * t,
      visits: 120,
      moves: [{ gtp: 'Q16', order: 0, win: 0.5, lead: 4 },
              { gtp: 'D4', order: 1, win: 0.49, lead: 3.5 }],
      best: { gtp: 'Q16' }
    };
  }
  var r = await saveToRecords();
  out.存了 = !!(r && r.name);
  out.名字 = r && r.name || null;
  var rv = out.名字 ? await window.api.records.readReview(out.名字) : null;
  out.有报告 = !!(rv && rv.text);
  var o = (rv && rv.text) ? JSON.parse(rv.text) : null;
  out.版本 = o ? o.v : null;
  out.线数 = o && o.lines ? Object.keys(o.lines).length : 0;
  var k = o && o.lines ? Object.keys(o.lines)[0] : null;
  var line = k ? o.lines[k] : null;
  out.来源 = line ? line.source : null;
  out.分析手数 = line && line.report ? line.report.analyzed : null;
  out.目损 = line && line.report ? line.report.losses.length : null;
  out.存了中间文件 = !!(out.名字 && await window.api.records.readReviewPart(out.名字));
  return out;
})()`, 180000);
if (typeof step5 === 'string') { console.log('⑤ 运行失败: ' + step5); ws.close(); process.exit(1); }

console.log('\n⑤ 导出棋谱 + AI 分析一起存');
console.log('   导出文件名=' + step5.名字 + '（界面手数 ' + step5.手数 + '）');
console.log('   复盘文件版本=' + step5.版本 + '  线数=' + step5.线数 + '  来源=' + step5.来源
  + '  分析到的手数=' + step5.分析手数 + '  目损条数=' + step5.目损);
console.log('   没留中间文件=' + !step5.存了中间文件);
const okE = step5.存了 && step5.有报告 && step5.版本 === 3 && step5.线数 === 1
  && step5.来源 === 'live' && step5.分析手数 === step5.手数 + 1
  && step5.目损 === step5.手数 && !step5.存了中间文件;

/* ---------- ⑥ 重新打开这份棋谱：不用复盘，目损直接就有 ---------- */
const step6 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  await openRecord(${JSON.stringify(step5.名字 || '')});
  var t0 = Date.now();
  while (!state.review && Date.now() - t0 < 15000) await sleep(200);
  out.等秒 = Math.round((Date.now() - t0) / 1000);
  out.有复盘 = !!state.review;
  out.来源 = state.review ? state.review.source : null;
  out.目损 = state.review ? state.review.losses.length : null;
  out.手数 = state.moves.length;
  out.线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  showReviewReport();
  out.文案 = (document.getElementById('review-body').textContent || '').slice(0, 400);
  return out;
})()`, 90000);
if (typeof step6 === 'string') { console.log('⑥ 运行失败: ' + step6); ws.close(); process.exit(1); }

console.log('\n⑥ 重新打开刚导出的棋谱（不点任何复盘）');
console.log('   等 ' + step6.等秒 + 's 后：有复盘=' + step6.有复盘 + '  来源=' + step6.来源
  + '  目损=' + step6.目损 + ' / 手数 ' + step6.手数 + '  线数=' + step6.线数);
console.log('   报告开头="' + String(step6.文案 || '').slice(0, 160) + '"');
const okF = step6.有复盘 && step6.来源 === 'live'
  && step6.目损 === step6.手数 && step6.手数 === MOVES_E.length
  && String(step6.文案 || '').indexOf('边下边算') >= 0;

/* ---------- ⑦ 对弈棋局**有分支**时导出：只存当前这条线（用户 2026-10-22 问的）
   ① 回看中落子 = 开分支 → 被放弃的那半段分析在 cutForBranch 里就删了（`truncateAnalysisTo`）；
   ② 导出时 live 报告只写**你站的那条线**（`saveLiveReviewFor` 只认 `state.anaAt`）；
   ③ 重开这份棋谱默认回到**主线**（新分支是挂在右边当变体）→ 报告不在眼前，
      但文件里有，切过去就有（`syncReviewForLine` 会挑当前线那份）。
   ★ 这条同时回归 applyVariationLine 的 anaAt 截断：换线后快照里不能留着别的线的局面
     （否则 live 报告会混进别的分支的胜率/目差 —— 比没有数字更糟）。 */
const step7 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  await openRecord(${JSON.stringify(EXPORT_SRC)});
  await sleep(300);
  out.原手数 = state.moves.length;
  /* 伪造「每一手都分析过」 */
  state.anaAt = {};
  for (var t = 0; t <= out.原手数; t++) {
    state.anaAt[t] = { at: t, side: (t % 2 ? 'w' : 'b'), blackWin: 0.5 + 0.01 * t, lead: 3 - 0.1 * t,
      visits: 120, moves: [{ gtp: 'Q16', order: 0 }, { gtp: 'D4', order: 1 }], best: { gtp: 'Q16' } };
  }
  out.分析手数 = Object.keys(state.anaAt).length;
  var CUT = 15;
  gotoView(CUT);
  /* 找一个空点落下（回看中落子 = 开分支） */
  var b = boardAt(CUT), x = -1, y = -1;
  for (var j = 0; j < N && x < 0; j++) for (var i = 0; i < N && x < 0; i++) {
    if (!b[idx(i, j)]) { x = i; y = j; }
  }
  out.落点 = toGTP(x, y);
  var ok = tryPlay(x, y);
  await sleep(300);
  out.落子成功 = ok !== false;
  out.开后手数 = state.moves.length;
  out.有树 = !!state.varRoot;
  /* ★ anaAt 只该留下共享前缀（位置 0..CUT），不能留原来后半段的快照 */
  var keys = Object.keys(state.anaAt).map(Number);
  out.快照最大位置 = keys.length ? Math.max.apply(null, keys) : null;
  out.快照条数 = keys.length;
  out.串了别的线 = keys.some(function(k){ return k > CUT; });
  /* 再切一次线：换回来再换过去，快照不许因此变脏 */
  switchVariation(1);
  await sleep(300);
  var k2 = Object.keys(state.anaAt).map(Number);
  out.换线后最大位置 = k2.length ? Math.max.apply(null, k2) : null;
  out.换线后手数 = state.moves.length;
  switchVariation(-1);                 // 回到刚开出来的那条分支，导出它
  await sleep(300);
  out.回切后手数 = state.moves.length;
  /* 导出一份（live 报告只会写这条线） */
  var r = await saveToRecords();
  out.导出名 = r && r.name || null;
  var rv = out.导出名 ? await window.api.records.readReview(out.导出名) : null;
  var o = (rv && rv.text) ? JSON.parse(rv.text) : null;
  out.线数 = o && o.lines ? Object.keys(o.lines).length : 0;
  /* ★ 2026-10-22 起导出会写**所有分支**的分析（不只是当前这条线）——
     所以这里要按「当前这条线」去挑，而不是拿下标 0。 */
  out.当前线指纹 = lineKeyOfMoves(state.moves);
  var lk = out.当前线指纹;
  var curLine = (o && o.lines) ? o.lines[lk] : null;
  out.报告线手数 = curLine ? curLine.n : null;
  out.报告来源 = curLine ? curLine.source : null;
  out.报告线指纹对得上 = !!curLine;
  out.各线 = {};
  if (o && o.lines) for (var kk in o.lines) {
    out.各线[kk] = { n: o.lines[kk].n, 来源: o.lines[kk].source,
      分析手数: o.lines[kk].report ? o.lines[kk].report.analyzed : null };
  }
  /* 重开这份导出的棋谱：默认回主线（新分支挂在右边当变体）。
     ★ 2026-10-22：原来是固定 sleep(1200) 就断言「文件里有线数 >= 2」——
       实测偶发 FAIL：openRecord 里读盘 + autoLoadReviewDoc 慢一点（三道守卫还要比
       reviewBusy / gameGen / recName），1200ms 就还没装进来。改成轮询到报告到位（最多 5 秒），
       判据本身不变 —— 别让测试的等待时间冒充功能问题。 */
  await openRecord(out.导出名);
  var tw = Date.now();
  while (Date.now() - tw < 5000
    && !(state.reviewDoc && state.reviewDoc.lines
      && Object.keys(state.reviewDoc.lines).length >= 2)) await sleep(200);
  await sleep(150);
  out.重开手数 = state.moves.length;
  out.重开有复盘 = !!state.review;
  out.重开线指纹 = lineKeyOfMoves(state.moves);
  out.文件里有线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  return out;
})()`, 180000);
if (typeof step7 === 'string') { console.log('⑦ 运行失败: ' + step7); ws.close(); process.exit(1); }

console.log('\n⑦ 对弈有分支时导出（只存当前线 / 快照不串线）');
console.log('   原手数=' + step7.原手数 + '  在第 15 手落 ' + step7.落点 + ' 开分支 → 现在 '
  + step7.开后手数 + ' 手（有树=' + step7.有树 + '）');
console.log('   快照：条数=' + step7.快照条数 + ' 最大位置=' + step7.快照最大位置
  + '（应 ≤ 15）  串了别的线=' + step7.串了别的线);
console.log('   换线后：手数=' + step7.换线后手数 + ' 快照最大位置=' + step7.换线后最大位置
  + '  回到分支后手数=' + step7.回切后手数);
console.log('   导出的报告：线数=' + step7.线数 + ' 当前线手数=' + step7.报告线手数
  + ' 来源=' + step7.报告来源 + ' 指纹对得上=' + step7.报告线指纹对得上);
console.log('   每条线：' + JSON.stringify(step7.各线));
console.log('   重开：手数=' + step7.重开手数 + '（主线）  有复盘=' + step7.重开有复盘
  + '  文件里的线数=' + step7.文件里有线数);
/* ★ 2026-10-22 用户要求改成「导出时把这个棋局**所有分支**的 AI 分析都存下来」：
   开分支那一刻被放弃的那条线，快照已经由 archiveAnaLine 留档（cutForBranch 里截断之前），
   所以导出应当是**两条以上**的 live 报告，而不是原来的「只存当前这一条」。 */
const gLines = Object.keys(step7.各线 || {}).map(k => step7.各线[k]);
const gAllLive = gLines.length > 0 && gLines.every(l => l.来源 === 'live');
const gHasOld = gLines.some(l => l.n === step7.原手数 && l.分析手数 === step7.原手数 + 1);
const gHasNew = gLines.some(l => l.n === 16);
const okG = step7.落子成功 && step7.有树 && step7.开后手数 === 16
  && !step7.串了别的线 && step7.快照最大位置 === 15        // 只留共享前缀（位置 0..15）
  && step7.换线后最大位置 <= 15
  && step7.回切后手数 === 16
  && step7.线数 >= 2 && gAllLive && gHasOld && gHasNew   // ★ 所有分支都存了（live）
  && step7.报告来源 === 'live' && step7.报告线指纹对得上
  && step7.文件里有线数 >= 2;

/* ---------- ⑧ 复盘范围：一次把两条分支都算完（scope='all'） ----------
   用户要求（2026-10-22）：「对棋谱进行 AI 复盘时，要求选择是对当前分支复盘，
   还是对所有分支（或剩余未复盘的所有分支）复盘」。
   这一块验「全部」：两条线一次算完、同一个文件两项、进度窗写明第几条分支。 */
try { fs.rmSync(repFile); } catch (e) { /* 没有就算了 */ }
try { fs.rmSync(partFile); } catch (e) { /* 没有就算了 */ }
const step8 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME)};
  await openRecord(NAME);
  await sleep(700);
  out.有树 = !!state.varRoot;
  settings.reviewVisits = 20;
  runReview(NAME, { scope: 'all' });
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  out.总数 = rvRun ? rvRun.total : null;
  out.条数 = rvRun ? rvRun.lineCount : null;
  var seen = [];
  for (var i = 0; i < 60; i++) {
    await sleep(400);
    var e = document.getElementById('rv-hand');
    if (e && e.textContent) seen.push(e.textContent);
    if (!reviewBusy) break;
  }
  out.采样 = seen.slice(0, 3);
  out.见过条数 = seen.some(function(s){ return s.indexOf('条分支') >= 0; });
  var t1 = Date.now();
  while (reviewBusy && Date.now() - t1 < 300000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t1) / 1000);
  var d = state.reviewDoc;
  out.线数 = d && d.lines ? Object.keys(d.lines).length : 0;
  out.全是正式复盘 = d && d.lines ? Object.keys(d.lines).every(function(k){ return d.lines[k].source === 'review'; }) : false;
  out.每条都整盘 = d && d.lines ? Object.keys(d.lines).every(function(k){
    var e2 = d.lines[k]; return e2.report && e2.report.losses && e2.report.losses.length === e2.n; }) : false;
  out.当前有报告 = !!state.review;
  out.标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  return out;
})()`, 400000);
if (typeof step8 === 'string') { console.log('⑧ 运行失败: ' + step8); ws.close(); process.exit(1); }

const doc8 = JSON.parse(fs.readFileSync(repFile, 'utf8'));
const keys8 = Object.keys(doc8.lines || {});
console.log('\n⑧ 一次复盘「全部分支」（两条线）');
console.log('   总数=' + step8.总数 + '（应 26 = 两条线各 13 个回合）  条数=' + step8.条数
  + '  见过"第 N 条分支"=' + step8.见过条数 + '  跑完=' + step8.跑完秒 + 's');
console.log('   采样: ' + JSON.stringify(step8.采样));
console.log('   文件线数=' + keys8.length + '（界面 ' + step8.线数 + '）  全是正式复盘=' + step8.全是正式复盘
  + '  每条都算满=' + step8.每条都整盘 + '  当前有报告=' + step8.当前有报告);
console.log('   标题="' + step8.标题 + '"');
const okH = step8.起来了 && step8.总数 === (MAIN.length + 1) * 2 && step8.条数 === 2
  && step8.见过条数 && keys8.length === 2 && step8.线数 === 2
  && step8.全是正式复盘 && step8.每条都整盘 && step8.当前有报告
  && String(step8.标题 || '').indexOf('AI 复盘') >= 0;

/* ---------- ⑨ 走势图跟着分支走（用户报的「切分支走势图不变」） ----------
   验收方式不看「有没有调用 renderCurve」，而是量**真实数据 + 真实像素**：
   · state.history / state.leads 换成这条线的（末回合数值明显不同）；
   · 曲线画布重画后**指纹不同**（说明真的换了图，不是只换了变量）；
   · 卡片标题上标出「· 2 条分支」（不然前面几十手是同一个局面，看着像没反应）。 */
const step9 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var h32 = function(s){ var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  var cvHash = function(){ try { return h32(document.getElementById('curve').toDataURL()); } catch (e) { return 'ERR'; } };
  var label = function(){ var e = document.getElementById('curve-line'); return e ? e.textContent : null; };
  var out = {};
  var NAME = ${JSON.stringify(NAME)};
  await openRecord(NAME);
  /* ★ 2026-10-22：原来是固定 sleep(900) 就往下走 —— 实测偶发 FAIL：
     autoLoadReviewDoc 要读盘、还要过三道守卫（reviewBusy / gameGen / recName），
     抢在同一帧里会慢半拍。没装好时切到分支就找不到那份报告，state.history 仍留着主线的，
     于是 B_末 变成 0.577、和主线只差 0.002（看着像"两条线数据一样"的功能 bug）。
     改成轮询到「文件里两条线都装进来」再往下。 */
  var tw = Date.now();
  while (Date.now() - tw < 6000
    && !(state.reviewDoc && state.reviewDoc.lines
      && Object.keys(state.reviewDoc.lines).length >= 2)) await sleep(150);
  await sleep(300);
  gotoView(7);
  await sleep(200);
  out.A_键 = lineKeyOfMoves(state.moves);
  out.A_末 = (function(){ var a = state.history.filter(function(x){ return typeof x === 'number'; }); return a.length ? a[a.length - 1] : null; })();
  out.A_画布 = cvHash();
  out.A_标签 = label();
  out.A_报告键 = state.review ? state.review.lineKey : null;
  switchVariation(1);
  await sleep(700);
  out.B_键 = lineKeyOfMoves(state.moves);
  out.B_末 = (function(){ var a = state.history.filter(function(x){ return typeof x === 'number'; }); return a.length ? a[a.length - 1] : null; })();
  out.B_画布 = cvHash();
  out.B_标签 = label();
  out.B_报告键 = state.review ? state.review.lineKey : null;
  switchVariation(-1);
  await sleep(700);
  out.回A_键 = lineKeyOfMoves(state.moves);
  out.回A_末 = (function(){ var a = state.history.filter(function(x){ return typeof x === 'number'; }); return a.length ? a[a.length - 1] : null; })();
  out.回A_画布 = cvHash();
  out.回A_长度 = (state.history || []).length;
  out.回A_有报告 = !!state.review;
  out.回A_报告键 = state.review ? state.review.lineKey : null;
  out.回A_文件线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  out.回A_画布 = cvHash();
  return out;
})()`, 120000);
if (typeof step9 === 'string') { console.log('⑨ 运行失败: ' + step9); ws.close(); process.exit(1); }

const diffAB = (typeof step9.A_末 === 'number' && typeof step9.B_末 === 'number')
  ? Math.abs(step9.A_末 - step9.B_末) : 0;
console.log('\n⑨ 切分支时走势图跟着换');
console.log('   主线：键=' + step9.A_键 + ' 末回合胜率=' + (step9.A_末 === null ? 'null' : step9.A_末.toFixed(3))
  + ' 画布指纹=' + step9.A_画布 + ' 标签="' + step9.A_标签 + '"');
console.log('   分支：键=' + step9.B_键 + ' 末回合胜率=' + (step9.B_末 === null ? 'null' : step9.B_末.toFixed(3))
  + ' 画布指纹=' + step9.B_画布 + ' 标签="' + step9.B_标签 + '"');
console.log('   两条线末回合胜率相差=' + diffAB.toFixed(3) + '  画布真的重画了=' + (step9.A_画布 !== step9.B_画布));
/* ★ 为什么不比「切回来那张画布和第一次一模一样」：切分支会重排一次当前局面的
   实时分析，成交点是**同一个局面**（共享前缀），那一点的值被高搜索量更新是正常的。
   要验的是「切回来又是主线那条线的数据」，所以比键 + 末回合的胜率。 */
console.log('   切回A: 键=' + step9.回A_键 + ' 末回合=' + step9.回A_末 + ' history长度=' + step9.回A_长度
  + ' 有报告=' + step9.回A_有报告 + ' 报告键=' + step9.回A_报告键 + ' 文件线数=' + step9.回A_文件线数);
console.log('   报告跟着换=' + (step9.A_报告键 === step9.A_键 && step9.B_报告键 === step9.B_键)
  /* ★ 这里和下面 okI 用**同一把尺子**（容差 0.02）。曾经写成严格相等，输出「切回来是主线那份=false」
     而结论却是 PASS —— 判据和打印不一致比判错更糟，看一眼会以为坏了。 */
  + '  切回来仍是主线那条（末值容差 0.02）='
  + (step9.回A_键 === step9.A_键
     && Math.abs((step9.回A_末 === null ? -9 : step9.回A_末) - (step9.A_末 === null ? -8 : step9.A_末)) < 0.02));
const okI = step9.A_键 !== step9.B_键
  && step9.A_报告键 === step9.A_键 && step9.B_报告键 === step9.B_键
  && diffAB > 0.03                       // ★ 换的是真数据，不是同一个数组
  && step9.A_画布 !== step9.B_画布        // ★ 曲线真的重画成了另一条
  /* ★ 用容差而不是严格相等：切回来之后 app 会给**当前那一手**补一次实时分析，
     万一排队里还有一手落在末回合附近，history 末位可能被重算过（正常行为）。
     0.02 的容差足够挡住这种噪声，又远小于两条线之间的差（本案 0.53）。 */
  && step9.回A_键 === step9.A_键
  && Math.abs((step9.回A_末 === null ? -9 : step9.回A_末) - (step9.A_末 === null ? -8 : step9.A_末)) < 0.02
  && String(step9.A_标签 || '').indexOf('2 条分支') >= 0;

/* ---------- ⑩ 切到没复盘的分支 → 弹窗问「要不要算」（用户要求） ----------
   先把文件清成「只有主线一条」，再切到分支：
     ① 应当弹「这条分支还没复盘」，且按钮里能直接开算；
     ② 点「暂不」→ 关掉；同一条线**这一轮会话里不再追问**（noAskKeys）。
   ★ 判据是「弹窗真的开了 + 真的算了」，不是"调用了某个函数"。 */
try { fs.rmSync(repFile); } catch (e) { /* 没有就算了 */ }
try { fs.rmSync(partFile); } catch (e) { /* 没有就算了 */ }
const step10 = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME)};
  localStorage.removeItem('rapacego.noAskLine');   // 别被上一轮的「别再问」影响
  await openRecord(NAME);
  await sleep(700);
  settings.reviewVisits = 20;
  state.noAskKeys.clear();
  /* ① 只算主线（13 个回合，很快） */
  runReview(NAME, { scope: 'line' });
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  var t1 = Date.now();
  while (reviewBusy && Date.now() - t1 < 180000) await sleep(300);
  out.主线线数 = state.reviewDoc && state.reviewDoc.lines ? Object.keys(state.reviewDoc.lines).length : 0;
  document.getElementById('review').classList.remove('open');
  /* ② 切到分支 → 应当弹窗 */
  gotoView(7);
  await sleep(150);
  switchVariation(1);
  await sleep(1200);
  out.弹窗开 = document.getElementById('review').classList.contains('open');
  out.标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  out.文案 = (document.getElementById('review-body').textContent || '').slice(0, 300);
  out.有算键 = !!document.getElementById('ra-go');
  out.有连算键 = !!document.getElementById('ra-more');
  /* ③ 点「暂不」→ 关掉，且同一条线不再追问 */
  var no = document.getElementById('ra-no');
  if (no) no.click();
  await sleep(200);
  out.暂不后关掉 = !document.getElementById('review').classList.contains('open');
  out.记住了 = state.noAskKeys.size;
  switchVariation(-1);
  await sleep(500);
  switchVariation(1);
  await sleep(1200);
  out.第二次还问 = document.getElementById('review').classList.contains('open');
  return out;
})()`, 300000);
if (typeof step10 === 'string') { console.log('⑩ 运行失败: ' + step10); ws.close(); process.exit(1); }

console.log('\n⑩ 切到没复盘的分支会弹窗问');
console.log('   主线算完 → 文件线数=' + step10.主线线数);
console.log('   切到分支：弹窗=' + step10.弹窗开 + '  标题="' + step10.标题 + '"'
  + '  有"复盘这条分支"键=' + step10.有算键 + '  有"一起算"键=' + step10.有连算键);
console.log('   文案="' + String(step10.文案 || '').slice(0, 180) + '"');
console.log('   点暂不后关掉=' + step10.暂不后关掉 + '  记住的线数=' + step10.记住了
  + '  再切回来还问=' + step10.第二次还问);
const okJ = step10.主线线数 === 1 && step10.弹窗开 && step10.有算键
  && String(step10.标题 || '').indexOf('还没复盘') >= 0
  && String(step10.文案 || '').indexOf('复用') >= 0     // 共享前缀会复用，说清楚
  && step10.暂不后关掉 && step10.记住了 >= 1 && !step10.第二次还问;

console.log('\n=== 结论 ===');
console.log('① 主线复盘存成 v3（一条线一项）           ' + (okA ? 'PASS' : '★ FAIL'));
console.log('② 换分支后不冒充主线报告（提示还没复盘）  ' + (okB ? 'PASS' : '★ FAIL'));
console.log('③ 分支复盘复用共享前缀 + 同一文件两条线   ' + (okC ? 'PASS' : '★ FAIL'));
console.log('④ 切回主线显示主线那份                    ' + (okD ? 'PASS' : '★ FAIL'));
console.log('⑤ 导出棋谱同时存下 AI 分析（live）        ' + (okE ? 'PASS' : '★ FAIL'));
console.log('⑥ 再打开就有目损、不用重新复盘            ' + (okF ? 'PASS' : '★ FAIL'));
console.log('⑦ 对弈有分支：导出把各分支分析都存上    ' + (okG ? 'PASS' : '★ FAIL'));
console.log('⑧ 一次复盘全部分支（scope=all）          ' + (okH ? 'PASS' : '★ FAIL'));
console.log('⑨ 切分支走势图跟着换（数据+像素）        ' + (okI ? 'PASS' : '★ FAIL'));
console.log('⑩ 切到没复盘的分支会弹窗问              ' + (okJ ? 'PASS' : '★ FAIL'));
ws.close();
process.exit(okA && okB && okC && okD && okE && okF && okG && okH && okI && okJ ? 0 : 1);
