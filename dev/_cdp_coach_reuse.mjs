/* 全盘讲解「复用复盘数据」+「打开棋谱就能看到讲解」的回归（2026-10-23 两个用户报障）。
   不需要真 KataGo（全部走复用），也不需要 LoGos。
   ① 老复盘文件（每手 100 次）遇上现在的 500 次设置 —— 必须仍然借得到，一个请求都不发
   ② 借来的搜索量要如实标在 histVisits 里（不能标成 500）
   ③ 打开带讲解的棋谱 → 自动摊成「全盘」，行数 = 讲过的条数
   ④ 讲解文件是空的时候要说话（不能静默留一个空框）
   ⑤ 阶段①算完的 turns 要能落成正式复盘（saveReviewFromTurns）
   ⑥ 单条「讲解这手」优先用复盘数据（不现场问 KataGo）—— 2026-10-23 用户要求
   ⑦ 有分支的棋谱：讲解按**线指纹**存，切分支不串、各存各的（同一个 .coach.json）
*/
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.PORT || 9335);
const DIR = process.env.RAPACEGO_RECORDS || '';
const NAME = 'P1vsP2-202610232200.sgf';

/* ---------- 夹具：一份 12 手的 19 路棋谱（黑先） ---------- */
const GTP = ['D4', 'Q16', 'D16', 'Q4', 'R6', 'C14', 'O17', 'F3', 'R14', 'C6', 'Q10', 'D10'];
function gtp2sgf(g) {
  const x = g.charCodeAt(0) - 65;
  const y = parseInt(g.slice(1), 10);
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + (19 - y));
}
const sgfBody = GTP.map((g, i) => ';' + (i % 2 ? 'W' : 'B') + '[' + gtp2sgf(g) + ']').join('');
const SGF = '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese]PB[P1]PW[P2]GN[复用测试]' + sgfBody + ')\n';

if (DIR) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, NAME), SGF, 'utf8');
  for (const suf of ['.review.json', '.coach.json']) {
    const f = path.join(DIR, NAME + suf);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

/* ---------- 连页面 ---------- */
async function getPage() {
  for (let i = 0; i < 80; i++) {
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
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(res => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.result?.exceptionDetails) return 'ERR: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
}
await send('Runtime.enable');

/* ---------- ① 打开棋谱，问页面要签名 / 指纹 / 手顺 ---------- */
const meta = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rd = await window.api.records.read(${JSON.stringify(NAME)});
  if (!rd || !rd.text) return { err: '读不到夹具棋谱' };
  applyRecord(parseSGF(rd.text), ${JSON.stringify(NAME)});
  await sleep(600);
  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi, size: N, maxVisits: reviewVisits(),
  };
  return {
    core: reviewEnvCore(base, analyzeModelName),
    full: reviewEnvSig(base, analyzeModelName),
    key: lineKeyOfList(lineGtpOf(state.moves)),
    moves: lineGtpOf(state.moves),
    n: state.moves.length,
    visits: reviewVisits(),
    recName: state.recName,
  };
})()`);
if (meta && meta.err) { console.log('★ ' + meta.err); process.exit(1); }
if (typeof meta === 'string' && meta.startsWith('ERR')) { console.log('★ ' + meta); process.exit(1); }

const n = meta.n;
const R = {};
R['⓿ 夹具打开'] = n + ' 手 · 指纹 ' + meta.key + ' · 当前设置每手 ' + meta.visits + ' 次';

/* ---------- ② 写一份「老复盘」：每手 100 次（和现在的设置不同） ---------- */
const oldEnv = meta.full.split('|');
oldEnv[1] = '100';
const turns = {};
for (let i = 0; i <= n; i++) {
  const cp = i < n ? (meta.moves[i][0] === 'W' ? 'W' : 'B')
    : (n && meta.moves[n - 1][0] === 'W' ? 'B' : 'W');
  const wr = 0.5 + 0.03 * Math.sin(i);
  turns[i] = {
    turn: i,
    root: { currentPlayer: cp, winrate: wr, scoreLead: 0.6 * Math.cos(i / 2), visits: 100 },
    moves: [{ move: 'Q10', order: 0, winrate: wr + 0.01 },
            { move: 'D4', order: 1, winrate: wr - 0.02 }],
    actualMove: i < n ? meta.moves[i].slice(1) : null,
  };
}
const doc = { v: 3, name: NAME.replace(/\.sgf$/i, ''), updated: Date.now(), lines: {} };
doc.lines[meta.key] = {
  key: meta.key, moves: meta.moves, n, env: oldEnv.join('|'), sig: oldEnv.join('|') + '|' + meta.key,
  visits: 100, source: 'review', turns,
};
if (DIR) fs.writeFileSync(path.join(DIR, NAME + '.review.json'), JSON.stringify(doc), 'utf8');

/* 顺便写一份 coach（12 条）—— 用来验③ */
const list = [null];
for (let i = 1; i <= n; i++) {
  list.push({ head: '第 ' + i + ' 手 · 测试', verdict: '亏了 0.1% 胜率', ok: false,
              lead: 'AI 当时想下的是 Q10；实际下的是 ' + meta.moves[i - 1].slice(1) + '。',
              body: '这是第 ' + i + ' 手的测试讲解正文，用来验证打开棋谱时能不能直接看到。' });
}
if (DIR) fs.writeFileSync(path.join(DIR, NAME + '.coach.json'), JSON.stringify({ v: 1, n, list }), 'utf8');

/* ---------- ③ 复用：一个请求都不该发 ---------- */
const reuse = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  state.reviewDoc = null;                    /* 强制重新读盘（模拟「重开棋谱」） */
  const t0 = performance.now();
  const got = await coachTurnsForLine(gameGen);
  const ms = Math.round(performance.now() - t0);
  const filled = (got.turns || []).filter(Boolean).length;
  return {
    ok: got.ok, computed: got.computed, reused: got.reused, visits: got.visits,
    borrowed: got.borrowed, incomplete: got.incomplete, filled, ms,
    need: state.moves.length + 1,
    histVisits0: (state.histVisits || [])[0],
    histAll100: (state.histVisits || []).every(v => v === 100),
    histLen: (state.histVisits || []).length,
  };
})()`);

R['① 复用成功（ok）'] = reuse && reuse.ok ? '✓' : ('★ ' + JSON.stringify(reuse));
R['① 没有让引擎重算（computed=false）'] = reuse && reuse.computed === false ? '✓ 一个请求都没发' : '★ 又算了';
R['① 借到的回合数 = n+1'] = (reuse && reuse.reused === reuse.need) ? ('✓ ' + reuse.reused + '/' + reuse.need) : ('★ ' + (reuse && reuse.reused) + '/' + (reuse && reuse.need));
R['① 回合数据齐（无 null）'] = (reuse && reuse.filled === reuse.need) ? ('✓ ' + reuse.filled) : ('★ ' + (reuse && reuse.filled));
R['① 沿用了老复盘的搜索量 100'] = (reuse && reuse.visits === 100 && reuse.borrowed === 100) ? '✓' : ('★ visits=' + (reuse && reuse.visits) + ' borrowed=' + (reuse && reuse.borrowed));
R['① 耗时 < 3 秒'] = (reuse && reuse.ms < 3000) ? ('✓ ' + reuse.ms + 'ms') : ('★ ' + (reuse && reuse.ms) + 'ms');
R['② 精度标记如实（不冒充 500）'] = (reuse && reuse.histLen === reuse.need && reuse.histAll100) ? '✓ 全 100' : ('★ ' + (reuse && reuse.histVisits0) + ' / 长度 ' + (reuse && reuse.histLen));

/* ---------- ④ 打开棋谱 → 自动摊成全盘 ---------- */
const open = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rd = await window.api.records.read(${JSON.stringify(NAME)});
  applyRecord(parseSGF(rd.text), ${JSON.stringify(NAME)});
  await sleep(1200);
  const body = document.getElementById('explain-body');
  return {
    explainN: Object.keys(state.coach.explain || {}).length,
    allView: !!state.coach.allView,
    rows: body ? body.querySelectorAll('.all-row').length : -1,
    allHidden: (document.getElementById('btn-all') || {}).hidden,
    txt: body ? (body.textContent || '').replace(/\\s+/g, ' ').slice(0, 400) : '',
  };
})()`);

R['③ 打开后讲解条数'] = (open && open.explainN === n) ? ('✓ ' + open.explainN) : ('★ ' + (open && open.explainN) + ' / 期望 ' + n);
R['③ 自动摊成「全盘」'] = open && open.allView ? '✓' : '★ 还停在单手视图';
R['③ 全盘行数'] = (open && open.rows === n) ? ('✓ ' + open.rows) : ('★ ' + (open && open.rows));
R['③ 「看全盘／返回」链接可见'] = (open && open.allHidden === false) ? '✓' : '★ hidden';
R['③ 页面上读到正文'] = (open && open.txt.indexOf('测试讲解正文') >= 0) ? '✓' : ('★ ' + (open && open.txt));

/* ---------- ⑤ 空讲解文件要说话 ---------- */
if (DIR) fs.writeFileSync(path.join(DIR, NAME + '.coach.json'), JSON.stringify({ v: 1, n, list: [null] }), 'utf8');
const empty = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rd = await window.api.records.read(${JSON.stringify(NAME)});
  applyRecord(parseSGF(rd.text), ${JSON.stringify(NAME)});
  await sleep(1200);
  const f = document.getElementById('status');
  return { flash: f ? (f.textContent || '').replace(/\\s+/g, ' ') : '',
           explainN: Object.keys(state.coach.explain || {}).length };
})()`);
R['④ 空文件时给出提示'] = (empty && empty.flash.indexOf('空的') >= 0) ? ('✓「' + empty.flash + '」') : ('★ ' + JSON.stringify(empty));
R['④ 空文件时没有假讲解'] = (empty && empty.explainN === 0) ? '✓' : ('★ ' + (empty && empty.explainN));

/* ---------- ⑥ 阶段①算完的 turns 能落成正式复盘 ---------- */
const saved = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const myList = lineGtpOf(state.moves);
  const n2 = state.moves.length;
  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi, size: N, maxVisits: 100,
  };
  const env = reviewEnvSig(base, analyzeModelName);
  const tk = [];
  for (let i = 0; i <= n2; i++) {
    tk.push({ turn: i, root: { currentPlayer: i < n2 ? (state.moves[i].color === 'w' ? 'W' : 'B') : 'W',
      winrate: 0.5, scoreLead: 0, visits: 100 },
      moves: [{ move: 'Q10', order: 0, winrate: 0.51 }], actualMove: null });
  }
  /* 先把仓库清空（模拟「这盘还没有任何复盘文件」） */
  const w1 = await saveReviewFromTurns(state.recName, myList, n2, env, 100, tk, emptyReviewDoc(state.recName));
  const again = await saveReviewFromTurns(state.recName, myList, n2, env, 100, tk, state.reviewDoc);
  return { wrote: w1, secondTime: again };
})()`);
R['⑤ 算完落成复盘'] = saved && saved.wrote === true ? '✓' : ('★ ' + JSON.stringify(saved));
R['⑤ 已有正式复盘时不重复写'] = saved && saved.secondTime === false ? '✓' : ('★ ' + JSON.stringify(saved));

/* 读盘确认 */
if (DIR) {
  try {
    const back = JSON.parse(fs.readFileSync(path.join(DIR, NAME + '.review.json'), 'utf8'));
    const k = Object.keys(back.lines || {});
    const L = back.lines[k[0]] || {};
    R['⑤ 文件里是正式复盘'] = (L.source === 'review' && L.turns && Object.keys(L.turns).length === n + 1)
      ? ('✓ source=' + L.source + ' · turns=' + Object.keys(L.turns).length + ' · visits=' + L.visits)
      : ('★ ' + JSON.stringify({ source: L.source, turns: L.turns ? Object.keys(L.turns).length : null }));
    R['⑤ 文件里有报告（losses）'] = (L.report && Array.isArray(L.report.losses)) ? '✓' : '★ 没有 report';
  } catch (e) { R['⑤ 读回文件'] = '★ ' + e.message; }
}

/* ---------- ⑦ 单条「讲解这手」优先用复盘数据（2026-10-23 用户要求） ----------
   ★ 判据设计：把 coachReady 强行置 true（放行 LoGos 守卫），同时把 engineReady 置 false。
     如果它还是去现场问 KataGo，就会卡在「先把 KataGo 加载起来」那句话上 ——
     所以「页面上出现『数字用的是复盘数据』」就等于证明了没走 api.analyze。 */
const single = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
  coachReady = true; engineReady = false;
  const rv = await reviewCandidatesAt(6);
  state.viewAt = 5; syncUI(); await sleep(200);
  const body = document.getElementById('explain-body');
  if (body) body.textContent = '';
  runAnalysisExplain();
  let txt = '';
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    txt = body ? (body.textContent || '') : '';
    if (txt.indexOf('复盘数据') >= 0 || txt.indexOf('加载起来') >= 0) break;
  }
  coachReady = false; engineReady = false;
  return {
    ok: !!(rv && rv.from === 'review'), visits: rv && rv.visits,
    move: rv && rv.list && rv.list[0] && rv.list[0].move,
    len: rv && rv.list ? rv.list.length : 0,
    txt: (txt || '').replace(/\\s+/g, ' ').slice(0, 300),
  };
  } catch (e) {
    coachReady = false; engineReady = false;
    return { err: String((e && e.stack) || e).slice(0, 500) };
  }
})()`);
R['⑥ 复盘里取到候选点'] = (single && single.ok && single.len > 0)
  ? ('✓ ' + single.len + ' 个 · 首选 ' + single.move) : ('★ ' + JSON.stringify(single));
R['⑥ 沿用复盘那一档搜索量（100）'] = (single && single.visits === 100) ? '✓' : ('★ ' + (single && single.visits));
R['⑥ 页面说明「数字用的是复盘数据」'] = (single && String(single.txt).indexOf('复盘数据') >= 0)
  ? ('✓ ' + String(single.txt).slice(0, 90)) : ('★ ' + (single && single.txt));
R['⑥ 没去问 KataGo（KataGo 未就绪也能走完）'] = (single && String(single.txt).indexOf('加载起来') < 0)
  ? '✓' : ('★ 还在要 KataGo');

/* ---------- ⑧ 有分支的棋谱：讲解按线存 / 切分支不串 ---------- */
const BNAME = 'BRANCH-20261023.sgf';
const BSGF = '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese]PB[P1]PW[P2]GN[branch]'
  + ';B[pd];W[dp];B[pp];W[dd](;B[qp];W[oq];B[np])(;B[qq];W[pq];B[or]))\n';
if (DIR) {
  fs.writeFileSync(path.join(DIR, BNAME), BSGF, 'utf8');
  for (const suf of ['.review.json', '.coach.json']) {
    const f = path.join(DIR, BNAME + suf);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
const branch = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rd = await window.api.records.read(${JSON.stringify(BNAME)});
  applyRecord(parseSGF(rd.text), ${JSON.stringify(BNAME)});
  await sleep(1200);
  const kMain = coachLineKey();
  const nMain = state.moves.length;
  enterCoachLine();
  state.coach.explain[3] = { head: '第 3 手', verdict: '', lead: '', body: '主分支第 3 手' };
  state.coach.explain[5] = { head: '第 5 手', verdict: '', lead: '', body: '主分支第 5 手' };
  await saveCoachFile();
  state.viewAt = 5; syncUI(); await sleep(150);
  switchVariation(1);
  await sleep(700);
  const kBr = coachLineKey();
  const brN = state.moves.length;
  const brBox = Object.keys(state.coach.explain || {}).length;
  const brTxt = (document.getElementById('status') || {}).textContent || '';
  state.coach.explain[3] = { head: '第 3 手', verdict: '', lead: '', body: '分支 B 第 3 手' };
  await saveCoachFile();
  switchVariation(-1);
  await sleep(700);
  return {
    kMain: kMain, kBr: kBr, nMain: nMain, brN: brN,
    sameKey: kMain === kBr,
    brBox: brBox,
    brTxt: (brTxt || '').replace(/\\s+/g, ' ').slice(0, 120),
    backKey: coachLineKey(),
    backN: Object.keys(state.coach.explain || {}).length,
    backBody: (state.coach.explain[3] || {}).body || '',
    backHas5: !!(state.coach.explain[5] && state.coach.explain[5].body),
  };
})()`);
R['⑦ 两条分支的线指纹不同（同手数也不混）'] = (branch && branch.sameKey === false) ? '✓' : ('★ ' + JSON.stringify(branch && branch.kMain));
R['⑦ 切到新分支后讲解是空的（不串上一条线）'] = (branch && branch.brBox === 0) ? '✓' : ('★ 还剩 ' + (branch && branch.brBox) + ' 条');
/* ★ 2026-10-24：状态栏文案压短了（顶栏只占一行），这句从「这条分支还没讲」改成「讲解没讲过」。 */
R['⑦ 切过去时说了「这条线没讲过」'] = (branch && String(branch.brTxt).indexOf('没讲过') >= 0)
  ? ('✓「' + branch.brTxt + '」') : ('★ ' + (branch && branch.brTxt));
R['⑦ 切回主分支 / 讲解恢复'] = (branch && branch.backKey === branch.kMain && branch.backBody === '主分支第 3 手' && branch.backHas5)
  ? ('✓ ' + branch.backN + ' 条都在') : ('★ ' + JSON.stringify(branch));

/* 落盘文件：v2 + lines 里两条线各存各的 */
if (DIR) {
  try {
    const bf = JSON.parse(fs.readFileSync(path.join(DIR, BNAME + '.coach.json'), 'utf8'));
    const keys = Object.keys(bf.lines || {});
    const bodies = keys.map(k => {
      const arr = (bf.lines[k] || {}).list || [];
      return [].concat(arr).filter(x => x && x.body).map(x => x.body);
    });
    const flat = [].concat(...bodies).join(' | ');
    R['⑦ 文件是 v2（按线存）'] = (bf.v === 2 && Array.isArray(bf.list)) ? ('✓ v=' + bf.v) : ('★ v=' + bf.v);
    R['⑦ 文件里两条线都在'] = (keys.length === 2) ? ('✓ ' + keys.length + ' 条') : ('★ ' + keys.length + ' 条');
    R['⑦ 两条线的正文各归各'] = (flat.indexOf('主分支第 3 手') >= 0 && flat.indexOf('分支 B 第 3 手') >= 0
      && flat.indexOf('主分支第 5 手') >= 0) ? ('✓ ' + flat) : ('★ ' + flat);
    R['⑦ 每条线记着自己的手数'] = keys.every(k => typeof (bf.lines[k] || {}).n === 'number')
      ? ('✓ ' + keys.map(k => bf.lines[k].n).join(' / ')) : '★ n 缺失';
  } catch (e) { R['⑦ 读回讲解文件'] = '★ ' + e.message; }
}

/* ---------- ⑧ 布局：一块正文区、三个按钮（2026-10-24 用户要求）----------
   ★ 项目纪律：视觉问题量**真实几何**，不查 hidden === false。
     这一节只量位置/尺寸，外加「同一时刻只有一页可见」。 */
const layout = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const box = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  const card = document.getElementById('coach-card');
  const sc = document.getElementById('coach-scroll');
  const acts = document.querySelector('.coach-acts');
  if (!card || !sc || !acts) return { missing: true };
  const ex = document.getElementById('explain-body');
  const pk = document.getElementById('pick-sec');
  const titleEl = document.getElementById('coach-title');
  /* 打开棋谱的状态 → 「全盘讲解」也露出来（三个按钮同时出现 = 最挤的情况） */
  document.getElementById('btn-batch').hidden = false;

  state.coach.view = 'explain'; state.coach.allView = false;
  renderCoachPanels(true); await sleep(140);
  const exVis = box(ex).h > 8, pkVis0 = box(pk).h > 8;
  const title0 = titleEl.textContent;

  state.coach.view = 'pick'; renderCoachPanels(true); await sleep(140);
  const exVis2 = box(ex).h > 8, pkVis = box(pk).h > 8;
  const title1 = titleEl.textContent;

  state.coach.view = 'explain'; renderCoachPanels(true); await sleep(140);
  const btns = [...acts.querySelectorAll('button')].filter(b => !b.hidden);
  const cb = card.getBoundingClientRect();
  const left = document.querySelector('.left');
  const cards = [...left.children].filter(c => !c.hidden);
  return {
    leftCards: cards.length,
    cardH: Math.round(cb.height),
    scrollW: sc.clientWidth, scrollSW: sc.scrollWidth,
    bothInScroll: !!(sc.contains(ex) && sc.contains(pk)),
    exVis: exVis, pkVis0: pkVis0, exVis2: exVis2, pkVis: pkVis,
    title0: title0, title1: title1,
    btnN: btns.length,
    btnOneRow: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size,
    btnTexts: btns.map(b => b.textContent).join('/'),
    btnWrap: btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent).join(',') || '',
    btnOverflow: btns.some(b => b.getBoundingClientRect().right > cb.right - 1),
    btnBelowScroll: btns.every(b => b.getBoundingClientRect().top >= box(sc).bottom - 1),
    btnW: btns.map(b => Math.round(b.getBoundingClientRect().width)).join('/'),
    btnSum: Math.round(btns.reduce((t, b) => t + b.getBoundingClientRect().width, 0)),
    actsW: Math.round(acts.getBoundingClientRect().width),
  };
})()`);
const L8 = layout && !layout.missing ? layout : null;
R['⑧ 左栏只剩 2 张常驻卡（手数 + 讲解卡）'] = L8 && L8.leftCards === 2 ? '✓' : ('★ ' + (L8 && L8.leftCards));
R['⑧ 讲解卡比原来单张高（>300px）'] = L8 && L8.cardH > 300 ? ('✓ ' + L8.cardH + 'px') : ('★ ' + (L8 && L8.cardH));
R['⑧ 两页正文在同一个滚动区里'] = L8 && L8.bothInScroll ? '✓' : '★ 不在';
R['⑧ 分析讲解那一页：只有它可见'] = L8 && L8.exVis && !L8.pkVis0 ? '✓' : ('★ ' + JSON.stringify({ ex: L8 && L8.exVis, pk: L8 && L8.pkVis0 }));
R['⑧ 推荐落点那一页：只换成它（分析讲解收起）'] = L8 && L8.pkVis && !L8.exVis2 ? '✓' : ('★ ' + JSON.stringify({ ex: L8 && L8.exVis2, pk: L8 && L8.pkVis }));
R['⑧ 卡片标题跟着换（分析讲解 → 推荐落点讲解）'] = L8 && L8.title0 === '分析讲解' && L8.title1 === '推荐落点讲解'
  ? ('✓ ' + L8.title0 + ' → ' + L8.title1) : ('★ ' + (L8 && L8.title0) + ' → ' + (L8 && L8.title1));
R['⑧ 滚动区没有横向滚动条'] = L8 && L8.scrollSW <= L8.scrollW + 1 ? '✓' : ('★ ' + (L8 && L8.scrollSW + ' > ' + L8.scrollW));
R['⑧ 三个按钮都在（全盘/这手/落点）'] = L8 && L8.btnN === 3 && L8.btnTexts === '全盘讲解/讲解这手/推荐落点讲解'
  ? '✓' : ('★ ' + (L8 && L8.btnTexts));
R['⑧ 三个按钮排在同一行'] = L8 && L8.btnOneRow === 1 ? '✓' : ('★ ' + (L8 && L8.btnOneRow) + ' 行');
R['⑧ 按钮文字都不折行'] = L8 && !L8.btnWrap ? '✓' : ('★ 折了：' + (L8 && L8.btnWrap));
R['⑧ 按钮没有溢出卡片右边界'] = L8 && !L8.btnOverflow ? '✓' : '★ 溢出';
R['⑧ 按钮在滚动区下方（卡片最下面一行）'] = L8 && L8.btnBelowScroll ? '✓' : '★ 不在下面';
R['⑧ 按钮总宽放得下（' + (L8 && L8.btnW) + '）'] = L8 && L8.btnSum <= L8.actsW
  ? ('✓ ' + L8.btnSum + ' ≤ ' + L8.actsW) : ('★ ' + (L8 && L8.btnSum) + ' > ' + (L8 && L8.actsW));
/* 恢复：把「全盘讲解」藏回去（对局态本来就不显示），别影响后面的用例 */
await js(`(function(){ const b = document.getElementById('btn-batch'); if (b && !state.fromRecord) b.hidden = true; renderCoachPanels(true); return 1; })()`);

/* ---------- ⑨ 「讲解这手」：讲过的直接显示，不再问 LoGos ----------
   判据设计：把 LoGos / KataGo 两盏灯都置 false。如果它还想去生成，
   needEngine 会拦下并 flash 「还没加载」—— 所以「页面上出现了缓存里的正文」
   就等于证明了它一个请求都没发。 */
const cacheEx = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const at = state.moves.length;
  state.viewAt = at; state.coach.allView = false; state.coach.view = 'explain';
  state.coach.explain[at] = { head: '第 ' + at + ' 手 · 缓存', verdict: '缓存里的评价', ok: true,
    lead: '', body: '这是一段早就讲好的正文（缓存命中标记）' };
  coachReady = false; engineReady = false;
  renderCoachPanels(true);
  $('btn-explain').click();
  await sleep(300);
  const body = document.getElementById('explain-body');
  const st = document.getElementById('status');
  return {
    txt: (body.textContent || ''), view: state.coach.view,
    disabled: $('btn-explain').disabled,
    title: document.getElementById('coach-title').textContent,
    flash: st ? (st.textContent || '') : '',
  };
})()`);
R['⑨ 缓存命中：正文直接出来'] = cacheEx && cacheEx.txt.indexOf('缓存命中标记') >= 0
  ? '✓ ' + cacheEx.txt.replace(/\s+/g, ' ').slice(0, 40) : ('★ ' + (cacheEx && cacheEx.txt));
R['⑨ 没有弹「引擎还没加载」'] = cacheEx && cacheEx.flash.indexOf('还没加载') < 0 ? '✓' : ('★ ' + (cacheEx && cacheEx.flash));
R['⑨ 没有停在「讲解中…」（没发请求）'] = cacheEx && cacheEx.disabled === false ? '✓' : '★ 按钮还是灰的';
R['⑨ 切回「分析讲解」那一页'] = cacheEx && cacheEx.view === 'explain' && cacheEx.title === '分析讲解'
  ? '✓' : ('★ ' + (cacheEx && cacheEx.view) + ' / ' + (cacheEx && cacheEx.title));

/* ---------- ⑩ 「推荐落点讲解」：同一个局面讲过的也直接显示 ---------- */
const cachePk = await js(`(async function(){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const at = state.viewAt;
  const key = pickPositionKey(at);
  state.coach.picks[key] = { at: at, side: 'b', positionKey: key, gen: gameGen,
    pts: [{ title: '推荐 1 · Q10（胜率 50.0%）', body: '缓存里的选点讲解正文（命中标记）' }] };
  state.coach.pick = state.coach.picks[key];
  coachReady = false; engineReady = false;
  $('btn-pick').click();
  await sleep(300);
  const pk = document.getElementById('pick-sec');
  const ex = document.getElementById('explain-body');
  return {
    txt: (document.getElementById('pick-body').textContent || ''),
    view: state.coach.view,
    pickH: Math.round(pk.getBoundingClientRect().height),
    exH: Math.round(ex.getBoundingClientRect().height),
    title: document.getElementById('coach-title').textContent,
    disabled: $('btn-pick').disabled,
  };
})()`);
R['⑩ 缓存命中：选点正文直接出来'] = cachePk && cachePk.txt.indexOf('命中标记') >= 0
  ? '✓ ' + cachePk.txt.replace(/\s+/g, ' ').slice(0, 40) : ('★ ' + (cachePk && cachePk.txt));
R['⑩ 切到推荐落点那一页（分析讲解收起）'] = cachePk && cachePk.view === 'pick'
  && cachePk.pickH > 8 && cachePk.exH < 1 ? '✓' : ('★ ' + JSON.stringify(cachePk));
R['⑩ 标题变成「推荐落点讲解」'] = cachePk && cachePk.title === '推荐落点讲解' ? '✓' : ('★ ' + (cachePk && cachePk.title));
R['⑩ 没有重复让 LoGos 讲（按钮没灰）'] = cachePk && cachePk.disabled === false ? '✓' : '★ 按钮还是灰的';
/* 还原：切回分析讲解页，并把这份假缓存清掉 */
await js(`(function(){ state.coach.view = 'explain'; state.coach.allView = false;
  state.coach.picks = {}; state.coach.pick = null; renderCoachPanels(true); return 1; })()`);

/* ---------- ⑪ 切手数：推荐落点讲解必须跟着换（2026-10-24 晚用户报的 bug）----------
   ★ 判据：给两个**不同**局面各塞一份缓存，正文必须跟着 viewAt 走；
     切到没讲过的那一手必须变空状态并说清「这一手还没有」，绝不能挂着上一手的正文。
     旧代码这里读的是 state.coach.pick（最后生成的那一份）→ 切手数纹丝不动，正是报障点。 */
const switchPk = await js(`(async function(){
  const n = state.moves.length;
  if (n < 4) return { skip: '手数不够（' + n + '）' };
  const A = n - 2, B = n - 1, C = n;          /* C 故意不讲 */
  const mk = function (at, tag) {
    const key = pickPositionKey(at);
    return { at: at, side: 'b', positionKey: key, gen: gameGen,
      pts: [{ title: '推荐 1 · ' + tag, body: '正文-' + tag }] };
  };
  state.coach.picks = {};
  state.coach.picks[pickPositionKey(A)] = mk(A, 'AAA');
  state.coach.picks[pickPositionKey(B)] = mk(B, 'BBB');
  state.coach.pick = state.coach.picks[pickPositionKey(B)];   /* 最后生成的是 B：旧代码就卡在这份 */
  state.coach.pickPending = null;
  state.coach.view = 'pick'; state.coach.allView = false;
  const one = function (at) {
    state.viewAt = at; coachRenderedAt = -999; renderCoachPanels(true);
    const ctxEl = document.getElementById('pick-context');
    return { txt: document.getElementById('pick-body').textContent || '',
      ctx: (ctxEl.textContent || ''), ctxHidden: !!ctxEl.hidden };
  };
  const rA = one(A), rB = one(B), rC = one(C), rA2 = one(A);
  state.coach.view = 'explain'; state.coach.allView = false;
  state.coach.picks = {}; state.coach.pick = null;
  renderCoachPanels(true);
  return { A: A, B: B, C: C, rA: rA, rB: rB, rC: rC, rA2: rA2 };
})()`);
R['⑪ A 手：显示 A 那份'] = switchPk && switchPk.rA && switchPk.rA.txt.indexOf('正文-AAA') >= 0
  ? '✓' : ('★ ' + JSON.stringify(switchPk && switchPk.rA));
R['⑪ 切到 B 手：换成 B 那份'] = switchPk && switchPk.rB
  && switchPk.rB.txt.indexOf('正文-BBB') >= 0 && switchPk.rB.txt.indexOf('AAA') < 0
  ? '✓' : ('★ ' + JSON.stringify(switchPk && switchPk.rB));
R['⑪ 上下文小字跟着换（第 N 手后）'] = switchPk && switchPk.rB
  && switchPk.rB.ctx.indexOf('第 ' + switchPk.B + ' 手后') >= 0
  ? ('✓ ' + switchPk.rB.ctx) : ('★ ' + JSON.stringify(switchPk && switchPk.rB && switchPk.rB.ctx));
R['⑪ 切到没讲过的 C 手：不再挂着 B 的正文'] = switchPk && switchPk.rC
  && switchPk.rC.txt.indexOf('AAA') < 0 && switchPk.rC.txt.indexOf('BBB') < 0
  && switchPk.rC.txt.indexOf('还没有推荐落点讲解') >= 0
  ? '✓ ' : ('★ ' + JSON.stringify(switchPk && switchPk.rC));
R['⑪ 切回 A 手：还是 A 那份（没被最后生成的覆盖）'] = switchPk && switchPk.rA2
  && switchPk.rA2.txt.indexOf('正文-AAA') >= 0 ? '✓' : ('★ ' + JSON.stringify(switchPk && switchPk.rA2));

/* ---------- 输出 ---------- */
let pass = 0, fail = 0;
for (const k of Object.keys(R)) {
  const v = String(R[k]);
  if (v.startsWith('★')) fail++; else pass++;
  console.log((v.startsWith('★') ? '  ' : '  ') + k + ' → ' + v);
}
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
ws.close();
process.exit(fail ? 1 : 0);
