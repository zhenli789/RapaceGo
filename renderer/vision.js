/* 图片识谱（静态棋局）—— 把一张棋盘截图变成 19 路局面。
   ═══════════════════════════════════════════════════════════════════════════
   ★★ 这个文件是**纯计算**：不碰 DOM、不碰 state、不发网络请求、不写盘。
      这是整个功能的价值前提（图片不出本机），改代码时别破坏它。
   ★★ 只有一处依赖外部规范：SGF 的坐标字母表。它由调用方传进来
      （`toSGF(..., { cols: SGF_COLS })`），**不在本文件里再抄一份** ——
      项目里 SGF_COLS 与 GTP_COLS 是两张独立的表（见 app.js 顶部那段注释），
      抄第二份迟早会分叉。

   算法出处（思路借鉴，未复制代码）：
     · Tsumego / TsumegoLab —— 投影 + 等距阵列拟合 + 穿出线判角 + 暖度分「有子/空点」
       （该仓库**没有 LICENSE**，只能借鉴思路）
     · RecurGO v1.1.0（MIT）—— 760px 透视矫正、格心标定背景、黑白双阈值 + 置信度
   为什么不用 OpenCV，见 图片识谱方案.md §2。

   坐标口径（三套，别混）：
     ① 原图坐标 (x,y)：用户看到的像素坐标系，左上为原点。
     ② 棋盘局部坐标 (col,row)：col 从左往右、row 从**上**往下，原点 = 检出网格的左上交点。
        `board[row*nx+col]` 就是这个口径 —— 图怎么摆，矩阵就怎么存。
     ③ 贴角坐标：从「贴的那个 19 路角」往内数（见 orientToCorner）。锚定只用这一套。
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const EXTENT = 760;   // 透视矫正后的正方形边长（RecurGO 的取值：19 路格距 ≈ 42px，采样足够、又够快）
  const PAD = 38;       // 矫正图四周留白：让最外圈线不贴边（贴边就取不到圆采样）

  const EMPTY = 0, BLACK = 1, WHITE = 2, UNKNOWN = -1;
  const CONF_UNCERTAIN = 0.72;   // 低于它 → UI 标「待确认」

  /* ---------- 小工具 ---------- */
  const now = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();

  function medianOf(arr) {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr);
    a.sort();
    const n = a.length;
    return n & 1 ? a[n >> 1] : (a[(n >> 1) - 1] + a[n >> 1]) / 2;
  }

  /* 256 档直方图 —— 全图求中位数/分位数用它，比 sort 快两个数量级 */
  function histOf(vals) {
    const h = new Uint32Array(256);
    for (let i = 0; i < vals.length; i++) {
      let v = vals[i] | 0;
      if (v < 0) v = 0; else if (v > 255) v = 255;
      h[v]++;
    }
    return h;
  }
  function pctOf(hist, total, p) {
    let acc = 0;
    const target = total * p;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  /* ---------- 0. 通道分解 ----------
     lum  = 亮度（分类主判据之一）
     warm = R−B（暖度：木纹 ≫ 0，棋子是纯灰 ≈ 0）—— 101 及多数网站的子是灰的，
            用暖度分「有子/空点」比用亮度稳得多（Tsumego 的实测结论）
     sat  = 饱和度（白子低、木盘中高）—— 深色木盘上白子过曝时靠它兜底 */
  function prep(rgba, w, h) {
    const n = w * h;
    const lum = new Float32Array(n), warm = new Float32Array(n), sat = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      warm[i] = r - b;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      sat[i] = mx ? (mx - mn) / mx : 0;
    }
    return { w, h, lum, warm, sat, rgba };
  }

  /* ---------- 1. ROI：裁掉棋盘外的白边/文字/阴影 ----------
     木色/盘色判据很宽松（只用来砍掉明显的非棋盘边缘）。找不到就整图 ——
     命中不了说明用户截的是「纯白底 + 黑线 + 棋子」的死活题图，那本来就没有盘底色。 */
  function findRoi(P) {
    const { w, h, lum, warm } = P;
    const hist = histOf(lum);
    const med = pctOf(hist, w * h, 0.5);
    const colHit = new Int32Array(w), rowHit = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const L = lum[i], W = warm[i];
        if (W > 15 && L > 60 && L < 240) { colHit[x]++; rowHit[y]++; }
      }
    }
    let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1, found = false;
    const colOk = [], rowOk = [];
    for (let x = 0; x < w; x++) if (colHit[x] > h * 0.5) colOk.push(x);
    for (let y = 0; y < h; y++) if (rowHit[y] > w * 0.5) rowOk.push(y);
    if (colOk.length > 20 && rowOk.length > 20) {
      x0 = colOk[0]; x1 = colOk[colOk.length - 1];
      y0 = rowOk[0]; y1 = rowOk[rowOk.length - 1];
      found = true;
    }
    return { x0, y0, x1, y1, found, med };
  }

  /* ---------- 2. 局部背景归一（让「棋子」从线检测里彻底消失） ----------
     ★★ 这一步是整条管线能稳的关键，实测踩出来的：
        · 全局阈值（中位数与暗分位的中点）在这张图上直接失效 —— 棋盘外是白边，
          全图中位数被拉到 223，而棋盘线是 146；阈值算成 139.5，**一条线都进不来**。
        · 而「相对局部背景的暗度」不受曝光/白边/渐变影响：线细（1~2px）比
          半径 10px 的邻域暗 → 暗度 ~26；棋子内部与自己的邻域同色 → 暗度 ~0。
          于是**棋子自动变成「中性」**，投影里只剩线，不需要再靠「空盘行」过滤躲棋子。
     用积分图做盒均值，O(1) 每像素。 */
  function backgroundMean(P, r) {
    const { w, h, lum } = P;
    const W1 = w + 1;
    const ii = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0;
      for (let x = 0; x < w; x++) {
        rs += lum[y * w + x];
        ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + rs;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      const areaY = y1 - y0 + 1;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const s = ii[(y1 + 1) * W1 + x1 + 1] - ii[y0 * W1 + x1 + 1]
          - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
        out[y * w + x] = s / (areaY * (x1 - x0 + 1));
      }
    }
    return out;
  }

  function darknessMap(P, r) {
    const bg = backgroundMean(P, r);
    const n = P.w * P.h;
    const d = new Float32Array(n), l = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = bg[i] - P.lum[i];
      d[i] = v > 0 ? v : 0;
      l[i] = v < 0 ? -v : 0;
    }
    return { dark: d, light: l, bg };
  }

  /* ---------- 3. 网格线：暗度投影 → 峰值 → 等距阵列拟合 ----------
     为什么不能「找到峰就算线」：木纹的深色条纹、坐标文字、阴影都会出峰。
     真线的判据不是「暗」，而是「落在一条等距阵列上」——
     伪峰因为不配合别的峰，会被整体丢掉（Tsumego 的做法，实测有效）。 */
  function projectLines(P, map, box, axis) {
    const { w, h } = P;
    const DARK_T = 10;

    const x0 = Math.max(0, box.x0), x1 = Math.min(w - 1, box.x1);
    const y0 = Math.max(0, box.y0), y1 = Math.min(h - 1, box.y1);
    const len = axis === 'x' ? (x1 - x0 + 1) : (y1 - y0 + 1);
    const proj = new Float32Array(len);
    const warnings = [];

    if (axis === 'x') {
      const n = y1 - y0 + 1;
      for (let x = x0; x <= x1; x++) {
        let hit = 0;
        for (let y = y0; y <= y1; y++) if (map[y * w + x] > DARK_T) hit++;
        proj[x - x0] = n ? hit / n : 0;
      }
    } else {
      const n = x1 - x0 + 1;
      for (let y = y0; y <= y1; y++) {
        let hit = 0;
        const row = y * w;
        for (let x = x0; x <= x1; x++) if (map[row + x] > DARK_T) hit++;
        proj[y - y0] = n ? hit / n : 0;
      }
    }

    /* 平滑（[1,2,3,2,1]）+ 局部极大 */
    const sm = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let s = 0, wsum = 0;
      for (let d = -2; d <= 2; d++) {
        const j = i + d; if (j < 0 || j >= len) continue;
        const k = 3 - Math.abs(d); s += proj[j] * k; wsum += k;
      }
      sm[i] = wsum ? s / wsum : 0;
    }
    let mx = 0; for (let i = 0; i < len; i++) if (sm[i] > mx) mx = sm[i];
    /* ★ 阈值取「相对最大峰」而不是绝对值：不同皮肤的线对比度差好几倍，
       但「最明显的那条线」总是存在的（棋盘边框）。 */
    const thr = Math.max(0.06, mx * 0.28);
    const peaks = [];
    /* ★ 两端也要能出峰：最外圈的线正好落在搜索窗边界上时，
       老写法（i 从 1 到 len-2）**永远看不到它** —— 实测就是因此丢了棋盘最外一圈。 */
    for (let i = 0; i < len; i++) {
      const v = sm[i];
      if (v < thr) continue;
      const l = i > 0 ? sm[i - 1] : -1;
      const r = i < len - 1 ? sm[i + 1] : -1;
      if (v >= l && v > r) peaks.push(i);
    }
    /* 合并相邻 5px 内的峰（一条线可能出双峰） */
    const merged = [];
    for (const p of peaks) {
      if (merged.length && p - merged[merged.length - 1] < 5) {
        merged[merged.length - 1] = (merged[merged.length - 1] + p) / 2;
      } else merged.push(p);
    }
    return { peaks: merged, proj: sm, base: axis === 'x' ? x0 : y0, warnings };
  }

  /* 把一个峰按 anchor + k·d 归位；同一个 k 只留离阵列最近的峰 */
  function snapPeaks(peaks, anchor, d, tol) {
    const byK = new Map();
    for (const p of peaks) {
      const k = Math.round((p - anchor) / d);
      const res = Math.abs(p - (anchor + k * d));
      if (res > tol) continue;
      const cur = byK.get(k);
      if (cur === undefined || res < Math.abs(cur - (anchor + k * d))) byK.set(k, p);
    }
    return byK;
  }

  /* 等距阵列拟合：挑「支持峰最多」的相位与格距，最小二乘精修，再补被整排棋子挡掉的线。
     ★★ 2026-10-30 实测改过一次：原来取「命中峰最多」的 d，被**棋子的上下边缘**骗了 ——
        棋子直径约 0.9 格，它们的边缘在**半格**位置形成很强的水平暗带，
        于是 d 被折半（42 → 28），19 路被认成 28 路。
        现在改成 **平均支持度 × 填充率**：半格阵列虽然线更多，但每条都弱（0.2~0.3）；
        真阵列每条都强（0.45+）。用「强度」而不是「数量」当主判据才是对的。 */
  function fitLattice(peaks, proj) {
    const warnings = [];
    if (peaks.length < 3) return { lines: [], d: 0, support: [], warnings };
    const span = peaks[peaks.length - 1] - peaks[0];
    const gaps = [];
    for (let i = 1; i < peaks.length; i++) { const g = peaks[i] - peaks[i - 1]; if (g > 8) gaps.push(g); }
    if (!gaps.length) return { lines: [], d: 0, support: [], warnings };

    const supAt = (p) => {
      let s = 0;
      for (let i = Math.round(p) - 2; i <= Math.round(p) + 2; i++) {
        if (i >= 0 && i < proj.length && proj[i] > s) s = proj[i];
      }
      return s;
    };

    /* 候选格距：每个间隔本身、它的 2 倍和 1/2（真格距几乎总在这三个里） */
    const cands = new Set();
    for (const g of gaps) { cands.add(g); cands.add(g * 2); cands.add(g / 2); }

    let supAll = 0;
    for (const p of peaks) supAll += supAt(p);
    if (supAll <= 0) return { lines: [], d: 0, support: [], warnings };

    let best = null;
    for (const d of cands) {
      if (d < 6 || d > span / 1.5) continue;
      const tol = Math.max(1.5, d * 0.12);
      for (const a of peaks) {
        const m = snapPeaks(peaks, a, d, tol);
        if (m.size < 3) continue;
        let sup = 0;
        let kmin = Infinity, kmax = -Infinity;
        for (const [k, p] of m) {
          sup += supAt(p);
          if (k < kmin) kmin = k;
          if (k > kmax) kmax = k;
        }
        /* 三件事一起看，缺一个都会被骗：
           · explained = 命中的支持度占全部的比例 → 防「隔一条取一条」（只解释一半能量）
           · meanSup   = 每条命中线平均多强          → 防「半格阵列」（条数多但都是弱线）
           · fill      = 命中数 / 阵列覆盖的格子数    → 防「细格阵列顺手把棋盘外的边也兜进来」 */
        const explained = sup / supAll;
        const meanSup = sup / m.size;
        const fill = m.size / (kmax - kmin + 1);
        const score = explained * meanSup * fill;
        if (!best || score > best.score + 1e-9) best = { score, d, anchor: a, m };
      }
    }
    if (!best) return { lines: [], d: 0, support: [], warnings };

    /* 最小二乘精修 pos = off + k·d */
    const ks = [], ps = [];
    for (const [k, p] of best.m) { ks.push(k); ps.push(p); }
    const n = ks.length;
    const kMean = ks.reduce((a, b) => a + b, 0) / n;
    const pMean = ps.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (ks[i] - kMean) * (ps[i] - pMean); den += (ks[i] - kMean) ** 2; }
    const d = den ? num / den : best.d;
    const off = pMean - d * kMean;

    const matched = snapPeaks(peaks, off, d, Math.max(2, d * 0.12));
    const dropped = peaks.length - matched.size;
    if (dropped > 0) warnings.push('丢弃 ' + dropped + ' 条不在等距阵列上的伪线（木纹/棋子边缘/文字）');

    let kmin = Infinity, kmax = -Infinity;
    for (const k of matched.keys()) { if (k < kmin) kmin = k; if (k > kmax) kmax = k; }
    const lines = [], support = [];
    let missing = 0;
    for (let k = kmin; k <= kmax; k++) {
      const p = matched.has(k) ? matched.get(k) : (off + k * d);
      if (!matched.has(k)) missing++;
      lines.push(p);
      support.push(supAt(p));
    }
    if (missing) warnings.push(missing + ' 条网格线被整排棋子遮挡，已按等距补插');
    /* 两端的线如果明显比阵列中间弱，多半是坐标文字/木纹「凑」到了阵列上 → 砍掉。
       不砍的话，下游会把「19 路」当成「20 路」或者把左边多出的一列当成棋盘内。 */
    if (lines.length > 4) {
      const medS = medianOf(support);
      let cutHead = 0, cutTail = 0;
      while (lines.length - cutHead - cutTail > 3 && support[cutHead] < medS * 0.30) cutHead++;
      while (lines.length - cutHead - cutTail > 3
        && support[support.length - 1 - cutTail] < medS * 0.30) cutTail++;
      if (cutHead || cutTail) {
        if (cutHead) { lines.splice(0, cutHead); support.splice(0, cutHead); }
        if (cutTail) { lines.splice(lines.length - cutTail, cutTail); support.splice(support.length - cutTail, cutTail); }
        warnings.push('两端砍掉 ' + (cutHead + cutTail) + ' 条弱线（文字/木纹凑进了阵列）');
      }
    }
    return { lines, d, support, score: best.score, polarity: 'dark', warnings };
  }

  /* 一条轴：按「线比底色暗」找一遍，再按「线比底色亮」找一遍，取分高的那一遍。
     ★ 两种都必须试：深色主题的棋盘是**黑底浅线**，只找暗线会彻底失效
       （实测：深色盘 19 路被报成「75×20 条线」）。 */
  function detectAxis(P, maps, box, axis) {
    const cand = [];
    for (const name of ['dark', 'light']) {
      const pr = projectLines(P, maps[name], box, axis);
      const lat = fitLattice(pr.peaks, pr.proj);
      cand.push({ polarity: name, lines: lat.lines, d: lat.d, support: lat.support,
        score: lat.score || 0, warnings: lat.warnings, peaks: pr.peaks.length });
    }
    cand.sort((a, b) => b.score - a.score);
    return cand[0];
  }

  /* ---------- 3. 真边判定与判角 ----------
     ★ 只有「局部图」才需要它：整盘 19 路四条边都是真的，判不判无所谓。
     判据：一条最外侧线上，**正交线有没有继续往它外面延伸**。
       继续 → 图在这里被裁掉了（不是真边）；不继续 → 这就是棋盘的边。 */
  function classifyEdges(P, dark, xs, ys, d, box) {
    const { w, h } = P;
    const isDark = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? false : dark[y * w + x] > 10;

    /* 从 (x,y) 沿单位方向 (ux,uy) 往外探 0.15d~0.7d，看还有没有线穿出去。
       ★ 注意方向：判左边就往**左**探（改 x 不改 y）。第一版把 x/y 传反了，
         结果四条边全判错（实测：整盘图报了「只有上下两条真边」）。 */
    function outward(x, y, ux, uy) {
      let hit = 0, tries = 0;
      for (let f = 0.15; f <= 0.7 + 1e-6; f += 0.1) {
        tries++;
        if (isDark(Math.round(x + ux * f * d), Math.round(y + uy * f * d))) hit++;
      }
      return tries ? hit / tries : 0;
    }

    const votes = { left: [], right: [], top: [], bottom: [] };
    for (const y of ys) {
      votes.left.push(outward(xs[0], y, -1, 0));
      votes.right.push(outward(xs[xs.length - 1], y, +1, 0));
    }
    for (const x of xs) {
      votes.top.push(outward(x, ys[0], 0, -1));
      votes.bottom.push(outward(x, ys[ys.length - 1], 0, +1));
    }
    /* ★ 判据是「外侧还有没有线」+「离图边有多近」：
       · 离图边 < 0.55d → 一定是被裁掉的（真棋盘边外面总有木纹余量，裁切图没有）；
       · 外侧线还在继续（>50%） → 也是被裁掉的；
       · 两条都不成立 → 真边（棋盘的边线外侧什么都没有）。 */
    const NEAR = 0.55;
    const judge = (arr, pos, max) => {
      const margin = Math.min(pos, max - 1 - pos);
      if (margin < d * NEAR) return false;
      const cont = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return cont < 0.5;
    };
    return {
      left: judge(votes.left, xs[0], w),
      right: judge(votes.right, xs[xs.length - 1], w),
      top: judge(votes.top, ys[0], h),
      bottom: judge(votes.bottom, ys[ys.length - 1], h),
    };
  }

  /* 恰好 2 条相邻真边 → 唯一角；否则 null（让用户手动选） */
  function edgesToCorner(e) {
    const n = (e.left ? 1 : 0) + (e.right ? 1 : 0) + (e.top ? 1 : 0) + (e.bottom ? 1 : 0);
    if (n !== 2) return null;
    if (e.left && e.top) return 'tl';
    if (e.right && e.top) return 'tr';
    if (e.left && e.bottom) return 'bl';
    if (e.right && e.bottom) return 'br';
    return null;
  }

  /* ---------- 4. 透视矫正 ----------
     4 点 → 4 点的单应矩阵（h[0..7]）。直接解 8×8 线性方程，
     不做矩阵求逆 —— 求逆那步最容易写错符号。 */
  function perspCoeffs(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { 0: x, 1: y } = src[i];
      const u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    /* 高斯消元（部分主元） */
    for (let c = 0; c < 8; c++) {
      let piv = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      if (piv !== c) { const t = A[piv]; A[piv] = A[c]; A[c] = t; const tb = b[piv]; b[piv] = b[c]; b[c] = tb; }
      const pv = A[c][c];
      for (let j = c; j < 8; j++) A[c][j] /= pv;
      b[c] /= pv;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c];
        if (!f) continue;
        for (let j = c; j < 8; j++) A[r][j] -= f * A[c][j];
        b[r] -= f * b[c];
      }
    }
    return b;
  }

  /* 把原图按 4 个角点拉成正方形；返回 RGBA（EXTENT+2PAD 见方）+ 映射参数 */
  function warpQuad(P, corners, extent, pad) {
    extent = extent || EXTENT; pad = pad == null ? PAD : pad;
    const side = extent + pad * 2;
    const out = new Uint8ClampedArray(side * side * 4);
    /* 目标 → 源 的映射（反向采样，避免空洞） */
    const dstPts = [[pad, pad], [pad + extent, pad], [pad + extent, pad + extent], [pad, pad + extent]];
    const h = perspCoeffs(dstPts, corners);
    if (!h) throw new Error('四角无效（三点共线？）');
    const { w, h: ih, rgba } = P;
    for (let Y = 0; Y < side; Y++) {
      for (let X = 0; X < side; X++) {
        const den = h[6] * X + h[7] * Y + 1;
        const sx = (h[0] * X + h[1] * Y + h[2]) / den;
        const sy = (h[3] * X + h[4] * Y + h[5]) / den;
        const o = (Y * side + X) * 4;
        if (sx < -1 || sy < -1 || sx > w || sy > ih) { out[o + 3] = 255; continue; }
        /* 双线性 */
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const fx = sx - x0, fy = sy - y0;
        const x1 = Math.min(w - 1, Math.max(0, x0 + 1)), y1 = Math.min(ih - 1, Math.max(0, y0 + 1));
        const xa = Math.min(w - 1, Math.max(0, x0)), ya = Math.min(ih - 1, Math.max(0, y0));
        const i00 = (ya * w + xa) * 4, i10 = (ya * w + x1) * 4, i01 = (y1 * w + xa) * 4, i11 = (y1 * w + x1) * 4;
        for (let k = 0; k < 3; k++) {
          const top = rgba[i00 + k] * (1 - fx) + rgba[i10 + k] * fx;
          const bot = rgba[i01 + k] * (1 - fx) + rgba[i11 + k] * fx;
          out[o + k] = top * (1 - fy) + bot * fy;
        }
        out[o + 3] = 255;
      }
    }
    return { data: out, width: side, height: side, extent, pad };
  }

  /* ---------- 5. 矫正图上的网格拟合 ----------
     自动路径已经由线检测给了角点，这一步其实是「在矫正图上复核一遍」：
     用户手拖角点手抖几像素时，靠它把线找回来。 */
  function detectGrid(P, opts) {
    opts = opts || {};
    /* ★ 只在**矫正出来的那块棋盘**里找线（PAD 那圈留白不算）：
       留白里是棋盘外的木纹/白边/坐标文字，把 19 路找成 28 路就是这么来的（实测）。 */
    const box = opts.box || { x0: 0, y0: 0, x1: P.w - 1, y1: P.h - 1 };
    const maps = darknessMap(P, Math.max(3, Math.round(Math.min(P.w, P.h) / 120)));
    const ax = detectAxis(P, maps, box, 'x');
    const ay = detectAxis(P, maps, box, 'y');
    const warnings = [...ax.warnings, ...ay.warnings];
    if (ax.polarity === 'light') warnings.push('网格线比底色亮（深色主题），已按亮线识别');
    return {
      xs: ax.lines.map(v => v + box.x0),
      ys: ay.lines.map(v => v + box.y0),
      dx: ax.d, dy: ay.d,
      supportX: ax.support, supportY: ay.support,
      nx: ax.lines.length, ny: ay.lines.length, warnings,
    };
  }

  /* 把线阵列强制成 n 条：多了砍两端（保中间），少了按拟合出的 d 往外补 */
  function forceCount(lines, d, n) {
    if (!lines.length || !n) return lines.slice();
    if (lines.length === n) return lines.slice();
    if (lines.length > n) {
      const drop = lines.length - n;
      const a = Math.floor(drop / 2);
      return lines.slice(a, a + n);
    }
    const out = lines.slice();
    while (out.length < n) out.push(out[out.length - 1] + d);
    return out;
  }

  /* ---------- 6. 交点采样与黑白分类 ----------
     ★ 关键不是阈值本身，而是**背景标定**：在每个「格心」（两根线中间）取小圆求中位亮度/饱和，
       得到「这块盘此刻的底色」。整盘偏黄、偏亮、偏暗都被这一标定吃掉，
       比全图 k-means 三簇稳（那一套在「白子多」的局面会把白子算成底色）。
     ★★ 2026-10-30 实测踩出来的（图片识谱接入界面时才暴露）：
       「格心小圆的中位数」是**整数**（中位数取自整数亮度的数组），324 个整数再取中位数，
       结果只能落在整数半档上 —— 解码器差 ±1 灰度（Chromium 的 ICC 转换 vs sips 的转换），
       这个标定值就跳 0.3，而白子的判定分正好压在阈值上 → 同一张图**同一个算法**，
       界面里认出 83 颗、命令行里认出 94 颗（少的 11 颗全是白子）。
       改成**截尾均值**：仍然抗离群（砍掉两端 10%），但对输入连续 —— 同样的 ±1 只让它动 0.02。 */
  function trimmedMean(arr, frac) {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr);
    a.sort();
    const k = Math.floor(a.length * (frac == null ? 0.1 : frac));
    if (a.length - 2 * k <= 0) return a[a.length >> 1];
    let sum = 0;
    for (let i = k; i < a.length - k; i++) sum += a[i];
    return sum / (a.length - 2 * k);
  }

  function circleOffsets(r) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r + 0.001) out.push(dx, dy);
      }
    }
    return out;
  }

  function sampleStats(P, cx, cy, off) {
    const { w, h, lum, sat } = P;
    const L = [], S = [];
    const bx = Math.round(cx), by = Math.round(cy);
    for (let i = 0; i < off.length; i += 2) {
      const x = bx + off[i], y = by + off[i + 1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const idx = y * w + x;
      L.push(lum[idx]); S.push(sat[idx]);
    }
    if (!L.length) return null;
    L.sort((a, b) => a - b); S.sort((a, b) => a - b);
    return { lum: L[L.length >> 1], sat: S[S.length >> 1], L, n: L.length };
  }

  function classify(P, grid) {
    const { xs, ys } = grid;
    const nx = xs.length, ny = ys.length;
    const cell = (grid.dx + grid.dy) / 2;
    const rSample = Math.max(3, Math.round(cell * 0.34));
    const rBg = Math.max(2, Math.round(cell * 0.09));
    const offS = circleOffsets(rSample), offB = circleOffsets(rBg);

    /* 背景标定：所有格心取中位数 */
    const bgL = [], bgS = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const st = sampleStats(P, xs[i] + grid.dx / 2, ys[j] + grid.dy / 2, offB);
        if (st) { bgL.push(st.lum); bgS.push(st.sat); }
      }
    }
    const boardLum = bgL.length ? trimmedMean(bgL) : 180;
    const boardSat = bgS.length ? trimmedMean(bgS) : 0.25;

    const board = new Int8Array(nx * ny);
    const conf = new Float32Array(nx * ny);
    const uncertain = [];
    let stoneCount = 0;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const st = sampleStats(P, xs[i], ys[j], offS);
        const idx = j * nx + i;
        if (!st) { board[idx] = UNKNOWN; conf[idx] = 0.3; uncertain.push([i, j]); continue; }
        let dark = 0, light = 0;
        /* 「亮分」用**软计数**，不数「多少个样本超过 boardLum+24」。
           ★★ 为什么（2026-10-30 实测，接入界面才暴露）：硬计数的阈值是悬崖 ——
              白子的高光正好压在 +24 那条线上，boardLum 抖动 0.3（解码器差 ±1 灰度）
              就让 lightF 从 0.24 掉到 0.20，whiteScore 从 0.719 掉到 0.676，
              越过 0.68 → 同一张图 11 颗白子整片消失（命令行 94 颗、界面 83 颗）。
              软计数把每个样本按「高过背景多少」给 0~1 分（+12 起算、+36 封顶），
              同样的抖动只让 lightF 动千分之几，不再决定一颗子的生死。
           ★ 黑的那一侧**故意保留硬计数**：黑子分数本来就远在阈值之上（≈3.4），
             那里没有悬崖，改成软的只是白白让判据变模糊。 */
        let lightSoft = 0;
        for (let k = 0; k < st.n; k++) {
          const v = st.L[k];
          if (v < boardLum - 28) { dark++; continue; }
          const t = (v - boardLum - 12) / 24;
          if (t > 0) lightSoft += t > 1 ? 1 : t;
        }
        const darkF = dark / st.n, lightF = lightSoft / st.n;
        const blackScore = Math.max(0, (boardLum - st.lum) / 46) + darkF;
        const whiteScore = Math.max(0, (st.lum - boardLum) / 38) + lightF * 0.85
          + Math.max(0, (boardSat - st.sat) / 110);

        let v = EMPTY, c;
        if (blackScore >= 0.72 && blackScore > whiteScore + 0.18) {
          v = BLACK;
          c = Math.min(1, 0.68 + Math.max(0, blackScore - 0.72) * 0.22 + Math.max(0, blackScore - whiteScore - 0.18) * 0.22);
        } else if (whiteScore >= 0.68 && whiteScore > blackScore + 0.16) {
          v = WHITE;
          c = Math.min(1, 0.68 + Math.max(0, whiteScore - 0.68) * 0.22 + Math.max(0, whiteScore - blackScore - 0.16) * 0.22);
        } else {
          v = EMPTY;
          c = Math.max(0.45, Math.min(1, 1 - Math.max(blackScore / 0.72, whiteScore / 0.68) * 0.46));
          /* 空点也可能处在模糊带（有子但没到阈值）→ 让用户看一眼 */
          if (Math.max(blackScore / 0.72, whiteScore / 0.68) > 0.72) uncertain.push([i, j]);
        }
        board[idx] = v; conf[idx] = c;
        if (v !== EMPTY) stoneCount++;
        if (c < CONF_UNCERTAIN && v !== EMPTY) uncertain.push([i, j]);
      }
    }
    return { board, conf, nx, ny, boardLum, boardSat, uncertain, stoneCount, cell };
  }

  /* ---------- 7. 变换（旋转 / 镜像）----------
     ★ 只改「图方向」的矩阵与角标注，**不动网格参数** —— 网格是原图的属性。
     非方阵转 90° 会交换 nx↔ny，这条不写死的话锚定会静默错位。 */
  const CORNER_ROT = { tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' };   // 顺时针 90°
  const CORNER_MIRROR = { tl: 'tr', tr: 'tl', br: 'bl', bl: 'br' }; // 左右镜像
  const CORNER_FLIP = { tl: 'bl', bl: 'tl', tr: 'br', br: 'tr' };   // 上下镜像

  function applyXform(src, kind) {
    const { board, conf, nx, ny } = src;
    const corner = src.corner || 'tl';
    let outB, outC, w = nx, h = ny, cornerOut = corner;

    const get = (b, x, y, W) => b[y * W + x];
    if (kind === 'rot90') {
      w = ny; h = nx; outB = new Int8Array(w * h); outC = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        /* 新 (x,y) ← 旧 (y, ny-1-x)  [顺时针] */
        const ox = y, oy = ny - 1 - x;
        outB[y * w + x] = get(board, ox, oy, nx); outC[y * w + x] = get(conf, ox, oy, nx);
      }
      cornerOut = CORNER_ROT[corner] || corner;
    } else if (kind === 'rot180') {
      w = nx; h = ny; outB = new Int8Array(w * h); outC = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ox = nx - 1 - x, oy = ny - 1 - y;
        outB[y * w + x] = get(board, ox, oy, nx); outC[y * w + x] = get(conf, ox, oy, nx);
      }
      cornerOut = CORNER_FLIP[CORNER_MIRROR[corner]] || corner;
    } else if (kind === 'flipH') {
      w = nx; h = ny; outB = new Int8Array(w * h); outC = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ox = nx - 1 - x;
        outB[y * w + x] = get(board, ox, y, nx); outC[y * w + x] = get(conf, ox, y, nx);
      }
      cornerOut = CORNER_MIRROR[corner] || corner;
    } else if (kind === 'flipV') {
      w = nx; h = ny; outB = new Int8Array(w * h); outC = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const oy = ny - 1 - y;
        outB[y * w + x] = get(board, x, oy, nx); outC[y * w + x] = get(conf, x, oy, nx);
      }
      cornerOut = CORNER_FLIP[corner] || corner;
    } else {
      outB = board.slice(); outC = conf.slice();
    }
    return { board: outB, conf: outC, nx: w, ny: h, corner: cornerOut, boardLum: src.boardLum, boardSat: src.boardSat };
  }

  /* ---------- 8. 贴角归一 ----------
     把矩阵翻成「从贴的那个角往内数」：row 0 = 离该角最近的一行，col 0 = 最近的一列。
     这样锚定公式对四个角都是同一套（见 anchorTo19），不用写四份。 */
  function orientToCorner(src, corner) {
    const b = src.board, c = src.conf, nx = src.nx, ny = src.ny;
    const needH = (corner === 'tr' || corner === 'br');   // 右侧的角 → 左右翻
    const needV = (corner === 'bl' || corner === 'br');   // 下方的角 → 上下翻
    if (!needH && !needV) return { board: b, conf: c, nx, ny };
    const outB = new Int8Array(nx * ny), outC = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) {
      for (let k = 0; k < nx; k++) {
        const sr = needV ? (ny - 1 - r) : r;
        const sc = needH ? (nx - 1 - k) : k;
        outB[r * nx + k] = b[sr * nx + sc];
        outC[r * nx + k] = c[sr * nx + sc];
      }
    }
    return { board: outB, conf: outC, nx, ny };
  }

  /* ---------- 9. 锚定到 19 路 ----------
     (c,r) 是「从贴角往内数」的局部坐标；off 是偏移（0 = 紧贴角）。
     19/13/9 全是奇数 → 整盘居中时 (19−n)/2 是整数，且天元对齐（不是将就，是唯一合理贴法）。 */
  function anchorTo19(c, r, corner, off) {
    off = off || 0;
    switch (corner) {
      case 'tl': return [off + c, off + r];
      case 'tr': return [18 - off - c, off + r];
      case 'bl': return [off + c, 18 - off - r];
      case 'br': return [18 - off - c, 18 - off - r];
    }
    return [off + c, off + r];
  }

  /* 把一块（可能局部的）矩阵落到 19×19 上。返回 { stones:[{x,y,color}], bad:[...] } */
  function toBoard19(src, opts) {
    const o = opts || {};
    const corner = o.corner || 'tl';
    const off = Math.max(0, Math.min(18, o.off | 0));
    const or = orientToCorner(src, corner);
    const stones = [], bad = [];
    for (let r = 0; r < or.ny; r++) {
      for (let c = 0; c < or.nx; c++) {
        const v = or.board[r * or.nx + c];
        if (v === EMPTY || v === UNKNOWN) continue;
        const [X, Y] = anchorTo19(c, r, corner, off);
        if (X < 0 || Y < 0 || X > 18 || Y > 18) { bad.push([c, r]); continue; }
        stones.push({ x: X, y: Y, color: v === BLACK ? 'b' : 'w' });
      }
    }
    return { stones, bad, nx: or.nx, ny: or.ny };
  }

  /* ---------- 10. 导出 SGF ----------
     静态局面 = 根节点上的 AB/AW + PL（谁该走）。没有手顺，也不编手顺。
     ★ cols 由调用方传（app.js 的 SGF_COLS，含 i），本文件不复制坐标表。 */
  function sgfEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  }
  function toSGF(stones, opts) {
    const o = opts || {};
    const cols = o.cols || 'abcdefghijklmnopqrs';
    const size = o.size || 19;
    const komi = o.komi == null ? 7.5 : o.komi;
    const ru = o.ru || 'Chinese';
    const pl = o.pl === 'w' ? 'W' : 'B';
    const sgfPt = (x, y) => '[' + cols[x] + cols[y] + ']';
    const b = stones.filter(s => s.color === 'b').map(s => sgfPt(s.x, s.y)).join('');
    const w = stones.filter(s => s.color === 'w').map(s => sgfPt(s.x, s.y)).join('');
    let s = '(;GM[1]FF[4]SZ[' + size + ']CA[UTF-8]AP[RapaceGo:0.3]KM[' + komi + ']RU[' + ru + ']PL[' + pl + ']';
    if (b) s += 'AB' + b;
    if (w) s += 'AW' + w;
    if (o.comment) s += 'GC[' + sgfEscape(o.comment) + ']';
    return s + ')';
  }

  /* ---------- 11. 总入口 ----------
     opts:
       corners  手动四角 [[x,y]×4]（tl,tr,br,bl 顺序）；不给就自动找
       size     强制整盘路数（19/13/9）；不给就自动
       返回的 board 是「图方向」的矩阵（row0 = 图的上边） */
  function analyze(img, opts) {
    const o = opts || {};
    const t0 = now();
    const P = prep(img.data, img.width, img.height);
    const warnings = [];
    let corners = o.corners || null;
    let edges = null, corner = null;

    if (!corners) {
      const roi = findRoi(P);
      if (!roi.found) warnings.push('没找到棋盘底色（可能是纯白底死活题图），已按整图处理');
      const box = { x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1 };
      const maps = darknessMap(P, Math.max(3, Math.round(Math.min(P.w, P.h) / 120)));
      const ax = detectAxis(P, maps, box, 'x');
      const ay = detectAxis(P, maps, box, 'y');
      warnings.push(...ax.warnings, ...ay.warnings);
      if (ax.lines.length < 3 || ay.lines.length < 3) {
        throw new Error('网格检测失败：只找到 ' + ax.lines.length + ' 竖线 × ' + ay.lines.length + ' 横线。'
          + '请手动点四个角，或换一张只截棋盘的图。');
      }
      const xs = ax.lines.map(v => v + box.x0);
      const ys = ay.lines.map(v => v + box.y0);
      const d = (ax.d + ay.d) / 2;
      edges = classifyEdges(P, maps.dark, xs, ys, d, box);
      corner = edgesToCorner(edges);
      corners = [[xs[0], ys[0]], [xs[xs.length - 1], ys[0]], [xs[xs.length - 1], ys[ys.length - 1]], [xs[0], ys[ys.length - 1]]];
    } else {
      warnings.push('已用手动四角（自动定位被跳过）');
    }

    const warped = warpQuad(P, corners, EXTENT, PAD);
    const W = prep(warped.data, warped.width, warped.height);

    /* 矫正图上复核网格。手拖角点有偏差时，这一步把线找回来；
       o.size 给了就按它定条数，否则用检出的条数。 */
    let g = detectGrid(W, { box: { x0: PAD - 8, y0: PAD - 8, x1: PAD + EXTENT + 8, y1: PAD + EXTENT + 8 } });
    const gRaw = { nx: g.nx, ny: g.ny, dx: g.dx, dy: g.dy, xs: g.xs.slice(), ys: g.ys.slice() };
    if (o.size) {
      g.xs = forceCount(g.xs, g.dx, o.size);
      g.ys = forceCount(g.ys, g.dy, o.size);
      g.nx = g.xs.length; g.ny = g.ys.length;
    }
    if (g.nx < 2 || g.ny < 2) throw new Error('矫正后没找到网格（只有 ' + g.nx + '×' + g.ny + ' 条线）');
    if (g.nx > 19 || g.ny > 19) {
      throw new Error('检出 ' + g.nx + '×' + g.ny + ' 条线，超过 19 路 —— 请只截棋盘本体，别把坐标/表格带进来');
    }

    const cls = classify(W, g);
    /* ★ 白底白子是**已知识别不了的**（白子与底色同色，没有可用的对比信号）。
       真实场景里这种图多半来自纯白底的棋谱书 / 白主题 App —— 与其悄悄漏检，
       不如直说，让用户逐点核对。 */
    if (cls.boardLum > 235) {
      warnings.push('底色很亮（亮度 ' + Math.round(cls.boardLum)
        + '）：白子可能与底色同色，白色棋子会漏检，请逐点核对');
    }
    const ms = Math.round(now() - t0);
    return {
      ok: true, ms,
      nx: cls.nx, ny: cls.ny,
      board: cls.board, conf: cls.conf,
      corner, edges,
      boardLum: Math.round(cls.boardLum), boardSat: +cls.boardSat.toFixed(3),
      cell: +cls.cell.toFixed(1),
      uncertain: cls.uncertain, stoneCount: cls.stoneCount,
      grid: { xs: g.xs, ys: g.ys, dx: g.dx, dy: g.dy },
      rawGrid: gRaw,
      corners, warped: { data: warped.data, width: warped.width, height: warped.height, pad: PAD, extent: EXTENT },
      warnings,
    };
  }

  const V = {
    EXTENT, PAD, EMPTY, BLACK, WHITE, UNKNOWN, CONF_UNCERTAIN,
    prep, analyze, detectGrid, classify, warpQuad, perspCoeffs,
    applyXform, orientToCorner, anchorTo19, toBoard19, toSGF, forceCount,
    _internal: { findRoi, projectLines, fitLattice, detectAxis, classifyEdges, edgesToCorner, medianOf, darknessMap, backgroundMean },
  };

  root.Vision = V;
  if (typeof module === 'object' && module.exports) module.exports = V;
})(typeof globalThis !== 'undefined' ? globalThis : this);
