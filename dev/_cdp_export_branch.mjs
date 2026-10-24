/* 端到端：**导出带分支的棋谱时，每条分支的解说词（C[]）都要存**；
   ★ 2026-10-23 用户改口：导出**不再**顺带存对弈过程的 AI 分析（.review.json 一份都不写），
     需要复盘就在棋谱库里点这份棋谱做一次正式复盘。这条测试同时守住这两件事。
   用法：先起一个带 --remote-debugging-port=9333 的实例（命令抄 dev/README.md），再
     node dev/_cdp_export_branch.mjs
   ★ 需要 RAPACEGO_RECORDS 指到临时棋谱库（脚本会往里写夹具和导出的棋谱，绝不碰用户数据）。
   ★ 不需要真引擎：分析快照直接喂 `applyAnalysis(payload, at)`（存快照这一步与引擎无关），
     这样测的是**序列化/落盘**这一段，和之前那个 bug 的位置完全对应。
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

/* ---------- 夹具：12 手，第 7 手分叉（主线 O4 / 分支 A19），共享前 6 手 ---------- */
const MAIN = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'np', 'qf', 'cc', 'dc', 'cd', 'cf'];
const BRANCH = ['pd', 'dp', 'pq', 'dd', 'nc', 'qo', 'aa', 'qq', 'bb', 'ab', 'ba', 'ca'];
const SHARED = 6;
const NAME = '导出分支.sgf';
/* 分支第 8 手写一段**原生解说** —— 导出时分析不能把它盖掉 */
const NATIVE_K = 8;
const NATIVE_TXT = '原生的解说别动';
const nodeOf = (m, i, extra) => ';' + (i % 2 ? 'W' : 'B') + '[' + m + ']' + (extra || '');
const sgfOf = () => '(;GM[1]FF[4]DT[2026-10-22]SZ[19]KM[6.5]RU[chinese]'
  + 'PB[T]PW[T]RE[B+3.5]CA[UTF-8]GN[导出分支]'
  + MAIN.slice(0, SHARED).map((m, i) => nodeOf(m, i)).join('')
  + '(' + MAIN.slice(SHARED).map((m, i) => nodeOf(m, SHARED + i)).join('') + ')'
  + '(' + BRANCH.slice(SHARED).map((m, i) => {
    const k = SHARED + i + 1;                       // 手数（1 起）
    return nodeOf(m, SHARED + i, k === NATIVE_K ? 'C[' + NATIVE_TXT + ']' : '');
  }).join('') + ')'
  + ')';
fs.writeFileSync(path.join(REC_DIR, NAME), sgfOf(), 'utf8');
for (const ext of ['.review.json', '.review.part.json']) {
  try { fs.rmSync(path.join(REC_DIR, NAME + ext)); } catch (e) { /* 没有就算了 */ }
}

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

/* ---------- 第一段：两条线各喂满分析 → 导出 ---------- */
const p1 = await js(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NAME = ${JSON.stringify(NAME)};
  const out = {};
  await openRecord(NAME); await sleep(700);
  out.开局手数 = state.moves.length;
  out.有树 = !!state.varRoot;

  /* 一条线喂满分析快照。tag 决定"这条线是谁"（数字要能一眼分辨）：
       a（主线）= 黑方大优 / 首选 Q16 ；b（分支）= 黑方大劣 / 首选 A19 */
  const feed = tag => {
    const pay = at => {
      const side = (at % 2 === 0) ? 'B' : 'W';
      const bwA = 0.62, leadA = 3.0, bwB = 0.18, leadB = -7.5;
      const bw = tag === 'a' ? bwA : bwB;
      const lead = tag === 'a' ? leadA : leadB;
      return {
        root: {
          currentPlayer: side,
          winrate: side === 'B' ? bw : 1 - bw,
          scoreLead: side === 'B' ? lead : -lead,
          visits: 600,
        },
        moves: [{
          move: tag === 'a' ? 'Q16' : 'A19',
          winrate: side === 'B' ? (tag === 'a' ? 0.64 : 0.16) : (tag === 'a' ? 0.36 : 0.84),
          scoreLead: side === 'B' ? lead : -lead,
          prior: tag === 'a' ? 0.55 : 0.35, order: 0, visits: 300,
          pv: [tag === 'a' ? 'Q16' : 'A19'],
        }],
      };
    };
    for (let at = 0; at <= state.moves.length; at++) applyAnalysis(pay(at), at);
  };

  const listA = lineGtpOf(state.moves);
  const keyA = lineKeyOfMoves(state.moves);
  feed('a');
  out.主线快照 = Object.keys(state.anaAt).length;

  /* 切到分支（这一步会把主线的分析留档）→ 喂满分支 → 再切回主线 */
  state.viewAt = 7; syncUI(); await sleep(80);
  switchVariation(1); await sleep(400);
  out.分支手数 = state.moves.length;
  out.分支第7手 = state.moves[6] ? toGTP(state.moves[6].x, state.moves[6].y) : null;
  const listB = lineGtpOf(state.moves);
  const keyB = lineKeyOfMoves(state.moves);
  feed('b');
  out.分支快照 = Object.keys(state.anaAt).length;

  state.viewAt = 7; syncUI(); await sleep(80);
  switchVariation(-1); await sleep(400);
  out.回到主线第7手 = state.moves[6] ? toGTP(state.moves[6].x, state.moves[6].y) : null;
  /* ★ 关键：切回来之后 anaAt 只剩共享前缀（后半段被截掉了），
     靠 state.anaLines 里的留档补 —— 导出必须用"留档 + 现在的"合并结果。 */
  out.回主线快照 = Object.keys(state.anaAt).length;
  out.留档线数 = Object.keys(state.anaLines || {}).length;
  out.合并快照 = Object.keys(curLineAnaAt()).length;
  out.键不同 = (keyA !== keyB);
  out.线数 = [listA.length, listB.length];

  const sgf = buildSGF();
  /* ★ 坐标换算是 SGF → GTP：列 q → Q（跳 I）、行字母 a=19 倒着数（f=14、q=3） */
  const cnt = (sgf.match(/C\\[手数 /g) || []).length;
  out.C总数 = cnt;
  out.主线第7手有解说 = sgf.indexOf('手数 7: B O4') >= 0;
  out.分支第7手有解说 = sgf.indexOf('手数 7: B A19') >= 0;
  out.主线末手有解说 = sgf.indexOf('手数 12: W C14') >= 0;
  out.分支末手有解说 = sgf.indexOf('手数 12: W C19') >= 0;
  out.原生解说还在 = sgf.indexOf(';W[qq]C[' + ${JSON.stringify(NATIVE_TXT)} + ']') >= 0;
  out.原生那手没被分析覆盖 = sgf.indexOf('手数 8: W Q3') < 0;
  out.分支末手片段 = (sgf.split('手数 12: W C19').pop() || '').slice(0, 48);

  const saved = await saveToRecords();
  await sleep(500);
  out.存档名 = saved && saved.name;
  out.弹出的窗 = Array.prototype.slice.call(document.querySelectorAll('.modal-mask.open')).length;
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  return out;
})()`, 120000);
console.log('① 导出（两条线各有分析）');
console.log(JSON.stringify(p1, null, 1));
if (typeof p1 === 'string' && p1.startsWith('ERR')) { console.log(p1); ws.close(); process.exit(1); }

/* ---------- Node 侧：确认**没有**写 .review.json ----------
   ★ 2026-10-23 用户改口：「对弈的棋局点导出棋谱时，不要保存对弈过程中的 ai 计算结果，
     需要复盘就在棋谱库点它做 AI 复盘」—— 所以导出**只写棋谱本身**，
     解说词（SGF 的 C[]）照旧写，分析报告一份都不落。 */
const savedName = p1 && p1.存档名;
let reviewExists = false;
if (savedName) {
  reviewExists = fs.existsSync(path.join(REC_DIR, savedName + '.review.json'));
}
console.log('② 导出后有没有 .review.json：' + (reviewExists ? '★ 有（不该有）' : '✓ 没有'));

/* ---------- 第二段：重新打开导出的棋谱，看两条线的解说词 / 目损 ---------- */
const p2 = await js(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  await openRecord(${JSON.stringify(savedName)}); await sleep(900);
  out.打开手数 = state.moves.length;
  const boxText = () => {
    const b = document.getElementById('cbox');
    return b ? String(b.textContent || '') : '';
  };
  state.viewAt = state.moves.length; syncUI(); await sleep(120);
  const tA = boxText();
  out.主线解说 = tA.indexOf('手数 12: W C14') >= 0;
  out.主线有目损 = !!(state.review && state.review.losses && state.review.losses.length);
  out.主线目损数 = state.review && state.review.losses ? state.review.losses.length : 0;
  out.主线来源 = state.review ? state.review.source : null;

  state.viewAt = 7; syncUI(); await sleep(100);
  switchVariation(1); await sleep(600);
  state.viewAt = state.moves.length; syncUI(); await sleep(150);
  const tB = boxText();
  out.分支解说 = tB.indexOf('手数 12: W C19') >= 0;
  out.分支解说片段 = tB.slice(0, 40);
  out.分支有目损 = !!(state.review && state.review.losses && state.review.losses.length);
  out.分支目损数 = state.review && state.review.losses ? state.review.losses.length : 0;
  out.分支来源 = state.review ? state.review.source : null;

  /* 原生解说那手：分支第 8 手应当还是原文 */
  state.viewAt = 8; syncUI(); await sleep(120);
  out.原生解说保住 = boxText().indexOf(${JSON.stringify(NATIVE_TXT)}) >= 0;
  document.querySelectorAll('.modal-mask.open').forEach(m => m.classList.remove('open'));
  return out;
})()`, 120000);
console.log('③ 重新打开（不点任何复盘）');
console.log(JSON.stringify(p2, null, 1));

/* ---------- 判据 ---------- */
const ok = ask => (ask ? 'PASS' : 'FAIL');
const a1 = p1 && p1.有树 === true && p1.键不同 === true;
const checks = [
  ['① 夹具打开后是两条 12 手的线', a1 && p1.分支手数 === 12 && p1.分支第7手 === 'A19'],
  ['② 主线 12 手全有解说（不是只剩前缀）', p1.主线第7手有解说 === true && p1.主线末手有解说 === true],
  ['③ 分支 12 手全有解说', p1.分支第7手有解说 === true && p1.分支末手有解说 === true],
  ['④ C[] 里 17 手带分析（18 个节点 − 1 个原生解说）', p1.C总数 === 17],
  ['⑤ 原生解说没被覆盖', p1.原生解说还在 === true && p1.原生那手没被分析覆盖 === true],
  ['⑥ 切回来时靠留档补齐（合并快照 > 当前快照）', p1.合并快照 === 13 && p1.回主线快照 < 13],
  ['⑦ 导出**没有**写 .review.json（对弈过程的分析不落盘）', reviewExists === false],
  ['⑧ 重开后主线：解说词在、且没有目损（不是 live 报告）',
    p2.主线解说 === true && p2.主线有目损 === false],
  ['⑨ 重开后分支：解说词在、且没有目损', p2.分支解说 === true && p2.分支有目损 === false],
  ['⑩ 重开后原生解说仍是原文', p2.原生解说保住 === true],
];
console.log('');
console.log('=== 结论 ===');
for (const [name, pass] of checks) console.log(name + '   ' + ok(pass));
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（一条都没有 ✓）');
ws.close();
process.exit(0);
