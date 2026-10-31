/* 端到端：图片识谱（2026-10-30 新增功能的验收闸门）
   用法（macOS / Linux，必须在**同一条 bash 里**先起 Electron 再跑它）：
     RAPACEGO_RECORDS=_trash/_vis_rec RAPACEGO_PUZZLES=_trash/_vis_puz \
       env -u ELECTRON_RUN_AS_NODE npx electron . --remote-debugging-port=9333 \
         --no-sandbox --disable-gpu --in-process-gpu --user-data-dir=_trash/_ud_vis &
     RAPACEGO_RECORDS=... RAPACEGO_PUZZLES=... node dev/_cdp_vision.mjs
   Windows 走项目的启动器：python dev/_rtest.py dev/_cdp_vision.mjs _trash/_shot_vis.png

   ★ 这个脚本验的是**界面那一段**（renderer/app.js 里的「图片识谱」面板）——
     算法本身由 dev/_vision_test.mjs 单独回归（56 项，纯 Node，不开窗口）。
     两层分工：算法错了这里是"逐点对不上"，界面错了这里是"状态/几何不对"。

   ★★ 为什么不去点「识别图片…」那个按钮：它调 window.api.vision.pick()，
      弹的是**系统文件对话框**，CDP 按不了。所以这里从「解码 + 建面板」那一步接上
      （visToImageData → visReset → visAnalyze），除了 dialog 那一下之外没绕过任何被测代码。
      落盘那半（vision:save）反而是真的走 IPC —— 下面第 ⑦ 段读的文件是主进程写的。

   ★ 两个夹具就是用户给的那两张 jpg（19 路整盘 94 子 / 局部 11×8 29 子），
     真值 .json 是反画成棋盘后人眼核对过的（见 dev/_vision_test.mjs 顶部）。
     这里**不许把期望值写死在测试里** —— 一律读夹具，改夹具就等于改判据。
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;

/* ★ 测试专用的棋谱库 / 题集目录（启动命令里用 RAPACEGO_RECORDS / RAPACEGO_PUZZLES 指过来）。
   绝不碰用户自己那份 —— 这是本项目踩过血的教训（见 main.js 的 refreshRecordsDir）。 */
const REC_DIR = String(process.env.RAPACEGO_RECORDS || '');
const PUZ_DIR = String(process.env.RAPACEGO_PUZZLES || '');

function fixtureBase64(name) {
  const p = path.join(ROOT_DIR, 'dev', 'fixtures', 'vision', name);
  return 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
}
function fixtureTruth(name) {
  const p = path.join(ROOT_DIR, 'dev', 'fixtures', 'vision', name.replace(/\.jpg$/i, '.json'));
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* 渲染进程要用的三个值：两张图的 dataUrl + 两张真值。
   一律走 JSON.stringify 编成字面量 —— 渲染进程看不到 Node 侧的变量。 */
const FIXES = {
  full: { name: 'full19.jpg', url: fixtureBase64('full19.jpg'), truth: fixtureTruth('full19.jpg') },
  part: { name: 'corner11x8.jpg', url: fixtureBase64('corner11x8.jpg'), truth: fixtureTruth('corner11x8.jpg') },
};
const FIXES_LIT = JSON.stringify(FIXES);

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 端口还没起来，继续等 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口 ' + PORT);
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
    errs.push('未捕获异常: ' + ((d.exception && d.exception.description) || d.text || '?').split('\n')[0]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push('console.error: ' + m.params.args.map(a => (a.value !== undefined ? a.value : a.description) || '').join(' ').slice(0, 200));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errs.push('log: ' + m.params.entry.text.slice(0, 200));
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
await send('Log.enable');

/* 页面里要跑的那段代码先**拼成一个字符串**，好让下一行在 Node 侧编译一遍。
   ★ 为什么多这一步：这段代码里混着 JS 源码和中文注释，最容易犯的错是
     "中文引号里套了 ASCII 双引号" —— 那会让整段变成语法错，而症状是
     "所有断言一起红，看不出到底哪条错"。踩过一次，所以现在先 new Function 验语法。 */
const PAGE = ('(async function(){\n'
  + 'const FIX = ' + FIXES_LIT + ';\n'
  + 'const steps = [];\n'
  + 'window.__visSteps = steps;\n'
  + 'const step = (name, ok, extra) => steps.push((ok ? "OK " : "BAD ") + name + (extra === undefined || extra === "" ? "" : " -> " + extra));\n'
  + 'const sleep = ms => new Promise(r => setTimeout(r, ms));\n'
  + 'const doc = id => document.getElementById(id);\n'
  + 'async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 12000)) { if (fn()) return true; await sleep(80); } return false; }\n'

  /* ---------- 页面内小工具 ---------- */
  + 'function imgOf(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("decode fail")); im.src = url; }); }\n'
  /* 走**真的** visToImageData（含白底铺底、像素上限），只是绕过了系统对话框 */
  + 'async function loadFix(key) {\n'
  + '  const f = FIX[key];\n'
  + '  const im = await imgOf(f.url);\n'
  + '  visReset();\n'
  + '  vis.name = f.name;\n'
  + '  vis.src = visToImageData(im);\n'
  + '  vis.pl = "b";\n'
  + '  vis.dots = true;\n'
  + '  doc("vision").classList.add("open");\n'
  + '  await visAnalyze();\n'
  + '  return f;\n'
  + '}\n'
  /* 眼前这张盘 → ["..XO..", ...]（与夹具 rows 同一口径：row0 = 图的上边） */
  + 'function rowsNow() {\n'
  + '  const r = vis.res; const m = visMatrix(); const out = [];\n'
  + '  for (let j = 0; j < r.ny; j++) {\n'
  + '    let s = "";\n'
  + '    for (let i = 0; i < r.nx; i++) { const v = m.board[j * r.nx + i]; s += v === Vision.BLACK ? "X" : (v === Vision.WHITE ? "O" : "."); }\n'
  + '    out.push(s);\n'
  + '  }\n'
  + '  return out;\n'
  + '}\n'
  + 'function diffRows(got, want) {\n'
  + '  const bad = [];\n'
  + '  if (got.length !== want.length) bad.push("行数 " + got.length + " != " + want.length);\n'
  + '  for (let j = 0; j < Math.min(got.length, want.length); j++) {\n'
  + '    if (got[j] !== want[j]) bad.push("第 " + j + " 行：得 " + got[j] + " 期望 " + want[j]);\n'
  + '  }\n'
  + '  return bad;\n'
  + '}\n'
  /* 行矩阵的三种变换（期望值由**夹具**算，不写死） */
  /* ★ 顺时针转 90° 的矩阵公式：new[i][j] = old[ny-1-j][i]（不是 new[i] = old[ny-1-i] ——
     那是"上下翻"，第一版这里写错过，测试于是以"旋转不对"的样子报红）。 */
  + 'function rotCW(rows) {\n'
  + '  const ny = rows.length, nx = rows[0].length, out = [];\n'
  + '  for (let i = 0; i < nx; i++) { let s = ""; for (let j = 0; j < ny; j++) s += rows[ny - 1 - j][i]; out.push(s); }\n'
  + '  return out;\n'
  + '}\n'
  + 'function mirH(rows) { return rows.map(s => s.split("").reverse().join("")); }\n'
  + 'function mirV(rows) { return rows.slice().reverse(); }\n'
  /** 交叉点 → 屏幕坐标（再派发**真**鼠标事件，验的是坐标换算那一层） */
  + 'function ptOf(i, j) {\n'
  + '  const c = doc("vis-canvas"); const rc = c.getBoundingClientRect(); const r = vis.res;\n'
  + '  return { x: rc.left + r.grid.xs[i] * (rc.width / c.width), y: rc.top + r.grid.ys[j] * (rc.height / c.height) };\n'
  + '}\n'
  + 'async function clickCell(i, j) {\n'
  + '  const p = ptOf(i, j); const c = doc("vis-canvas");\n'
  + '  const mk = t => new MouseEvent(t, { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 });\n'
  + '  c.dispatchEvent(mk("mousedown")); c.dispatchEvent(mk("mousemove")); c.dispatchEvent(mk("mouseup")); c.dispatchEvent(mk("click"));\n'
  + '  await sleep(40);\n'
  + '}\n'
  + 'const valAt = (i, j) => { const m = visMatrix(); return m.board[j * vis.res.nx + i]; };\n'
  + 'const clickSeg = (id, v) => doc(id).querySelector("[data-v=\'" + v + "\']").click();\n'

  /* ================= ① 起点与几何 ================= */
  + 'step("一开始面板是关着的", !doc("vision").classList.contains("open"));\n'

  /* ---- ①.0 两个入口所在的底栏不能被挤坏（2026-10-30 踩过）----
     棋谱库底栏加上「识别图片…」之后变成 6 个按钮，比可用宽度多 14px：flex 会把按钮**压窄**，
     而按钮高度是固定的 28px —— 文字折成两行，第二行直接溢出到框外（看上去像"按钮被劈开"）。
     ★ 判据必须**量真实几何**（文字只有一行 + 文字框没高出按钮内高），不能只查按钮存在。 */
  + 'function footBad(sel) {\n'
  + '  const f = document.querySelector(sel);\n'
  + '  if (!f) return "找不到 " + sel;\n'
  + '  const bad = [];\n'
  + '  for (const b of f.querySelectorAll("button")) {\n'
  + '    const rg = document.createRange(); rg.selectNodeContents(b);\n'
  + '    const tops = new Set(Array.from(rg.getClientRects()).map(x => Math.round(x.top)));\n'
  + '    const bh = b.getBoundingClientRect().height;\n'
  + '    if (tops.size > 1) bad.push(b.textContent + "(折 " + tops.size + " 行)");\n'
  + '    else if (rg.getBoundingClientRect().height > bh - 8) bad.push(b.textContent + "(溢出按钮外)");\n'
  + '  }\n'
  + '  return bad.join("、");\n'
  + '}\n'
  + 'doc("btn-records").click(); await sleep(500);\n'
  + 'const badRec = footBad("#records .mfoot");\n'
  + 'const nRecBtn = document.querySelectorAll("#records .mfoot button").length;\n'
  + 'step("棋谱库底栏 6 个按钮，都只有一行、没溢出按钮框外", nRecBtn === 6 && !badRec, (badRec || "6 个都在框里") + " / 共 " + nRecBtn + " 个");\n'
  + 'doc("rec-close").click(); await sleep(250);\n'
  + 'openPuzzles(); await sleep(500);\n'
  + 'const badPuz = footBad("#puzzles .mfoot");\n'
  + 'const nPuzBtn = document.querySelectorAll("#puzzles .mfoot button").length;\n'
  + 'step("题集面板底栏 5 个按钮，同样没被挤坏", nPuzBtn === 5 && !badPuz, (badPuz || "5 个都在框里") + " / 共 " + nPuzBtn + " 个");\n'
  /* 2026-10-31 用户要求：「识别图片…」改成白底，与同排其它按钮一致（原来它是唯一的绿按钮） */
  + 'const bgOf = id => getComputedStyle(doc(id)).backgroundColor;\n'
  + 'step("题集面板「识别图片…」是白底、和旁边按钮同色", bgOf("puz-vision") === bgOf("puz-import")\n'
  + '  && /^rgb\\(255,\\s*255,\\s*255\\)$/.test(bgOf("puz-vision")), bgOf("puz-vision") + " / 相邻 " + bgOf("puz-import"));\n'
  + 'doc("puz-close").click(); await sleep(250);\n'

  + 'const fFull = await loadFix("full");\n'
  + 'step("整盘图：面板已打开", doc("vision").classList.contains("open"));\n'
  + 'step("整盘图：原图尺寸读出来了", vis.src.width > 400 && vis.src.height > 400, vis.src.width + "x" + vis.src.height);\n'
  + 'const stage = doc("vis-canvas").getBoundingClientRect();\n'
  + 'const sideR = document.querySelector(".vis-side").getBoundingClientRect();\n'
  + 'const modalR = document.querySelector("#vision .modal").getBoundingClientRect();\n'
  + 'step("画布是正方形（矫正图 836 见方）", Math.abs(doc("vis-canvas").width - doc("vis-canvas").height) < 2, doc("vis-canvas").width + "x" + doc("vis-canvas").height);\n'
  + 'step("画布显示尺寸 = VIS_BOX", Math.abs(stage.width - 452) < 3, Math.round(stage.width) + "px");\n'
  + 'step("右栏没被画布挤扁", sideR.width >= 180, Math.round(sideR.width) + "px");\n'
  + 'step("弹窗不超出窗口高度", modalR.height <= window.innerHeight * 0.93 + 1, Math.round(modalR.height) + " / " + window.innerHeight);\n'
  + 'step("弹窗没超出窗口宽度", modalR.width <= window.innerWidth - 20, Math.round(modalR.width) + " / " + window.innerWidth);\n'

  /* ================= ② 整盘 19 路逐点 ================= */
  + 'const rf = vis.res;\n'
  + 'step("整盘图：检出 19x19", rf.nx === 19 && rf.ny === 19, rf.nx + "x" + rf.ny);\n'
  /* 真值 95 颗 —— C7 那颗白子中央被原图自带的绿点盖住，算法认不出来（已知漏检，见 ②.6） */
  + 'step("整盘图：认出 94 颗（真值 95，差的那一颗是 C7 已知漏检）", rf.stoneCount === 94, "实际 " + rf.stoneCount);\n'
  /* 逐点比真值 —— 用**按点**的差异列表（diffRows 是按行返回的，一处差就整行打出来，
     定位不到是哪一格；这里要的恰恰是"只差 C7 一格"）。 */
  + 'const CHM = { "-1": "?", "0": ".", "1": "X", "2": "O" };\n'
  + 'const dpts = [];\n'
  + 'for (let j = 0; j < rf.ny; j++) for (let i = 0; i < rf.nx; i++)\n'
  + '  if ((CHM[String(valAt(i, j))] || "?") !== fFull.truth.rows[j][i]) dpts.push("(" + i + "," + j + ")");\n'
  + 'step("整盘图：逐点对上真值（361 点，就差 C7 那一处已知漏检）", dpts.length === 1 && dpts[0] === "(2,12)", dpts.join(" "));\n'
  + 'let wrongFlag = 0;\n'
  + 'for (const u of rf.uncertain) { if (fFull.truth.rows[u[1]][u[0]] !== "." && !(u[0] === 2 && u[1] === 12)) wrongFlag++; }\n'
  + 'step("整盘图：待确认点只落在 C7（漏检了、但界面明说了）", wrongFlag === 0 && rf.uncertain.length === 1, "待确认 " + rf.uncertain.length + " 个，误报 " + wrongFlag + " 个");\n'
  + 'step("整盘图：贴角/偏移两行藏起来了（整盘不需要）", doc("vis-corner-sec").hidden && doc("vis-off-sec").hidden);\n'

  /* ---- ②.5 「标出识别结果」画出来必须就是**一颗棋子**（2026-10-31 用户两次报障）----
     第一次：「哪些是黑子、哪些是白子看不出来」→ 代码取值写错（`m[i]` 而 visMatrix() 返回对象），
     361 个点（含空点）全画成灰点。第二次：改成"缩小的棋子小点"后，用户发现
     **手改的点 / 空点上加的子跟识别出来的子长得不一样**，怀疑是"故意区分"。
     根子是小点压在照片的棋子上：底下有子没子两回事。现在一律画整颗棋子。

     ★ 判据也换了口径。原来数"变亮/变暗的像素"（小点才有那种极性），现在要回答的是
       "这一格画出来是不是一颗黑子 / 一颗白子"，所以量**中心的亮度**和**棋子外那一圈**：
         · 判定为黑的格子：中心必须暗（实测 41）；判定为白的：中心必须亮（实测 252）
         · 空点：一点没变（一个像素都不该动）
         · 手加的子：中心颜色和识别出来的子一致（这是用户抱怨的量化版 ——
           改造前手加黑的外圈亮度 227、识别黑 90，差 137；现在 74 vs 53，差 21）
         · 悬停：不许改变这一格的颜色（改造前悬停会在中心画绿点，黑子中心 14 → 75） */
  + 'const mcv = doc("vis-canvas"), mg = mcv.getContext("2d");\n'
  + 'const pickCell = want => { for (let j = 0; j < rf.ny; j++) for (let i = 0; i < rf.nx; i++) if (valAt(i, j) === want) return [i, j]; return null; };\n'
  /* 空点要挑一个**周围一圈也没有待确认橙圈**的：那个圈半径 0.5 格，会伸到邻格里去搅局 */
  + 'const uncSet = new Set(rf.uncertain.map(u => u[0] + "," + u[1]));\n'
  + 'const nearUnc = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (uncSet.has((i + di) + "," + (j + dj))) return true; return false; };\n'
  + 'const pickEmpty = () => { for (let j = 2; j < rf.ny - 2; j++) for (let i = 2; i < rf.nx - 2; i++)\n'
  + '  if (valAt(i, j) === Vision.EMPTY && !nearUnc(i, j)) return [i, j]; return null; };\n'
  + 'const cB = pickCell(Vision.BLACK), cW = pickCell(Vision.WHITE), cE = pickEmpty();\n'
  + 'step("找到黑格 / 白格 / 干净空点各一个", !!cB && !!cW && !!cE, "黑 " + cB + " 白 " + cW + " 空 " + cE);\n'
  /* 以「格」为半径的环形平均亮度（0~r1 就是中心那一坨） */
  + 'function lumRing(i, j, r0, r1) {\n'
  + '  const cx = rf.grid.xs[i], cy = rf.grid.ys[j], c = rf.cell;\n'
  + '  const R = Math.round(c * (r1 + 0.03));\n'
  + '  const x0 = Math.round(cx) - R, y0 = Math.round(cy) - R, w = R * 2 + 1;\n'
  + '  const dd = mg.getImageData(x0, y0, w, w).data;\n'
  + '  let sum = 0, n = 0;\n'
  + '  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {\n'
  + '    const px = x0 + x + 0.5 - cx, py = y0 + y + 0.5 - cy;\n'
  + '    const d = Math.sqrt(px * px + py * py) / c;\n'
  + '    if (d < r0 || d > r1) continue;\n'
  + '    const k = (y * w + x) * 4;\n'
  + '    sum += 0.299 * dd[k] + 0.587 * dd[k + 1] + 0.114 * dd[k + 2]; n++;\n'
  + '  }\n'
  + '  return n ? sum / n : -1;\n'
  + '}\n'
  + 'const ctr = (p) => lumRing(p[0], p[1], 0, 0.12);\n'
  /* 空点"什么都没画"要逐像素比，不能只比平均值（一圈细橙线对平均值影响很小） */
  + 'const mrad = Math.max(8, rf.cell * 0.56);\n'
  + 'function discAt(i, j) {\n'
  + '  const x0 = Math.round(rf.grid.xs[i] - mrad), y0 = Math.round(rf.grid.ys[j] - mrad);\n'
  + '  const w = Math.round(mrad * 2);\n'
  + '  const dd = mg.getImageData(x0, y0, w, w).data;\n'
  + '  const out = [];\n'
  + '  for (let k = 0; k < dd.length; k += 4) out.push(0.299 * dd[k] + 0.587 * dd[k + 1] + 0.114 * dd[k + 2]);\n'
  + '  return out;\n'
  + '}\n'
  + 'const changed = (on, off) => { let n = 0; for (let k = 0; k < on.length; k++) if (Math.abs(on[k] - off[k]) > 30) n++; return n; };\n'

  /* 基线：关掉标记 = 原图 */
  + 'vis.dots = false; visPaintBoard(mcv);\n'
  + 'const offE = discAt(cE[0], cE[1]);\n'
  + 'vis.dots = true; visPaintBoard(mcv);\n'
  + 'const onE = discAt(cE[0], cE[1]);\n'
  + 'step("空点上什么都不画（原来 361 个点全被画了灰点）", changed(onE, offE) <= 4, "空点处变化像素 " + changed(onE, offE));\n'
  + 'const ctrB = ctr(cB), ctrW = ctr(cW), rimB = lumRing(cB[0], cB[1], 0.34, 0.48), rimW = lumRing(cW[0], cW[1], 0.34, 0.48);\n'
  + 'step("判定为黑的格子画出来的就是一颗黑子（中心暗）", ctrB < 60, "中心亮度 " + ctrB.toFixed(0));\n'
  + 'step("判定为白的格子画出来的就是一颗白子（中心亮）", ctrW > 220, "中心亮度 " + ctrW.toFixed(0));\n'
  + 'step("棋子占满一格（0.34~0.48 格那一圈：黑子是暗的、白子是亮的）", rimB < 110 && rimW > 150, "黑 " + rimB.toFixed(0) + " / 白 " + rimW.toFixed(0));\n'

  /* 手加子：走真点击（空 → 黑），量"和识别出来的子是不是同一个东西" */
  + 'await clickCell(cE[0], cE[1]);\n'
  + 'step("空点点一下就变成黑子", valAt(cE[0], cE[1]) === Vision.BLACK, "现在 " + valAt(cE[0], cE[1]));\n'
  + 'const handCB = ctr(cE), handRB = lumRing(cE[0], cE[1], 0.34, 0.48);\n'
  + 'step("手加的黑子中心是暗的（就是一颗黑子，不是「标记」）", handCB < 70, "中心亮度 " + handCB.toFixed(0));\n'
  + 'step("手加的黑子和识别出来的黑子同一个外观（外圈亮度接近）", Math.abs(handRB - rimB) <= 45, "手加 " + handRB.toFixed(0) + " vs 识别 " + rimB.toFixed(0));\n'
  + 'await clickCell(cE[0], cE[1]);\n'
  + 'step("再点一下变白子", valAt(cE[0], cE[1]) === Vision.WHITE, "现在 " + valAt(cE[0], cE[1]));\n'
  + 'const handCW = ctr(cE), handRW = lumRing(cE[0], cE[1], 0.34, 0.48);\n'
  + 'step("手加的白子中心是亮的", handCW > 230, "中心亮度 " + handCW.toFixed(0));\n'
  + 'step("手加的白子和识别出来的白子同一个外观", Math.abs(handCW - ctrW) <= 30, "手加 " + handCW.toFixed(0) + " vs 识别 " + ctrW.toFixed(0));\n'
  + 'await clickCell(cE[0], cE[1]);\n'
  + 'step("再点一下回到空点（画的东西也消失）", valAt(cE[0], cE[1]) === Vision.EMPTY && changed(discAt(cE[0], cE[1]), offE) <= 4,\n'
  + '  "现在 " + valAt(cE[0], cE[1]));\n'

  /* 悬停：只许有一块淡绿底，不许往中心画点 */
  + 'const hBefore = ctr(cB);\n'
  + 'vis.hover = cB; visPaintBoard(mcv);\n'
  + 'const hAfter = ctr(cB);\n'
  + 'vis.hover = null; visPaintBoard(mcv);\n'
  + 'step("悬停不改变这一格的颜色（原来在中心画绿点，黑子会被看成「未定」）", Math.abs(hAfter - hBefore) < 12, hBefore.toFixed(0) + " -> " + hAfter.toFixed(0));\n'
  /* 悬停提示要把"哪一格 / 是什么 / 为什么圈着"一次说清 —— 用户 2026-10-31 就是卡在这句上。
     ★ 坐标必须是**棋盘坐标**（C7），不能是"图的第 13 行"：整盘图上那一格印的就是 7。 */
  + 'visHoverTip([2, 12]);\n'
  + 'const tipTxt = doc("vis-tip").textContent;\n'
  + 'step("悬停 C7：报的是棋盘坐标 C7，而且说清了它是空点、为什么圈着",\n'
  + '  tipTxt.indexOf("C7") === 0 && tipTxt.indexOf("空点") > 0 && tipTxt.indexOf("待确认") > 0, tipTxt);\n'
  + 'step("这行提示装得下（一行、没有溢出）", doc("vis-tip").scrollWidth <= doc("vis-tip").clientWidth + 1,\n'
  + '  doc("vis-tip").scrollWidth + " / " + doc("vis-tip").clientWidth);\n'
  + 'visHoverTip(null);\n'

  + 'const lgEl = doc("vis-legend");\n'
  + 'step("图例三项（黑子 / 白子 / 待确认）在底栏露出来了", !!lgEl && lgEl.offsetWidth > 60 && lgEl.querySelectorAll("i").length === 3\n'
  + '  && lgEl.textContent.indexOf("待确认") >= 0,\n'
  + '  lgEl ? Math.round(lgEl.offsetWidth) + "px / " + lgEl.textContent.replace(/\\s+/g, " ").trim() : "没有图例");\n'

  /* ================= ③ 真鼠标点着改子 ================= */
  + 'let bi = -1, bj = -1;\n'
  + 'for (let j = 0; j < rf.ny && bi < 0; j++) for (let i = 0; i < rf.nx && bi < 0; i++) if (valAt(i, j) === Vision.BLACK) { bi = i; bj = j; }\n'
  + 'step("找到一颗黑子用来点", bi >= 0, "(" + bi + "," + bj + ")");\n'
  + 'await clickCell(bi, bj);\n'
  + 'step("点一下：黑 -> 白", valAt(bi, bj) === Vision.WHITE, "现在 " + valAt(bi, bj));\n'
  + 'await clickCell(bi, bj);\n'
  + 'step("再点：白 -> 空", valAt(bi, bj) === Vision.EMPTY, "现在 " + valAt(bi, bj));\n'
  + 'await clickCell(bi, bj);\n'
  + 'step("再点：空 -> 黑（回到原值）", valAt(bi, bj) === Vision.BLACK, "现在 " + valAt(bi, bj));\n'
  + 'step("改回原值后校正表是干净的（edits 空）", vis.edits.size === 0, "edits=" + vis.edits.size);\n'
  + 'step("信息栏写了棋子数和待确认数", doc("vis-info").textContent.indexOf("棋子 94") >= 0 && doc("vis-info").textContent.indexOf("待确认") >= 0, doc("vis-info").textContent.slice(0, 46));\n'
  + 'await clickCell(bi, bj);\n'
  + 'step("真改一处：edits 记 1 条", vis.edits.size === 1, "edits=" + vis.edits.size);\n'
  + 'step("真改一处：棋子数还是 94（颜色变了但还在盘上）", visStones().stones.length === 94, "锚定后 " + visStones().stones.length);\n'
  + 'await clickCell(bi, bj); await clickCell(bi, bj);\n'   /* 白 -> 空 -> 黑，回到原值 */
  + 'step("再走一圈回到原值，edits 又空了", vis.edits.size === 0, "edits=" + vis.edits.size);\n'

  /* ================= ④ 旋转 / 镜像 ================= */
  /* 这一段比的是"转没转"，所以拿**转之前的识别结果**当基准，不拿真值 ——
     真值里 C7 那颗石子算法本来就没认出来（已知漏检），拿真值当基准会在转完之后
     在别的位置冒出同样的差异，把断言变成"永远红"。 */
  + 'const base = rowsNow();\n'
  + 'doc("vis-xform").querySelector("[data-v=\'rot90\']").click();\n'
  + 'await waitFor(() => !vis.busy, 20000);\n'
  + 'step("顺时针 90 度后仍然是 19x19", vis.res.nx === 19 && vis.res.ny === 19, vis.res.nx + "x" + vis.res.ny);\n'
  + 'let d = diffRows(rowsNow(), rotCW(base));\n'
  + 'step("顺时针 90 度：矩阵整体转了（不是只换个标签）", d.length === 0, d.slice(0, 2).join(" | "));\n'
  + 'step("顺时针 90 度：原图也真的转了（宽高互换）", vis.src.width === 1278 && vis.src.height === 1270, vis.src.width + "x" + vis.src.height);\n'
  + 'doc("vis-xform").querySelector("[data-v=\'rot270\']").click();\n'
  + 'await waitFor(() => !vis.busy, 20000);\n'
  + 'd = diffRows(rowsNow(), base);\n'
  + 'step("再逆时针 90 度：回到原样", d.length === 0, d.slice(0, 2).join(" | "));\n'
  + 'doc("vis-xform").querySelector("[data-v=\'flipH\']").click();\n'
  + 'await waitFor(() => !vis.busy, 20000);\n'
  + 'd = diffRows(rowsNow(), mirH(base));\n'
  + 'step("左右镜像：矩阵左右翻", d.length === 0, d.slice(0, 2).join(" | "));\n'
  + 'doc("vis-xform").querySelector("[data-v=\'flipH\']").click();\n'
  + 'await waitFor(() => !vis.busy, 20000);\n'
  + 'd = diffRows(rowsNow(), base);\n'
  + 'step("再镜像一次：回到原样（幂等）", d.length === 0, d.slice(0, 2).join(" | "));\n'

  /* ================= ⑤ 局部图 + 自动判角 ================= */
  + 'const fPart = await loadFix("part");\n'
  + 'step("局部图：检出 11x8", vis.res.nx === 11 && vis.res.ny === 8, vis.res.nx + "x" + vis.res.ny);\n'
  + 'step("局部图：29 颗子", vis.res.stoneCount === 29, "实际 " + vis.res.stoneCount);\n'
  + 'd = diffRows(rowsNow(), fPart.truth.rows);\n'
  + 'step("局部图：逐点与真值一致（88 点）", d.length === 0, d.slice(0, 3).join(" | "));\n'
  + 'step("局部图：自动判角 = 左下", vis.res.corner === "bl", String(vis.res.corner));\n'
  + 'step("局部图：贴角/偏移两行露出来了", !doc("vis-corner-sec").hidden && !doc("vis-off-sec").hidden);\n'
  + 'step("面板上的贴角按钮亮着 bl", (() => { const b = doc("vis-corner").querySelector(".on"); return !!b && b.dataset.v === "bl"; })());\n'

  /* ================= ⑥ 贴角 + 偏移（锚到 19 路的坐标） ================= */
  + 'function stoneRange() {\n'
  + '  const s = visStones().stones; if (!s.length) return null;\n'
  + '  let x0 = 99, x1 = -1, y0 = 99, y1 = -1;\n'
  + '  for (const q of s) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }\n'
  + '  return { x0: x0, x1: x1, y0: y0, y1: y1, n: s.length };\n'
  + '}\n'
  + 'let rg = stoneRange();\n'
  /* 期望值怎么来的（别猜，按代码推）：局部 11×8，棋子占列 i=0..9、行 j=3..7。
     贴左下 = 先上下翻（r'=7-j）再 Y=18-r' = 11+j → 行 14..18；列不动 → 0..9。 */
  + 'step("贴左下：局部列 0..9 落在 X 0..9", rg.x0 === 0 && rg.x1 === 9, "X " + rg.x0 + ".." + rg.x1);\n'
  + 'step("贴左下：局部行 3..7 落在 Y 14..18", rg.y0 === 14 && rg.y1 === 18, "Y " + rg.y0 + ".." + rg.y1);\n'
  + 'step("贴左下：29 颗子全在盘内（没有越界）", rg.n === 29 && visStones().bad.length === 0, "盘内 " + rg.n + " / 越界 " + visStones().bad.length);\n'
  + 'clickSeg("vis-corner", "tl");\n'
  + 'rg = stoneRange();\n'
  /* 贴左上 = 不翻，X=i、Y=j → 列 0..9、行 3..7 */
  + 'step("改贴左上：整体搬到左上角（列不变、行不再翻）", rg.x0 === 0 && rg.y0 === 3 && rg.x1 === 9 && rg.y1 === 7, "X " + rg.x0 + ".." + rg.x1 + " Y " + rg.y0 + ".." + rg.y1);\n'
  + 'doc("vis-off-more").click(); doc("vis-off-more").click(); doc("vis-off-more").click();\n'
  + 'rg = stoneRange();\n'
  /* 偏移 3 = 贴的那个角往里让 3 路 → X=3+i（3..12）、Y=3+j（6..10） */
  + 'step("偏移 3：整体内缩 3 路", rg.x0 === 3 && rg.x1 === 12 && rg.y0 === 6 && rg.y1 === 10, "X " + rg.x0 + ".." + rg.x1 + " Y " + rg.y0 + ".." + rg.y1);\n'
  + 'step("偏移 3：格数不变（只是挪位置）", rg.n === 29, "盘内 " + rg.n);\n'
  + 'step("偏移数字跟着变", doc("vis-off-txt").textContent === "3", doc("vis-off-txt").textContent);\n'
  + 'clickSeg("vis-corner", "br");\n'
  + 'rg = stoneRange();\n'
  /* 贴右下 = 列也翻（c'=10-i）+ 行翻（r'=7-j）；X=15-c'=5+i（5..14）、Y=15-r'=8+j（11..15） */
  + 'step("改贴右下 + 偏移 3：落到右下角", rg.x0 === 5 && rg.x1 === 14 && rg.y0 === 11 && rg.y1 === 15, "X " + rg.x0 + ".." + rg.x1 + " Y " + rg.y0 + ".." + rg.y1);\n'
  /* 回到自动判角，后面存档用它 */
  + 'doc("vis-re").click();\n'
  + 'await sleep(1000);\n'   /* vis-re 不置 busy，只能定时等它把新结果算完 */
  + 'step("「重认」把贴角/偏移复位成自动", vis.cornerManual === null && vis.off === 0, "corner=" + String(vis.cornerManual) + " off=" + vis.off);\n'
  + 'step("「重认」之后仍然逐点正确", diffRows(rowsNow(), fPart.truth.rows).length === 0);\n'

  /* ================= ⑥.5 手动框四角（拖手柄 → 松手自动重认） ================= */
  + 'doc("vis-mc").click();\n'
  + 'await sleep(200);\n'
  + 'step("手动框角：视图切到原图", vis.view === "corners", vis.view);\n'
  + 'step("手动框角：按钮文案变成「返回校正」", doc("vis-mc").textContent === "返回校正", doc("vis-mc").textContent);\n'
  + 'step("手动框角：四个角**预置**好了（不用从零点四次）", !!vis.mc && vis.mc.length === 4, JSON.stringify(vis.mc && vis.mc.map(q => q.map(Math.round))));\n'
  + 'const cvv = doc("vis-canvas");\n'
  + 'let hOK = true; const hPos = [];\n'
  + 'for (const q2 of (vis.mc || [])) { const t2 = visSrcToCanvas(q2[0], q2[1]); hPos.push(Math.round(t2.x) + "," + Math.round(t2.y));\n'
  + '  if (t2.x < 10 || t2.y < 10 || t2.x > cvv.width - 10 || t2.y > cvv.height - 10) hOK = false; }\n'
  + 'step("手动框角：四个手柄都完整落在画布内（没被边缘切掉）", hOK, hPos.join(" ") + " / 画布 " + cvv.width + "x" + cvv.height);\n'
  + 'const rc2 = cvv.getBoundingClientRect();\n'
  + 'const disp = q2 => ({ x: rc2.left + q2.x * (rc2.width / cvv.width), y: rc2.top + q2.y * (rc2.height / cvv.height) });\n'
  + 'const s0 = visSrcToCanvas(vis.mc[0][0], vis.mc[0][1]);\n'
  + 'const s1 = { x: s0.x + 2, y: s0.y + 1 };\n'
  + 'const d0 = disp(s0), d1 = disp(s1);\n'
  + 'const before0 = vis.mc[0].slice();\n'
  + 'cvv.dispatchEvent(new MouseEvent("mousedown", { clientX: d0.x, clientY: d0.y, bubbles: true, cancelable: true, button: 0 }));\n'
  + 'cvv.dispatchEvent(new MouseEvent("mousemove", { clientX: d1.x, clientY: d1.y, bubbles: true, cancelable: true }));\n'
  + 'cvv.dispatchEvent(new MouseEvent("mouseup", { clientX: d1.x, clientY: d1.y, bubbles: true, cancelable: true }));\n'
  + 'await sleep(1500);\n'
  + 'step("拖角：1 号手柄的坐标真的变了", vis.mc[0][0] !== before0[0] || vis.mc[0][1] !== before0[1], JSON.stringify([before0.map(Math.round), vis.mc[0].map(Math.round)]));\n'
  + 'step("拖角：松手后自动重认了一遍（结果还在）", !!vis.res && vis.res.nx >= 8, vis.res ? (vis.res.nx + "x" + vis.res.ny) : "无");\n'
  + 'doc("vis-mc").click();\n'
  + 'await sleep(150);\n'
  + 'step("返回校正：回到棋盘视图", vis.view === "board", vis.view);\n'
  + 'doc("vis-re").click();\n'
  + 'await sleep(1000);\n'
  + 'step("手动框过之后再「重认」：四角回到完全自动", vis.mc === null && vis.cornerManual === null, "mc=" + String(vis.mc));\n'

  /* ================= ⑥.6 默认偏移（整盘小棋盘居中） =================
     ★ 这一段验的是**纯策略函数** visAutoOff()，不需要另造一张 13 路的图：
       给它几个假的结果对象就行。默认值错了在界面上表现为「整盘棋歪在角上」。 */
  + 'step("默认偏移：19 路整盘不缩", visAutoOff({ nx: 19, ny: 19, corner: null }) === 0, visAutoOff({ nx: 19, ny: 19, corner: null }));\n'
  + 'step("默认偏移：13 路整盘居中（缩 3 → 落在 3..15）", visAutoOff({ nx: 13, ny: 13, corner: null }) === 3, visAutoOff({ nx: 13, ny: 13, corner: null }));\n'
  + 'step("默认偏移：9 路整盘居中（缩 5 → 落在 5..13）", visAutoOff({ nx: 9, ny: 9, corner: null }) === 5, visAutoOff({ nx: 9, ny: 9, corner: null }));\n'
  + 'step("默认偏移：局部图不替用户缩（贴角说了算）", visAutoOff({ nx: 11, ny: 8, corner: "bl" }) === 0, visAutoOff({ nx: 11, ny: 8, corner: "bl" }));\n'
  + 'step("局部图重认之后偏移回到 0", vis.off === 0, "off=" + vis.off);\n'

  /* ================= ⑦ 存进棋谱库（真 IPC + 真文件） ================= */
  + 'clickSeg("vis-pl", "w");\n'
  + 'step("先手选了白先", vis.pl === "w");\n'
  + 'doc("vis-to-rec").click();\n'
  + 'const okRec = await waitFor(() => !doc("vision").classList.contains("open") && state.setup.length > 0, 20000);\n'
  + 'step("存进棋谱库：面板关了、棋谱开了", okRec, "recName=" + state.recName);\n'
  + 'step("存进棋谱库：摆子 29 颗", state.setup.length === 29, "实际 " + state.setup.length);\n'
  + 'step("存进棋谱库：没有手顺（静态局面）", state.moves.length === 0, "手数 " + state.moves.length);\n'
  + 'step("存进棋谱库：PL[W] 被读回来了", state.firstPlayer === "w", String(state.firstPlayer));\n'
  + 'step("存进棋谱库：轮到白走", state.toMove === "w", state.toMove);\n'
  + 'step("存进棋谱库：sideToMove(0) 也说白先", sideToMove(0) === "w", sideToMove(0));\n'
  + 'const recName = state.recName;\n'
  /* 再把这份棋谱导出去，验 buildSGF 会写 PL[]（不然别人打开只能猜） */
  + 'state.exportName = "回流-视觉测试.sgf";\n'
  + 'const saved = await window.api.records.save(state.exportName, buildSGF());\n'
  + 'step("导出时 buildSGF 写盘成功", !!(saved && saved.ok), JSON.stringify(saved && (saved.name || saved.error)));\n'

  /* ================= ⑧ 当习题练 ================= */
  + 'await loadFix("part");\n'
  + 'await clickCell(0, 0);\n'      /* 空点 -> 黑，验"手改会落进习题里" */
  + 'clickSeg("vis-pl", "b");\n'
  + 'doc("vis-to-puz").click();\n'
  + 'const okPuz = await waitFor(() => settings.mode === "tsumego" && !!state.tsumegoSet, 20000);\n'
  + 'step("当习题练：进了习题模式", okPuz, "mode=" + settings.mode);\n'
  + 'step("当习题练：题集里正好 1 道题", !!state.tsumegoSet && state.tsumegoSet.list.length === 1, state.tsumegoSet ? String(state.tsumegoSet.list.length) : "无");\n'
  + 'const pr = state.tsumegoSet.list[0];\n'
  + 'step("当习题练：摆子 30 颗（含手改那一颗）", pr.setup.length === 30, "实际 " + pr.setup.length);\n'
  + 'step("当习题练：先手 = 黑先", settings.tfirst === "b" && pr.first === "b", "tfirst=" + settings.tfirst + " first=" + pr.first);\n'
  + 'step("当习题练：停在摆题阶段", state.tsumego && state.tsumego.phase === "setup", state.tsumego ? state.tsumego.phase : "无");\n'
  + 'step("当习题练：盘上就是这 30 颗子", state.setup.length === 30, "state.setup=" + state.setup.length);\n'
  + 'step("当习题练：练习卡露出来了", !doc("ts-card").hidden);\n'

  /* ================= ⑨ 收尾：ESC 关面板 + 复位 ================= */
  + 'await loadFix("part");\n'
  + 'await clickCell(1, 1);\n'
  + 'step("关之前：确实有一处手改", vis.edits.size === 1, "edits=" + vis.edits.size);\n'
  + 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));\n'
  + 'await sleep(120);\n'
  + 'step("ESC 把面板关掉了", !doc("vision").classList.contains("open"));\n'
  + 'step("关掉时把大图/结果/校正都释放了", vis.src === null && vis.res === null && vis.edits.size === 0);\n'
  + 'step("关掉时没把棋局也清掉", state.setup.length === 30, "state.setup=" + state.setup.length);\n'

  + 'return { steps: steps, recName: recName, bad: steps.filter(s => s.indexOf("BAD ") === 0).length };\n'
  + '})()');

try {
  new Function('return ' + PAGE);          // 只验语法，不执行（页面上下文才有 document/vis）
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

console.log('=== 图片识谱 · 端到端 ===');
for (const s of report.steps) console.log('  ' + (s.startsWith('OK ') ? '\u2713 ' + s.slice(3) : '\u2605 ' + s.slice(4)));

/* ---------- 文件侧核对（主进程真写过盘） ---------- */
let fileBad = 0, fileN = 0;
function check(name, ok, extra) {
  fileN++;
  console.log('  ' + (ok ? '\u2713 ' : '\u2605 ') + name + (extra ? ' \u2192 ' + extra : ''));
  if (!ok) fileBad++;
}
console.log('=== 落盘核对 ===');
const recFile = path.join(REC_DIR, report.recName || '');
check('棋谱库里真有这份文件', !!report.recName && fs.existsSync(recFile), recFile);
if (fs.existsSync(recFile)) {
  const t = fs.readFileSync(recFile, 'utf8');
  check('SGF 里写了 PL[W]', /PL\[W\]/.test(t));
  check('SGF 里写了 SZ[19]', /SZ\[19\]/.test(t));
  check('SGF 里写了 AB/AW 两组摆子', /AB\[/.test(t) && /AW\[/.test(t));
  const nAB = (/AB((?:\[[a-s]{2}\])+)/.exec(t) || ['', ''])[1].length / 4;
  const nAW = (/AW((?:\[[a-s]{2}\])+)/.exec(t) || ['', ''])[1].length / 4;
  check('AB+AW = 29 颗（和识别结果对得上）', nAB + nAW === 29, 'AB ' + nAB + ' + AW ' + nAW);
  check('注释里写了来路（图片识谱）', /GC\[.*\u56fe\u7247\u8bc6\u8c31/.test(t));
  check('文件名带「识谱-」前缀', /^\u8bc6\u8c31-/.test(report.recName || ''), report.recName);
}
const flowFile = path.join(REC_DIR, '\u56de\u6d41-\u89c6\u89c9\u6d4b\u8bd5.sgf');
check('导出的那份也真的有', fs.existsSync(flowFile), flowFile);
if (fs.existsSync(flowFile)) {
  const t = fs.readFileSync(flowFile, 'utf8');
  check('导出的棋谱里也有 PL[W]（buildSGF 那处改动生效）', /PL\[W\]/.test(t));
  check('导出的棋谱里没有多余的手顺', !/;[BW]\[/.test(t), '手数节点数 ' + (t.match(/;[BW]\[/g) || []).length);
}
if (PUZ_DIR) {
  const puz = fs.readdirSync(PUZ_DIR).filter(f => /^\u8bc6\u8c31-/.test(f));
  check('题集目录里有识谱存下来的那份', puz.length >= 1, puz.join(', ') || '空');
  if (puz.length) {
    const t = fs.readFileSync(path.join(PUZ_DIR, puz[0]), 'utf8');
    const nAB = (/AB((?:\[[a-s]{2}\])+)/.exec(t) || ['', ''])[1].length / 4;
    const nAW = (/AW((?:\[[a-s]{2}\])+)/.exec(t) || ['', ''])[1].length / 4;
    check('题集里 AB+AW = 30 颗（含手改那一颗）', nAB + nAW === 30, 'AB ' + nAB + ' + AW ' + nAW);
    check('题集里写了 PL[B]（黑先）', /PL\[B\]/.test(t));
  }
} else {
  console.log('  （没设 RAPACEGO_PUZZLES，跳过题集文件核对）');
}

if (errs.length) {
  console.log('=== \u2605 控制台报错 ===');
  for (const e of errs.slice(0, 12)) console.log('  ' + e);
}
const bad = report.bad + fileBad;
console.log('');
console.log((bad === 0 ? '全部通过' : '有 ' + bad + ' 项失败') + '：' + report.steps.length + ' 项界面断言 + ' + fileN + ' 项落盘断言'
  + (errs.length ? '，控制台 ' + errs.length + ' 条报错' : ''));
ws.close();
process.exit(bad === 0 && errs.length === 0 ? 0 : 1);
