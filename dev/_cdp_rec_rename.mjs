/* 端到端：棋谱库「备注」写 GN +「双击棋谱名」改文件名（2026-10-31 用户要求）
   用法（macOS，先起 Electron 再跑它，命令见 dev/README.md 里的通用写法）：
     RAPACEGO_RECORDS=_trash/_ren_rec \
       env -u ELECTRON_RUN_AS_NODE npx electron . --remote-debugging-port=9334 \
         --no-sandbox --disable-gpu --in-process-gpu --user-data-dir=_trash/_ud_ren &
     RAPACEGO_RECORDS=_trash/_ren_rec node dev/_cdp_rec_rename.mjs

   用户当天的两句话（先「改成改名」，几小时后又要求「改回来 + 双击改名」）：
     ·「将棋谱库中的备注功能改为『改名』功能，要注意如果这份棋谱有复盘报告 json
        或者讲解报告 json，是否也要同时更改名字？否则可能找不到？」
     ·「将棋谱库『改名』按钮改回原来的『备注』，SGF 的 GN 信息还是按原来的方式显示，
        改名功能修改为双击棋谱的名称时可以修改。」

   所以这里要验的：
     ① 行上按钮是**备注**（不是改名）；主名字 = **备注名**（GN），灰字第二行 = 真实文件名；
     ② 点「备注」→ 只写 GN，**盘上文件名一个字节都不动**；清空备注 → GN 变空、仍不改名；
     ③ **双击名字** → 就地输入 → 回车 → 盘上 .sgf 真改名，
        **复盘 / 讲解 / 复盘进度三份 json 跟着改名**；Esc 取消则谁都不动；
     ④ 正在打开的那份改名后，state.recName 跟着换（否则后面复盘又写到老文件名上）；
     ⑤ 目标名已存在时**拒绝**，谁都不动（绝不覆盖别人的棋谱）；
     ⑥ 题集面板那边：大小（KB）与时间已经从行上删掉，只剩「N 题」。
   ★ 判据一半在页面、一半在 Node（盘上到底有没有那几份文件 / GN 到底写成什么）——
     只看页面会漏"报告没跟着搬"和"备注其实改了文件名"。
   ★ 绝不碰用户的 records/：启动命令用 RAPACEGO_RECORDS 指向 _trash 下的临时目录。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9334;
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');
const PUZ_DIR = String(process.env.RAPACEGO_PUZZLES || '');

const OLD = '测试对局-甲 vs 乙.sgf';
const NEW = '改过名的对局.sgf';
const TAKEN = '占用中的名字.sgf';
const GN0 = '甲 vs 乙（测试棋局名）';          // 夹具自带的 GN → 列表上行第一行
const NOTE1 = '这是新备注';                    // ② 要写进去的备注
const SGF = '(;GM[1]FF[4]SZ[19]CA[UTF-8]GN[' + GN0 + ']PB[甲]PW[乙];B[pd];W[dd];B[pp])';

/* ★ 每轮先把临时目录**整个清空**再铺夹具。
   不清的话上一轮改名留下的 <新名>.review.json 之类会变成"孤儿"，
   于是本轮改名时这三份会撞上同名目标（被正确地拒绝覆盖），
   测试就会看到"没跟着搬"的假失败 —— 这是夹具脏了，不是功能坏了。 */
const cleanDir = dir => {
  if (!dir || !/(_trash|RapaceGo)/.test(dir)) return;      // 只在临时目录里动手
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 清不掉就让断言报出来 */ }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 同上 */ }
};

try {
  if (REC_DIR) {
    cleanDir(REC_DIR);
    fs.writeFileSync(path.join(REC_DIR, OLD), SGF, 'utf8');
    fs.writeFileSync(path.join(REC_DIR, OLD + '.review.json'), JSON.stringify({ v: 3, lines: {} }), 'utf8');
    fs.writeFileSync(path.join(REC_DIR, OLD + '.coach.json'), JSON.stringify({ v: 2, lines: {} }), 'utf8');
    fs.writeFileSync(path.join(REC_DIR, OLD + '.review.part.json'), JSON.stringify({ v: 3, lines: {} }), 'utf8');
    fs.writeFileSync(path.join(REC_DIR, TAKEN), SGF, 'utf8');
  }
  if (PUZ_DIR) {
    cleanDir(PUZ_DIR);
    const p = path.join(PUZ_DIR, '改名测试题集.sgf');
    fs.writeFileSync(p, '(;GM[1]FF[4]SZ[19]PL[B]AB[dd][de]AW[ee]C[测试])\n(;GM[1]FF[4]SZ[19]PL[W]AB[pp]AW[qq]C[测试2])', 'utf8');
  }
} catch (e) { /* 拷不进去就让断言自己报出来 */ }

async function getPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 端口还没起来 */ }
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
    const d = m.params.exceptionDetails || {};
    errs.push('未捕获异常: ' + ((d.exception && d.exception.description) || d.text || '?').split('\n')[0]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + m.params.args.map(a => (a.value !== undefined ? a.value : a.description) || '').join(' ').slice(0, 200));
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result && r.result.exceptionDetails) {
    return 'ERR: ' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || '').split('\n')[0];
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
await send('Runtime.enable');

const PAGE = ('(async function(){\n'
  + 'const steps = [];\n'
  + 'const step = (name, ok, extra) => steps.push((ok ? "OK " : "BAD ") + name + (extra === undefined || extra === "" ? "" : " -> " + extra));\n'
  + 'const sleep = ms => new Promise(r => setTimeout(r, ms));\n'
  + 'const doc = id => document.getElementById(id);\n'
  + 'async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 15000)) { if (fn()) return true; await sleep(80); } return false; }\n'
  + 'const rows = () => Array.from(document.querySelectorAll("#reclist > li"));\n'
  /* 按**文件名**找行：主名字是备注名，会随备注变化，不能拿它当锚点 */
  + 'const rowOf = fname => rows().find(li => {\n'
  + '  const f = li.querySelector(".rec-file"), n = li.querySelector(".rec-name");\n'
  + '  return (f && f.textContent === fname) || (n && n.textContent === fname.replace(/\\.sgf$/i, ""));\n'
  + '}) || null;\n'
  + 'const nameOf = li => (li && li.querySelector(".rec-name") ? li.querySelector(".rec-name").textContent : "");\n'
  + 'const fileOf = li => (li && li.querySelector(".rec-file") ? li.querySelector(".rec-file").textContent : "");\n'
  + 'const btnOf = (li, label) => Array.from(li.querySelectorAll("button")).find(b => b.textContent.indexOf(label) === 0) || null;\n'
  + 'const status = () => (doc("status") ? doc("status").textContent : "");\n'
  /* 双击名字 = 改名（2026-10-31 起的入口） */
  + 'async function dblName(fname) {\n'
  + '  const li = rowOf(fname);\n'
  + '  if (!li) return "没有这一行";\n'
  + '  const info = li.querySelector(".rec-info");\n'
  + '  info.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));\n'
  + '  await sleep(200);\n'
  + '  return li.querySelector("input") ? "ok" : "双击后没出现输入框";\n'
  + '}\n'
  + 'async function typeKey(key) {\n'
  + '  const inp = document.querySelector("#reclist input");\n'
  + '  if (!inp) return "没有输入框";\n'
  + '  inp.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));\n'
  + '  await sleep(800);\n'
  + '  return "ok";\n'
  + '}\n'
  + 'try {\n'

  /* ============ ① 列表显示：主名字是备注名（GN），灰字第二行是文件名 ============ */
  + 'await waitFor(() => typeof state === "object" && !!doc("reclist") && !!doc("btn-records"), 30000);\n'
  + 'step("界面起来了（app.js 跑到最后）", typeof state === "object" && !!doc("reclist"));\n'
  + 'doc("btn-records").click(); await sleep(1200);\n'
  + 'step("棋谱库打开了", doc("records").classList.contains("open"));\n'
  + 'const li0 = rowOf("' + OLD + '");\n'
  + 'step("列表里找到了这一份（按文件名认）", !!li0,\n'
  + '  rows().map(x => nameOf(x) + " / " + fileOf(x)).join(" | ").slice(0, 110));\n'
  + 'step("上行主名字 = 备注名（GN），不是文件名", nameOf(li0) === "' + GN0 + '", nameOf(li0));\n'
  + 'step("下行灰字 = 真实文件名", fileOf(li0) === "' + OLD + '", fileOf(li0));\n'
  + 'step("行上的按钮是「备注」不是「改名」", !!li0 && !!btnOf(li0, "备注") && !btnOf(li0, "改名"));\n'
  + 'step("有复盘报告 / 讲解的那份仍标着「带讲解」", !!li0 && li0.textContent.indexOf("带讲解") >= 0);\n'
  + 'step("名字上有「双击可以改文件名」的提示", !!li0 && li0.querySelector(".rec-name").title.indexOf("双击") >= 0,\n'
  + '  li0 ? li0.querySelector(".rec-name").title : "");\n'

  /* ============ ② 「备注」只写 GN，文件名不动 ============ */
  + 'btnOf(li0, "备注").click(); await sleep(250);\n'
  + 'const nInp = document.querySelector("#reclist input");\n'
  + 'step("点「备注」→ 就地出现输入框（预填现有备注）", !!nInp && nInp.value === "' + GN0 + '", nInp ? nInp.value : "没有输入框");\n'
  + 'nInp.value = "' + NOTE1 + '";\n'
  + 'nInp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));\n'
  + 'await sleep(900);\n'
  + 'step("提交后提示写的是「备注：…」", status().indexOf("备注：") === 0, status().slice(0, 40));\n'
  /* 备注写完行会重画：主名字应该变成新备注，文件名那一行仍是 OLD */
  + 'const liB = rowOf("' + OLD + '");\n'
  + 'step("备注写完，主名字换成了新备注", nameOf(liB) === "' + NOTE1 + '", nameOf(liB));\n'
  + 'step("备注写完，灰字文件名一点没变（说明没改名）", fileOf(liB) === "' + OLD + '", fileOf(liB));\n'

  /* ============ ③ 双击名字改名：盘上真改名 + 三份 json 跟着走 ============ */
  + 'btnOf(liB, "打开").click();\n'
  + 'await waitFor(() => state.recName === "' + OLD + '", 15000);\n'
  + 'step("打开这份棋谱（记在 state.recName 上）", state.recName === "' + OLD + '", state.recName);\n'
  + 'doc("btn-records").click(); await sleep(900);\n'
  + 'const r1 = await dblName("' + OLD + '");\n'
  + 'step("双击名字 → 就地出现改名输入框", r1 === "ok", r1);\n'
  + 'const rInp = document.querySelector("#reclist input");\n'
  + 'step("输入框里预填的是文件名（不含 .sgf）", !!rInp && rInp.value === "' + OLD.replace(/\.sgf$/, '') + '", rInp ? rInp.value : "无");\n'
  + 'rInp.value = "' + NEW + '";\n'
  + 'const k1 = await typeKey("Enter");\n'
  + 'step("回车确认没报错", k1 === "ok", k1);\n'
  + 'step("列表里出现了新名字那一行", !!rowOf("' + NEW + '"));\n'
  + 'step("老名字那一行没了", !rowOf("' + OLD + '"));\n'
  + 'step("提示写清了「已改名为」", status().indexOf("已改名为") >= 0, status().slice(0, 40));\n'
  + 'step("提示里说明了复盘报告 / 讲解跟着改名", status().indexOf("复盘报告") >= 0 && status().indexOf("讲解") >= 0, status().slice(0, 60));\n'
  + 'step("正在打开的那份，state.recName 跟着换成了新名字", state.recName === "' + NEW + '", state.recName);\n'
  + 'const li1 = rowOf("' + NEW + '");\n'
  + 'step("改名后备注名原样保留（GN 没被改名动过）", nameOf(li1) === "' + NOTE1 + '", nameOf(li1));\n'
  + 'step("改名后「带讲解」还在（说明 coach.json 也被认到了）", !!li1 && li1.textContent.indexOf("带讲解") >= 0);\n'
  + 'step("改名后复盘按钮仍是「复盘报告」（review.json 被认到了）", !!li1 && !!btnOf(li1, "复盘报告"));\n'

  /* ============ ④ 双击后按 Esc = 取消，谁都不动 ============ */
  + 'const r3 = await dblName("' + NEW + '");\n'
  + 'step("再双击一次，输入框又出来了", r3 === "ok", r3);\n'
  + 'const rInp3 = document.querySelector("#reclist input");\n'
  + 'if (rInp3) rInp3.value = "不该出现的名字";\n'
  + 'const k3 = await typeKey("Escape");\n'
  + 'step("按 Esc 取消没报错", k3 === "ok", k3);\n'
  + 'step("Esc 之后名字没变（列表里还是原名，且「不该出现的名字」没出现）",\n'
  + '  !!rowOf("' + NEW + '"));\n'
  + 'step("Esc 之后「不该出现的名字」一行也没有", rows().every(li => li.textContent.indexOf("不该出现的名字") < 0));\n'

  /* ============ ⑤ 目标名已存在 → 拒绝、谁都不动 ============ */
  + 'const r2 = await dblName("' + NEW + '");\n'
  + 'const rInp2 = document.querySelector("#reclist input");\n'
  + 'if (rInp2) rInp2.value = "' + TAKEN + '";\n'
  + 'await typeKey("Enter");\n'
  + 'step("改成一个已被占用的名字 → 被拦住并提示", status().indexOf("已经有「") >= 0, status().slice(0, 48));\n'
  + 'step("原来那份还在（没被顶掉）", !!rowOf("' + NEW + '"));\n'
  + 'step("被占用的那份也还在", !!rowOf("' + TAKEN + '"));\n'

  /* ============ ⑥ 题集面板：只剩「N 题」 ============ */
  + 'doc("rec-close").click(); await sleep(200);\n'
  + 'openPuzzles(); await sleep(1400);\n'
  + 'const pli = Array.from(document.querySelectorAll("#puzlist > li")).find(li => {\n'
  + '  const n = li.querySelector(".rec-name"); return n && n.textContent === "改名测试题集";\n'
  + '}) || null;\n'
  + 'const pmeta = pli ? pli.querySelector(".rec-meta").textContent : "";\n'
  + 'step("题集面板里有那份测试题集", !!pli);\n'
  + 'step("行上只写「2 题」（没有 KB / 时间）", pmeta === "2 题", pmeta);\n'
  + 'step("整行文本里既没有 KB 也没有「月·日」时间", pli ? !/KB/.test(pli.textContent) && !/\\d+月\\d+日/.test(pli.textContent) : false,\n'
  + '  pli ? pli.textContent.slice(0, 60) : "没有这一行");\n'
  /* 题集改名也改成双击名字（2026-10-31 第二件事），行上不该再有「改名」按钮 */
  + 'step("题集行上没有「改名」按钮了", !!pli && !Array.from(pli.querySelectorAll("button")).some(b => b.textContent.indexOf("改名") === 0),\n'
  + '  pli ? Array.from(pli.querySelectorAll("button")).map(b => b.textContent).join("/") : "");\n'
  + 'pli.querySelector(".rec-name").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));\n'
  + 'await sleep(250);\n'
  + 'const pInp = document.querySelector("#puzlist input");\n'
  + 'step("双击题集名 → 就地出现改名输入框（预填题集名）", !!pInp && pInp.value === "改名测试题集", pInp ? pInp.value : "没有输入框");\n'
  + 'if (pInp) {\n'
  + '  pInp.value = "改过名的题集";\n'
  + '  pInp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));\n'
  + '}\n'
  + 'await sleep(1000);\n'
  + 'step("题集改名后提示写清了", status().indexOf("题集已改名为") >= 0, status().slice(0, 40));\n'
  + 'step("题集列表里出现了新名字", Array.from(document.querySelectorAll("#puzlist .rec-name")).some(x => x.textContent === "改过名的题集"),\n'
  + '  Array.from(document.querySelectorAll("#puzlist .rec-name")).map(x => x.textContent).join("|"));\n'
  + 'doc("puz-close").click(); await sleep(200);\n'
  + '} catch (err) { steps.push("BAD 中途抛异常 -> " + ((err && err.message) || err)); }\n'
  + 'return { steps: steps, bad: steps.filter(s => s.indexOf("BAD ") === 0).length };\n'
  + '})()');

try {
  new Function('return ' + PAGE);      /* 只验语法：页面代码里混着中文注释，引号套错会全红 */
} catch (e) {
  console.log('页面代码有语法错（还没发到界面）：' + ((e && e.message) || e));
  process.exit(2);
}
const report = await js(PAGE);
if (typeof report === 'string' && report.indexOf('ERR:') === 0) {
  console.log('渲染进程里抛异常了：' + report);
  process.exit(2);
}
if (!report || !report.steps) {
  console.log('没拿到结果：' + JSON.stringify(report));
  process.exit(2);
}
console.log('=== 棋谱库「备注 / 双击改名」· 端到端 ===');
for (const s of report.steps) console.log('  ' + (s.startsWith('OK ') ? '\u2713 ' + s.slice(3) : '\u2605 ' + s.slice(4)));

/* ---------- 文件层再核一遍 ---------- */
let fileBad = 0, fileN = 0;
function check(name, ok, extra) {
  fileN++;
  console.log('  ' + (ok ? '\u2713 ' : '\u2605 ') + name + (extra ? ' \u2192 ' + extra : ''));
  if (!ok) fileBad++;
}
console.log('=== 文件核对 ===');
const at = f => path.join(REC_DIR, f);
const ex = f => fs.existsSync(at(f));
const gnOf = f => {
  try { const m = /GN\[([^\]]*)\]/.exec(fs.readFileSync(at(f), 'utf8')); return m ? m[1] : ''; }
  catch (e) { return '(读不到这个文件)'; }           // 文件都没了：让上面那条断言先红，别在这里再崩一次
};
check('改过名的那份 .sgf 在盘上', ex(NEW), NEW);
check('老的 .sgf 已经不在', !ex(OLD));
check('备注写进了新文件的 GN（备注跟着棋谱一起改了名）', gnOf(NEW) === NOTE1, 'GN[' + gnOf(NEW) + ']');
check('复盘报告跟着改名了（' + NEW + '.review.json）', ex(NEW + '.review.json'));
check('逐手讲解跟着改名了（' + NEW + '.coach.json）', ex(NEW + '.coach.json'));
check('复盘进度跟着改名了（' + NEW + '.review.part.json）', ex(NEW + '.review.part.json'));
check('老名字的三份 json 都没留下', !ex(OLD + '.review.json') && !ex(OLD + '.coach.json') && !ex(OLD + '.review.part.json'));
check('备注时留的 .bak 也跟着搬了（不留孤儿）', ex(NEW + '.bak') && !ex(OLD + '.bak'));
check('「不该出现的名字」没有被创建（Esc 真的取消了）', !fs.readdirSync(REC_DIR).some(f => f.indexOf('不该出现的名字') === 0));
check('被占用的那份原封不动（没被覆盖）', ex(TAKEN));
check('棋谱库里没有多出副本（(2) 之类）', !fs.readdirSync(REC_DIR).some(f => /\(2\)/.test(f)),
  fs.readdirSync(REC_DIR).join(', '));
if (PUZ_DIR) {                                    /* 题集在另一个目录（puzzles/），单独核一遍 */
  const puzAt = f => path.join(PUZ_DIR, f);
  check('题集文件真的改名了（盘上）', fs.existsSync(puzAt('改过名的题集.sgf')) && !fs.existsSync(puzAt('改名测试题集.sgf')),
    fs.readdirSync(PUZ_DIR).join(', '));
}

const bad = report.bad + fileBad;
console.log('');
if (bad) console.log('有 ' + bad + ' 项失败：' + report.steps.length + ' 项界面断言 + ' + fileN + ' 项文件断言');
else console.log('全部通过：' + report.steps.length + ' 项界面断言 + ' + fileN + ' 项文件断言');
if (errs.length) console.log('控制台报错 ' + errs.length + ' 条：\n  ' + errs.slice(0, 5).join('\n  '));
ws.close();
process.exit(bad ? 1 : 0);
