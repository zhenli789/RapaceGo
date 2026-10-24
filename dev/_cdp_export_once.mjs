/* 端到端：**同一局棋反复导出不要存出一堆副本**（2026-10-22 用户报障）。
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_export_once.mjs
   ★ 需要 RAPACEGO_RECORDS 指到临时棋谱库（脚本会往里写夹具和导出的棋谱，绝不碰用户数据）。
   ★ 不需要真引擎。
   四段：
     ① 第一局：下几手 → 导出（新建）→ 再导出（覆盖同一份，文件数不变）
     ② 继续落子 → 再导出：还是同一份，但**磁盘上的内容真的更新了**
     ③ 从棋谱库打开**自家导出的**棋谱 → 导出：写回原文件（不另存）
     ④ 打开**外来**棋谱（没有 AP[RapaceGo] 标记）→ 导出：另存一份，原件一个字节都不动
   ★ 模板串里禁用反引号、别写 '\\n'（项目纪律 #10）。 */
import fs from 'fs';
import path from 'path';

const PORT = 9333;
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');
if (!REC_DIR) {
  console.log('★ 没有 RAPACEGO_RECORDS —— 这一轮会写到真实棋谱库里，拒绝运行');
  process.exit(1);
}
fs.mkdirSync(REC_DIR, { recursive: true });

/* 外来棋谱：12 手，故意带 GN/DT/PB/PW/**没有** AP[RapaceGo] —— 导出的 buildSGF 会重建，
   写回它就会把这些属性弄丢，所以只能另存。 */
const FOREIGN = '外来棋谱.sgf';
const F_MAIN = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'np', 'qf', 'cc', 'dc', 'cd', 'cf'];
const foreignText = '(;GM[1]FF[4]SZ[19]KM[6.5]RU[chinese]CA[UTF-8]'
  + 'GN[别动我的标题]DT[2020-01-01]PB[某位前辈]PW[另一位前辈]EV[某比赛]'
  + F_MAIN.map((m, i) => ';' + (i % 2 ? 'W' : 'B') + '[' + m + ']').join('')
  + ')';
const fPath = path.join(REC_DIR, FOREIGN);
fs.writeFileSync(fPath, foreignText, 'utf8');
try { fs.rmSync(fPath + '.bak'); } catch (e) { /* 没有就算了 */ }

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
    expression: expr, returnByValue: true, awaitPromise: true, timeout: timeout || 60000,
  });
  if (r.result && r.result.exceptionDetails) {
    const e = r.result.exceptionDetails;
    return 'ERR:' + ((e.exception && e.exception.description) || e.text);
  }
  return r.result && r.result.result && r.result.result.value;
}

/* ---------- ①②：新局导出两次 + 落子后再导出 ---------- */
const p1 = await js(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  const cnt = async () => ((await window.api.records.list()) || []).length;
  const status = () => String((document.getElementById('status') || {}).textContent || '');

  settings.mode = 'free'; settings.autoBoth = false;
  applyNewGame(false); await sleep(200);
  tryPlay(15, 3, false); tryPlay(3, 15, false); tryPlay(15, 15, false); await sleep(150);

  out.存前文件数 = await cnt();
  out.导出前exportName = state.exportName;

  const s1 = await saveToRecords(); await sleep(400);
  out.第一次名 = s1 && s1.name;
  out.第一次提示 = status();
  out.第一次文件数 = await cnt();
  out.导出后exportName = state.exportName;

  const s2 = await saveToRecords(); await sleep(400);
  out.第二次名 = s2 && s2.name;
  out.第二次提示 = status();
  out.第二次文件数 = await cnt();

  /* 同一局再落一手，再导出 —— 名字不变，内容要变 */
  tryPlay(9, 9, false); await sleep(200);
  const s3 = await saveToRecords(); await sleep(400);
  out.第三次名 = s3 && s3.name;
  out.第三次提示 = status();
  out.第三次文件数 = await cnt();
  out.第三次手数 = state.moves.length;

  /* 开新局 → 记录作废，下次必须另起名字（别把上一局盖了） */
  applyNewGame(false); await sleep(150);
  out.新局后exportName = state.exportName;
  return out;
})()`, 120000);
console.log('① 同一局导出两次 / ② 落子后再导出');
console.log(JSON.stringify(p1, null, 1));
if (typeof p1 === 'string' && p1.startsWith('ERR')) { console.log(p1); ws.close(); process.exit(1); }

/* ---------- Node 侧：确认磁盘内容真的更新了（不是两次都写同一份旧内容） ---------- */
const firstName = String(p1 && p1.第一次名 || '');
let diskTurns = -1, diskOk = false;
if (firstName) {
  try {
    const t = fs.readFileSync(path.join(REC_DIR, firstName), 'utf8');
    diskTurns = (t.match(/;[BW]\[/g) || []).length;
    diskOk = true;
  } catch (e) { diskTurns = -1; }
}
console.log('   磁盘上 ' + firstName + ' 的手数 = ' + diskTurns + '（期望 4 = 3 + 后来补的那一手）');
/* ★ 2026-10-23 用户要求：导出不再顺带存对弈过程的 AI 分析 → 不许出现 .review.json */
const reviewWritten = !!firstName && fs.existsSync(path.join(REC_DIR, firstName + '.review.json'));
console.log('   导出后有没有 .review.json：' + (reviewWritten ? '★ 有（不该有）' : '✓ 没有'));

/* ---------- ③：打开自家导出的棋谱 → 导出应写回原文件 ---------- */
const p2 = await js(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  const cnt = async () => ((await window.api.records.list()) || []).length;
  const status = () => String((document.getElementById('status') || {}).textContent || '');
  const NAME = ${JSON.stringify(firstName)};
  await openRecord(NAME); await sleep(800);
  out.打开的手数 = state.moves.length;
  out.打开后exportName = state.exportName;
  out.打开后recName = state.recName;
  const before = await cnt();
  const s = await saveToRecords(); await sleep(500);
  out.导出名 = s && s.name;
  out.提示 = status();
  out.文件数前 = before;
  out.文件数后 = await cnt();
  out.导出后exportName = state.exportName;
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  return out;
})()`, 120000);
console.log('③ 打开自家棋谱再导出（写回原文件）');
console.log(JSON.stringify(p2, null, 1));

/* ---------- ④：外来棋谱 → 必须另存，原件不动 ---------- */
const p3 = await js(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  const cnt = async () => ((await window.api.records.list()) || []).length;
  const status = () => String((document.getElementById('status') || {}).textContent || '');
  await openRecord(${JSON.stringify(FOREIGN)}); await sleep(800);
  out.打开的手数 = state.moves.length;
  const before = await cnt();
  const s = await saveToRecords(); await sleep(500);
  out.导出名 = s && s.name;
  out.提示 = status();
  out.文件数前 = before;
  out.文件数后 = await cnt();
  out.没写回原件 = String(out.导出名 || '') !== ${JSON.stringify(FOREIGN)};
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  return out;
})()`, 120000);
console.log('④ 外来棋谱导出（另存，不动原件）');
console.log(JSON.stringify(p3, null, 1));

const foreignAfter = (() => { try { return fs.readFileSync(fPath, 'utf8'); } catch (e) { return ''; } })();

/* ---------- 判据 ---------- */
const ok = ask => (ask ? 'PASS' : 'FAIL');
const checks = [
  ['① 第一次导出是新建（文件数 +1、记下 exportName）',
    p1.第一次文件数 === p1.存前文件数 + 1 && p1.导出后exportName === p1.第一次名],
  ['② 再点一次导出：同一个文件名、文件数不变',
    p1.第二次名 === p1.第一次名 && p1.第二次文件数 === p1.第一次文件数],
  ['③ 第二次提示写「已更新棋谱库 … 同一局覆盖」',
    /已更新棋谱库/.test(p1.第二次提示 || '') && /没另存副本/.test(p1.第二次提示 || '')],
  ['④ 落子后再导出：还是同一份，文件数不变',
    p1.第三次名 === p1.第一次名 && p1.第三次文件数 === p1.第一次文件数],
  ['⑤ 磁盘内容真的更新了（4 手，不是两次写旧内容）',
    diskOk === true && diskTurns === 4],
  ['⑥ 开新局后 exportName 清空（下一局不会盖住上一局）', p1.新局后exportName === ''],
  ['⑦ 打开自家导出的棋谱 → 导出写回原文件（文件数不变）',
    p2.导出名 === firstName && p2.文件数后 === p2.文件数前],
  ['⑧ 写回时提示写「已写回 … 就是你在看的这份」',
    /已写回/.test(p2.提示 || '') && /就是你在看的这份棋谱/.test(p2.提示 || '')],
  ['⑨ 外来棋谱导出 → 另存一份（文件数 +1）',
    p3.没写回原件 === true && p3.文件数后 === p3.文件数前 + 1],
  ['⑩ 外来棋谱原件一个字节都没动', foreignAfter === foreignText],
  ['⑪ 导出没有写 .review.json（不再存对弈过程的分析）', reviewWritten === false],
];
console.log('');
console.log('=== 结论 ===');
for (const [name, pass] of checks) console.log(name + '   ' + ok(pass));
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
