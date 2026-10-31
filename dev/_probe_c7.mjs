/* 诊断：C7 那颗「带绿点的白子」为什么被认成空点 —— 以及换一种采样方式能不能救回来
   跑法： node dev/_probe_c7.mjs

   背景（2026-10-31 用户报障）：用户给的整盘图里 C7 是一颗**白子**，子中央被原图自带的一个
   绿色小圆点盖住（别的围棋 App 的"最后一手"标记就是这个样式）。界面把它认成了**空点**，
   套了个「待确认」橙圈。用户于是问"点 C7 代表的是不确定吗"。
   查夹具真值时发现：**真值 json 也写着空点** —— 也就是说这条错被"真值"一起复制了，
   361 点比对因此一直全绿。项目纪律 2 说「测试判据比被测代码更易写错」，这就是一例。

   本探针只做两件事，不改产品代码：
     ① 把 classify 的 blackScore/whiteScore 打出来（给 vision.js 源码做个 _trash 里的补丁副本）
     ② 试几种采样方式（居中圆盘 / 中心挖空的圆环 / 更大的圆盘），看哪一种能把 C7 判回白子，
        同时**不把另外 360 点搞坏**。
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, 'dev/fixtures/vision');
const TMP = path.join(ROOT, '_trash/_c7');
fs.mkdirSync(TMP, { recursive: true });

/* ---------- BMP 读入（Node 没有 JPEG 解码器，借 sips 转一道） ---------- */
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
function loadJpgAsImage(img) {
  const bmp = path.join(TMP, img.replace(/\.jpe?g$/i, '.bmp'));
  execFileSync('sips', ['-s', 'format', 'bmp', path.join(FIX, img), '--out', bmp], { stdio: 'ignore' });
  return readBmp(bmp);
}

/* ---------- 给 vision.js 做补丁副本：多返回 scores，可换采样方式 ---------- */
const SRC = fs.readFileSync(path.join(ROOT, 'renderer/vision.js'), 'utf8');
function buildVision(patch) {
  let s = SRC;
  /* ①「采样偏移」这一段是唯一要换的地方 */
  const before = "    const offS = circleOffsets(rSample), offB = circleOffsets(rBg);";
  if (s.indexOf(before) < 0) throw new Error('源码变了，补丁点找不到：offS');
  s = s.replace(before, '    const offS = ' + patch.offs + ', offB = circleOffsets(rBg);');
  /* ①.5 给补丁注入一个"挖空中心的圆环"采样器（原源码里没有这个函数） */
  s = s.replace('  function sampleStats(P, cx, cy, off) {',
    '  function ringOffsets(rIn, rOut) {\n'
    + '    const out = [];\n'
    + '    for (let dy = -rOut; dy <= rOut; dy++) for (let dx = -rOut; dx <= rOut; dx++) {\n'
    + '      const d2 = dx * dx + dy * dy;\n'
    + '      if (d2 <= rOut * rOut + 0.001 && d2 >= rIn * rIn - 0.001) out.push(dx, dy);\n'
    + '    }\n'
    + '    return out;\n'
    + '  }\n'
    + '  function sampleStats(P, cx, cy, off) {');
  /* ② 多吐一份评分，好知道"差多少"而不是只有"对/错" */
  s = s.replace('    const board = new Int8Array(nx * ny);',
    '    const scores = new Float32Array(nx * ny * 2);\n    const board = new Int8Array(nx * ny);');
  s = s.replace('        board[idx] = v; conf[idx] = c;',
    '        scores[idx * 2] = blackScore; scores[idx * 2 + 1] = whiteScore;\n        board[idx] = v; conf[idx] = c;');
  s = s.replace('return { board, conf, nx, ny, boardLum, boardSat, uncertain, stoneCount, cell };',
    'return { board, conf, nx, ny, boardLum, boardSat, uncertain, stoneCount, cell, scores };');
  s = s.replace('uncertain: cls.uncertain, stoneCount: cls.stoneCount,',
    'uncertain: cls.uncertain, stoneCount: cls.stoneCount, scores: cls.scores,');
  const f = path.join(TMP, 'vision_' + patch.tag + '.js');
  fs.writeFileSync(f, s);
  delete require.cache[f];
  return require(f);
}

const truth = JSON.parse(fs.readFileSync(path.join(FIX, 'full19.json'), 'utf8'));
/* ★ 真值里 C7 是错的（照片里是白子）—— 本探针顺手把它当"应该是 O"来算 */
const TRUE_FIX = truth.rows.map(r => r.split(''));
TRUE_FIX[12][2] = 'O';

const CH = { '-1': '?', '0': '.', '1': 'X', '2': 'O' };
function run(tag, patch, img) {
  const V = buildVision(Object.assign({ tag }, patch));
  const im = loadJpgAsImage(img);
  const res = V.analyze(im, {});
  if (!res.ok) { console.log(tag + ': 识别失败 ' + res.error); return; }
  const rows = [];
  for (let j = 0; j < res.ny; j++) {
    let s = '';
    for (let i = 0; i < res.nx; i++) s += CH[String(res.board[j * res.nx + i])] || '?';
    rows.push(s);
  }
  const diff = [];
  for (let j = 0; j < 19; j++) for (let i = 0; i < 19; i++) {
    if (rows[j][i] !== TRUE_FIX[j][i]) diff.push('(' + i + ',' + j + ') 得' + rows[j][i] + ' 应' + TRUE_FIX[j][i]);
  }
  const sc = res.scores;
  const idx = 12 * res.nx + 2;
  console.log('\n=== ' + tag + '  棋子 ' + res.stoneCount + '  与真值差 ' + diff.length + ' 点');
  console.log('    C7: 判 ' + rows[12][2] + '  blackScore=' + sc[idx * 2].toFixed(3)
    + ' whiteScore=' + sc[idx * 2 + 1].toFixed(3) + '  conf=' + res.conf[idx].toFixed(2)
    + '  boardLum=' + Math.round(res.boardLum));
  if (diff.length) console.log('    ' + diff.slice(0, 6).join(' | '));
  return rows;
}

const IMG = 'full19.jpg';
run('A-原样(居中圆盘 0.34)', { offs: 'circleOffsets(rSample)' }, IMG);
run('B-圆环 0.16~0.34', { offs: 'ringOffsets(Math.round(cell * 0.16), rSample)' }, IMG);
run('C-圆环 0.20~0.38', { offs: 'ringOffsets(Math.round(cell * 0.20), Math.round(cell * 0.38))' }, IMG);
run('D-大圆盘 0.44', { offs: 'circleOffsets(Math.max(3, Math.round(cell * 0.44)))' }, IMG);
