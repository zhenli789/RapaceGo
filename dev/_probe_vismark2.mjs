/* 一次性小探针：问清楚 C7（uncertain 空点）中心那一坨**到底是什么颜色、谁画的** */
const PORT = Number(process.env.RAPACEGO_CDP_PORT || 9334);
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.result && r.result.exceptionDetails) return 'ERR: ' + r.result.exceptionDetails.text;
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const code = `(function(){
  const r = vis.res; const cv = document.getElementById('vis-canvas');
  const g = cv.getContext('2d');
  const i = 2, j = 12;
  const cx = r.grid.xs[i], cy = r.grid.ys[j];
  const px = (x, y) => { const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]]; };
  const out = [];
  out.push('center ' + JSON.stringify(px(cx, cy)));
  for (const d of [2, 4, 6, 8, 10, 12, 14, 16, 18]) out.push('r=' + d + ' up ' + JSON.stringify(px(cx, cy - d)));
  out.push('hover=' + JSON.stringify(vis.hover) + ' dots=' + vis.dots + ' edits=' + vis.edits.size);
  out.push('cell=' + r.cell.toFixed(2) + ' nx=' + r.nx);
  out.push('unc=' + JSON.stringify(r.uncertain));
  out.push('board@2,12=' + visMatrix().board[12 * r.nx + 2]);
  return out.join(' | ');
})()`;
console.log(await js(code));
ws.close();
