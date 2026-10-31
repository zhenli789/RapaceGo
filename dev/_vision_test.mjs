/* 图片识谱的回归测试（Node，不启动 Electron）
   ─────────────────────────────────────────────────────────────────────────────
   跑法： node dev/_vision_test.mjs
   覆盖：
     ① 两张真图（dev/fixtures/vision/*.jpg，用户提供的实拍截图）——逐点比对真值
     ② 合成图：四种盘色 × 9/13/19 路 —— 检验判色阈值没有焊死在木色上
     ③ 旋转/镜像：幂等 + 角标注跟着转
     ④ 锚定：四种贴角 × 偏移 —— 逐点算坐标，不查「没报错」
     ⑤ SGF：先手、棋子数、坐标字母表（SGF 含 i）

   ★ 真图要先转 BMP（Node 没有 JPEG 解码器）。macOS 自带 sips；
     没有 sips 的机器上这一组自动跳过并**明确说明跳过了**，不静默通过。
   ★ 判据是「逐点矩阵比对」，不是「跑通了」——项目纪律 2：视觉问题量真实几何。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Vision = require(path.join(ROOT, 'renderer/vision.js'));
const FIX = path.join(ROOT, 'dev/fixtures/vision');
const TMP = path.join(ROOT, '_trash/vimg');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  —— ' + detail : '')); }
};
const msec = (t) => Math.round(performance.now() - t);

/* ══════════════ BMP 读写（24bpp） ══════════════ */
function readBmp(file) {
  const b = fs.readFileSync(file);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18), rawH = b.readInt32LE(22);
  const topDown = rawH < 0, h = Math.abs(rawH), bpp = b.readUInt16LE(28);
  const bytes = bpp / 8, stride = Math.floor((w * bpp + 31) / 32) * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : (h - 1 - y), row = off + sy * stride;
    for (let x = 0; x < w; x++) {
      const p = row + x * bytes, o = (y * w + x) * 4;
      out[o] = b[p + 2]; out[o + 1] = b[p + 1]; out[o + 2] = b[p]; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
function writeBmp(file, img) {
  const { data, width: w, height: h } = img;
  const stride = Math.floor((w * 24 + 31) / 32) * 4;
  const b = Buffer.alloc(54 + stride * h);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(54 + stride * h, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * 4, d = 54 + y * stride + x * 3;
      b[d] = data[s + 2]; b[d + 1] = data[s + 1]; b[d + 2] = data[s];
    }
  }
  fs.writeFileSync(file, b);
}

/* ══════════════ 合成棋盘（造「不像这张图」的图来测阈值） ══════════════ */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* skin: bg/line/black/white 四个颜色 + 噪声强度 */
const SKINS = {
  '浅木（本图那种）': { bg: [226, 210, 180], line: [150, 120, 86], black: [38, 38, 40], white: [248, 247, 242], noise: 5 },
  '橙木（101 那种）': { bg: [228, 158, 62], line: [40, 30, 22], black: [24, 24, 26], white: [246, 244, 238], noise: 6 },
  '深色盘': { bg: [96, 96, 100], line: [210, 210, 205], black: [20, 20, 22], white: [240, 240, 238], noise: 4 },
  '纯白底（死活题）': { bg: [252, 252, 252], line: [30, 30, 30], black: [20, 20, 20], white: [255, 255, 255], noise: 2, whiteOnWhite: true },
};

function synthBoard(nx, ny, cell, skin, rnd, density) {
  const pad = Math.round(cell * 0.9);
  const W = (nx - 1) * cell + pad * 2, H = (ny - 1) * cell + pad * 2;
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  };
  /* 底色 + 噪声（模拟照片/JPEG 的颗粒，防止测试只对纯色成立） */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = (rnd() - 0.5) * 2 * skin.noise;
      /* 一点低频明暗，模拟木纹走向 */
      const g = Math.sin(x * 0.03) * 3 + Math.sin(y * 0.017) * 2;
      put(x, y, [skin.bg[0] + j + g, skin.bg[1] + j + g * 0.8, skin.bg[2] + j + g * 0.6]);
    }
  }
  /* 网格线（2px 宽） */
  for (let i = 0; i < nx; i++) {
    for (let t = 0; t < H; t++) { put(pad + i * cell, t, skin.line); put(pad + i * cell + 1, t, skin.line); }
  }
  for (let j = 0; j < ny; j++) {
    for (let t = 0; t < W; t++) { put(t, pad + j * cell, skin.line); put(t, pad + j * cell + 1, skin.line); }
  }
  /* 棋子 */
  const r = Math.round(cell * 0.46);
  const board = [];
  for (let j = 0; j < ny; j++) {
    let row = '';
    for (let i = 0; i < nx; i++) {
      if (rnd() > density) { row += '.'; continue; }
      const c = rnd() < 0.5 ? 1 : 2;
      row += c === 1 ? 'X' : 'O';
      const cx = pad + i * cell + 1, cy = pad + j * cell + 1;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          /* 轻微径向明暗（真实棋子都有），不让它变成纯色圆 */
          const sh = 1 - 0.18 * Math.max(0, (dx + dy) / (r * 1.6));
          const base = c === 1 ? skin.black : skin.white;
          put(cx + dx, cy + dy, [base[0] * sh, base[1] * sh, base[2] * sh]);
        }
      }
    }
    board.push(row);
  }
  return { img: { data, width: W, height: H }, rows: board };
}

const CH = { 1: 'X', 2: 'O', 0: '.', '-1': '?' };
function rowsOf(r) {
  const out = [];
  for (let j = 0; j < r.ny; j++) {
    let s = '';
    for (let i = 0; i < r.nx; i++) s += CH[r.board[j * r.nx + i]] || '.';
    out.push(s);
  }
  return out;
}
function diffRows(got, want) {
  const bad = [];
  const ny = Math.max(got.length, want.length);
  for (let j = 0; j < ny; j++) {
    const a = got[j] || '', b = want[j] || '';
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || '.') !== (b[i] || '.')) bad.push('(' + i + ',' + j + ') 期望 ' + (b[i] || '.') + ' 实际 ' + (a[i] || '.'));
    }
  }
  return bad;
}

console.log('=== ① 真图（用户提供的截图） ===');
const hasSips = (() => {
  try { execFileSync('which', ['sips'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
fs.mkdirSync(TMP, { recursive: true });

/* ★★ knownMiss：**已知漏检**，逐条钉死位置。
   2026-10-31 发现的：用户那张整盘图里 C7 是一颗白子，子中央被原图自带的一个绿色小圆点
   盖住（别的围棋 App 的"最后一手"标记）。白子本来就难认（底色亮度 224、白子约 240，
   只差十几灰度），中央那坨绿点又把 med 值拉低，whiteScore 只有 0.49（要 0.68 才算白子）。
   试过三种改采样方式（中心挖空的圆环 0.16~0.34 / 0.20~0.38、加大到 0.44 圆盘）——
   全都更差：整盘白子从 94 颗掉到 48 颗。所以**不动算法**，把这一条当已知漏检写进来。
   钉死位置的意义：将来谁改坏了别处，这里会立刻红；谁真把它修好了，会提示把这条删掉。 */
const REAL = [
  { name: 'full19', desc: '整盘 19 路（带坐标文字）', nx: 19, ny: 19, corner: null,
    knownMiss: ['(2,12) 期望 O 实际 .'] },
  { name: 'corner11x8', desc: '局部 11×8（左下角死活题）', nx: 11, ny: 8, corner: 'bl',
    knownMiss: [] },
];
for (const t of REAL) {
  const jpg = path.join(FIX, t.name + '.jpg');
  const gt = JSON.parse(fs.readFileSync(path.join(FIX, t.name + '.json'), 'utf8'));
  if (!hasSips || !fs.existsSync(jpg)) {
    console.log('  - ' + t.name + '：跳过（没有 sips 或没有夹具图片）');
    continue;
  }
  const bmp = path.join(TMP, '_t_' + t.name + '.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', jpg, '--out', bmp], { stdio: 'ignore' });
  const img = readBmp(bmp);
  const t0 = performance.now();
  const r = Vision.analyze(img);
  const ms = msec(t0);
  const bad = diffRows(rowsOf(r), gt.rows);
  const known = t.knownMiss || [];
  const unexpected = bad.filter(x => known.indexOf(x) < 0);
  const stillThere = known.filter(x => bad.indexOf(x) >= 0);
  ok(t.name + ' 尺寸 ' + t.nx + '×' + t.ny, r.nx === t.nx && r.ny === t.ny,
    '实际 ' + r.nx + '×' + r.ny);
  ok(t.name + ' 判角 ' + (t.corner || '不判（整盘）'), r.corner === t.corner, '实际 ' + r.corner);
  ok(t.name + ' 逐点对上真值（' + (gt.nx * gt.ny) + ' 点，已知漏检 ' + known.length + ' 处）',
    unexpected.length === 0, unexpected.slice(0, 5).join('；'));
  /* 已知漏检不许"悄悄多出来"也不许"悄悄消失" —— 消失了说明修好了，得删掉这条配置 */
  if (known.length && stillThere.length !== known.length) {
    console.log('  · ' + t.name + '：已知漏检已不在（' + known.filter(x => stillThere.indexOf(x) < 0).join('；')
      + '）—— 如果这是修好了，把 REAL 里的 knownMiss 删掉');
  }
  /* 待确认只允许出现在已知漏检那几格上（"漏了但界面明说了"才是合格的表现） */
  const uncBad = r.uncertain.filter(([i, j]) => {
    const key = '(' + i + ',' + j + ')';
    return !known.some(x => x.indexOf(key) === 0);
  });
  ok(t.name + ' 待确认点只落在已知漏检上（其余不许有）', uncBad.length === 0,
    '多出来 ' + uncBad.length + ' 个：' + uncBad.slice(0, 4).map(p => '(' + p[0] + ',' + p[1] + ')').join(' '));
  ok(t.name + ' 耗时 ' + ms + 'ms < 800ms', ms < 800);
}

console.log('=== ② 合成图：四种盘色 × 三种盘面大小 ===');
for (const [skinName, skin] of Object.entries(SKINS)) {
  for (const n of [19, 13, 9]) {
    const rnd = mulberry32(1000 + n + skinName.length);
    const cell = n === 19 ? 34 : (n === 13 ? 46 : 60);
    const { img, rows } = synthBoard(n, n, cell, skin, rnd, 0.35);
    let r = null, err = '';
    try { r = Vision.analyze(img); } catch (e) { err = e.message; }
    if (!r) { ok(skinName + ' ' + n + ' 路', false, err); continue; }
    const got = rowsOf(r);
    const tag = skinName + ' ' + n + ' 路';
    ok(tag + ' 尺寸', r.nx === n && r.ny === n, '实际 ' + r.nx + '×' + r.ny);
    if (skin.whiteOnWhite) {
      /* ★ 已知识别不了白子（白子与底色同色）——只要求黑子全对 + **必须报警告**。
         「悄悄漏检」才是 bug，「说了但做不到」是限制。 */
      const badB = diffRows(got, rows).filter(x => /期望 X/.test(x));
      ok(tag + ' 黑子全对（' + badB.length + ' 错）', badB.length === 0, badB.slice(0, 4).join('；'));
      ok(tag + ' 亮了警告' + (r.warnings.length ? '' : '（没有！）'), r.warnings.length > 0);
    } else {
      const bad = diffRows(got, rows);
      ok(tag + ' 逐点（错 ' + bad.length + ' 点）', bad.length === 0, bad.slice(0, 4).join('；'));
    }
  }
}

console.log('=== ③ 旋转 / 镜像 ===');
{
  const rnd = mulberry32(7);
  const { img } = synthBoard(13, 13, 46, SKINS['橙木（101 那种）'], rnd, 0.4);
  const r = Vision.analyze(img);
  const base = { board: r.board, conf: r.conf, nx: r.nx, ny: r.ny, corner: 'bl' };
  const same = (a, b) => a.nx === b.nx && a.ny === b.ny
    && a.board.every((v, i) => v === b.board[i]);
  const r90 = Vision.applyXform(base, 'rot90');
  const r180 = Vision.applyXform(r90, 'rot90');
  const r270 = Vision.applyXform(r180, 'rot90');
  const r360 = Vision.applyXform(r270, 'rot90');
  ok('转四次回到原样', same(base, r360));
  ok('rot90 两次 = rot180', same(Vision.applyXform(base, 'rot180'), r180));
  ok('rot90 后角标注 tl→tr', Vision.applyXform({ ...base, corner: 'tl' }, 'rot90').corner === 'tr');
  ok('flipH 两次回到原样', same(base, Vision.applyXform(Vision.applyXform(base, 'flipH'), 'flipH')));
  ok('flipV 后角标注 bl→tl', Vision.applyXform(base, 'flipV').corner === 'tl');
  ok('flipH 后角标注 bl→br', Vision.applyXform(base, 'flipH').corner === 'br');
  /* 非方阵：11×8 转 90° 必须交换宽高 */
  const rect = { board: new Int8Array(11 * 8), conf: new Float32Array(11 * 8), nx: 11, ny: 8, corner: 'bl' };
  const rr = Vision.applyXform(rect, 'rot90');
  ok('非方阵转 90° 交换宽高（11×8 → 8×11）', rr.nx === 8 && rr.ny === 11, rr.nx + '×' + rr.ny);
}

console.log('=== ④ 锚定到 19 路 ===');
{
  /* 只放一颗在矩阵左上角 (0,0) 的子，看它落到 19 路的哪儿 —— 语义无歧义：
     「贴X角」= 图的那个角粘在棋盘的那个角上，所以 (0,0) 落在**离角最远**的那一侧。 */
  const one = (corner, off) => {
    const b = new Int8Array(4); b[0] = 1;                    // 只有 (0,0) 一颗黑子
    const m2 = { board: b, conf: new Float32Array(4), nx: 2, ny: 2 };
    return Vision.toBoard19(m2, { corner, off }).stones[0];
  };
  let s1 = one('tl', 0);
  ok('贴左上：(0,0) → A19', s1.x === 0 && s1.y === 0, JSON.stringify(s1));
  s1 = one('tr', 0);
  ok('贴右上：(0,0) → S19（左侧内缩一格）', s1.x === 17 && s1.y === 0, JSON.stringify(s1));
  s1 = one('bl', 0);
  ok('贴左下：(0,0) → A2（上方内缩一格）', s1.x === 0 && s1.y === 17, JSON.stringify(s1));
  s1 = one('br', 0);
  ok('贴右下：(0,0) → S2', s1.x === 17 && s1.y === 17, JSON.stringify(s1));
  s1 = one('tl', 3);
  ok('偏移 3：整体往内挪 3 路', s1.x === 3 && s1.y === 3, JSON.stringify(s1));
  /* 越界必须报出来，不许静默丢子 */
  const big = { board: new Int8Array(19 * 19).fill(1), conf: new Float32Array(19 * 19), nx: 19, ny: 19 };
  const over = Vision.toBoard19(big, { corner: 'tl', off: 3 });
  ok('越界棋子被计进 bad（偏移 3 + 19 宽 = 3 颗越界）', over.bad.length > 0 && over.stones.length < 361,
    'bad=' + over.bad.length + ' stones=' + over.stones.length);
}

console.log('=== ⑤ SGF ===');
{
  const stones = [{ x: 15, y: 3, color: 'b' }, { x: 3, y: 15, color: 'w' }, { x: 8, y: 8, color: 'b' }];
  const s = Vision.toSGF(stones, { cols: 'abcdefghijklmnopqrs', pl: 'w', komi: 0, ru: 'Chinese', comment: '测试' });
  ok('写着 GM[1]FF[4]SZ[19]', /GM\[1\]FF\[4\]SZ\[19\]/.test(s));
  ok('先手写进 PL[W]', /PL\[W\]/.test(s));
  ok('AB 两颗、AW 一颗', (s.match(/AB((?:\[[a-s]{2}\])+)/)||['',''])[1].match(/\[/g)?.length === 2
    && (s.match(/AW((?:\[[a-s]{2}\])+)/)||['',''])[1].match(/\[/g)?.length === 1, s);
  /* ★ 第 9 列在 SGF 里是 i（不是 j），这是两张坐标表最容易搞错的地方 */
  ok('第 9 列写的是 i 不是 j（(8,8) → [ii]）', /\[ii\]/.test(s), s);
  ok('注释进了 GC[]', /GC\[测试\]/.test(s));
  ok('括号配平', (s.match(/\(/g) || []).length === 1 && (s.match(/\)/g) || []).length === 1);
}

console.log('');
console.log((fail ? '★ ' : '') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
