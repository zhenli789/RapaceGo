# dev —— 开发与测试脚本（下载软件的人**不需要**这些）

这个目录是给**改代码的人**用的。软件本身只需要仓库根目录的那些文件
（`main.js`、`preload.js`、`renderer/`、`engine.cfg`、`package.json`）。

> 为什么单独放一个目录（2026-10-07）：这 50 多个脚本原来散在仓库根目录，
> GitHub 的仓库页会先列一长串文件、README 渲染在下面 —— 访客得滚半天才看到产品介绍。
> 搬进来之后根目录只剩 16 个文件。

## 文件分类

| 前缀 | 是什么 | 例子 |
|---|---|---|
| `_cdp_*.mjs` | **端到端测试**（驱动真界面，靠 CDP 调试端口） | `_cdp_regress.mjs`（综合回归，最常跑）、`_cdp_ko.mjs`（打劫/倒扑）、`_cdp_jump.mjs`（涨跌数字）、`_cdp_tsumego.mjs`（习题练习 + 导入 SGF 题集）、`_cdp_variation.mjs`（手数卡的分支树 + 切换 + 导出保留分支；夹具在 `_trash/fixtures/tree/`，`10-nested-branch.sgf` 是三层分支）、`_cdp_moveinfo.mjs`（右侧「解说词」卡的逐手分析明细 + 「双方都由 KATAGO 走」的判据；不需要真引擎）、`_cdp_export.mjs`（导出命名 / 棋谱库列表 / 复盘按钮合并 / 连停一手终局 / 回看不显示胜负 / 导出带分析）、`_cdp_branch.mjs`（默认坐标 / 回看落子开分支 + 手数卡变树 + 导出带分支 / 复盘按钮同宽白底） |
| `fixtures/` | **测试夹具**（进仓库）。用时由启动命令复制进测试用的临时目录 | `测试题集-3题.sgf`（3 道 9 路题：带变体 / 带根节点 C[] / 没写 PL） |
| `_rtest.py` | **跑 CDP 测试的启动器**：拉起 Electron（带调试口）→ 跑脚本 → 截图 → 关掉 | — |
| `_lint_*.mjs` | **静态检查**（不需要跑界面） | `_lint_ids`（DOM id 对不上）、`_lint_ipc`（IPC 契约）、`_lint_hidden`（`[hidden]` 被 display 压过） |
| `_smoke.mjs` | 冒烟：把主要路径点一遍，看有没有运行时错误 | — |
| `_precheck.mjs` | **预检**：① 先 `node --check` 每个脚本**整份文件**的语法；② 再把 CDP 脚本里每个模板串**真求值一遍**并做语法检查（这是唯一能抓「模板串里的转义/反引号出错」的办法）。改完 `dev/*.mjs` 就顺手跑它 |
| `_deploy.sh` / `_sync_deploy.ps1` | 发布：提交 + 打 tag + 发 Release / 同步到免解压版 | — |
| `_build_lazy.ps1` / `_update_lazy.ps1` | 重建懒人包 / 把新版程序拷进懒人包 | — |
| `_check_encodings.ps1` | 检查 `.bat` 的 BOM / CRLF / `%~dp0`（踩过好几次） | — |

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
