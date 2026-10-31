/* 渲染进程 ↔ 主进程 的桥（contextIsolation 下唯一通道） */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 引擎状态：{ ok, model, ready, error } */
  engineStatus: () => ipcRenderer.invoke('engine:status'),

  /* 当前版本号（如 '0.1.1'）。界面显示在「帮助」面板上 —— 用户靠它判断要不要更新。 */
  appVersion: () => ipcRenderer.invoke('app:version'),

  /* ★ 引擎后端自检（2026-10-07 新增）：
     → Promise<{ backend: { ok, raw, name, brand, downloads, version }, gpu: { brand, name }, warn }>
     backend.raw = kataGo 自报的后端（cuda / opencl / metal / rocm / eigen …）
     gpu.brand   = 屏幕这块卡的品牌（nvidia / amd / intel / apple，认不出就是空串）
     warn        = 两边对不上时给用户的一句具体建议（对得上就是空串）
     用途：用户装了 N 卡专用版却在 A 卡机器上跑时，界面能明确告诉他去换哪个包，
     而不是只显示「引擎起不来」。只读探测，不改任何配置。 */
  engineCheck: () => ipcRenderer.invoke('engine:check'),

  /* 请求分析（strong 引擎）：{ initialStones, moves, rules, komi, size, maxVisits }
     → Promise<最终报告 | { error }> */
  analyze: req => ipcRenderer.invoke('engine:analyze', req),

  /* 请求 AI 落子（human 引擎）：多一个 profile = 真实段位（如 'rank_3d'）
     → Promise<最终报告 | { error }> */
  playMove: req => ipcRenderer.invoke('engine:play', req),

  /* AI 复盘（整盘逐手）：请求带 analyzeTurns=[0..N]（N = 手数，多算一个末端回合）
     → Promise<{ turns: [...每回合报告] } | { error }>
     进度用 onReviewProgress 订阅 */
  review: req => ipcRenderer.invoke('engine:analyze', req),
  onReviewProgress: cb => ipcRenderer.on('engine:review-progress', (_e, d) => cb(d)),

  /* 取消当前分析（切局面时用） */
  cancel: () => ipcRenderer.invoke('engine:cancel'),

  /* 引擎中途报告（边算边刷） */
  onProgress: cb => ipcRenderer.on('engine:progress', (_e, d) => cb(d)),

  /* 引擎状态变化（就绪 / 出错 / 退出 / 已暂停）
     → { analyze, play, coach } 各含 { state, ready, paused, error, model, pid, kind }
     state: 'off'（未加载）| 'loading' | 'ready' | 'paused' | 'error' */
  onStatus: cb => ipcRenderer.on('engine:status', (_e, d) => cb(d)),

  /* ★ 引擎加载 / 卸载 / 暂停 / 恢复（key = 'analyze' | 'play' | 'coach'）
     2026-10-05 用户要求：引擎**默认不加载**，打开软件不吃显存；
     要用了手动点一下（顶栏的引擎状态灯）。暂停只对 KataGo 有意义，
     LoGos 没有「暂停」（它平时不干活），对应的操作是「中止」。 */
  engine: {
    load:   key => ipcRenderer.invoke('engine:load', key),
    unload: key => ipcRenderer.invoke('engine:unload', key),
    pause:  key => ipcRenderer.invoke('engine:pause', key),
    resume: key => ipcRenderer.invoke('engine:resume', key),
  },

  /* ★ LoGos 讲解（本地 llama-server）
     - prompt 由**渲染进程**拼好（坐标转换/棋盘矩阵/长短要求都在 app.js 里），
       主进程只做「转发 + 掐断」这条管道。
     - explain(req) → Promise<{ text, aborted } | { error }>
       req: { id, prompt, maxTokens, temperature, stop[] }
     - 流式：onProgress 每吐一小段就回调一次 { id, text, full } */
  coach: {
    explain: req => ipcRenderer.invoke('coach:explain', req),
    cancel:  ()  => ipcRenderer.invoke('coach:cancel'),
    onProgress: cb => ipcRenderer.on('coach:progress', (_e, d) => cb(d)),
  },

  /* 在桌面创建 / 刷新快捷方式（设置面板里的按钮用）
     → { ok: true, path } | { error } */
  makeShortcut: () => ipcRenderer.invoke('app:makeShortcut'),

  /* 设置：KataGo 路径与权重（左上角「设置」）
     get    → { config, files:{katago,analyzeWeight,playWeight}, defaults }
     choose → 弹系统文件框，{ path, ok, suggest? } | { canceled:true }（**不保存**）
     check  → { katago, analyzeWeight, playWeight }（只检测）
     save   → 写盘 + 按新路径重启两个引擎 → { ok, config } | { error } */
  settings: {
    get:    ()     => ipcRenderer.invoke('settings:get'),
    choose: kind   => ipcRenderer.invoke('settings:choose', kind),
    check:  c      => ipcRenderer.invoke('settings:check', c),
    save:   c      => ipcRenderer.invoke('settings:save', c),
  },

  /* 棋谱库（软件目录下的 records/，只放 sgf）
     list → [{name, size, mtime}]；read/save/rename/remove → 文件操作；dir → 目录路径 */
  records: {
    list:   ()        => ipcRenderer.invoke('records:list'),
    read:   name      => ipcRenderer.invoke('records:read', name),
    save:   (name, text) => ipcRenderer.invoke('records:save', name, text),
    rename: (a, b)    => ipcRenderer.invoke('records:rename', a, b),
    remove: name      => ipcRenderer.invoke('records:delete', name),
    dir:    ()        => ipcRenderer.invoke('records:dir'),
    openDir: ()       => ipcRenderer.invoke('records:openDir'),
    setDir: dir       => ipcRenderer.invoke('records:setDir', dir),
    /* 导入棋谱：弹系统文件框（可多选）→ 复制进棋谱库
       → { canceled:true } | { ok:true, imported:[文件名], failed:[原因] } | { error } */
    importSgf: ()     => ipcRenderer.invoke('records:import'),
    /* 备注：只写 SGF 的 GN 字段，**不动文件名**（改名走 rename，界面入口是双击棋谱名） */
    setNote: (name, note) => ipcRenderer.invoke('records:setNote', name, note),
    /* 改名：真改文件名，复盘报告 / 讲解 / 复盘进度会跟着一起改名（main.js 的 records:rename） */
    saveReview: (name, json) => ipcRenderer.invoke('records:saveReview', name, json),
    readReview: name => ipcRenderer.invoke('records:readReview', name),
    /* ★ 复盘**中间结果**（<棋谱名>.review.part.json）—— 断点续算用：
       整盘复盘在重权重上要几十分钟，停止/崩溃后下次只补没算完的手。 */
    saveReviewPart: (name, json) => ipcRenderer.invoke('records:saveReviewPart', name, json),
    readReviewPart: name => ipcRenderer.invoke('records:readReviewPart', name),
    deleteReviewPart: name => ipcRenderer.invoke('records:deleteReviewPart', name),
    /* ★ 全盘讲解的结果（逐手存下来的一整盘）—— 跟棋谱存在一起，下次打开直接就有 */
    saveCoach: (name, json) => ipcRenderer.invoke('records:saveCoach', name, json),
    readCoach: name => ipcRenderer.invoke('records:readCoach', name),
  },

  /* ★ 习题题集（2026-10-14）：软件目录下的 puzzles/，只放 sgf。
     和棋谱库是**两个目录**：records/ 是「一局棋」，puzzles/ 是「一套题」
     （一份 SGF 里可能并列串着几百道题）。分开的理由见 main.js 的 puzzles 段注释。
       list   → [{ name, size, mtime }]（**不含题数** —— 题数由界面自己数，
                保证"怎么把 SGF 切成一道道题"只有一处实现）
       read   → { ok, text } | { error }
       import → 弹系统文件框（单选）→ 复制进 puzzles/（重名加 (2)，**不覆盖**）
                → { canceled:true } | { ok:true, name } | { error }
       importRecord → 把棋谱库里某一份棋谱复制成题集（「当题练」用，原棋谱不动）
       rename / remove / dir / openDir → 同棋谱库那套 */
  puzzles: {
    list:   ()            => ipcRenderer.invoke('puzzles:list'),
    read:   name          => ipcRenderer.invoke('puzzles:read', name),
    import: ()            => ipcRenderer.invoke('puzzles:import'),
    importRecord: name    => ipcRenderer.invoke('puzzles:importRecord', name),
    rename: (a, b)        => ipcRenderer.invoke('puzzles:rename', a, b),
    remove: name          => ipcRenderer.invoke('puzzles:delete', name),
    /* ★ 2026-10-31：往一份题集里再加一道题 / 新建一份空题集（见 main.js 那段注释）。
       append 与 import 的重名策略**相反**：import 加 (2) 不覆盖，append 必须写进点名那一份。 */
    append: (name, text)  => ipcRenderer.invoke('puzzles:append', name, text),
    create: name          => ipcRenderer.invoke('puzzles:create', name),
    dir:    ()            => ipcRenderer.invoke('puzzles:dir'),
    openDir: ()           => ipcRenderer.invoke('puzzles:openDir'),
  },

  /* ★ 图片识谱（2026-10-30）：
       pick() → 弹系统文件框挑一张图
                → { canceled:true } | { ok:true, name, bytes, dataUrl } | { error }
                图片**只到渲染进程为止**（dataUrl 在内存里，不上传、不落盘）——
                识别全在 renderer/vision.js 里做，纯 JS、无第三方库。
       save(dest, name, text) → 把认出来的局面写成 SGF
                dest: 'record'（棋谱库 records/）| 'puzzle'（题集 puzzles/）
                → { ok:true, name, dest } | { error }；重名加 (2)(3)…，不覆盖 */
  vision: {
    pick: ()              => ipcRenderer.invoke('vision:pick'),
    save: (dest, name, t) => ipcRenderer.invoke('vision:save', dest, name, t),
  },

  /* 关于与更新（2026-10-08 用户要求，放在设置面板里）
     info()         → { version, downloadUrl, lastCheck }
     checkUpdate()  → { ok:true, current, latest, upToDate, ... } | { ok:false, error }
     openDownload() → 用系统浏览器打开 GitHub 上最新版的发布页 */
  app: {
    info:         () => ipcRenderer.invoke('app:info'),
    checkUpdate:  () => ipcRenderer.invoke('app:checkUpdate'),
    openDownload: () => ipcRenderer.invoke('app:openDownload'),
  },
});
