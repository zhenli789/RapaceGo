/* 出图：识谱面板改完之后的样子（人眼复核用，不参与断言）
   用法（同一条 bash 里先起 Electron）：
     RAPACEGO_* 见 _cdp_vision.mjs；端口默认 9335
   要看到三件事：① 识别出来的黑白子就是棋子 ② 空点上手加的子长得一样
                ③ C7 那种"漏检"是橙色虚线圈 + 悬停文字说明
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.RAPACEGO_CDP_PORT || 9335);
const url = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT_DIR, 'dev/fixtures/vision/full19.jpg')).toString('base64');

const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result && r.result.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception || {}).description;
  return r.result && r.result.result ? r.result.result.value : undefined;
};

const code = '(async function(){\n'
  + 'const sleep = ms => new Promise(r => setTimeout(r, ms));\n'
  + 'const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "' + url + '"; });\n'
  + 'visReset(); vis.name = "full19.jpg"; vis.src = visToImageData(im); vis.pl = "b"; vis.dots = true;\n'
  + 'document.getElementById("vision").classList.add("open");\n'
  + 'await visAnalyze();\n'
  + 'await sleep(200);\n'
  /* 在 G7 那个空点上手加一颗黑子（模拟用户说的"点其他空子加子"） */
  + 'const r = vis.res;\n'
  + 'let p = null;\n'
  + 'for (let j = 4; j < 10 && !p; j++) for (let i = 5; i < 10 && !p; i++)\n'
  + '  if (visMatrix().board[j * r.nx + i] === Vision.EMPTY && !r.uncertain.some(u => u[0] === i && u[1] === j)) p = [i, j];\n'
  + 'if (p) vis.edits.set(p[0] + "," + p[1], Vision.BLACK);\n'
  /* 悬停在 C7（那颗"漏检"的白子上），好让下面的提示文字一起入镜 */
  + 'vis.hover = [2, 12];\n'
  + 'visPaintBoard(document.getElementById("vis-canvas"));\n'
  + 'visHoverTip([2, 12]);\n'
  + 'window.__p = p;\n'
  + 'return "ok " + p;\n'
  + '})()';
console.log(await js(code));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  const out = path.join(ROOT_DIR, '_trash', '_shot_vis_mark.png');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('截图: ' + out);
} else {
  console.log('截图失败: ' + JSON.stringify(shot).slice(0, 200));
}
ws.close();
