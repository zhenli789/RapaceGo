/* 验收 2026-10-21 的复盘改动（"进度条卡住"那一轮）：
 *   ⓪ 中间结果 IPC 读写删（分块落盘 / 断点续算全靠它）
 *   ① 细进度：一手算到一半时进度条也在动（#rv-hand 有「本手已搜 x/N」），
 *      整盘总数始终是 25（不因为分块被打回去），剩余时间带「秒/手」
 *   ② 停止：整盘还在跑、第一块已落盘时点 #rv-stop →
 *      已算完的手保留、**上一版报告一个字节都不许动**
 *   ③ 续算：再点一次 → 从第 N+1 手往后算（不是从 0），算完报告补齐、中间文件删除
 *   ④ 终局棋谱：自动数子的 cancel() 不许把复盘掐成「用户点了停止」
 *   ⑤ **最后一块只剩 1 个回合**（夹具 D = 10 手 → 第二块是 [10]）也要算完 ——
 *      2026-10-22 用户实测报的「停在 110 / 111 手、点接着算也不补」就是这个：
 *      任何「手数 % 10 === 0」的棋谱都会踩到
 *
 * 全部在**不改搜索量、不换权重**的前提下成立 —— 所以只用很小的一档跑，验管线不验棋力。
 * ★ 脚本开头会**重启一次分析引擎**：KataGo 跨请求复用搜索树，不重启的话同一个实例连跑第二次
 *   会「0 秒跑完」，三个断言全红但产品其实没问题（详见下面引擎那段的注释）。
 *
 * ★★ 为什么要两份棋谱（A = 原局，B = A 的左右镜像）：
 *   KataGo 的 analysis 在**请求之间复用搜索树** —— 同一个局面第二次去问，几乎瞬时返回
 *   （实测：用 60 步算过的局面再按 20 步请求，0.0x 秒就回来了）。
 *   拿同一份棋谱测「停止 / 续算」，分块还没真正开始就已经"算完"了，
 *   测出来的全是假 PASS / 假 FAIL（第一版就栽在这儿：三块请求都正常返回，
 *   但「停止时已落盘」= 0）。所以 ②③ 换成 B：它每一手的局面都和 A 不同，树没法复用。
 *
 * 运行（mac，必须同一条命令里起实例 + 跑测试，抄 dev/README.md）：
 *   export RAPACEGO_RECORDS="$PWD/_trash/records_test" RAPACEGO_PUZZLES="$PWD/_trash/puzzles_test"
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     --remote-debugging-port=9333 --user-data-dir="$PWD/_trash/userdata_test" \
 *     --no-sandbox --disable-gpu --in-process-gpu . > _trash/_mac_run.log 2>&1 &
 *   sleep 16; node dev/_cdp_review.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const RECORDS = process.env.RAPACEGO_RECORDS;

/* 夹具 A：真实棋谱（KaTrain AI 对 AI，2026-09-19）前 24 手主分支。
   短是故意的 —— 20 步搜索量下整盘十几秒，够验管线又不至于让测试跑半小时。 */
const MOVES_A = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'np', 'qf', 'cc', 'dc', 'cd', 'cf',
  'ce', 'de', 'bf', 'cb', 'bb', 'be', 'df', 'cg', 'bd', 'bg', 'ef', 'eb'];
/* 夹具 B：把 A 的纵坐标镜像（19 路：k → 18-k）。镜像一个合法对局必然还是合法对局，
   而每一手的局面都和 A 不同 —— 这正是我们要的「引擎没有可复用的搜索树」。 */
const MIRROR = m => m[0] + String.fromCharCode(97 + 18 - (m[1].charCodeAt(0) - 97));
const MOVES_B = MOVES_A.map(MIRROR);

function sgfOf(moves, gn) {
  /* pass 在 SGF 里是空值（`;B[]`）—— ④ 的终局夹具要用 */
  return '(;GM[1]FF[4]DT[2026-09-19]SZ[19]KM[6.5]RU[chinese]'
    + 'PB[AI (KataGo)]PW[AI (KataGo)]RE[白+0.5]CA[UTF-8]GN[' + gn + ']'
    + moves.map((m, i) => ';' + (i % 2 ? 'W' : 'B') + '[' + (m === 'pass' ? '' : m) + ']').join('') + ')';
}

const NAME_A = '复盘夹具A_24手.sgf';
const NAME_B = '复盘夹具B_24手.sgf';
const repA = path.join(RECORDS || '/dev/null', NAME_A + '.review.json');
const partA = path.join(RECORDS || '/dev/null', NAME_A + '.review.part.json');
const repB = path.join(RECORDS || '/dev/null', NAME_B + '.review.json');
const partB = path.join(RECORDS || '/dev/null', NAME_B + '.review.part.json');

const TOTAL = MOVES_A.length + 1;        // 24 手 + 末端那一回合 = 25

/* B 的「上一版报告」：内容是假的（只有个标记），用途只有一个 ——
   ② 里点停止之后，这个文件必须**逐字节不变**。没算完就覆盖旧报告是最坏的情况：
   用户点一次「重新复盘」、中途停了，结果连旧报告都没了。 */
const SEED = '{"v":2,"marker":"上一版完整报告","n":24}';

if (!RECORDS) {
  console.log('★ 没有 RAPACEGO_RECORDS —— 这一轮会写到真实棋谱库里，拒绝运行');
  process.exit(1);
}
fs.mkdirSync(RECORDS, { recursive: true });

/* 引擎日志里 `Request must have a string "id" field` 的条数。
   ★ 2026-10-21 加这条断言的原因：终止请求写成 `{action:'terminate',terminateId:id}`
   时**缺 id**，引擎会把这条 terminate 扔掉（日志里就是上面那句），
   于是前端以为停了、引擎还在闷头算 —— 用户拿到的正是「只算了前 4 / 294 手」。
   停止一次之后这个数字必须**不增加**，否则说明停机又退回「假停」。 */
function countTerminateErrors() {
  const dir = path.join(process.cwd(), 'engine-logs');
  if (!fs.existsSync(dir)) return -1;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 30 * 60 * 1000) continue;  // 只看这一轮的
      n += (fs.readFileSync(p, 'utf8').match(/must have a string "id" field/g) || []).length;
    } catch (e) { /* 读不到就跳过 */ }
  }
  return n;
}
fs.writeFileSync(path.join(RECORDS, NAME_A), sgfOf(MOVES_A, '复盘夹具A'), 'utf8');
fs.writeFileSync(path.join(RECORDS, NAME_B), sgfOf(MOVES_B, '复盘夹具B'), 'utf8');
/* 夹具 C：**终局**棋谱（前 10 手 + 连续两个 pass）。
   ★ 它专门回归 2026-10-21 用户实测报的「只算了前 4 / 294 手」：
   打开一份**下完的**棋谱时，syncUI 见 isTerminal() 会排一个 700ms 后的自动数子，
   而 runScore 一进门就 cancel() —— 正好落在复盘第一块请求发出之后，把它掐成「用户点了停止」。
   短棋谱（A/B 都不终局）不会触发，所以之前三块断言全绿、bug 却真实存在。 */
const MOVES_C = MOVES_A.slice(0, 10).concat(['pass', 'pass']);
const NAME_C = '复盘夹具C_终局.sgf';
fs.writeFileSync(path.join(RECORDS, NAME_C), sgfOf(MOVES_C, '复盘夹具C'), 'utf8');
/* 夹具 D：**正好 10 手**（11 个回合）—— 专门回归 2026-10-22 用户报的
   「复盘停在 110 / 111 手、点接着算也不补」。
   ★ 为什么 10 手才测得出来：复盘按 REVIEW_CHUNK=10 分块，10 手 → 回合 0..10 = 11 个
     → 第一块 [0..9]、**第二块只剩 [10] 一个回合**。主进程当时用 `turns.length > 1`
     判断「收集模式」，于是这块被当成单局面请求，回的是单条 payload 而不是 {turns:[…]}，
     前端一条都收不到 —— 而且不报错、不算卡住，整盘就永远差最后一回合。
     任何手数只要「手数 % 10 === 0」都会踩到（110 手的真实棋谱就是这么来的）。
   ★ 手顺用「左右镜像」（和 B 的上下镜像不同），免得复用 A/B/C 的搜索树。 */
const MIRROR_X = m => String.fromCharCode(97 + 18 - (m[0].charCodeAt(0) - 97)) + m[1];
const MOVES_D = MOVES_A.slice(0, 10).map(MIRROR_X);
const NAME_D = '复盘夹具D_10手.sgf';
fs.writeFileSync(path.join(RECORDS, NAME_D), sgfOf(MOVES_D, '复盘夹具D'), 'utf8');
for (const suf of ['.review.json', '.review.part.json']) {
  try { fs.rmSync(path.join(RECORDS, NAME_D + suf)); } catch (e) { /* 没有就算了 */ }
}
for (const suf of ['.review.json', '.review.part.json']) {
  try { fs.rmSync(path.join(RECORDS, NAME_C + suf)); } catch (e) { /* 没有就算了 */ }
}
for (const f of [repA, partA, partB]) { try { fs.rmSync(f); } catch (e) { /* 没有就算了 */ } }
fs.writeFileSync(repB, SEED, 'utf8');    // B 预置一份旧报告（见上）

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

/* 引擎：**先重启一次**，然后等就绪。
   ★ 为什么不是「已经就绪就直接用」：KataGo 的 analysis 在请求之间**复用搜索树** ——
   同一个局面第二次按同样的搜索量去问，它几乎瞬时返回。所以在同一个实例里连跑两次这个脚本，
   第二次 ① 会「0 秒跑完」（看不到细进度）、② 连中间文件都来不及产生，全是**假 FAIL**
   （2026-10-21 实测踩过：同实例第二次跑，三块断言全红，但产品行为完全正常）。
   重启引擎 = 清空搜索树，脚本才可以重复运行。 */
const load = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var t0 = Date.now();
  if (engineReady) {
    await window.api.engine.unload('analyze');
    while (engineReady && Date.now() - t0 < 60000) await sleep(500);
  }
  await window.api.engine.load('analyze');
  var t1 = Date.now();
  while (!engineReady && Date.now() - t1 < 180000) await sleep(1000);
  return { 就绪: engineReady, 等了秒: Math.round((Date.now()-t0)/1000) };
})()`, 300000);
console.log('引擎 ' + JSON.stringify(load));
/* ★ 判据必须同时认两个键：早退/加载两条分支的键名不一样时，只查一个会在
   「引擎早就被前一个测试加载过」的情况下静默 exit(1) —— 啥也不打印，看着像脚本自己崩了。
   第一次连着跑「回归 + 复盘」就栽在这儿（return 的是 已就绪，判断查的是 就绪）。 */
if (!load || !(load.就绪 || load.已就绪)) {
  console.log('★ 引擎没起来，后面的断言都没意义');
  ws.close(); process.exit(1);
}

/* ---------- ⓪ 中间结果读写自检（分块落盘 / 断点续算全靠它；这条路坏了下面全崩） ---------- */
const io = await js(`(async function(){
  var w = await window.api.records.saveReviewPart('__probe.sgf', JSON.stringify({ a: 1 }));
  var r = await window.api.records.readReviewPart('__probe.sgf');
  var d = await window.api.records.deleteReviewPart('__probe.sgf');
  var r2 = await window.api.records.readReviewPart('__probe.sgf');
  return { 写: w, 读: (r && r.text) || null, 删: d, 删后还有: !!(r2 && r2.text),
           目录: await window.api.records.dir() };
})()`);
console.log('⓪ 中间结果读写自检: ' + JSON.stringify(io));
if (!io || !io.读 || io.删后还有) {
  console.log('★ 中间结果 IPC 不通 —— 分块落盘和续算无从谈起，先修这个');
  ws.close(); process.exit(1);
}

/* ---------- ① 完整跑一遍夹具 A（60 步 × 25 回合），边跑边看细进度 ---------- */
const runA = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var hand = function(){ var e = document.getElementById('rv-hand'); return e ? e.textContent : null; };
  var wid  = function(){ var e = document.getElementById('rv-fill'); return e ? e.style.width : null; };
  var out = {};
  /* ★ 60 步（不是 20）：一手约 2 秒，才看得到「本手已搜 x/60」的细进度 ——
     20 步时一手只有 0.6 秒，中途报告还没推过来就算完了（不是 bug，是太快）。
     ★ 全局进度消息每 1 秒一条（main.js 的 reportDuringSearchEvery=1），
     所以采样间隔取 500ms，保证每手至少瞥见一次。 */
  settings.reviewVisits = 60;
  runReview(${JSON.stringify(NAME_A)});          // 不 await：要在跑的过程中采样
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  var seen = [], sawLive = false, widths = [], etas = [];
  for (var i = 0; i < 60; i++) {
    await sleep(500);
    var h = hand(); if (h) { seen.push(h); if (h.indexOf('已搜') >= 0) sawLive = true; }
    var w = wid(); if (w) widths.push(w);
    var e = document.getElementById('rv-eta'); if (e && e.textContent) etas.push(e.textContent);
    if (!reviewBusy && i > 4) break;
  }
  out.采样 = seen.slice(0, 6);
  out.采样尾 = seen.slice(-2);
  out.剩余文案 = etas.length ? etas[etas.length - 1] : null;
  out.见过本手进度 = sawLive;
  out.宽度从 = widths[0]; out.宽度到 = widths[widths.length - 1];
  out.总数都对 = seen.length > 0 && seen.every(function(s){ return s.indexOf('/ ' + ${TOTAL} + ' 手') >= 0; });
  var t1 = Date.now();
  while (reviewBusy && Date.now() - t1 < 300000) await sleep(500);
  out.跑完秒 = Math.round((Date.now() - t1) / 1000);
  out.目损条数 = state.review ? state.review.losses.length : null;
  out.手数 = state.moves.length;
  out.部分标记 = state.review && state.review.partial ? state.review.partial : null;
  out.报告已存 = !!(await window.api.records.readReview(${JSON.stringify(NAME_A)}));
  out.中间文件已删 = !(await window.api.records.readReviewPart(${JSON.stringify(NAME_A)}));
  out.测到速度 = localStorage.getItem('rapacego.reviewRate');
  return out;
})()`, 400000);
if (typeof runA === 'string') { console.log('① 运行失败: ' + runA); ws.close(); process.exit(1); }

console.log('\n① 完整跑一遍（60 步/手，24 手 = 25 回合）');
console.log('   采样: ' + JSON.stringify(runA.采样));
console.log('   采样尾: ' + JSON.stringify(runA.采样尾) + '  跑完=' + runA.跑完秒 + 's');
console.log('   见过「本手已搜」=' + runA.见过本手进度 + '  宽度 ' + runA.宽度从 + ' → ' + runA.宽度到
  + '  总数恒为 ' + TOTAL + ' = ' + runA.总数都对);
console.log('   目损条数=' + runA.目损条数 + '（应=手数 ' + runA.手数 + '）  部分标记=' + JSON.stringify(runA.部分标记));
console.log('   报告已存=' + runA.报告已存 + '  中间文件已删=' + runA.中间文件已删 + '  速度=' + runA.测到速度);
console.log('   剩余文案: ' + runA.剩余文案);

const okA = runA.起来了 && runA.见过本手进度 && runA.总数都对
  && runA.宽度从 !== runA.宽度到
  && runA.目损条数 === runA.手数
  && runA.报告已存 && runA.中间文件已删 && !runA.部分标记
  && runA.测到速度 && String(runA.测到速度).indexOf('vps') >= 0
  && String(runA.剩余文案 || '').indexOf('秒/手') >= 0;

/* ---------- ② 停止：夹具 B，整盘还在跑、第一块已落盘时点 #rv-stop ---------- */
const errBefore = countTerminateErrors();
const seedLen = fs.readFileSync(repB, 'utf8').length;
const runB = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME_B)};
  settings.reviewVisits = 20;      // 20 步：一手约 0.6 秒，第一块 10 手约 6 秒
  /* 等上一轮的后台分析退场（runReview 自己会用 terminateId 掐掉旧查询，
     这里只是不让自己赶上那个交接窗口） */
  var t0 = Date.now();
  while (reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  runReview(NAME);
  var t1 = Date.now();
  while (!reviewBusy && Date.now() - t1 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  /* 等「整盘还没跑完、中间文件已经有第一块」—— 这同时证明了两件事：
     分块真的在发生，而且每块算完就落盘（不然崩溃就白算） */
  var t2 = Date.now(), got = 0;
  while (Date.now() - t2 < 180000) {
    await sleep(400);
    var p = await window.api.records.readReviewPart(NAME);
    if (p && p.text) {
      try {
        var o = JSON.parse(p.text);
        if (o.lines) { got = 0; for (var kk in o.lines) { var tt = o.lines[kk] && o.lines[kk].turns; if (tt) got += Object.keys(tt).length; } }
        else got = Object.keys(o.turns || {}).length;
      } catch (e) { got = -1; }
      if (got >= 10 && reviewBusy) break;      // 整盘仍在跑，但第一块已经落盘
    }
    /* 整盘已经跑完了，而一块都没抓到 → 说明这台机器/这次会话太快（或引擎还留着搜索树）。
       这时不能干等 180 秒再报 FAIL —— 直接说清原因，别让「等不到」伪装成「功能坏了」。 */
    if (!reviewBusy) break;
  }
  out.停止时已落盘 = got;
  out.整盘提前跑完 = !reviewBusy && got < 10;
  out.等落盘秒 = Math.round((Date.now() - t2) / 1000);
  out.停止时整盘仍在跑 = reviewBusy;
  out.停止前手文案 = (function(){ var e = document.getElementById('rv-hand'); return e ? e.textContent : null; })();
  var btn = document.getElementById('rv-stop');
  out.有停止键 = !!btn;
  if (btn) btn.click();
  var t3 = Date.now();
  while (reviewBusy && Date.now() - t3 < 90000) await sleep(300);
  out.停下用了秒 = Math.round((Date.now() - t3) / 1000);
  out.停止后还在跑 = reviewBusy;
  var p2 = await window.api.records.readReviewPart(NAME);
  out.中间文件保留 = !!(p2 && p2.text);
  try { out.中间文件手数 = p2 && p2.text ? Object.keys(JSON.parse(p2.text).turns || {}).length : 0; } catch (e) { out.中间文件手数 = -1; }
  out.部分标记 = state.review && state.review.partial ? state.review.partial : null;
  out.弹窗开着 = document.getElementById('review').classList.contains('open');
  /* ★ 2026-10-21 改：停止后**不再直接弹报告**，而是弹「暂停」面板。
     用户实测报的「这份报告没算完整盘：只算了前 4 / 294 手」就是旧行为 ——
     点停止 → 一份残缺报告糊在脸上，像程序坏了。 */
  out.暂停面板 = !!document.getElementById('rv-continue');
  out.暂停文案 = (document.getElementById('review-body').textContent || '').slice(0, 240);
  out.有看已算键 = !!document.getElementById('rv-peek');
  return out;
})()`, 300000);
if (typeof runB === 'string') { console.log('② 运行失败: ' + runB); ws.close(); process.exit(1); }

const partTurns = (() => {
  if (!fs.existsSync(partB)) return 0;
  try {
    const o = JSON.parse(fs.readFileSync(partB, 'utf8'));
    if (o.lines) {
      return Object.keys(o.lines).reduce((sum, k) =>
        sum + Object.keys((o.lines[k] || {}).turns || {}).length, 0);
    }
    return Object.keys(o.turns || {}).length;
  } catch (e) { return 0; }
})();
const seedNow = fs.existsSync(repB) ? fs.readFileSync(repB, 'utf8') : '';
const errAfter = countTerminateErrors();
const termErrors = (errAfter >= 0 && errBefore >= 0) ? errAfter - errBefore : 0;

console.log('\n② 停止（第一块落盘后点 #rv-stop，夹具 B = A 的镜像）');
console.log('   起来=' + runB.起来了 + '  停止时已落盘=' + runB.停止时已落盘 + '（等了 ' + runB.等落盘秒 + 's）'
  + '  整盘仍在跑=' + runB.停止时整盘仍在跑 + '  整盘提前跑完=' + runB.整盘提前跑完);
console.log('   停止前手文案="' + runB.停止前手文案 + '"');
console.log('   有停止键=' + runB.有停止键 + '  停下用了=' + runB.停下用了秒 + 's  停止后还在跑=' + runB.停止后还在跑);
console.log('   中间文件保留=' + runB.中间文件保留 + '  手数=' + partTurns + ' / ' + TOTAL);
console.log('   旧报告 ' + seedLen + ' → ' + seedNow.length + ' 字节，逐字节不变=' + (seedNow === SEED));
console.log('   部分标记=' + JSON.stringify(runB.部分标记) + '  弹窗开着=' + runB.弹窗开着
  + '  暂停面板=' + runB.暂停面板 + '  有"先看已算"键=' + runB.有看已算键);
console.log('   暂停文案="' + runB.暂停文案 + '"');
console.log('   终止请求被引擎拒绝的次数=' + termErrors + '（必须 0；以前是 1 —— terminate 缺 id）');

const okB = runB.起来了 && runB.有停止键 && !runB.整盘提前跑完
  && runB.停止时整盘仍在跑 && runB.停止时已落盘 >= 10
  && !runB.停止后还在跑
  && runB.中间文件保留 && partTurns >= 10 && partTurns < TOTAL
  && seedNow === SEED                       // ★ 没算完 → 一个字节都不许动旧报告
  && runB.部分标记 && runB.部分标记.done < runB.部分标记.total
  && runB.暂停面板 && runB.有看已算键        // ★ 停止 → 暂停面板（不是残缺报告）
  && termErrors === 0;                       // ★ 引擎真的收到 terminate 了

/* ---------- ③ 续算：再跑一次夹具 B，必须从第 partTurns+1 手往后算 ---------- */
const runC = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME_B)};
  settings.reviewVisits = 20;              // ★ 必须和 ② 一样：签名里有 maxVisits，变了就整份作废
  /* ★ 走到**暂停面板的「接着算」按钮**上（不是直接调 runReview）：
     用户点完停止看到的就是这个面板，续算的唯一入口就是这颗键 ——
     直接调函数等于绕开了被测的那一步。 */
  var cont = document.getElementById('rv-continue');
  if (!cont) return '暂停面板里没有「接着算」按钮';
  cont.click();
  /* ★ 先等 reviewBusy 真的亮起来 —— runReview 前面还有几个 await，
     立刻读会看到 false（第一次跑这个测试就踩在这儿，白等）。 */
  var t0 = Date.now();
  while (!reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  await sleep(2000);
  out.续算后第一瞥 = (function(){ var e = document.getElementById('rv-hand'); return e ? e.textContent : null; })();
  var t1 = Date.now();
  while (reviewBusy && Date.now() - t1 < 300000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t1) / 1000);
  out.目损条数 = state.review ? state.review.losses.length : null;
  out.手数 = state.moves.length;
  out.部分标记 = state.review && state.review.partial ? state.review.partial : null;
  out.中间文件已删 = !(await window.api.records.readReviewPart(NAME));
  out.报告已存 = !!(await window.api.records.readReview(NAME));
  return out;
})()`, 400000);
if (typeof runC === 'string') { console.log('③ 运行失败: ' + runC); ws.close(); process.exit(1); }

/* 「第 X / 25 手」里的 X 必须 ≥ partTurns+1（证明前面那些手是复用的，没有从 0 重算） */
const mC = /第\s*(\d+)\s*\/\s*(\d+)/.exec(String(runC.续算后第一瞥 || ''));
const startHand = mC ? Number(mC[1]) : -1;
const repBNew = fs.existsSync(repB) ? fs.readFileSync(repB, 'utf8') : '';
let repBok = false;
try {
  const o = JSON.parse(repBNew);
  const lines = o.lines ? Object.keys(o.lines).map(k => o.lines[k]) : [o];
  repBok = lines.some(e => e && e.report && Array.isArray(e.report.losses)
    && e.report.losses.length === MOVES_A.length);
} catch (e) { repBok = false; }
const seedGone = repBNew.indexOf('上一版完整报告') < 0;
console.log('\n③ 续算（停止后重跑夹具 B）');
console.log('   起来=' + runC.起来了 + '  续算后第一瞥="' + runC.续算后第一瞥 + '" → 从第 '
  + startHand + ' 手开始（必须 ≥ ' + (partTurns + 1) + '）');
console.log('   跑完=' + runC.跑完秒 + 's（只补 ' + (TOTAL - partTurns) + ' 手，应明显短于整盘）');
console.log('   目损条数=' + runC.目损条数 + '/手数' + runC.手数 + '  部分标记=' + JSON.stringify(runC.部分标记)
  + '  中间文件已删=' + runC.中间文件已删);
console.log('   报告已存=' + runC.报告已存 + '  旧标记已消失=' + seedGone + '  报告可读(24 条目损)=' + repBok);

const okC = runC.起来了 && startHand >= partTurns + 1
  && runC.目损条数 === runC.手数 && !runC.部分标记
  && runC.中间文件已删 && runC.报告已存
  && seedGone && repBok;

/* ---------- ④ 回归：**终局**棋谱不会被自动数子掐断（用户报障的根因） ---------- */
const runD = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME_C)};
  settings.reviewVisits = 20;
  var t0 = Date.now();
  while (reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  runReview(NAME);
  var t1 = Date.now();
  while (!reviewBusy && Date.now() - t1 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  var t2 = Date.now();
  while (reviewBusy && Date.now() - t2 < 180000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t2) / 1000);
  out.终局 = isTerminal();
  out.手数 = state.moves.length;
  out.目损条数 = state.review ? state.review.losses.length : null;
  out.部分标记 = state.review && state.review.partial ? state.review.partial : null;
  out.报告已存 = !!(await window.api.records.readReview(NAME));
  out.弹窗标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  return out;
})()`, 240000);
if (typeof runD === 'string') { console.log('④ 运行失败: ' + runD); ws.close(); process.exit(1); }

console.log('\n④ 终局棋谱（下完的棋谱：数子不能把复盘掐死）');
console.log('   起来=' + runD.起来了 + '  终局=' + runD.终局 + '  跑完=' + runD.跑完秒 + 's');
console.log('   手数=' + runD.手数 + '  目损条数=' + runD.目损条数 + '  部分标记=' + JSON.stringify(runD.部分标记));
console.log('   报告已存=' + runD.报告已存 + '  弹窗标题="' + runD.弹窗标题 + '"');

const okD = runD.起来了 && runD.终局 && !runD.部分标记
  && runD.目损条数 === runD.手数 && runD.报告已存;

/* ---------- ⑤ 回归：**最后一块只剩 1 个回合**也要算完 ----------
   夹具 D 只有 10 手 → 11 个回合 → 第二块是 [10]（单个回合）。
   主进程的 collect 判据写错时（`turns.length > 1`），这一块回的是单条 payload，
   前端 `res.turns` 为空 → 静默漏掉最后一回合，面板还说「这次没算完」。 */
const runE = await js(`(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  var NAME = ${JSON.stringify(NAME_D)};
  settings.reviewVisits = 20;
  await openRecord(NAME);
  await sleep(300);
  out.手数 = state.moves.length;
  var t0 = Date.now();
  while (reviewBusy && Date.now() - t0 < 20000) await sleep(100);
  runReview(NAME);
  var t1 = Date.now();
  while (!reviewBusy && Date.now() - t1 < 20000) await sleep(100);
  out.起来了 = reviewBusy;
  var t2 = Date.now();
  while (reviewBusy && Date.now() - t2 < 180000) await sleep(300);
  out.跑完秒 = Math.round((Date.now() - t2) / 1000);
  out.目损条数 = state.review ? state.review.losses.length : null;
  out.部分标记 = state.review && state.review.partial ? state.review.partial : null;
  out.最后回合有数 = !!(state.review && state.review.losses
    && typeof state.review.losses[state.moves.length - 1] === 'number');
  /* ★ 直接量「拿到了几个回合」：11 个回合（0..10）一个都不能少。
     以前漏手是完全静默的，只有这个数字看得出来。 */
  out.拿到回合数 = rvRun ? rvRun.doneSet.size : null;
  out.手文案 = (function(){ var e = document.getElementById('rv-hand'); return e ? e.textContent : null; })();
  out.弹窗标题 = (function(){ var h = document.querySelector('#review-body h2'); return h ? h.textContent : null; })();
  out.报告已存 = !!(await window.api.records.readReview(NAME));
  out.中间文件已删 = !(await window.api.records.readReviewPart(NAME));
  return out;
})()`, 240000);
if (typeof runE === 'string') { console.log('⑤ 运行失败: ' + runE); ws.close(); process.exit(1); }

const TOTAL_D = MOVES_D.length + 1;          // 10 手 → 11 个回合
console.log('\n⑤ 最后一块只剩 1 个回合（夹具 D = 10 手，第二块是 [10]）');
console.log('   起来=' + runE.起来了 + '  跑完=' + runE.跑完秒 + 's  手数=' + runE.手数
  + '  拿到回合数=' + runE.拿到回合数 + ' / ' + TOTAL_D);
console.log('   目损条数=' + runE.目损条数 + '  最后一手有数=' + runE.最后回合有数
  + '  部分标记=' + JSON.stringify(runE.部分标记));
console.log('   弹窗标题="' + runE.弹窗标题 + '"  手文案="' + runE.手文案 + '"');
console.log('   报告已存=' + runE.报告已存 + '  中间文件已删=' + runE.中间文件已删);

const okE = runE.起来了 && runE.手数 === MOVES_D.length
  && runE.拿到回合数 === TOTAL_D                 // ★ 一个回合都不许漏
  && runE.目损条数 === runE.手数 && runE.最后回合有数
  && !runE.部分标记 && runE.报告已存 && runE.中间文件已删
  && String(runE.弹窗标题 || '').indexOf('复盘暂停') < 0;

console.log('\n=== 结论 ===');
console.log('① 细进度 + 总数不被分块打回 + 完整落盘  ' + (okA ? 'PASS' : '★ FAIL'));
console.log('② 停止：第一块即落盘 / 不覆盖旧报告  ' + (okB ? 'PASS' : '★ FAIL'));
console.log('③ 续算：从中断处接着算并补齐  ' + (okC ? 'PASS' : '★ FAIL'));
console.log('④ 终局棋谱不被自动数子掐断  ' + (okD ? 'PASS' : '★ FAIL'));
console.log('⑤ 最后一块只剩 1 个回合也算完（110 / 111 那个 bug）  ' + (okE ? 'PASS' : '★ FAIL'));
ws.close();
process.exit(okA && okB && okC && okD && okE ? 0 : 1);
