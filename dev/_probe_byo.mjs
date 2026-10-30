/* 探针：对弈读秒到底走不走（2026-10-30 用户报「读秒好像没效果」）
   不判「代码看起来对不对」，只量真实状态：phase / 剩余秒 / 读秒次数 / 界面文字 / 颜色类。
   两段：
     ① 摆棋模式（不受 AI 抢手干扰）—— 主时间→读秒→读秒次数递减→用尽判负
     ② 人机对弈 —— 同上，但中间有 AI 落子，看读秒会不会被抢手吃掉
   ★ 时间幅度全部压缩：主时间 1s、读秒 2s，便于几秒内跑完。 */
const PORT = 9333;
async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('连不上调试端口');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push('异常: ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
  }
};
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

const out = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const dom = () => ({
    b: $('ctime-b').textContent, w: $('ctime-w').textContent,
    nb: $('cid-b').textContent, nw: $('cid-w').textContent,
    cb: $('clock-b').className, cw: $('clock-w').className,
  });
  const snap = () => {
    const c = state.clock;
    const d = clockDisplay(c.side);
    return 't=' + ((performance.now() - c.since) / 1000).toFixed(1) + 's'
      + ' phase=' + c.phase
      + ' side=' + c.side
      + ' bt=' + c.b.t.toFixed(2) + ' bn=' + c.b.n
      + ' wt=' + c.w.t.toFixed(2) + ' wn=' + c.w.n
      + ' byo=' + c.byo
      + ' disp=' + d.phase + '/' + d.sec.toFixed(1) + '/n' + d.n
      + ' | DOM ' + JSON.stringify(dom());
  };
  const R = {};

  /* ========== ① 摆棋：主时间 1s、读秒 2s×3 ========== */
  settings.clock = 'rapid'; settings.mode = 'free';
  applyNewGame(); await sleep(300);
  const P = { on: state.clock.on, main: state.clock.main, byo: state.clock.byo, byoN: state.clock.byoN, add: state.clock.add };
  R['① 档位读到的预设'] = 'on=' + P.on + ' main=' + P.main + ' byo=' + P.byo + ' byoN=' + P.byoN + ' add=' + P.add;
  const c = state.clock;
  c.b.t = 1.0; c.w.t = 60; c.byo = 2; c.b.n = 3; c.w.n = 3;
  c.since = performance.now(); c.running = true; c.phase = 'main'; c.side = 'b';
  let beeps = 0; try { window.playBeep = function () { beeps++; }; } catch (e) { }
  R['① 起点'] = snap();
  const tl = [];
  for (let i = 0; i < 20; i++) { await sleep(500); tl.push(snap()); }
  R['① 时间线（每 0.5s）'] = tl;
  R['① 读秒音次数'] = beeps;

  /* ========== ② 人机对弈：同样压缩时间，看 AI 抢手会不会吃掉读秒 ========== */
  state.result = null;
  settings.mode = 'play'; settings.color = 'b';
  applyNewGame(); await sleep(400);
  const c2 = state.clock;
  c2.b.t = 1.0; c2.w.t = 60; c2.byo = 2; c2.b.n = 3; c2.w.n = 3;
  c2.since = performance.now(); c2.running = true; c2.phase = 'main'; c2.side = 'b';
  beeps = 0;
  R['② 起点'] = snap();
  const tl2 = [];
  for (let i = 0; i < 16; i++) { await sleep(500); tl2.push('moves=' + state.moves.length + ' ' + snap()); }
  R['② 时间线（每 0.5s）'] = tl2;
  R['② 读秒音次数'] = beeps;
  R['② 结果'] = state.result ? JSON.stringify(state.result) : '（无）';

  return JSON.stringify(R, null, 1);
})()`);
await new Promise(r => setTimeout(r, 500));
console.log(out);
console.log('');
console.log('=== 运行时错误 ===');
console.log(errs.length ? errs.join('\n') : '（无）');
ws.close();
process.exit(0);
