# dev —— 开发与测试脚本（下载软件的人**不需要**这些）

这个目录是给**改代码的人**用的。软件本身只需要仓库根目录的那些文件
（`main.js`、`preload.js`、`renderer/`、`engine.cfg`、`package.json`）。

> 为什么单独放一个目录（2026-10-07）：这 50 多个脚本原来散在仓库根目录，
> GitHub 的仓库页会先列一长串文件、README 渲染在下面 —— 访客得滚半天才看到产品介绍。
> 搬进来之后根目录只剩 16 个文件。

## 文件分类

| 前缀 | 是什么 | 例子 |
|---|---|---|
| `_cdp_*.mjs` | **端到端测试**（驱动真界面，靠 CDP 调试端口） | `_cdp_regress.mjs`（综合回归，最常跑）、`_cdp_ko.mjs`（打劫/倒扑）、`_cdp_jump.mjs`（涨跌数字）、`_cdp_tsumego.mjs`（习题练习 + 导入 SGF 题集）、`_cdp_variation.mjs`（手数卡的分支树 + 切换 + 导出保留分支；夹具在 `_trash/fixtures/tree/`，`10-nested-branch.sgf` 是三层分支）、`_cdp_moveinfo.mjs`（右侧「解说词」卡的逐手分析明细 + 「双方都由 KATAGO 走」的判据；不需要真引擎）、`_cdp_export.mjs`（导出命名 / 棋谱库列表 / 复盘按钮合并 / 连停一手终局 / 回看不显示胜负 / 导出带分析）、`_cdp_branch.mjs`（默认坐标 / 回看落子开分支 + 手数卡变树 + 导出带分支 / 复盘按钮同宽白底）、`_cdp_review.mjs`（复盘管线五块：细进度 / 分块落盘 / 停止不覆盖旧报告 / 断点续算 / **终局棋谱不被自动数子掐断** / **最后一块只剩 1 个回合也要算完**；★ 用 A/B/C/D 四份棋谱 —— KataGo 跨请求复用搜索树，同一局面重跑会瞬时完成，测不出真行为；★ ④ 专门回归「打开下完的棋谱 → 700ms 后自动数子 → cancel() 把复盘第一块当成用户停止」这个 bug，短棋谱（A/B 都不终局）永远测不出来；★ ⑤ 夹具 D 只放 **10 手**（回合 0..10 = 11 个 → 第二块恰好是 [10] 单个回合），回归「手数 % 10 === 0 时复盘永远停在 N / N+1 手、点接着算也补不上」）、`_cdp_review_branch.mjs`（**分支复盘 + 导出带分析**，十块：主线复盘存 v3 → 切分支不冒充主线报告 → 「复盘这条分支」复用共享前缀、两条线写进同一个 json → 切回主线看主线那份 → 导出棋谱时把下棋攒的分析存成 live 报告 → 再打开就有目损 → 导出含**各分支** live → `scope:'all'` 一次算全部分支（总数 = (N+1)×条数、进度文案含「第 N 条分支」、文件里每条线 `losses.length === n`）→ **切分支走势图跟着换**（末回合胜率相差 > 0.03 + 画布指纹不同 + 标题含「2 条分支」；切回来**不用画布字节比**，因为 `applyVariationLine` 会重排实时分析，改比末值差 < 0.02）→ 切到未复盘分支弹窗询问（含「复用」、点「暂不」后不再问）。★ ⑦/⑨ 在 `openRecord` 之后**轮询到报告装好**（最多 5 秒）再断言 —— 原来是固定 sleep(1200) / sleep(900)，偶发把「`autoLoadReviewDoc` 还没装完」当成功能 bug（⑨ 会看到两条线末值只差 0.002，像是共享前缀把主线数据抄给了分支）。★ 夹具是两条**只差第 7 手**的 12 手线，分支那条下在 1-1 角（明显劣势）—— 否则两条曲线几乎重合，⑨ 测不出来）、`_cdp_export_branch.mjs`（**导出时每条分支的解说词（C[]）和复盘 json 都要存**，十块，**不需要真引擎**：两条线各喂满 `applyAnalysis` 快照 → 导出后主线 12 手 / 分支 12 手**全有 C[]**（17 个分析 + 1 个原生解说）、**原生解说不被分析覆盖** → 切回主线时 `anaAt` 只剩共享前缀，靠 `curLineAnaAt()`（留档 + 现在的）补齐 → 复盘 json 两条线都 `source='live'` 且 `losses.length === n` → 重开后两条线的解说词与目损都在。★ 夹具两条线的分数刻意差很远（黑+3 / 白+7.5），否则分不出这段解说词是谁的）、`_cdp_export_once.mjs`（**同一局导出不要存出一堆副本**，十块，不需要真引擎：新局导出 → 再导出（同名、文件数不变、提示「已更新棋谱库…同一局覆盖」）→ 落子后再导出（同名、磁盘内容真更新到 4 手）→ 开新局后 `state.exportName` 清空 → 打开**自家导出的**棋谱再导出（写回原文件、文件数不变、提示「已写回…就是你在看的这份」）→ 打开**外来**棋谱（夹具没有 `AP[RapaceGo]`）导出（另存一份、原件一个字节都不动）。★ 外来棋谱必须另存：`buildSGF()` 是重建整份棋谱，写回会把 GN/DT/EV 这些属性弄丢）`_cdp_batch_reuse.mjs`（**全盘讲解复用复盘数据 + 跑完摊成「全盘」**，需要真 KataGo + LoGos：先直调 `reviewLineJob` 给一份 6 手棋谱做正式复盘 → 点「全盘讲解」，判据是**进度条上有没有出现过「正在让 KataGo 算一遍」**（不做代码分支断言）＋状态栏有没有说「已经复盘过」＋第一手讲解的延迟 ≪ 复盘本身耗时 → 跑完 `allView` 自动打开、`#explain-body` 里 6 行、点第二行跳到第 2 手且视图不关、点「返回」回到单手视图 → 全部讲过再点「全盘讲解」不发请求直接摊开 → **反向对照**：把 `settings.reviewVisits` 从 500 改到 300（环境签名变了）必须重新算。★ 需要 2~4 分钟（LoGos 每手几秒）） |
| `fixtures/` | **测试夹具**（进仓库）。用时由启动命令复制进测试用的临时目录 | `测试题集-3题.sgf`（3 道 9 路题：带变体 / 带根节点 C[] / 没写 PL） |
| `_rtest.py` | **跑 CDP 测试的启动器**：拉起 Electron（带调试口）→ 跑脚本 → 截图 → 关掉 | — |
| `_lint_*.mjs` | **静态检查**（不需要跑界面） | `_lint_ids`（DOM id 对不上）、`_lint_ipc`（IPC 契约）、`_lint_hidden`（`[hidden]` 被 display 压过） |
| `_smoke.mjs` | 冒烟：把主要路径点一遍，看有没有运行时错误 | — |
| `_precheck.mjs` | **预检**：① 先 `node --check` 每个脚本**整份文件**的语法；② 再把 CDP 脚本里每个模板串**真求值一遍**并做语法检查（这是唯一能抓「模板串里的转义/反引号出错」的办法）。改完 `dev/*.mjs` 就顺手跑它 |
| `_deploy.sh` / `_sync_deploy.ps1` | 发布：提交 + 打 tag + 发 Release / 同步到免解压版 | — |
| `_build_lazy.ps1` / `_update_lazy.ps1` | 重建懒人包 / 把新版程序拷进懒人包 | — |
| `_check_encodings.ps1` | 检查 `.bat` 的 BOM / CRLF / `%~dp0`（踩过好几次） | — |

> **2026-10-23 新增的两个**（都跟「全盘讲解」有关）：
> - `_cdp_batch_reuse.mjs` —— 全盘讲解阶段①复用复盘、跑完摊开。★ ㉑ 已改判据：**换搜索量后仍然复用**
>   （老复盘 100 次 vs 默认 500 次，以前会因为这一处不等而整盘白算），另加「环境核心不含搜索量」
>   「换权重就不能借」两条纯函数边界。需要真 KataGo + LoGos（复盘 44s + 讲完 61s）。
> - `_cdp_coach_reuse.mjs` —— **不需要真引擎**：造 12 手棋谱 + 一份 100 次的老复盘 → 断言阶段①
>   `computed === false`、借到 13/13、`visits === 100`、`histVisits` 如实；再验打开带讲解的棋谱
>   **自动摊成全盘**、空讲解文件有提示、`saveReviewFromTurns` 落成正式复盘且不覆盖已有报告。
>   ★ 2026-10-23 深夜加了 ⑥⑦（共 31 项）：
>   - ⑥ **单条「讲解这手」也吃复盘数据**：把 `coachReady` 强行置 true、`engineReady` 置 false ——
>     页面上还能出现「数字用的是复盘数据」，就证明没走 `api.analyze`（否则会卡在"先加载 KataGo"）。
>   - ⑦ **有分支的棋谱讲解按线存**：两条线各写各的 → 切分支后 `explain` 为空（不串）→ 切回来恢复 →
>     文件 v2 的 `lines` 里两条线各带各的 `n` 和正文。
>   - ⑧ **合并后的讲解卡布局**（共 57 项，2026-10-24 改成「一块正文区、三个页」后重写）：
>     左栏只剩 2 张常驻卡、卡高 > 300px、两页正文在同一个滚动区里、
>     **同一时刻只有一页可见**（切到推荐落点那页时分析讲解收起）、卡片标题跟着页变、
>     无横向滚动条、三个按钮**同一行 / 不折字 / 不溢出卡片 / 在滚动区下方**、总宽 ≤ 内容宽。
>     ★ 全是**真实几何**（`getBoundingClientRect`），不查 `hidden` 本身。
>   - ⑨⑩ **讲过的直接显示**（2026-10-24 用户要求）：把 `coachReady` / `engineReady` 都置 false，
>     再塞一份假缓存 → 点「讲解这手」/「推荐落点讲解」必须**同步**把缓存正文摆出来、
>     不进入「讲解中…」、不弹「引擎还没加载」、并切到对应那一页。命中缓存就不该发任何请求。
>   - ⑪ **切手数时推荐落点讲解要跟着换**（2026-10-24 晚报障：讲完一手，回看到别的手，这一段纹丝不动）：
>     给 A、B 两个局面各塞一份缓存（`state.coach.pick` 故意留成**后生成的那份 B**），
>     然后反复改 `state.viewAt` → 正文与上下文小字必须跟着换；切到没讲过的 C 手必须变空状态、
>     且**不能出现 A/B 的字样**。★ 顺带守一个坑：`rec === pickPending` 在两边都是 null 时也为真，
>     会把「没讲过」误判成「正在生成」（第一次跑就栽在这）。
>
> ★ `_trash/fixtures/tree/` 的三个夹具（`03-branch-mid` / `05-comments` / `10-nested-branch`）
>  **2026-10-23 重建过一次**（原来那份丢了，`_cdp_variation.mjs` 会全部报 ★ 甚至假绿）。
> 断言是硬编码的：03 是「主线 4 手 + 第 2 手分出的 2 手分支」、10 是「主线 6 + A 线 4 + B 线 3 = 13 个圈」，
> 改夹具前先看脚本里的期望值。

> **2026-10-24 新增 `_cdp_topbar.mjs`** —— 顶栏状态区（`#status`）**只有一行**的回归测试（10 项，不需要真引擎）。
> 背景：`.topbar` 是 `flex-wrap: wrap`，折行按 flex-basis 判断；状态文字原来是 `flex: 0 1 auto`，
> 一句长话就把右边「新对局 / 对局模式 / 对手棋力」挤到第二行 —— 顶栏高度和排布临时变形。
> 现在 `flex: 1 1 0`（basis 0）+ 省略号 + `title` 全文。脚本在 1020 / 1280 / 1460 三档宽度下逐条
> 塞最长文案，量 `offsetHeight` 与每个子元素的底边（不查 CSS 属性值）；1280 以上还要求**不出现省略号**。
> ★ **改状态栏文案就往这里加一条最长的那种** —— 判据是真实几何，写错文案它会红。
> 全部文案清单（153 处 / 138 条，含宽度）见仓库根目录 `顶栏状态文字清单.md`。

## 怎么跑

所有脚本**都按自己所在位置推导路径**，所以从哪儿运行都行。

```bash
# 静态检查（秒级，改完代码先跑这个）
node dev/_lint_ids.mjs
node dev/_lint_ipc.mjs
node dev/_lint_hidden.mjs
node dev/_precheck.mjs        # ★ 改过 dev/*.mjs 必跑：先查整份文件语法，再逐个模板串求值
                              #   （模板串体的注释里多写一个反引号就会截断 → 只有它能立刻报出来）

# 端到端（会自己拉起软件、跑完关掉）
python dev/_rtest.py dev/_cdp_regress.mjs _trash/_shot.png
```

### macOS / Linux 上手动跑（`_rtest.py` 只能 Windows 跑）

`_rtest.py` 用了 `ctypes.windll.user32`，所以在 mac/Linux 上要么自己起实例、要么按下面这样
**在同一条命令里**起 + 跑（沙箱/CI 会给每次命令独立的网络视角，分成两条命令会连不上 9333）：

```bash
env -u ELECTRON_RUN_AS_NODE \
  RAPACEGO_RECORDS="$PWD/_trash/records_test" \
  RAPACEGO_PUZZLES="$PWD/_trash/puzzles_test" \
  ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  --remote-debugging-port=9333 --user-data-dir="$PWD/_trash/userdata_test" \
  --no-sandbox --disable-gpu --in-process-gpu . > _trash/_mac_run.log 2>&1 &
sleep 16; node dev/_cdp_tsumego.mjs
```

- `RAPACEGO_RECORDS` / `RAPACEGO_PUZZLES` 把**棋谱库**和**题集目录**都指到工作区里的临时目录 ——
  测试**绝不碰**用户真实数据（血的教训见 `main.js` 里 `refreshRecordsDir` 的注释）。
  ★ 给 **`node` 那一次调用也要带上**（不只是给 Electron）：`_cdp_tsumego.mjs` 会往
    测试棋谱库里放一份夹具棋谱，用来验「当题练」不会重复复制 ——
    没设 `RAPACEGO_RECORDS` 时它**故意跳过**那一段（宁可少测，也不能往用户的真棋谱库里写文件）。
- 跑 `_cdp_tsumego.mjs` 之前把夹具放进题集测试目录（不放大夹具也行，那一段会自动跳过）：

```bash
mkdir -p _trash/puzzles_test && cp dev/fixtures/测试题集-3题.sgf _trash/puzzles_test/
# 想跑"真实 347 题"那一段（可选）：把那份 xxqj.sgf 放到 _trash/fixtures/xxqj.sgf，再
cp _trash/fixtures/xxqj.sgf _trash/puzzles_test/ 2>/dev/null || true
```

`_rtest.py` 的参数顺序是 `<_测试脚本> <截图名> [第二段脚本] [第二张截图名]` ——
⚠️ **第 2 个位置参数是截图名**，所以测试脚本要的参数得走**环境变量**传
（`_cdp_shot2.mjs`、`_cdp_stuck.mjs` 就是这么做的）。

## 环境要求

- **Node.js**（脚本用 `import`，要 ESM 支持）
- **Python 3**（只给 `_rtest.py` 用；它只用标准库，不需要 pip 装东西）
- `node_modules`（`npm install`）—— `_rtest.py` 要用里面的 `electron` 跑界面

## 三条纪律

1. **`.ps1` / `.bat` 必须 UTF-8 带 BOM + CRLF** —— Windows PowerShell 5.1 读无 BOM 的
   UTF-8 会当 GBK，中文注释一变乱码整段语法就崩。用编辑器改完 `.ps1` 记得补 BOM
   （`_check_encodings.ps1` 会查）。
2. **测试的判据比被测代码更容易写错**。本项目有多次"测试报 ★，其实是判据错了"的记录
   （拿 GBK 字节比 UTF-8、用不存在的字段当等待条件、把观察者效应当成被测行为）。
   写判据时先确认：**字段真的存在吗？口径对吗？**
3. **CDP 脚本的被测代码写在模板字符串里 → 注释里禁用反引号**（踩过 **8 次**，每次都是
   `SyntaxError: missing ) after argument list`；最近一次就在写"注释里禁用反引号"这句话的注释里）。
   改完 **必跑 `node dev/_precheck.mjs`**（它第 ⓪ 步会先 `node --check` 整份文件，专门抓这个）。
   它当场报出过一次，省掉一轮一分多钟的跑测 —— 所以这条纪律现在是**机器守着的**，别只靠自觉。
