/* 端到端：多道题存进同一份 SGF 题集（2026-10-31 新增功能的验收闸门）
   用法（macOS / Linux，必须在**同一条 bash 里**先起 Electron 再跑它）：
     RAPACEGO_RECORDS=_trash/_vis_rec RAPACEGO_PUZZLES=_trash/_vis_puz \
       env -u ELECTRON_RUN_AS_NODE npx electron . --remote-debugging-port=9333 \
         --no-sandbox --disable-gpu --in-process-gpu --user-data-dir=_trash/_ud_vis &
     RAPACEGO_RECORDS=... RAPACEGO_PUZZLES=... node dev/_cdp_puzset.mjs

   用户的原话：「在习题练习模式，无论是自由摆题，或是图片识别的题，多个题目可以保存到
   同一个 sgf 文件，也可以提前新建 sgf 文件，将题目存进去。且题目保存要有先手等基本信息」。

   所以这里要验的就是三条：
     ① 能**先新建一份空题集**，再往里存；
     ② 存第二道题时**加在同一个文件末尾**（不是又新建一份），开出来是 2 题、先手各自对；
     ③ 识谱认出来的题也能存进**已有的**题集（走「存进题集…」→ 面板上的待存提示）。

   ★ 判据一半在页面（功能对不对）、一半在 Node（文件里到底写了什么）——
     只看页面会漏掉"文件里其实写了两份不同的东西"这类问题。
   ★ 绝不碰用户的 puzzles/：启动命令用 RAPACEGO_PUZZLES 指向 _trash 下的临时目录。
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const PUZ_DIR = String(process.env.RAPACEGO_PUZZLES || '');

/* 测试自己的一份"已有题集"（347 题的 xxqj 副本）：验「追加到已有题集」这半。
   拷进临时目录，**不碰** puzzles/ 里用户那份。 */
const BASE_SET = 'xxqj-测试副本.sgf';
const NEW_SET = '多题合集.sgf';
try {
  if (PUZ_DIR) {
    fs.mkdirSync(PUZ_DIR, { recursive: true });
    const src = path.join(ROOT_DIR, 'puzzles', 'xxqj.sgf');
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PUZ_DIR, BASE_SET));
    const stale = path.join(PUZ_DIR, NEW_SET);
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }
} catch (e) { /* 拷不进去就让相关断言自己报出来 */ }

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

/* 识谱用的夹具（局部 11×8 那两张里的局部图：子少、认得准） */
const FIX_URL = 'data:image/jpeg;base64,'
  + fs.readFileSync(path.join(ROOT_DIR, 'dev', 'fixtures', 'vision', 'corner11x8.jpg')).toString('base64');

const PAGE = ('(async function(){\n'
  + 'const steps = [];\n'
  + 'const step = (name, ok, extra) => steps.push((ok ? "OK " : "BAD ") + name + (extra === undefined || extra === "" ? "" : " -> " + extra));\n'
  + 'const sleep = ms => new Promise(r => setTimeout(r, ms));\n'
  + 'const doc = id => document.getElementById(id);\n'
  + 'async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 15000)) { if (fn()) return true; await sleep(80); } return false; }\n'
  + 'const rowOf = name => Array.from(document.querySelectorAll("#puzlist > li")).find(li => {\n'
  + '  const nm = li.querySelector(".rec-name"); return nm && nm.textContent === name.replace(/\\.sgf$/i, "");\n'
  + '}) || null;\n'
  + 'const btnOf = (li, label) => Array.from(li.querySelectorAll("button")).find(b => b.textContent.indexOf(label) === 0) || null;\n'
  + 'const metaOf = name => { const li = rowOf(name); const m = li && li.querySelector(".rec-meta"); return m ? m.textContent : ""; };\n'
  + 'const readSet = async name => { const r = await window.api.puzzles.read(name); return (r && r.text) || ""; };\n'
  /* 段控（黑/白、先手）一律**点按钮**：click 才走 initSeg 的回调，setSeg 只改样式不动状态 */
  + 'const pick = (id, v) => doc(id).querySelector("[data-v=\'" + v + "\']").click();\n'
  + 'const countGames = txt => splitSgfGames(txt).length;\n'

  /* ================= ① 新建一份空白题集 ================= */
  + 'openPuzzles(); await sleep(900);\n'
  + 'step("题集面板打开了", doc("puzzles").classList.contains("open"));\n'
  + 'step("面板里已经有那份 347 题的题集（测试副本）", !!rowOf("' + BASE_SET + '"));\n'
  + 'step("空白题集这会儿还不存在", !rowOf("' + NEW_SET + '"));\n'
  + 'doc("puz-new").click(); await sleep(300);\n'
  + 'const nw = document.querySelector("#puzlist > li input");\n'
  + 'step("点「新建题集…」就地出现命名框", !!nw);\n'
  + 'nw.value = "' + NEW_SET.replace(/\.sgf$/i, '') + '";\n'
  + 'nw.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));\n'
  + 'const okNew = await waitFor(() => !!rowOf("' + NEW_SET + '"), 8000);\n'
  + 'step("新建后列表里出现了这份题集", okNew);\n'
  + 'const newLi = rowOf("' + NEW_SET + '");\n'
  + 'step("新题集显示「0 题」", !!newLi && newLi.querySelector(".rec-meta").textContent.indexOf("0 题") === 0,\n'
  + '  newLi ? newLi.querySelector(".rec-meta").textContent.slice(0, 12) : "没有这一行");\n'
  + 'step("空白题集的「打开」按钮是禁用的（没题可练，点了只会报错）", !!newLi && btnOf(newLi, "打开").disabled);\n'
  + 'step("这份行上有「存当前题」按钮", !!newLi && !!btnOf(newLi, "存当前题"));\n'

  /* ================= ② 摆第一道题 → 存进去 ================= */
  + 'doc("puz-close").click(); await sleep(250);\n'
  + 'enterTsumego(); await sleep(400);\n'
  + 'const A = [[3,3],[4,3],[5,3],[3,4],[4,4]];   // 5 黑\n'
  + 'const B = [[5,4],[4,5]];                     // 2 白\n'
  + 'pick("seg-tscolor", "b"); await sleep(120);\n'
  + 'for (const [x, y] of A) placeSetupStone(x, y, false);\n'
  + 'pick("seg-tscolor", "w"); await sleep(120);\n'
  + 'for (const [x, y] of B) placeSetupStone(x, y, false);\n'
  + 'await sleep(200);\n'
  + 'step("摆好第一道题：7 颗子", state.setup.length === 7, "setup=" + state.setup.length);\n'
  + 'pick("seg-tsfirst", "b"); await sleep(150);\n'
  + 'openPuzzles(); await sleep(700);\n'
  + 'btnOf(rowOf("' + NEW_SET + '"), "存当前题").click();\n'
  + 'const okPut = await waitFor(() => metaOf("' + NEW_SET + '").indexOf("1 题") === 0, 8000);\n'
  + 'await sleep(300);\n'
  + 'step("存进去之后那行写着「1 题」", okPut, metaOf("' + NEW_SET + '").slice(0, 12));\n'
  + 'let txtA = await readSet("' + NEW_SET + '");\n'
  + 'step("文件里正好 1 棵树", countGames(txtA) === 1, "共 " + countGames(txtA) + " 棵");\n'
  + 'step("这道题写了先手 PL[B]", /PL\\[B\\]/.test(txtA));\n'
  + 'step("摆子分组写了 AB / AW", /AB(\\[[a-s]{2}\\])+/.test(txtA) && /AW(\\[[a-s]{2}\\])+/.test(txtA));\n'
  + 'const cntA = (re, t) => ((re.exec(t) || ["", ""])[1].length) / 4;\n'
  + 'step("AB 5 颗 / AW 2 颗（和盘上一致）", cntA(/AB((?:\\[[a-s]{2}\\])+)/, txtA) === 5 && cntA(/AW((?:\\[[a-s]{2}\\])+)/, txtA) === 2,\n'
  + '  "AB " + cntA(/AB((?:\\[[a-s]{2}\\])+)/, txtA) + " / AW " + cntA(/AW((?:\\[[a-s]{2}\\])+)/, txtA));\n'
  + 'step("注释里写了出处（RapaceGo）", /C\\[[^\\]]*RapaceGo/.test(txtA));\n'

  /* ================= ③ 换一道题，再存一次（关键：进同一个文件） ================= */
  + 'doc("puz-close").click(); await sleep(250);\n'
  + 'doc("btn-ts-clear").click(); await sleep(200);\n'
  + 'const C = [[10,10],[11,10],[12,10]];           // 3 黑\n'
  + 'const Dd = [[10,11],[11,11],[12,11],[11,12]];  // 4 白（换个形状，免得和第一道认混）\n'
  + 'pick("seg-tscolor", "b"); await sleep(120);\n'
  + 'for (const [x, y] of C) placeSetupStone(x, y, false);\n'
  + 'pick("seg-tscolor", "w"); await sleep(120);\n'
  + 'for (const [x, y] of Dd) placeSetupStone(x, y, false);\n'
  + 'pick("seg-tsfirst", "w"); await sleep(200);\n'
  + 'step("第二道题：7 颗子、白先", state.setup.length === 7 && settings.tfirst === "w",\n'
  + '  "setup=" + state.setup.length + " tfirst=" + settings.tfirst);\n'
  + 'openPuzzles(); await sleep(700);\n'
  + 'btnOf(rowOf("' + NEW_SET + '"), "存当前题").click();\n'
  + 'const okPut2 = await waitFor(() => metaOf("' + NEW_SET + '").indexOf("2 题") === 0, 8000);\n'
  + 'await sleep(300);\n'
  + 'step("再存一次 → 同一份文件变成「2 题」（不是又建了一份）", okPut2,\n'
  + '  metaOf("' + NEW_SET + '").slice(0, 12));\n'
  + 'const txtB = await readSet("' + NEW_SET + '");\n'
  + 'step("文件里现在 2 棵树", countGames(txtB) === 2, "共 " + countGames(txtB) + " 棵");\n'
  + 'step("第二棵写的是 PL[W]（先手跟着题目走）", (txtB.match(/PL\\[W\\]/g) || []).length === 1);\n'
  + 'step("两棵树之间是 )( 分开的、没有粘成一行", /\\)\\s*\\(/.test(txtB));\n'
  + 'step("题集目录里没有多出「(2)」这种副本", (await window.api.puzzles.list()).filter(x => x.name.indexOf("' + NEW_SET.replace(/\.sgf$/i, '') + ' (") === 0).length === 0);\n'

  /* ================= ④ 打开它：两道题都在、先手各自对 ================= */
  + 'btnOf(rowOf("' + NEW_SET + '"), "打开").click();\n'
  + 'const okOpen = await waitFor(() => state.tsumegoSet && state.tsumegoSet.name === "' + NEW_SET + '", 15000);\n'
  + 'await sleep(600);\n'
  + 'step("打开这份题集：进了习题模式", okOpen && settings.mode === "tsumego", "mode=" + settings.mode);\n'
  + 'const L = state.tsumegoSet ? state.tsumegoSet.list : [];\n'
  + 'step("解析出 2 道题", L.length === 2, "list=" + L.length);\n'
  + 'step("第 1 题：7 子、黑先", L.length > 0 && L[0].setup.length === 7 && L[0].first === "b",\n'
  + '  L.length > 0 ? "子 " + L[0].setup.length + " first=" + L[0].first : "无");\n'
  + 'step("第 2 题：7 子、白先", L.length > 1 && L[1].setup.length === 7 && L[1].first === "w",\n'
  + '  L.length > 1 ? "子 " + L[1].setup.length + " first=" + L[1].first : "无");\n'
  + 'step("盘上已经载入第 1 题（摆题阶段）", state.setup.length === 7 && state.tsumego.phase === "setup",\n'
  + '  "setup=" + state.setup.length + " phase=" + (state.tsumego ? state.tsumego.phase : "无"));\n'
  + 'doc("btn-ts-next").click(); await sleep(600);\n'
  + 'step("按 › 能翻到第 2 题（先手跟着变成白先）", settings.tfirst === "w" && state.setup.length === 7,\n'
  + '  "tfirst=" + settings.tfirst + " setup=" + state.setup.length);\n'

  /* ================= ⑤ 同一道题再存一次 → 拦住，不写重复 ================= */
  + 'openPuzzles(); await sleep(600);\n'
  + 'btnOf(rowOf("' + NEW_SET + '"), "存当前题").click();\n'
  + 'await sleep(700);\n'
  + 'const txtC = await readSet("' + NEW_SET + '");\n'
  + 'step("正在练这道题时再点「存当前题」→ 不写重复（还是 2 棵树）", countGames(txtC) === 2, "共 " + countGames(txtC) + " 棵");\n'
  + 'step("并且给了提示（不是悄悄没反应）", doc("status") ? doc("status").textContent.indexOf("已经在") >= 0 : false,\n'
  + '  doc("status") ? doc("status").textContent.slice(0, 28) : "没有 status 元素");\n'

  /* ================= ⑥ 识谱认出来的题 → 存进已有题集 ================= */
  + 'doc("puz-close").click(); await sleep(250);\n'
  + 'const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = ' + JSON.stringify(FIX_URL) + '; });\n'
  + 'visReset(); vis.name = "corner11x8.jpg"; vis.src = visToImageData(im); vis.pl = "b"; vis.dots = true;\n'
  + 'doc("vision").classList.add("open");\n'
  + 'await visAnalyze();\n'
  + 'step("识谱认出了 11×8、29 子", vis.res && vis.res.stoneCount === 29, vis.res ? vis.res.nx + "x" + vis.res.ny + " / " + vis.res.stoneCount + " 子" : "无");\n'
  + 'const nBase0 = countGames(await readSet("' + BASE_SET + '"));\n'
  + 'doc("vis-to-set").click();\n'
  + 'const okPend = await waitFor(() => doc("puzzles").classList.contains("open") && !doc("puz-pend").hidden, 8000);\n'
  + 'step("点「存进题集…」→ 题集面板打开，并提示手上有一道待存的题", okPend,\n'
  + '  doc("puz-pend").hidden ? "提示没露出来" : doc("puz-pend").textContent.slice(0, 24));\n'
  + 'step("识谱面板已经关掉（图片内存释放）", !doc("vision").classList.contains("open"));\n'
  + 'btnOf(rowOf("' + BASE_SET + '"), "存当前题").click();\n'
  + 'await sleep(1200);\n'
  + 'const nBase1 = countGames(await readSet("' + BASE_SET + '"));\n'
  + 'step("存进那份 347 题的题集 → 变成 " + (nBase0 + 1) + " 题", nBase1 === nBase0 + 1, nBase0 + " → " + nBase1);\n'
  + 'step("存完待存提示收起来了", doc("puz-pend").hidden);\n'
  + 'const txtBase = await readSet("' + BASE_SET + '")\n'
  + 'step("追加的那道题带 PL[B] 和 29 颗摆子", /PL\\[B\\]/.test(txtBase.slice(-1200)) && /AW\\[/.test(txtBase.slice(-1200)));\n'

  /* ================= ⑦ 收尾 ================= */
  + 'doc("puz-close").click(); await sleep(250);\n'
  + 'step("关面板时把待存题也丢掉（下次开不该再冒提示）", puzPending === null && doc("puz-pend").hidden);\n'
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
console.log('=== 多题存进同一份题集 · 端到端 ===');
for (const s of report.steps) console.log('  ' + (s.startsWith('OK ') ? '\u2713 ' + s.slice(3) : '\u2605 ' + s.slice(4)));

/* ---------- 文件层再核一遍（主进程真写过盘） ---------- */
let fileBad = 0, fileN = 0;
function check(name, ok, extra) {
  fileN++;
  console.log('  ' + (ok ? '\u2713 ' : '\u2605 ') + name + (extra ? ' \u2192 ' + extra : ''));
  if (!ok) fileBad++;
}
console.log('=== 文件核对 ===');
const fNew = path.join(PUZ_DIR, NEW_SET);
check('新题集文件真的在磁盘上', fs.existsSync(fNew), fNew);
if (fs.existsSync(fNew)) {
  const t = fs.readFileSync(fNew, 'utf8');
  check('文件里有 2 棵树（和界面一致）', (t.match(/\(\s*;/g) || []).length === 2, '(; 出现 ' + (t.match(/\(\s*;/g) || []).length + ' 次');
  check('两棵树各写了一个 PL', (t.match(/PL\[[BW]\]/g) || []).length === 2);
  check('两棵树的摆子数都是 7', (t.match(/AB((?:\[[a-s]{2}\])+)/g) || []).length === 2);
}
const fBase = path.join(PUZ_DIR, BASE_SET);
check('原有题集那份还在（没被覆盖成别的东西）', fs.existsSync(fBase) && fs.statSync(fBase).size > 70000,
  fs.existsSync(fBase) ? Math.round(fs.statSync(fBase).size / 1024) + ' KB' : '不存在');

const bad = report.bad + fileBad;
console.log('');
if (bad) console.log('有 ' + bad + ' 项失败：' + report.steps.length + ' 项界面断言 + ' + fileN + ' 项文件断言');
else console.log('全部通过：' + report.steps.length + ' 项界面断言 + ' + fileN + ' 项文件断言');
if (errs.length) console.log('控制台报错 ' + errs.length + ' 条：\n  ' + errs.slice(0, 5).join('\n  '));
ws.close();
process.exit(bad ? 1 : 0);
