/* 图片识谱的开发期驱动（Node，不启动 Electron）
   ─────────────────────────────────────────────────────────────────────────────
   BMP → RGBA → renderer/vision.js → 诊断 + 调试图 + 反画棋盘 + 与真值比对。

   用法：
     sips -s format bmp in.jpg --out _trash/vimg/a.bmp          # 先转 BMP
     node dev/_vision_dev.mjs _trash/vimg/a.bmp
     node dev/_vision_dev.mjs a.bmp --size 19                    # 强制整盘路数
     node dev/_vision_dev.mjs a.bmp --corners x1,y1,x2,y2,x3,y3,x4,y4   # 手动四角（tl,tr,br,bl）
     node dev/_vision_dev.mjs a.bmp --gt 真值.json               # 逐点比对（退出码 3 = 有差异）
     node dev/_vision_dev.mjs a.bmp --rows --jsonout 矩阵.json
     node dev/_vision_dev.mjs a.bmp --render 反画.bmp
     node dev/_vision_dev.mjs a.bmp --warp 矫正.bmp
     node dev/_vision_dev.mjs a.bmp --probe                     # 只打网格诊断（不跑整条管线）
     node dev/_vision_dev.mjs a.bmp --cols 88,148,1175          # 只看若干列亮度

   ★ 为什么走 BMP：Node 没有图片解码器，sips（macOS 自带）能一键转，
     BMP 无压缩、几十行就能读写 —— 为开发脚本装个 pngjs 不值当。
   ★ 生产代码的解码走浏览器（createImageBitmap），本脚本只服务开发/回归。
   ★ 测试图片与产物一律放 _trash/，不进库（项目纪律 4）。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Vision = require(path.join(ROOT, 'renderer/vision.js'));

/* ══════════════ BMP 读写（24/32bpp，负高度 = 自上而下） ══════════════ */
function readBmp(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 2) !== 'BM') throw new Error('不是 BMP');
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const rawH = b.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const bpp = b.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error('只支持 24/32bpp，当前 ' + bpp);
  const bytes = bpp / 8;
  const stride = Math.floor((w * bpp + 31) / 32) * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : (h - 1 - y);
    const row = off + sy * stride;
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
  const size = 54 + stride * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * 4, d = 54 + y * stride + x * 3;
      b[d] = data[s + 2]; b[d + 1] = data[s + 1]; b[d + 2] = data[s];
    }
  }
  fs.writeFileSync(file, b);
}

/* ══════════════ 临时画布小工具 ══════════════ */
function canvas(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
function putPx(img, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
}
function disc(img, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r) putPx(img, cx + dx, cy + dy, c);
  }
}
function ring(img, cx, cy, r, c, th) {
  th = th || 2;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= r * r && d2 >= (r - th) * (r - th)) putPx(img, cx + dx, cy + dy, c);
  }
}
function blitScaled(dst, src, ox, oy, scale) {
  for (let y = 0; y < src.height * scale; y++) {
    for (let x = 0; x < src.width * scale; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const sy = Math.min(src.height - 1, Math.floor(y / scale));
      const s = (sy * src.width + sx) * 4;
      putPx(dst, ox + x, oy + y, [src.data[s], src.data[s + 1], src.data[s + 2]]);
    }
  }
}

/* 从矩阵反画一张干净的棋盘 —— 人眼复核用（和原图并排看，差一颗都看得出来） */
function renderBoard(lines, nx, ny, cell) {
  const pad = Math.round(cell * 1.2);
  const W = (nx - 1) * cell + pad * 2, H = (ny - 1) * cell + pad * 2;
  const img = canvas(W, H, [226, 196, 140]);
  for (let i = 0; i < nx; i++) for (let t = 0; t < H; t++) putPx(img, pad + i * cell, t, [70, 50, 30]);
  for (let j = 0; j < ny; j++) for (let t = 0; t < W; t++) putPx(img, t, pad + j * cell, [70, 50, 30]);
  const r = Math.round(cell * 0.46);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ch = (lines[j] || '')[i];
      if (ch !== 'X' && ch !== 'O') continue;
      disc(img, pad + i * cell, pad + j * cell, r, ch === 'X' ? [28, 28, 28] : [250, 250, 248]);
      if (ch === 'O') ring(img, pad + i * cell, pad + j * cell, r, [140, 140, 135], 1);
    }
  }
  return img;
}

/* ══════════════ 命令行 ══════════════ */
const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.log('用法: node dev/_vision_dev.mjs <bmp> [--size n] [--corners ...] [--gt json] [--rows]');
  process.exit(1);
}
const opt = {};
for (let i = 1; i < args.length; i++) {
  const k = args[i].replace(/^--/, '');
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) opt[k] = true;
  else { opt[k] = v; i++; }
}

const src = readBmp(file);
console.log('输入 ' + path.basename(file) + ' · ' + src.width + '×' + src.height);

/* ---- 只做网格诊断（管线可能因为条数超限直接抛错，所以先跑） ---- */
if (opt.probe) {
  const P = Vision.prep(src.data, src.width, src.height);
  const I = Vision._internal;
  const roi = I.findRoi(P);
  console.log('ROI ' + JSON.stringify(roi));
  const box = { x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1 };
  const maps = I.darknessMap(P, Math.max(3, Math.round(Math.min(P.w, P.h) / 120)));
  for (const axis of ['x', 'y']) {
    const pr = I.projectLines(P, maps.dark, box, axis);
    console.log('[' + axis + '] 峰(' + pr.peaks.length + ') '
      + pr.peaks.map(p => p + ':' + pr.proj[Math.round(p)].toFixed(2)).join(' '));
    const lat = I.fitLattice(pr.peaks, pr.proj);
    console.log('    阵列 d=' + lat.d.toFixed(2) + ' 线(' + lat.lines.length + ') '
      + lat.lines.map(v => v.toFixed(1)).join(' '));
  }
}

/* ---- 只看若干列/行的亮度分布 ---- */
if (opt.cols) {
  const P = Vision.prep(src.data, src.width, src.height);
  for (const spec of opt.cols.split(',')) {
    const vertical = spec[0] !== 'r';
    const c = Number(spec.replace(/^r/, ''));
    const vals = [];
    const n = vertical ? P.h : P.w;
    for (let k = 0; k < n; k++) vals.push(Math.round(vertical ? P.lum[k * P.w + c] : P.lum[c * P.w + k]));
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    console.log((vertical ? '列 ' : '行 ') + c + ': 分位 p5/p50/p95 '
      + [0.05, 0.5, 0.95].map(p => uniq[Math.floor(uniq.length * p)]).join('/')
      + ' | 抽样 ' + vals.filter((_, i) => i % 97 === 0).join(' '));
  }
}

/* ---- 主识别 ---- */
const opts = {};
if (opt.size) opts.size = +opt.size;
if (opt.corners) {
  const n = opt.corners.split(',').map(Number);
  opts.corners = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[6], n[7]]];
}
let r = null;
try { r = Vision.analyze(src, opts); }
catch (e) { console.log('★ 失败: ' + e.message); process.exit(2); }

console.log('耗时 ' + r.ms + 'ms · 检出 ' + r.nx + '×' + r.ny + ' · 格距 ' + r.cell.toFixed(1)
  + ' · 底色亮度 ' + r.boardLum + ' 饱和 ' + r.boardSat + ' · 判角 ' + (r.corner || '未判出'));
console.log('棋子 ' + r.stoneCount + ' 颗 · 待确认 ' + r.uncertain.length + ' 点');
if (r.edges) {
  const on = ['left', 'right', 'top', 'bottom'].filter(k => r.edges[k]);
  console.log('真边: ' + (on.length ? on.join(',') : '（一条都没有）'));
}
r.warnings.forEach(s => console.log('  · ' + s));
if (opt.dump) {
  const f = a => Array.from(a).map(v => v.toFixed(1)).join(' ');
  console.log('xs(' + r.grid.xs.length + ') ' + f(r.grid.xs));
  console.log('ys(' + r.grid.ys.length + ') ' + f(r.grid.ys));
  console.log('四角 ' + r.corners.map(p => '(' + Math.round(p[0]) + ',' + Math.round(p[1]) + ')').join(' '));
}

/* ---- 矩阵（row0 = 图的上边） ---- */
const CHR = { 1: 'X', 2: 'O', 0: '.', '-1': '?' };
const rows = [];
for (let j = 0; j < r.ny; j++) {
  let line = '';
  for (let i = 0; i < r.nx; i++) line += CHR[r.board[j * r.nx + i]] || '.';
  rows.push(line);
}
if (opt.rows) {
  console.log('矩阵:');
  rows.forEach((s, j) => console.log('  ' + String(j).padStart(2) + ' ' + s));
}
if (opt.jsonout) {
  fs.writeFileSync(opt.jsonout, JSON.stringify({ nx: r.nx, ny: r.ny, rows }, null, 1));
  console.log('矩阵已写 ' + opt.jsonout);
}
if (opt.render) {
  writeBmp(opt.render, renderBoard(rows, r.nx, r.ny, 40));
  console.log('反画棋盘 → ' + opt.render);
}
if (opt.warp) {
  writeBmp(opt.warp, r.warped);
  console.log('矫正图 → ' + opt.warp + '（' + r.warped.width + '×' + r.warped.height + '）');
}

/* ---- 锚定到 19 路 + 生成 SGF ---- */
if (opt.sgf) {
  const corner = opt.corner || r.corner || 'tl';
  const off = +(opt.off || 0);
  const pl = (opt.pl || 'b').toLowerCase() === 'w' ? 'w' : 'b';
  const b19 = Vision.toBoard19({ board: r.board, conf: r.conf, nx: r.nx, ny: r.ny },
    { corner, off });
  const grid = Array.from({ length: 19 }, () => Array(19).fill('.'));
  for (const st of b19.stones) grid[st.y][st.x] = st.color === 'b' ? 'X' : 'O';
  console.log('锚定 19 路（贴 ' + corner + ' · 偏移 ' + off + ' · 先手 ' + pl.toUpperCase()
    + ' · 越界 ' + b19.bad.length + '）:');
  grid.forEach((row, y) => console.log('  ' + String(19 - y).padStart(2) + ' ' + row.join('')));
  console.log('     ABCDEFGHJKLMNOPQRST');
  const sgf = Vision.toSGF(b19.stones, {
    cols: 'abcdefghijklmnopqrs', pl, komi: opt.komi == null ? 7.5 : +opt.komi,
    comment: '图片识别导入 · 原图 ' + r.nx + '×' + r.ny + ' · 贴 ' + corner + ' · 偏移 ' + off,
  });
  console.log('SGF: ' + sgf);
  if (opt.sgfout) { fs.writeFileSync(opt.sgfout, sgf + '\n', 'utf8'); console.log('SGF 已写 ' + opt.sgfout); }
}

/* ---- 调试图：上 = 矫正图（叠识别结果），下 = 矩阵预览 ---- */
const WP = r.warped;
const scale = Math.max(1, Math.floor(620 / WP.width));
const dbgW = Math.max(620, WP.width * scale + 20);
const closeH = WP.height * scale + 20;
const cellM = 22;
const matH = r.ny * cellM + 40;
const dbg = canvas(dbgW, closeH + matH + 10, [245, 245, 242]);
blitScaled(dbg, WP, 10, 10, scale);
for (let j = 0; j < r.ny; j++) {
  for (let i = 0; i < r.nx; i++) {
    const cx = 10 + r.grid.xs[i] * scale, cy = 10 + r.grid.ys[j] * scale;
    const v = r.board[j * r.nx + i];
    if (v === Vision.BLACK) disc(dbg, cx, cy, 3, [0, 0, 0]);
    else if (v === Vision.WHITE) disc(dbg, cx, cy, 3, [255, 255, 255]);
    else putPx(dbg, cx, cy, [0, 160, 255]);
    if (r.conf[j * r.nx + i] < Vision.CONF_UNCERTAIN) ring(dbg, cx, cy, 6, [230, 140, 0], 1);
  }
}
for (let j = 0; j < r.ny; j++) {
  for (let i = 0; i < r.nx; i++) {
    const v = r.board[j * r.nx + i], c = r.conf[j * r.nx + i];
    const x = 20 + i * cellM, y = closeH + 20 + j * cellM;
    const col = v === Vision.BLACK ? [30, 30, 30] : v === Vision.WHITE ? [250, 250, 250]
      : v === Vision.UNKNOWN ? [255, 0, 255] : [210, 210, 205];
    disc(dbg, x + cellM / 2, y + cellM / 2, cellM / 2 - 1, col);
    if (c < Vision.CONF_UNCERTAIN) ring(dbg, x + cellM / 2, y + cellM / 2, cellM / 2 - 1, [230, 140, 0], 1);
  }
}
const outBmp = opt.out || path.join(ROOT, '_trash/vimg/_dbg.bmp');
writeBmp(outBmp, dbg);
console.log('调试图 → ' + path.relative(ROOT, outBmp));

/* ---- 与真值比对 ---- */
if (opt.gt) {
  const gt = JSON.parse(fs.readFileSync(opt.gt, 'utf8'));
  let diff = 0, total = 0;
  const bad = [];
  for (let j = 0; j < r.ny; j++) {
    for (let i = 0; i < r.nx; i++) {
      const ch = (gt.rows[j] || '')[i] || '.';
      const want = ch === 'X' ? Vision.BLACK : ch === 'O' ? Vision.WHITE : Vision.EMPTY;
      const got = r.board[j * r.nx + i];
      total++;
      if (want !== got) {
        diff++;
        bad.push('(' + i + ',' + j + ') 期望 ' + (want === 1 ? '黑' : want === 2 ? '白' : '空')
          + ' 实际 ' + (got === 1 ? '黑' : got === 2 ? '白' : got === 0 ? '空' : '未定'));
      }
    }
  }
  console.log('真值比对：' + (total - diff) + '/' + total + ' 正确 · 准确率 '
    + (total ? (100 * (total - diff) / total).toFixed(2) : '0') + '%');
  bad.forEach(s => console.log('  ✗ ' + s));
  process.exitCode = diff ? 3 : 0;
}
