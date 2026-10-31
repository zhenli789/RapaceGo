/* 探针：识谱画布上「识别出的子 / 手加的子 / 悬停圈 / 待确认圈」到底画成了什么样
   用法（macOS，必须在同一条 bash 里先起 Electron 再跑它）：
     RAPACEGO_RECORDS=_trash/_pv_rec RAPACEGO_PUZZLES=_trash/_pv_puz \
       env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --remote-debugging-port=9334 \
         --no-sandbox --disable-gpu --in-process-gpu --user-data-dir=_trash/_ud_pv &
     node dev/_probe_vismark.mjs

   为什么要有这个探针（2026-10-31 用户报障 2 条）：
     ① 「点 C7 后变成黑子，但和其他黑子样式不一样；再点变白子就一致了」
     ② 「点其他空子（G7）加的子，样式和识别出来的黑白子都不同 —— 是故意区分的吗？」
   两条都指向同一件事：**标记是画在照片上的，照片里有子 / 没子，看起来当然不一样**。
   但"看起来不一样"必须量出来才知道差多少、差在哪一层（中心 / 环 / 环外面那一圈）。
   —— 本探针就是量这三层：center（中心亮度）、ring（标记环的极性像素数）、
      halo（标记外面 0.32~0.50 格那一圈的亮度，有棋子照片时应该是暗的 / 白的）。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.RAPACEGO_CDP_PORT || 9334);

function fixtureBase64(name) {
  const p = path.join(ROOT_DIR, 'dev', 'fixtures', 'vision', name);
  return 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
}
const FIX = JSON.stringify({ full: { name: 'full19.jpg', url: fixtureBase64('full19.jpg') } });

async function getPage() {
  for (let i = 0; i < 60; i++) {
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
await send('Log.enable');

const PAGE = ('(async function(){\n'
  + 'const FIX = ' + FIX + ';\n'
  + 'const out = [];\n'
  + 'window.__probe = out;\n'
  + 'const say = (k, v) => out.push(k + " = " + v);\n'
  + 'const sleep = ms => new Promise(r => setTimeout(r, ms));\n'
  + 'const doc = id => document.getElementById(id);\n'

  + 'async function imgOf(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("decode")); im.src = url; }); }\n'
  + 'const im = await imgOf(FIX.full.url);\n'
  + 'visReset();\n'
  + 'vis.name = FIX.full.name;\n'
  + 'vis.src = visToImageData(im);\n'
  + 'vis.pl = "b";\n'
  + 'vis.dots = true;\n'
  + 'doc("vision").classList.add("open");\n'
  + 'await visAnalyze();\n'
  + 'const r = vis.res;\n'
  + 'const cv = doc("vis-canvas");\n'
  + 'const g2 = cv.getContext("2d");\n'
  + 'say("geom", r.nx + "x" + r.ny + " cell=" + r.cell.toFixed(1) + " cv=" + cv.width);\n'

  /* ---- 采样：以交叉点为中心，取 0.62 格见方的方框，按"半径分环"统计 ---- */
  + 'function probe(i, j) {\n'
  + '  const cx = r.grid.xs[i], cy = r.grid.ys[j], c = r.cell;\n'
  + '  const R = Math.round(c * 0.62);\n'
  + '  const x0 = Math.round(cx) - R, y0 = Math.round(cy) - R, w = R * 2 + 1;\n'
  + '  const dd = g2.getImageData(x0, y0, w, w).data;\n'
  + '  const center = [], ringDark = [], ringLight = [], halo = [], green = [];\n'
  + '  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {\n'
  + '    const px = x0 + x + 0.5 - cx, py = y0 + y + 0.5 - cy;\n'
  + '    const d = Math.sqrt(px * px + py * py) / c;\n'   /* 以"格"为单位的半径 */
  + '    const k = (y * w + x) * 4;\n'
  + '    const R0 = dd[k], G0 = dd[k + 1], B0 = dd[k + 2];\n'
  + '    const lum = 0.299 * R0 + 0.587 * G0 + 0.114 * B0;\n'
  + '    if (d < 0.10) center.push(lum);\n'
  + '    if (d < 0.30) { if (lum < 90) ringDark.push(1); if (lum > 195) ringLight.push(1); }\n'
  + '    if (d >= 0.32 && d <= 0.50) halo.push(lum);\n'
  + '    if (d < 0.30 && G0 > R0 + 22 && G0 > B0 + 22) green.push(1);\n'
  + '  }\n'
  + '  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : -1;\n'
  + '  return { center: +mean(center).toFixed(1), dark: ringDark.length, light: ringLight.length,\n'
  + '    halo: +mean(halo).toFixed(1), greenPx: green.length };\n'
  + '}\n'
  + 'function show(tag, p) { say(tag, JSON.stringify(p)); }\n'

  /* ---- 挑样本：第一颗黑子 / 白子 / 干净空点；再加一个"空点手加子" ---- */
  + 'const unc = new Set(r.uncertain.map(u => u[0] + "," + u[1]));\n'
  + 'const val = (i, j) => visMatrix().board[j * r.nx + i];\n'
  + 'let B = null, W = null, E = null;\n'
  + 'for (let j = 2; j < r.ny - 2; j++) for (let i = 2; i < r.nx - 2; i++) {\n'
  + '  const v = val(i, j);\n'
  + '  if (v === Vision.BLACK && !B) B = [i, j];\n'
  + '  if (v === Vision.WHITE && !W) W = [i, j];\n'
  + '  if (v === Vision.EMPTY && !E && !unc.has(i + "," + j) && !unc.has((i + 1) + "," + j) && !unc.has((i - 1) + "," + j)) E = [i, j];\n'
  + '}\n'
  + 'say("picked", "B=" + B + " W=" + W + " E=" + E);\n'

  /* ---- ① 识别出的子（无悬停） ---- */
  + 'vis.hover = null; visPaintBoard(cv);\n'
  + 'show("识-黑", probe(B[0], B[1]));\n'
  + 'show("识-白", probe(W[0], W[1]));\n'
  + 'show("识-空", probe(E[0], E[1]));\n'

  /* ---- ② 悬停：中心会不会被绿色盖住（用户看到"绿点"） ---- */
  + 'vis.hover = B; visPaintBoard(cv);\n'
  + 'show("悬停黑", probe(B[0], B[1]));\n'
  + 'vis.hover = E; visPaintBoard(cv);\n'
  + 'show("悬停空", probe(E[0], E[1]));\n'
  + 'vis.hover = null; visPaintBoard(cv);\n'

  /* ---- ③ 手加子（走真代码：edits + 重画） ---- */
  + 'const kE = E[0] + "," + E[1];\n'
  + 'vis.edits.set(kE, Vision.BLACK); visPaintBoard(cv);\n'
  + 'show("手加-黑", probe(E[0], E[1]));\n'
  + 'vis.edits.set(kE, Vision.WHITE); visPaintBoard(cv);\n'
  + 'show("手加-白", probe(E[0], E[1]));\n'
  + 'vis.edits.delete(kE); visPaintBoard(cv);\n'

  /* ---- ④ 待确认橙圈的两种来源各一眼 ---- */
  + 'let U1 = null, U2 = null;\n'
  + 'for (const u of r.uncertain) {\n'
  + '  const v = val(u[0], u[1]);\n'
  + '  if (v !== Vision.EMPTY && !U1) U1 = u;\n'
  + '  if (v === Vision.EMPTY && !U2) U2 = u;\n'
  + '}\n'
  + 'say("uncSample", "有子低置信=" + U1 + " 空点可疑=" + U2 + " 总数=" + r.uncertain.length);\n'
  + 'if (U1) show("橙圈-有子", probe(U1[0], U1[1]));\n'
  + 'if (U2) show("橙圈-空点", probe(U2[0], U2[1]));\n'

  /* ---- ⑤ 把画布存成 PNG，人眼复核 ---- */
  + 'say("png", cv.toDataURL("image/png").length);\n'
  + 'window.__png = cv.toDataURL("image/png");\n'
  + 'return "done";\n'
  + '})()');

try { new Function('return ' + PAGE); } catch (e) { console.error('页面代码语法错: ' + e.message); process.exit(2); }

const r = await js(PAGE);
if (String(r).startsWith('ERR')) { console.error(r); process.exit(1); }
for (const line of await js('window.__probe.join("\\n")') ? String(await js('window.__probe.join("\\n")')).split('\n') : []) {
  console.log(line);
}
if (errs.length) console.log('\n页面报错:\n' + errs.join('\n'));
const png = await js('window.__png');
if (png && String(png).startsWith('data:image/png')) {
  const buf = Buffer.from(String(png).split(',')[1], 'base64');
  const p = path.join(ROOT_DIR, '_trash', '_probe_vismark.png');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log('\n画布已存: ' + p);
}
ws.close();
