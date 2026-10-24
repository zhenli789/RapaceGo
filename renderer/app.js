/* 对弈学习器 · 棋盘 + 完整对局设置（引擎尚未接入） */

let N = 19;
/*★ **两套坐标字母表，各自独立，绝对不能合并** —— 这是本文件最容易搞错的地方：

   ① `GTP_COLS`（跳 I，A B C D E F G H J K …）：界面显示的坐标、发给引擎的 GTP 坐标。
      围棋传统上跳过 I（I 和 J 形近、也怕和数字 1 混），业界一致。

   ② `SGF_COLS`（**含 i**，a b c d e f g h i j …）：棋谱文件（SGF 格式）的坐标。
      SGF 规范里 a=1 … h=8, **i=9**, j=10 … s=19，**不跳 i**。

   ★ 为什么能确定 SGF 用 i：拿本机 21433 份真实职业棋谱统计过 —— 坐标字母 i 出现
     164101 次（例：`;W[id]` 就是第 9 列），而且第 16 列是 `p` 不是 `q`
     （若跳 i，19 列会排到 q）。两种写法在这些棋谱里都能验出来。
   ★ 曾经踩过的坑：我一度认为"两套表不一致 = bug"，把 SGF 导出也改用 GTP_COLS，
     结果导出的棋谱从第 9 列起全部错位（`[GTP字母+数字]` 这种写法根本不是 SGF）。
     **判断"哪一套对"要看它服务的外部规范，不能只看两套表是否一致。** */
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';
const SGF_COLS = 'abcdefghijklmnopqrs';
const idx = (x, y) => y * N + x;

const settings = {
  color: 'b',        // 我执：b / w / r(随机)
  size: 19,
  /* play = 人机对弈（只能下自己那方）；free = 摆棋（两边随便下）；
     ★ 2026-10-12 新增第三个值 tsumego = 习题练习（摆题 → 解题两阶段，见 state.tsumego）。
     ⚠️ 凡是判 `=== 'play'` 的地方都要想一下 tsumego 该怎么走 ——
        例如「只能下自己那方」这条，习题练习里要看的是 state.tsumego.defend，
        不能直接复用 play 的判断（两者的"对方"含义不同：play 是段位对手，这里是防守方）。 */
  mode: 'play',
  rules: 'chinese',  // 默认中国规则
  level: 'rank_3d',  // 对手棋力 = KataGo 人类棋风模型的真实段位档位（见 RANKS）
  handicap: 0,
  komi: 7.5,
  clock: 'none',     // 计时档位：none / blitz / rapid / slow / pro / world
  visits: 500,       // 分析搜索量：每个局面让引擎思考多少步（越大越准、越慢）。见 VISIT_OPTS
  /* AI 复盘的搜索量 —— ★ 2026-10-04 用户要求「点 AI 复盘后手动设置，默认 500」：
     刻意**不跟随**底栏的「计算深度」——复盘是整盘逐手算，慢得多，
     值不值得调深应当由用户在点的那一刻决定（会弹面板让他选）。 */
  reviewVisits: 500,
  humanLike: false,  // 拟人落子：按「该段位人类会下哪」的概率抽样，而不是取最优（见 pickAIMove）
  /* ★ 双方都由 KATAGO 走（2026-10-18 用户要求）——AI 对弈模式下的「自我对弈」。
     打开后你不落子，两个颜色都交给 KATAGO（用的还是「对手棋力」那一档），
     底栏会出现「暂停 / 继续」按钮。 */
  autoBoth: false,

  /* ---------- 习题练习专用设置（2026-10-12 起）----------
     大部分在「新对局 → 对局类型 = 习题练习」里设；**解题过程中要改的**
     （KATAGO 执哪方 / 应对方式 / 提示 / 框架与框距）放在左栏的练习卡上。
     ★ 框架与框距两处都有（面板 + 练习卡），写的是同一对值，走 syncFrameUI 同步 ——
       因为面板点「开始」会把题目重置，做题中途想调框只有练习卡能改。 */
  tmode: 'free',       // 摆子方式：'free' 自由摆棋（先选颜色）/ 'alt' 交替摆棋（黑白自动轮换）
  tfirst: 'b',         // 先手：'b' 黑先 / 'w' 白先。★ 这道题该谁先走（发给引擎的 initialPlayer）
  /* KATAGO 执哪一方（2026-10-14 用户要求）：'b' / 'w'。
     你执的是**另一方**（state.myColor = 它的对方）。
     默认值跟着「先手」走（改先手时自动翻到对方）→ 默认就是"你来解题、KATAGO 防守"；
     想练**防守**（让 KATAGO 先动手、你来守）就把它改成先手那一方。
     注意它与「先手」是两个独立概念：先手是**题目的属性**（黑先/白先），
     这个是**谁坐哪一边**。两者相同 = KATAGO 先动手。 */
  taicolor: 'w',
  tframe: 'auto',      // 死活框架：'auto' 自动框 / 'off' 不加框架
  tdist: 4,            // 框架距离：框边比题目棋子最外沿再多留几路（角上典型小题 → 约 9×9）
};

/* ★★ 习题练习的**规则与贴目是固定值**（2026-10-14 用户提出「是不是不需要规则和贴目」）。
   依据：死活/手筋题要判的是"这块棋死没死"，用的是引擎的 ownership（归属），
   跟数子还是数目、贴几目都无关；贴目只在**绝对目差**上平移一个常数，不影响"哪一点最好"。
   所以：① 面板里那两行在习题模式下藏起来（`syncNewGameRows`），
        ② 发给引擎的一律用下面这两个值（`tsAnalyzeExtras` 里覆盖），
        ③ 状态栏也照它们显示 —— 三处口径一致，不会出现"界面上设了却不生效"。 */
const TS_RULE = 'chinese';   // 数子制：与 ownership / 归属判定最直接
const TS_KOMI = 0;           // 不贴目：题目的胜负由这一角的死活决定，贴目只会干扰绝对目差

/* KATAGO 执一方 → **你执另一方**（习题练习里"谁是哪一方"的唯一换算口）。
   进练习、开始解题、显示双方名字都要用，写成函数免得某处写反。 */
const otherColor = c => (c === 'b' ? 'w' : 'b');
const tsAIColor = () => (settings.taicolor === 'b' ? 'b' : 'w');   // KATAGO 那方
const tsMyColor = () => otherColor(tsAIColor());                    // 你那一方

/* 分析搜索量档位（用户要求可调，并指出「500 和 1600 之间缺得有点多」）。
   ★ 怎么定的：实测（19 路，同一局面重复跑）——
       500 visits → 单次分析约 0.4 秒，首选点与前 4 候选**与 1600 完全一致**（布局、中盘都是）
       1600 visits → 约 0.7 秒；只有**复杂中盘**的首选点会在两三个好点间跳（候选集合仍是同一批）
     所以默认 500，在 500~1600 之间补了 800 / 1200 两档。
   ★ 改档位**立即生效**：maxVisits 是每个分析请求自带的参数，
     改完下一次分析就用新值，**不必重开对局、也不必重启程序**。 */
const VISIT_OPTS = [
  [100, '极快'], [200, '很快'], [300, '快'], [500, '标准'],
  [800, '较深'], [1000, '深'], [1500, '更深'], [2000, '很深'], [3000, '最深'],
];

/* 规则集 —— 贴目默认值与座子按各家规则带出；
   kata 是传给 KataGo 的规则名（2026-10-03 实测确认可用）：
     chinese      AREA 数子 · tax=NONE
     japanese     TERRITORY 数目 · tax=SEKI
     korean       TERRITORY 数目 · tax=SEKI
     ancient-area AREA 数子 · tax=ALL（还棋头）← 明清规则  */
const RULES = {
  chinese:  { label: '中国规则', sgf: 'Chinese',  komi: 7.5, kata: 'chinese',
              seats: false, tax: 'NONE' },
  japanese: { label: '日本规则', sgf: 'Japanese', komi: 6.5, kata: 'japanese',
              seats: false, tax: 'SEKI' },
  korean:   { label: '韩国规则', sgf: 'Korean',   komi: 6.5, kata: 'korean',
              seats: false, tax: 'SEKI' },
  ancient:  { label: '明清规则', sgf: 'Chinese',  komi: 0,   kata: 'ancient-area',
              seats: true,  tax: 'ALL' },
};

/* 座子制（明清规则）：四角星位各一子、**对角同色**。
   古谱白先，摆完座子轮白走。

   ★★ 颜色分配（2026-10-07 规则审查改正，原来**黑白放反了**）：
        **黑子在「右上角 + 左下角」，白子在「左上角 + 右下角」。**
        依据：座子制比赛的通行规则原文 ——
          「开局前预置四枚座子……黑座子放置于右上角和左下角的四四位，白座子依此类推」
        （见 https://www.cczzwq.cn/emlog/?post=11 ；另见维基「座子制」条目）
        原来写成「左上/右下 = 黑」，正好反了 —— 古谱摆出来白黑互换，
        等于这套规则的颜色约定是错的。
   ⚠️ 边界：`mid` 是中央索引（19 路为 9）。星位在 (line,line) 与 (n-1-line,n-1-line) 上，
      所以 (x<mid && y<mid) = 左上、(x>mid && y>mid) = 右下 —— 这两个是**白**。 */
function seatStones(n) {
  const mid = (n - 1) / 2;
  const corners = starPoints(n).filter(([x, y]) => x !== mid && y !== mid);
  return corners.map(([x, y]) => ({
    x, y,
    /* 左上(小,小) 与 右下(大,大) 为白；右上(大,小) 与 左下(小,大) 为黑 */
    color: ((x < mid && y < mid) || (x > mid && y > mid)) ? 'w' : 'b',
  }));
}

const state = {
  moves: [],
  viewAt: 0,
  toMove: 'b',
  /* ★ 这份棋是「打开棋谱」来的（＝打谱）。由 applyRecord 置真、applyNewGame 清掉。
     ★ 2026-10-24：三个讲解按钮**打谱时都能用**（原来「推荐落点讲解」在这里被禁用；
       现在它会自己借复盘 / 现场算一批点，并画到盘上 —— 见 pickCandidatesAt）。 */
  fromRecord: false,
  /* ★ 当前打开的棋谱文件名（含 .sgf）—— 全盘讲解要**存回这份棋谱名下**
     （存成 <棋谱名>.coach.json，见 main.js 的 coachPath）。
     新对局时清空：没有棋谱就没地方存。 */
  recName: '',
  /* ★ 这一局**已经导出过的文件名**（2026-10-22 用户要求：同一局别存一堆副本）。
     `saveToRecords()` 第一次导出后记在这里，之后再点导出就**覆盖这一份**，
     不再按当前时间新起一个名字。换棋谱 / 开新局时清空。 */
  exportName: '',
  /* 棋谱自带的解说词（SGF 的 C[]，只取主分支）：下标 = 第几手（0 = 开局前）。
     只在「打谱」（state.fromRecord）时有内容；新开局的棋谱没有解说词。 */
  /* 棋谱的整棵变化树（2026-10-17）。null = 没有分支（新对局 / 自己摆的棋）。
     有了它：手数列表能标出分支点，Alt+←/→ 在同一层的兄弟变体间切换。
     ★ state.moves 永远是**当前这一条线**（分析 / 复盘 / 数子 / 导出都只认它），
       树只负责"换线"——切分支时把 moves 整条重建成那一条。 */
  varRoot: null,
  sgfComments: [],
  /* 棋谱根节点的说明文字（题集出处、这是第几图、谁整理的），**不属于任何一手**。
     ★ 为什么单独一个字段：原来它和「第 0 手」共用 comments[0] 这个键，
       而根节点后面通常还跟着 `;B[xx]` 那一手（它的键也是 0）→ 后者把前者覆盖掉，
       于是这段说明整段读不出来（实测抽样 300 份真实棋谱：18 份的根节点说明就是这么丢的，
       而在被 tokenizer 劈错的文件里丢得更彻底）。
     ★ 显示位置：右下角「解说词」框在「（开局前）」那一档里显示它 ——
       不另开一块界面（用户定的：软件不做做题功能，也不必多一张卡）。 */
  rootComment: '',
  /* 这份棋谱里「换了一道题」的位置（手数）。SGF 的题集用 `zz` 分隔，
     抽样 3000 份真实棋谱：2.97% 的文件含它。只有一条的显示提示，两条以上才有意义。 */
  quizTips: [],
  /* ★ 两条讲解的「存法」不一样（2026-10-05 用户定的）：
       · 分析讲解 explain[at] —— **跟手数走**：点评第 at 手，切到哪手就看哪手。
         之前只存最后一次，所以「讲完第 2 手点回第 1 手，框里还挂着第 2 手的内容」。
       · 选点讲解 pick —— **不跟手数走**：它是「此刻该走哪」的一张快照，
         点完就想留着看，切手数不该把它弄没（用户原话：就显示刚才讲解的就行）。
         所以只存一份，并记下它对应第几手 —— 显示时标出来，免得和眼前的局面混淆。
       · busy.x —— 正在生成的那一手（-1 = 空闲），避免刷新时把打字机的内容抹掉。 */
  coach: { explain: {}, pick: null, busy: { explain: -1, pick: -1 },
           /* ★ 2026-10-24 用户要求：三个按钮**共用一块正文区** —— 点哪个显示哪个。
              'explain' = 讲解这手（或 allView 时的全盘列表），'pick' = 推荐落点讲解。
              只控制「显示哪一页」，不影响数据怎么存（explain 按手、pick 按局面快照）。 */
           view: 'explain',
           /* ★ 推荐落点讲解的缓存：同一个局面讲过一次就不再问 LoGos。
              键 = pickPositionKey(at)（棋盘/规则/贴子/摆子/前 at 手），值 = 那份快照。
              pick 仍指「眼下该显示的那一份」—— 老代码只认它，不用改。 */
           picks: {},
           /* 全盘讲解进行中时是 { done, total }（否则 null）——
              用来① 挡住重复点击 ② 决定按钮是否可点。见 runBatchCoach。 */
           batch: null,
           /* ★ 2026-10-22 用户报障：跑完「全盘讲解」，右边框里只有当前那一手，
              看着像「只讲了一步」。→ 跑完（或本来就已经讲全）自动切到「全盘」视图：
              整盘每一手的讲解连成一页。allView 就是那个开关（标题旁「看全盘 / 返回」）。 */
           allView: false,
           /* ★★ 2026-10-23 用户报障（有分支的棋谱）：讲解原来**只按手号存**，切到另一条分支，
              同一个手号拿到的还是上一条线的文字，而且「全盘讲解」会把它当"已讲过"跳过。
              现在按**线指纹**存：lines[<lineKey>] = { n, list }，形状和 `.coach.json` 里一模一样。
              ★ state.coach.explain 永远**指向**当前这条线那一项的 list（同一个对象）——
                所有老代码写 explain 就等于写进 lines，不用到处改。 */
           lines: {}, curKey: '' },
  /* ★ 未开局（2026-10-04 用户要求）：软件打开时**不直接进对局**，而是停在
     一个「什么都还没定」的中性状态 ——
       · 棋盘点不动（tryPlay 直接挡掉）
       · 胜率条停在中性（五五开、不发分析请求，所以也不跳）
       · 对局信息四项全显示「未定」
       · 棋盘中央一个大胶囊按钮，引导去新建对局
     退出这个状态的只有两条路：点「新对局 → 开始」（applyNewGame），
     或打开一份棋谱（applyRecord，它会切摆棋模式）。 */
  noGame: true,
  showHints: (() => { try { return localStorage.getItem('rapacego.showHints') === 'true'; } catch { return false; } })(), // 首次默认关，之后沿用用户选择
  showCoords: true,  // 棋盘边缘显示 A–T / 1–19（2026-10-19 用户要求：默认显示）
  soundOn: true,     // 落子音效（默认开）
  clock: { on: false },   // 对局计时（applyNewGame 里按 settings.clock 填充）
  candidates: [],
  candAt: -1,        // 上面这批候选点是「第几手」算出来的（≠ viewAt 时说明还没跟上，画淡一点）
  ownership: null,   // 形势数据：长度 N*N，每点 -1~+1（正=黑倾向/负=白倾向/绝对值=归属强度）
  ownAt: -1,         // 这批 ownership 是第几手的
  showTerritory: false,  // 形势显示总开关（默认关；底栏「形势」，快捷键 X）
  terrStyle: 'fog',      // 形势画法：'fog' 雾（+死子变淡） / 'blocks' 方块
  showNums: false,       // 盘上显示手数（底栏「手数」，快捷键 M）
  rootVisits: 0,         // 最近一次分析的搜索量（「计算中… 320」那个数字）
  /* ★ 每一手那个胜率是「用多少搜索量算出来的」（history 的伴随数组，索引对齐）。
     2026-10-06 晚新增，为了治「手数后面的涨跌数字会自己跳」。
     来龙去脉：引擎每 0.25 秒推一次**中间报告**，每份报告都会写一次 history ——
     于是同一手会被写十几遍，而列表读的是**最后一次**的值（= 搜索量最大的那次）。
     实测（_cdp_jump.mjs，连落 6 手）：同一手被写 4~14 次，首次写入只有 150 访问量、
     末次 515；胜率极差最大到 **8.06%**（27.7% → 19.7% → 32.9%）。
     用户看到的正是「下完显示亏，过会儿点回去看又不亏了」。
     有了它就能判断「新结果是不是比已有的更可信」，见 rememberEval。 */
  histVisits: [],
  showPV: false,         // 变化图：鼠标停在推荐点上满 1 秒 → 显示后续变化（底栏「变化图」，快捷键 B）
  pv: null,              // 当前正在显示的变化：{ x, y, list: ['Q16','D4',...] }；null = 不显示
  setup: [],         // 让子 / 座子
  myColor: 'b',
  /* 双方名字 —— 右侧 ID 栏显示、导出棋谱时写进 SGF 的 PB / PW。
     '' = 没设过 → 按模式回落到 PLAYER / KATAGO / PLAYER1 / PLAYER2。
     打开棋谱时用棋谱里的 PB/PW 填进来，用户也可以点着名字直接改。 */
  names: { b: '', w: '' },
  thinking: false,   // AI 思考中 → 不显示落子预览方块
  koPoint: null,     // 打劫禁着点（简单劫）
  /* 逐手评估数据（走势曲线用）—— **两条都存**，因为曲线有两种纵轴（用户要的切换）：
       history[n] = 第 n 手之后的黑方胜率（0..1）
       leads[n]   = 第 n 手之后的黑方领先目数（正 = 黑优）
     ★ 视角固定成**黑方**：引擎给的原始值是「轮到走棋那一方」的，
       照那个画每落一手曲线就要翻一次，没法看；统一成黑方才能连成一条线。 */
  history: [],
  leads: [],
  histVisits: [],        // 每一手胜率的「精度」伴随数组（见 state.histVisits 的注释）
  /* ★ 每个局面的分析快照（2026-10-18）：下标 = 第几手（0 = 开局前）。
     用途：右侧「解说词」卡按手显示 —— 分数 / 胜率 / 目数损失 / 推荐选点 / PV / 直觉排名。
     形状 { at, side, blackWin, lead, visits, moves: [{gtp, prior, order, win, lead, pv}], best }。
     ⚠️ 里面的 win / lead **一律是黑方视角**（applyAnalysis 里换算过）——
        引擎原值是「轮到走棋那一方」，轮到白走时符号会反（纪律 11）。 */
  anaAt: {},
  /* ★ 离开某条分支时，把它那一条线的分析快照**留一份**（2026-10-22 用户要求
     「导出时把所有分支的 AI 分析都存下来」）。
     键 = 线指纹，值 = { key, moves: ["BQ16",…], at: {回合: anaAt 快照} }。
     为什么不能只靠 anaAt：它只装**当前这条线**（换线就截断），
     不另存的话，导出时别的分支早就没数据了 —— 想存也存不出来。 */
  anaLines: {},
  /* 本次会话里「已经问过要不要复盘」的线指纹（避免每次切到同一条未复盘的分支都弹窗） */
  noAskKeys: new Set(),
  /* 双方都由 KATAGO 走（自我对弈）。autoPaused = 暂停中（人按了「暂停」） */
  autoBoth: false,
  autoPaused: false,
  curveMode: 'win',  // 走势图纵轴：'win' 黑方胜率 / 'lead' 黑方领先目数
  draft: null,       // 试下（打草稿）：null = 不在试下；否则见 enterDraft()
  result: null,      // 终局结果 { winner, lead, unit, resign, by, terminal }；null = 尚未结束
  lastEval: null,    // 最近一次分析的 { blackWin, lead } —— AI 判断要不要认输要用
  /* AI 复盘结果（整盘逐手重算后填）：
     { losses: [每手目损], stats: {...}, name: 棋谱文件名, at: 手数 }
     null = 当前局面没有复盘数据（手数列表/走势图就不画目损）
     ★ 2026-10-22：一份棋谱可能有**好几条分支线**，每条各一份复盘 ——
       `review` 永远只装**当前这条线**的那份（换线时由 syncReviewForLine 重新挑）。 */
  review: null,
  /* 整份复盘文件（v3）：{ v:3, name, updated, lines: { <线指纹>: {…} } } —— 一条线一项。
     界面上所有地方都读 state.review（按线挑好的那份），这里只当"仓库"。 */
  reviewDoc: null,
  /* ★ 习题练习的运行时状态（2026-10-12）。settings.mode !== 'tsumego' 时是 null。
     由 makeTsumego() 建、exitTsumego() 清。字段含义见 makeTsumego 的注释。 */
  tsumego: null,
  /* ★ 当前打开的**题集**（2026-10-14 导入 SGF 习题时加）。null = 手摆的题（没有题集）。
     { name: 文件名, list: [每道题], idx: 当前第几道(0 起), skipped: 跳过几棵树 }
     为什么和 state.tsumego 分开放：题集是「一整本练习册」，tsumego 是「当前这一页」——
     换一页（翻题）不该重建题集，退出习题模式也不该把书丢掉（再进来还能接着翻）。
     ⚠️ 但 exitTsumego 会清 state.tsumego —— 读题集信息一律先判 tsSet() 有没有。 */
  tsumegoSet: null,
};

let hover = null;    // 鼠标悬停的交叉点 {x, y}
let pvTimer = null;  // 「悬停满 1 秒才显示变化图」的定时器

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let px = 600, pad = 22, gap = 31;

/* ---------------- 星位与让子 ---------------- */

function starPoints(n) {
  if (n === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
  if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
  return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
}

/* 让子位置（2–9 子）。星位按棋盘路数算：
   19 / 13 路星位在第 4 线（索引 3 / n-4），9 路在第 3 线（索引 2 / n-3）—— 原来写死 e-3，
   在 9 路盘上会摆到错误的位置。 */
function handicapStones(n, count) {
  const line = n >= 13 ? 3 : 2;          // 距边的路数（索引）
  const a = line;                        // 近边
  const b = n - 1 - line;                // 远边
  const m = Math.floor(n / 2);           // 边星 / 天元
  const P = {
    ne: [b, a], nw: [a, a],          // 右上、左上
    sw: [a, b], se: [b, b],          // 左下、右下
    mid: [m, m],                     // 天元
    w: [a, m], e: [b, m],            // 左边星、右边星
    n: [m, a], s: [m, b],            // 上边星、下边星
  };
  const map = {
    2: ['ne', 'sw'],
    /* ★ 让 3 子的第三子放**右上（se）**，不是左上（nw）—— 2026-10-07 规则审查改正。
       通行摆法（也见 KataGo 的 `place_free_handicap 3` 输出 `Q16 D4 Q4`）是：
         二子：右下(ne) + 左下(sw)          ← 对角
         三子：再加**右下方的对角那颗的右上角**？不 —— 是加**右下角(se, 即 Q4)**。
       也就是三子占据「左下、右下、右上」三个角，**左上留空**。
       原来写成 'nw'（左上），于是三子局变成了"左上+左下+右下" —— 与通行摆法差一个角。
       （2/4~9 子都是对的，只有 3 子这一档错；实测对照见 dev/_hc_check.mjs。） */
    3: ['ne', 'sw', 'se'],
    4: ['ne', 'sw', 'nw', 'se'],
    5: ['ne', 'sw', 'nw', 'se', 'mid'],
    6: ['ne', 'sw', 'nw', 'se', 'w', 'e'],              // 四角 + 左右边星
    7: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'mid'],
    8: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's'],    // 四角 + 四边星
    9: ['ne', 'sw', 'nw', 'se', 'w', 'e', 'n', 's', 'mid'],
  };
  return (map[count] || []).map(k => ({ x: P[k][0], y: P[k][1], color: 'b' }));
}

/* ---------------- 绘制 ---------------- */

/* 候选点配色：颜色代表次序（一选最显眼）
   注意：原来的「绿 + 黄」在木色棋盘上几乎分不出来（实测截图里连开发者自己都会认反），
   所以第三个改成偏橙的琥珀色 —— 四色的 R/G/B 分布拉得很开，一眼能分。 */
const HINT_COLORS = [
  { line: '33,113,214',  text: '#0f4f96', name: '蓝' },   // 第一选
  { line: '28,158,102',  text: '#12694a', name: '绿' },   // 第二选
  { line: '225,150,15',  text: '#8a5a00', name: '琥珀' }, // 第三选
  { line: '216,72,60',   text: '#8c2a20', name: '红' },   // 第四选
];

function resize() {
  const wrap = canvas.parentElement;
  const size = Math.max(300, Math.min(wrap.clientWidth, wrap.clientHeight) - 6);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  px = size;
  /* 留白要放得下坐标：开坐标时边距给大一些，否则字母/数字会压到棋盘外 */
  pad = size * (state.showCoords ? 0.056 : 0.037);
  gap = (size - pad * 2) / (N - 1);
  draw();
  renderCurve();     // 曲线 canvas 宽度跟着窗口变
}

const pxOf = (x, y) => [pad + x * gap, pad + y * gap];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStone(cx, cy, color, radius) {
  const r = radius || gap * 0.455;
  ctx.save();
  ctx.shadowColor = 'rgba(80,60,20,.28)';
  ctx.shadowBlur = gap * 0.14;
  ctx.shadowOffsetY = gap * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 7);
  const sg = ctx.createRadialGradient(cx - r * .35, cy - r * .35, r * .1, cx, cy, r);
  if (color === 'b') { sg.addColorStop(0, '#5a5a58'); sg.addColorStop(1, '#1b1b1a'); }
  else { sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#e2e0da'); }
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.restore();
  if (color === 'w') {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.strokeStyle = 'rgba(140,135,125,.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function draw() {
  const b = boardAt(state.viewAt);
  ctx.clearRect(0, 0, px, px);

  // 棋盘底
  const g = ctx.createLinearGradient(0, 0, px, px);
  /* 2026-10-04：底色由浅米黄 #f2dfba/#e9d3a8 调深为「中深」档（用户拍板）。
     起因见下方形势雾注释：**底色越亮，白雾能推的蓝通道幅度越小**
     （实测白雾色差 浅底 64 → 中深 105）。棋盘线/星位已连带加深，见下。 */
  g.addColorStop(0, '#dfc48f');
  g.addColorStop(1, '#d4b47c');
  ctx.fillStyle = g;
  roundRect(0, 0, px, px, 6);
  ctx.fill();

  // 网格
  /* 网格线随底色加深：旧的 #b08d5b 在中深底上色差只有 76（浅底时是 130），会糊掉；
     #8a6a3a 在同样底色上是 137，比原来还清楚一点。 */
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = Math.max(0.8, px / 900);
  for (let i = 0; i < N; i++) {
    const p = pad + i * gap;
    ctx.beginPath(); ctx.moveTo(pad, p); ctx.lineTo(px - pad, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, pad); ctx.lineTo(p, px - pad); ctx.stroke();
  }

  // 星位
  ctx.fillStyle = '#8a6a3a';          // 星位，与网格线同色
  for (const [sx, sy] of starPoints(N)) {
    const [cx, cy] = pxOf(sx, sy);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, gap * 0.075), 0, 7); ctx.fill();
  }

  /* 棋盘坐标（可开关）：底边 A–T、���边 1–N 从下往上数。
     ★ 用 GTP_COLS 而不是另写一份字母表 —— 之前这里、toGTP、SGF 导出各有一份，
       三份表一旦改了一处忘了另一处，坐标就会错位（真发生过，见第 4 行注释）。 */
  if (state.showCoords) {
    const cols = GTP_COLS;
    ctx.fillStyle = 'rgba(122,94,58,.74)';
    ctx.font = `${Math.max(9, gap * 0.38).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      ctx.fillText(cols[i], pad + i * gap, px - pad + gap * 0.56);
      ctx.fillText(String(N - i), pad - gap * 0.56, pad + i * gap);
    }
  }

  /* 形势雾（画在棋盘线之上、棋子之下） */
  drawTerritory();

  /* 候选点：虚线圆 + 半透明，颜色代表次序（蓝=一选，绿/琥珀/红依次）
     数字带一位小数，按半径算字号并用 measureText 兜底，保证不越出虚线圆
     ⚠️ 人机对弈时只在「轮到我方」才画 —— 否则你一落子、AI 还没走，
        屏幕上会冒出「对手该怎么下」的点，对你没用、看着还像出错。摆棋模式则一直显示。 */
  /* ★ 只画「跟当前局面匹配」的那一批（candAt === viewAt）。
     过期的候选点（上一个局面算的）**一律不画** —— 它们的位置在当前局面上已经没有意义，
     画出来只会让人困惑。之前这里做的是「淡着显示旧的」当过渡，被用户否掉了：
     「KaTrain 就没有这个，所有选点都是一下就算好的」（2026-10-04）。
     代价是换局面后有一段约 1~2 秒的空白 —— 用下面那句「计算中…」补上反馈。 */
  const hintsFresh = state.candAt === state.viewAt;
  /* ★ 习题练习：**不主动画选点** —— 一进题就把 AI 的首选画在盘上，等于直接把答案给了。
     ⚠️ 但仍然尊重「显示」菜单里那个「实时推荐落点」开关：它是用户自己明确打开的，
        再强行盖掉反而更让人困惑（用户定的：两处重复要能说清谁说了算）。
     （2026-10-17：原来还有一条"提示③"能强制显示，随分级提示一起删了。） */
  const hintsVisible = state.showHints && hintsFresh
    && (settings.mode !== 'play' || isMyTurn());
  if (hintsVisible && state.candidates.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.candidates.forEach((c, i) => {
      const [cx, cy] = pxOf(c.x, c.y);
      if (b[idx(c.x, c.y)] !== 0) return;

      const col = HINT_COLORS[Math.min(i, HINT_COLORS.length - 1)];
      const r = gap * 0.44;

      ctx.beginPath();                                   // 极淡底色，帮数字压住木纹
      ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = `rgba(${col.line},0.13)`;
      ctx.fill();

      ctx.setLineDash([gap * 0.11, gap * 0.075]);        // 虚线圆
      ctx.lineWidth = Math.max(1.2, gap * 0.055);
      ctx.strokeStyle = `rgba(${col.line},0.9)`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);                               // 用完立刻复位，否则会影响别的描边

      /* 数字必须完整落在虚线圆内：上限取「直径的 72%」（左右各留 14% 余量），
         起始字号也压到半径的 0.74 —— 之前 0.82 / 上限 86% 时，四位数字会顶到虚线上。 */
      let fs = Math.max(8, r * 0.74);
      ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      while (ctx.measureText(c.label).width > r * 1.44 && fs > 7) {
        fs -= 0.5;
        ctx.font = `bold ${fs.toFixed(1)}px "Microsoft YaHei", sans-serif`;
      }
      ctx.fillStyle = col.text;
      ctx.fillText(c.label, cx, cy + fs * 0.03);
    });
    ctx.globalAlpha = 1;          // 立刻复位，别影响后面画的元素
  }

  /* 「计算中… 320」—— 局面换了、新候选点还没补满时的反馈。
     带上搜索量：一眼看出「在算、而且数字在涨」（KaTrain 的选点圈里也是这个意思）。
     没有它，那段时间容易被当成「推荐点坏了」（这是之前用户报过的现象）。
     放在棋盘最上沿，不挡棋子。仅在「在看最新局面」时显示（回看历史时不必提示）。 */
  if (state.showHints && !hintsFresh && !state.noGame && state.viewAt === state.moves.length
      && (settings.mode !== 'play' || isMyTurn())) {
    ctx.fillStyle = 'rgba(38, 30, 18, .42)';
    ctx.font = `${Math.max(10, gap * 0.40).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.rootVisits > 0 ? ('计算中… ' + state.rootVisits) : '计算中…',
      px / 2, Math.max(2, pad - gap * 0.9));
  }

  /* 变化图（悬停推荐点满 1 秒后显示）—— 判定条件统一放在 pvVisible() 里 */
  if (pvVisible()) drawPV();

  /* 棋子 —— 一律按 boardAt() 的结果画（含让子），不能按手顺画：
     手顺里被提掉的子仍在 moves 中，照手顺画会把死子留在盘上。
     让子/座子也已并入 boardAt（它先摆 setup 再重放手顺），不重复绘制。 */
  /* 手数（可选）：先算出每个交叉点上的子是第几手落的。
     只数到 viewAt（回看时手数跟着回看位置走）；同一位置后下的会覆盖前面的值。 */
  const nums = state.showNums ? (() => {
    const m = new Map();
    for (let k = 0; k < state.viewAt; k++) {
      const mv = state.moves[k];
      if (!mv || mv.pass) continue;
      m.set(idx(mv.x, mv.y), k + 1);
    }
    return m;
  })() : null;

  for (let i = 0; i < N * N; i++) {
    if (b[i] === 0) continue;
    const sx = i % N, sy = (i / N) | 0;
    const [cx, cy] = pxOf(sx, sy);
    ctx.globalAlpha = stoneAlphaAt(sx, sy, b[i]);   // 死子变淡（形势雾）
    drawStone(cx, cy, b[i] === 1 ? 'b' : 'w');
    ctx.globalAlpha = 1;

    /* 盘上手数：**只写小数字，不画圆底**（原来画了个大圆，太抢眼）。
       颜色用**棋盘线的深棕** —— 用户要求「双方一个颜色」，黑白子共用一个色看着统一。
       注：不用棋盘底色的浅棕，那个在白子上几乎看不清（实测色差只有 80；深棕是 140/240）。 */
    if (nums) {
      const n = nums.get(i);
      if (n) {
        const s = String(n);
        const k = s.length >= 3 ? 0.27 : s.length === 2 ? 0.33 : 0.38;
        ctx.fillStyle = '#8a6a3a';
        ctx.font = `${Math.max(7.5, gap * k).toFixed(1)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s, cx, cy + gap * 0.015);
      }
    }
  }

  /* 最后一手标记 —— 野狐风格：棋子**右下角**的直角三角形
     · 直角顶点朝圆心（但**不侵入中心的手数数字** —— 数字高度约 ±0.12gap，所以顶点取 0.13gap）
     · 两个锐角正好落在棋子的**圆周**上（一个在右、一个在下）
     · 斜边朝右下，整个三角形都在棋子内部的右下方
     为什么不画在正中心：那会和手数数字重叠（用户原话「挡住手数了」）。
     几何：直角顶点 A(cx+a, cy+a)，两个锐角 B(cx+e, cy+a) / C(cx+a, cy+e)，
           e = √(R²−a²) 保证 B、C 恰好贴在圆边。 */
  if (state.viewAt > 0) {
    const m = state.moves[state.viewAt - 1];
    const bi = m ? idx(m.x, m.y) : -1;
    if (m && !m.pass && bi >= 0 && b[bi] !== 0) {
      const [cx, cy] = pxOf(m.x, m.y);
      const R = gap * 0.455;                             // 棋子半径（与 drawStone 一致）
      const a = gap * 0.13;                              // 直角顶点到圆心的横/纵距离
      const e = Math.sqrt(Math.max(0, R * R - a * a));   // 锐角在圆周上的另一坐标
      ctx.beginPath();
      ctx.moveTo(cx + a, cy + a);                        // 直角顶点（朝圆心）
      ctx.lineTo(cx + e, cy + a);                        // 锐角①：向右，落在圆边
      ctx.lineTo(cx + a, cy + e);                        // 锐角②：向下，落在圆边
      ctx.closePath();
      ctx.fillStyle = b[bi] === 1 ? '#e8574a' : '#c0392b';
      ctx.fill();
    }
  }

  // 落子预览小方块：悬停空点、轮到我下、且 AI 没在思考时显示
  if (hover && state.viewAt === state.moves.length && !state.thinking &&
      b[idx(hover.x, hover.y)] === 0) {
    const [hx, hy] = pxOf(hover.x, hover.y);
    const side = gap * 0.46, half = side / 2, rr = gap * 0.08;
    const isBlack = state.toMove === 'b';
    ctx.globalAlpha = isBlack ? 0.58 : 0.80;
    ctx.fillStyle = isBlack ? '#1b1b1a' : '#ffffff';
    roundRect(hx - half, hy - half, side, side, rr);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!isBlack) {
      ctx.strokeStyle = 'rgba(120,115,105,.6)';
      ctx.lineWidth = 1;
      roundRect(hx - half, hy - half, side, side, rr);
      ctx.stroke();
    }
  }

  /* ★ 习题练习的两层覆盖（画在最后 = 压在所有元素之上）：
       · 死活框架（框线）—— 棋子会盖住它，所以必须后画。
     自带"不是习题模式就什么都不画"的判断，放在这里不影响别的模式。
     （2026-10-17：原来还有一层「目标棋块标记」（提示①），随提示功能删了。） */
  drawFrame();
}

/* ---------------- 规则 ---------------- */

function neighbors(x, y) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < N - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < N - 1) out.push([x, y + 1]);
  return out;
}

function group(b, x, y) {
  const color = b[idx(x, y)];
  const seen = new Set();
  const stack = [[x, y]];
  const stones = [];
  const libs = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const k = idx(cx, cy);
    if (seen.has(k)) continue;
    seen.add(k);
    stones.push(k);
    for (const [nx, ny] of neighbors(cx, cy)) {
      const nk = idx(nx, ny);
      if (b[nk] === color) { if (!seen.has(nk)) stack.push([nx, ny]); }
      else if (b[nk] === 0) libs.add(nk);
    }
  }
  return { stones, libs };
}

function boardAt(n) {
  const b = new Int8Array(N * N);
  for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const m = state.moves[i];
    if (m.pass) continue;
    const c = m.color === 'b' ? 1 : 2;
    b[idx(m.x, m.y)] = c;
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      if (b[idx(nx, ny)] === 3 - c) {
        const gp = group(b, nx, ny);
        if (gp.libs.size === 0) gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  return b;
}

/* ---------------- 落子 ---------------- */

function tryPlay(x, y, byAI) {
  /* ★ 还没开局：棋盘点了不该有反应（用户要求：启动后先停在「未开局」，
     得先新建对局或打开棋谱）。AI 不会在这个状态下落子，所以只提示人手点的情况。 */
  if (state.noGame) {
    if (!byAI) flash('还没开局 —— 点棋盘中间的「新建对局」开始');
    return false;
  }
  /* ★★ 回看中落子（2026-10-19 用户要求）：在历史局面上下一手 = **开一条新分支**。
     原来这里一律挡掉（「回看中不能落子，先跳到最新」），想改一手只能悔棋；
     现在把后面的手留在变化树上当变体 → 手数卡画成分支树、导出也带着分支。
     ⚠️ 习题练习与试下不掺和：它们有自己的规则（答案 / 草稿），照旧挡住。 */
  if (state.viewAt !== state.moves.length) {
    if (tsOn() || state.draft) { flash('回看中不能落子，先跳到最新'); return false; }
    cutForBranch();
  }

  /* ★ 习题练习 · 摆题阶段：落子由画布上的分流交给 placeSetupStone（写 state.setup）。
     万一有别的路径调到这里，直接挡掉 —— 绝不能把"摆子"记成手顺。 */
  if (tsOn() && tsPhase() === 'setup') return false;

  /* ★ 习题练习 · 正在展示参考答案（「正解」按钮）：不许落子。
     盘上那串手顺是**答案**，不是用户走的 —— 让人往后接一手，答案就毁了，
     而且 KATAGO 的应手判据也会跟着乱。要落子就先收起答案（或按「重来」）。 */
  if (tsOn() && tsPhase() === 'solve' && state.tsumego.showAnswer) {
    if (!byAI) flash('正在展示参考答案 —— 先按「重来」或再按一次「正解」收起');
    return false;
  }

  /* ★ 习题练习 · 解题阶段 · KATAGO 应对：只能下自己那一方（tsMyColor()），另一方由 KATAGO 走。
     设成「我下两边」时不受限（那时是自己在推演变化）。
     ⚠️ 不复用下面 play 那条判断：play 的"对方"是段位对手，这里的"对方"是防守方，语义不同。 */
  if (!byAI && !state.draft && tsOn() && tsPhase() === 'solve'
      && state.tsumego.defend !== 'both' && !isMyTurn()) {
    flash('轮到对手（它执' + (tsAIColor() === 'b' ? '黑' : '白') + '）—— 想两边自己走就切「我下两边」');
    return false;
  }

  /* ★ 习题练习 · 解题阶段：**人也只能在框架内落子**（2026-10-12 用户要求）。
     为什么必须挡：框架就是"这道题的范围"。AI 那边已经用 allowMoves 锁在框内了，
     人这一侧不挡的话，一手走到框外就等于"脱先"——题也就不成题了
     （而且引擎被锁在框内、只能继续在框里应你，看着像答非所问）。
     给了出路：① 练习卡上的「框架 / 框距」可以随手调大 ② 把框架关掉 ③ 「重摆」改题。 */
  if (!byAI && tsOn() && tsPhase() === 'solve') {
    const fr = frameRect();
    if (fr && (x < fr.x0 || x > fr.x1 || y < fr.y0 || y > fr.y1)) {
      flash('这一手在框外 —— 调大练习卡上的「框距」，或把「框架」关掉');
      return false;
    }
  }

  /* 人机对弈模式下，只能下自己那一方（AI 自己落子时用 byAI 跳过这个检查）
     试下（打草稿）时不受限制 —— 试下就是要两边都摆一摆 */
  if (!byAI && !state.draft && settings.mode === 'play' && !isMyTurn()) {
    flash('现在轮到' + (sideToMove(state.viewAt) === 'b' ? '黑棋' : '白棋') + '，对手还没下');
    return false;
  }

  const b = boardAt(state.moves.length);
  if (b[idx(x, y)] !== 0) return false;

  // 打劫禁着点
  if (state.koPoint && state.koPoint.x === x && state.koPoint.y === y) {
    flash('打劫：此处暂时不能下，得先在他处走一手');
    return false;
  }

  const c = state.toMove === 'b' ? 1 : 2;
  b[idx(x, y)] = c;

  let captured = 0, capAt = null;
  for (const [nx, ny] of neighbors(x, y)) {
    if (b[idx(nx, ny)] === 3 - c) {
      const gp = group(b, nx, ny);
      if (gp.libs.size === 0) {
        captured += gp.stones.length;
        capAt = { x: nx, y: ny };
        gp.stones.forEach(k => { b[k] = 0; });
      }
    }
  }
  // 提子后自己仍无气 → 自杀，非法
  if (group(b, x, y).libs.size === 0) return false;

  /* ★★★ 打劫（Ko）—— **照抄 KaTrain 的写法**（不是我琢磨的启发式）。
     来源：github.com/sanderland/katrain  `katrain/core/game.py`
       第 156 行：  ko_or_snapback = len(self.last_capture) == 1 and self.last_capture[0] == move
       第 187 行：  if ko_or_snapback and len(self.last_capture) == 1 and not ignore_ko:
                        raise IllegalMoveException("Ko")

     翻译成这里的话 —— 状态只有一个：**上一手（对方那一手）提掉了哪一点**。
       「这一手是不是在上一手单子被提的那一点回提」 AND 「这一手也只提 1 子」 → 判劫
     就这两条，没有别的条件、也不需要预判未来。

     为什么这两条就够了（KaTrain 的设计，我之前绕了四版才看明白）：
       · 真劫：对方提走我一子 → 我在那一点回提、只提 1 子 → 判劫 ✓
       · 倒扑：我回提会一口气提走 ≥2 子 → 第二条不成立 → 放行 ✓
       · "提掉一个本来就只剩 1 气的子"：上一手提的**不是**我要下的这一点
         → 第一条不成立 → 放行 ✓
     我前面四版分别用「提1子+孤子+只剩1气」「把被提子放回去再比」
     「比 boardAt(n)/boardAt(n-1)」「模拟对方回提再比快照」——全都是在**预判未来**，
     而预判要处理提子、要吃透 boardAt 的索引语义，我就栽在那些细节上。
     KaTrain 不预判，只看"上一手干了什么"，所以它不会错。 */
  const prev = state.moves[state.moves.length - 1];        // 上一手（对方那一手）
  const 回提上一手被提的那一点 = !!(prev && !prev.pass && prev.captured === 1
    && prev.capAt && prev.capAt.x === x && prev.capAt.y === y);
  if (回提上一手被提的那一点 && captured === 1) {
    flash('打劫：不能立刻提回，得先在他处走一手');
    return false;
  }
  /* 禁着点（给界面画"此处暂时不能下"）：我这一手提了 1 子 → 那一点就是禁着点。
     （对方在那儿回提会还原局面。他若在那儿下别的、或提多子，规则自然放行。） */
  state.koPoint = (captured === 1 && capAt) ? { x: capAt.x, y: capAt.y } : null;

  state.moves.push({ x, y, color: state.toMove, captured, capAt: capAt || undefined });
  noteTreeMove();                        // 树存在时把它挂上（新分支挂在最右边）
  clearCoachAt(state.moves.length);      // 这个手号上的旧讲解作废（悔棋换了别的棋，见函数注释）
  clockSwitch();                         // 结算本手用时，换对方
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.pv = null;                       // 变化图只对当前局面有效，落了子就收掉
  state.viewAt = state.moves.length;
  syncUI();
  /* ★ 落子音效**放在重绘之后**起播（可在「显示」菜单里关掉）。
     为什么不能提前：syncUI 里要把整张盘重画一遍（形势雾是 N×N 逐点画，很吃主线程），
     而短音效只有 0.08~0.09 秒 —— 起播紧接着被主线程占住，开头会被啃掉，
     听感上就是「这一下怎么这么轻」。setTimeout 0 让它排在本帧绘制之后，
     人耳分辨不出这点延迟（见 playStoneSound 的注释②）。 */
  setTimeout(playStoneSound, 0);
  return true;
}

/* ---------- 从手顺反推禁着点（悔棋 / 打开棋谱之后要重算） ----------
   为什么需要它：打劫的禁着点是**由上一手决定的**，而悔棋会换掉上一手 ——
   所以悔棋之后必须重算，不能清成 null（清了就等于放行，用户 2026-10-07 报过）。
   反过来，悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了，禁着点该回来。

   ★★ 判据与 tryPlay **完全一致**（KaTrain 那两条）：
        上一手（对方那一手）只提了 1 子 → 它提的那一点就是禁着点。
      不预判未来、不模拟、不比盘面 —— 只看"上一手干了什么"。 */
function koFromBoard(b, moves) {
  const last = moves[moves.length - 1];
  if (!last || last.pass || last.captured !== 1 || !last.capAt) return null;
  return { x: last.capAt.x, y: last.capAt.y };
}

/* ★ 悔棋之后补上每手的 `capAt`（"这一手提掉了哪一点"）—— 打劫判据要用它。
   为什么需要补：`capAt` 是落子时算出来的，而 `boardAt()` 重放出来的旧棋谱
   （以及悔棋前存下来的手顺）里没有这个字段。没有它，`tryPlay` 里
   "是不是在上一手被提点回提"就永远为假 → 打劫形同失效
   （实测踩到：悔棋后能无视禁着点直接提劫，用户 2026-10-07 报过）。

   算法（最直白，不做任何推理）：
     对每一手，比"这一手走之前"和"走之后"的盘面 —— 在它**四邻**里，
     **之前是敌子、之后变空**的那一格，就是它提掉的那一点。
   ⚠️ 只在需要时调（悔棋后 / 打开棋谱后）。 */
function rebuildCapAt() {
  /* ※ 索引语义要记牢：`boardAt(n)` = **走完第 n 手之后**的盘面
     （`boardAt(0)` = 开局、还没走；`boardAt(1)` = 第 1 手走完）。
     所以对第 i 手（0-based 下标）：走之前 = `boardAt(i)`、走之后 = `boardAt(i + 1)`。
     ⚠️ 我第一版写成了 `boardAt(i)` / `boardAt(i-1)`，整个错开一手 ——
        于是 `capAt` 一个个都算不出来（实测：悔棋后打劫判据形同失效）。 */
  const before0 = () => {                      // 第 0 手"走之前"= setup 的盘面（等价 boardAt(0)）
    const b = new Int8Array(N * N);
    for (const s of state.setup) b[idx(s.x, s.y)] = s.color === 'b' ? 1 : 2;
    return b;
  };
  for (let i = 0; i < state.moves.length; i++) {
    const m = state.moves[i];
    m.capAt = undefined;
    if (m.pass || !m.captured) continue;       // 没提子 → 不可能是劫的那一手
    const prevBoard = (i === 0) ? before0() : boardAt(i);        // 这一手之前
    const after = boardAt(i + 1);                               // 这一手之后
    const me = m.color === 'b' ? 1 : 2;
    for (const [nx, ny] of neighbors(m.x, m.y)) {
      const k = idx(nx, ny);
      if (prevBoard[k] === 3 - me && after[k] === 0) { m.capAt = { x: nx, y: ny }; break; }
    }
  }
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.round((mx - pad) / gap);
  const y = Math.round((my - pad) / gap);
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  const [cx, cy] = pxOf(x, y);
  if (Math.hypot(mx - cx, my - cy) > gap * 0.48) return;
  /* ★ 习题练习的**摆题阶段**：落子要进 state.setup（初始局面），不能当手顺记 ——
     所以在这里就分流走 placeSetupStone，不进 tryPlay（tryPlay 写的是 state.moves）。 */
  if (tsOn() && tsPhase() === 'setup') { placeSetupStone(x, y, false); return; }
  tryPlay(x, y);
});

/* 右键：习题**摆题阶段**直接擦子（比"先切到橡皮工具再点"快得多，是摆棋最常用的动作）；
   ⚠️ 必须 preventDefault，否则会弹出浏览器/系统的右键菜单。
   别的模式右键保持原样（不改动既有行为）。
   ★ 2026-10-17：「解题阶段右键 = 手动指定目标」随判定功能一起删了。 */
canvas.addEventListener('contextmenu', e => {
  if (!(tsOn() && tsPhase() === 'setup')) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const x = Math.round((mx - pad) / gap);
  const y = Math.round((my - pad) / gap);
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  const [cx, cy] = pxOf(x, y);
  if (Math.hypot(mx - cx, my - cy) > gap * 0.48) return;
  placeSetupStone(x, y, true);
});

/* 悬停：吸附到最近的交叉点（只记坐标，是否空点在 draw 里判） */
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let next = null;

  if (!state.noGame && state.viewAt === state.moves.length && !state.thinking) {
    const x = Math.round((mx - pad) / gap);
    const y = Math.round((my - pad) / gap);
    if (x >= 0 && x < N && y >= 0 && y < N) {
      const [cx, cy] = pxOf(x, y);
      if (Math.hypot(mx - cx, my - cy) <= gap * 0.48) next = { x, y };
    }
  }

  const same = (hover === null && next === null) ||
               (hover && next && hover.x === next.x && hover.y === next.y);
  if (same) return;
  hover = next;
  updatePV();          // 悬停在「推荐点」上满 1 秒 → 显示后续变化（开关见底栏「变化图」）
  draw();
});

canvas.addEventListener('mouseleave', () => {
  clearTimeout(pvTimer); pvTimer = null;
  if (hover || state.pv) { hover = null; state.pv = null; draw(); }
});

/* ---------------- 界面 ---------------- */

const $ = id => document.getElementById(id);

function syncUI() {
  const total = state.moves.length;
  $('slider').max = total;
  $('slider').value = state.viewAt;
  $('counter').textContent = `${state.viewAt} / ${total}`;

  const R = RULES[settings.rules] || RULES.chinese;
  const sizeTxt = N === 19 ? '' : `${N} 路 · `;
  /* ★ 习题练习里这两个数要按**实际发给引擎的值**显示（2026-10-14）：
     · 「让 N 子」——习题模式下的摆子是**题目初始局面**，不是让子，写成"让 13 子"会误导；
     · 「贴目」——习题模式固定 0（TS_KOMI），显示 settings.komi 就会跟实际不符。
     状态栏是用户唯一能看到这两个数的地方，不能跟引擎实际收到的不一致。 */
  const tsMode = tsOn();
  const hcTxt = R.seats ? '座子 · '
    : (state.setup.length && !tsMode ? `让 ${state.setup.length} 子 · ` : '');
  const koTxt = `贴目 ${tsMode ? TS_KOMI : settings.komi}`;

  /* 两个引擎各自的就绪状态 —— 分析引擎挂了胜率不出来，对弈引擎挂了 AI 不落子，
     必须分开提示，否则用户只会看到「AI 不动」而不知道卡在哪。
     ★ 2026-10-05 起引擎**默认不加载**：「没加载」是正常状态，不再说成「启动中」——
       只在真出错、或正在加载时说一句；平时状态由顶栏那两盏灯负责。 */
  /* ★ 2026-10-24：顶栏只有一行，省两个省略号（各 ~12px）—— 状态词本身就是"进行中"。 */
  const engTxt = engineNote ? '引擎异常'
    : engineReloading ? '引擎重启中'
      : ((engStates.analyze === 'loading' || (settings.mode === 'play' && engStates.play === 'loading'))
        ? '引擎加载中' : '');
  const head = state.noGame
    ? '未开局 · 点棋盘中间「新建对局」开始'
    : total === 0
      ? `${sizeTxt}${hcTxt}${koTxt}`
      : `${sizeTxt}${hcTxt}${state.viewAt === total ? '进行中' : '回看中'} · 第 ${state.viewAt} 手 · 轮${sideToMove(state.viewAt) === 'b' ? '黑' : '白'}走` + quizTxt();
  /* 试下（草稿）期间状态栏必须一直提醒 —— 否则过一会儿就忘了自己在草稿里，
     回头还以为「明明下过怎么会没了」。 */
  const draftTxt = state.draft ? '试下中' : '';
  /* 拟人落子开着时要常驻提示 —— 否则过一会儿就忘了 AI 正在「按人类概率挑手」，
     会觉得它怎么突然变弱、或下了怪手。 */
  const humanTxt = settings.humanLike ? '拟人落子' : '';
  const statusTxt = [head, engTxt, draftTxt, humanTxt].filter(Boolean).join(' · ');
  $('status').textContent = statusTxt;
  $('status').title = statusTxt;

  /* ★ 顶栏那个模式按钮的文字 + 菜单高亮。放在 syncUI 里 = **唯一出口**：
     模式在好几处被改（applyNewGame / continueCurrentGame / enterTsumego / cancelNewGame），
     挨个加一句迟早漏掉一处；这里每帧幂等拉一次，永远跟 settings.mode 一致。 */
  syncModeBtn();

  /* 讲解框跟着**当前手数**刷新（切手数 / 讲解完成 / 开新局都会走到这里）。
     它自己会挡掉重复调用（同一手不重画），所以放 syncUI 里开销很小。 */
  renderCoachPanels();

  /* ★ 引擎还没就绪（或还没算出第一个局面）→ 胜率条两头不显示「黑 —」「白 —」，
     改一句「AI 准备中」（用户要求）：否则刚启动那几秒看着像"算完了、但两边都是横杠"。
     `lastEval` 有值 = 至少算过一次，就不再回退到这句话。
     ⚠️ 反过来（就绪了 / 又有数据了）也要**照着 lastEval 把数字画回来** ——
        否则「AI 准备中」会一直残留：改这几个文本的只有 applyAnalysis，
        而局面没变时分析是**不会重跑**的（shownAt 已经等于 viewAt）。 */
  if (state.noGame) {
    /* ★ 未开局：胜率条停在中性（五五开、两头都是 0.0 目）。
       之所以「不动」，是因为这个状态下**根本不发分析请求**（见 scheduleAnalysis）——
       不是把数字钉住、等它来覆盖。 */
    $('bar-black').style.width = '50%';
    $('eval-wr').textContent = '黑 50.0%';
    $('eval-wr-w').textContent = '白 50.0%';
    $('eval-lead').textContent = '0.0 目';
    $('eval-lead-w').textContent = '0.0 目';
  } else if (!engineReady || !state.lastEval) {
    /* ★ 用户要求：胜率条上**不再显示「正在加载」**（引擎状态挪到顶栏灯上了）。
       这里换成中性的一句，顺便告诉用户该干什么。 */
    const st = engStates.analyze;
    $('eval-wr').textContent = engineNote ? '引擎异常' : (st === 'loading' ? '加载中…' : '未分析');
    $('eval-wr-w').textContent = '';
    $('eval-lead').textContent = engineNote ? ''
      : (st === 'loading' ? '模型正在读入显存…'
        : (st === 'paused' ? '已暂停（顶栏可恢复）' : '点顶栏的 KataGo 加载'));
    $('eval-lead-w').textContent = '';
  } else {
    const bw = state.lastEval.blackWin, ld = state.lastEval.lead;
    const sg = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
    $('bar-black').style.width = (bw * 100).toFixed(1) + '%';
    $('eval-wr').textContent = '黑 ' + (bw * 100).toFixed(1) + '%';
    $('eval-wr-w').textContent = '白 ' + ((1 - bw) * 100).toFixed(1) + '%';
    $('eval-lead').textContent = sg(ld) + ' 目';
    $('eval-lead-w').textContent = sg(-ld) + ' 目';
  }

  /* 试下按钮：常态不填色，处于试下状态才填色 */
  $('btn-draft').classList.toggle('on', !!state.draft);
  $('btn-draft').title = state.draft
    ? '取消试下，回到进入试下之前的局面'
    : '试下：在此处存档，两边随便接着下（不影响正式对局）';

  $('btn-undo').disabled = total === 0;
  $('btn-save').disabled = total === 0;
  $('btn-score').disabled = total === 0;
  $('btn-resign').disabled = total === 0 || !!state.result;
  /* 「暂停 / 继续」：只有「双方都由 KATAGO 走」时才露出来（2026-10-18）。
     ★ 暂停时按钮显示「继续」并且点亮 —— 一眼看出"现在是我自己按停的"。 */
  {
    const ba = $('btn-auto');
    const showAuto = state.autoBoth && settings.mode === 'play' && !state.noGame;
    ba.hidden = !showAuto;
    ba.textContent = state.autoPaused ? '继续' : '暂停';
    ba.classList.toggle('on', state.autoPaused);
    ba.title = state.autoPaused
      ? '继续自动对弈（两边都由 KATAGO 走）'
      : '暂停自动对弈（暂停后不会再落子；按「继续」接着下）';
  }
  /* 未开局时「停一手 / 试下」也要置灰 —— 没有对局，这两个动作没有意义
     （disable 之后连快捷键调 .click() 也点不动，不用另加判断）。 */
  $('btn-pass').disabled = state.noGame;
  $('btn-draft').disabled = state.noGame;
  $('sel-terr').disabled = !state.showTerritory;   // 形势关掉时，偏好下拉跟着置灰
  /* 未开局：棋盘中央那个大胶囊按钮（引导新建对局）；
     引擎起不来时，按钮下面再给一条「去设置」的指路 —— 打包给别人时，
     对方第一眼看到的就是这条路（用户要求：不要自动弹窗，给个入口就行）。 */
  $('board-gate').hidden = !state.noGame;
  $('gate-tip').hidden = !(state.noGame && !!engineNote);
  /* ★ 引擎起不来的**具体原因**（2026-10-07 新增）。engineNote 里现在可能是
     main.js 从引擎 stderr 捞出来的原话转写（比如「权重文件太新：它需要更高版本的
     KataGo 引擎…」）—— 那句话比「引擎没起来」有用得多，得让它露出来。 */
  const why = $('gate-why');
  if (why) { why.hidden = !(state.noGame && !!engineNote); why.textContent = engineNote || ''; }

  /* ★ 各开关的勾选状态**统一从 state 画回来**（单一来源）。
     以前只同步了 chk-human，其余全靠 index.html 上的 `checked` 属性 ——
     那样一旦 HTML 和 state 初值不一致，就会出现「开关显示是开的、其实没生效」
     （2026-10-04 改启动默认值时差点踩到）。 */
  $('chk-show').checked = state.showHints;
  $('chk-coords').checked = state.showCoords;
  $('chk-nums').checked = state.showNums;
  $('chk-pv').checked = state.showPV;
  $('chk-sound').checked = state.soundOn;
  $('chk-terr').checked = state.showTerritory;
  $('chk-human').checked = settings.humanLike;     // 拟人落子（在 settings 里，不在 state）

  /* 对局信息 —— 只留 4 项（规则 / 计时 / 让子 / 贴目）。
     ★ 删项的**同时必须删掉这里的赋值**：`$('info-mode').textContent` 这种写法
     在元素不存在时会抛 TypeError，**把整个 syncUI 打断**（界面就再也不更新了）。
     省下的高度自动让给下面的手数栏（它 `flex:1`）。 */
  const short = t => String(t).replace(/（[^）]*）|\([^)]*\)/g, '').trim();

  /* 未开局：四项全写「未定」—— 规则、计时、让子、贴目这会儿都还没定下来 */
  if (state.noGame) {
    for (const id of ['info-rules', 'info-clock', 'info-hc', 'info-komi']) $(id).textContent = '未定';
  } else {
    /* ★ 习题练习：这三项要按"实际发给引擎的值"显示（2026-10-14）。
       · 规则：固定 TS_RULE（面板里那一行也藏了）
       · 贴目：固定 TS_KOMI —— 显示 settings.komi 就与实际不符
       · 让子：习题模式下的摆子是**题目初始局面**，不是让子 ——
         原来这里写出「让 13 子」（截图上看到的），纯属误导，改成「题目摆子 N 子」。
       （同样的口径在底栏状态行也有一份，见 syncUI 里 hcTxt / koTxt 那段。） */
    const tsMode = tsOn();
    $('info-rules').textContent = short((RULES[tsMode ? TS_RULE : settings.rules] || RULES.chinese).label);
    $('info-clock').textContent = (CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none).label;
    $('info-komi').textContent = String(tsMode ? TS_KOMI : settings.komi);
    $('info-hc').textContent = tsMode
      ? (state.setup.length ? '题目摆子 ' + state.setup.length + ' 子' : '还没摆')
      : (R.seats ? '座子 4 子'
        : (state.setup.length ? '让 ' + state.setup.length + ' 子' : '不让'));
  }

  /* 数子结果随局面变化：悔棋 / 续下之后若不再终局，就收起结果条。
     认输是终局，不动它 —— 认了就是认了。 */
  /* ★ 用「是在第几手时数的」判断，**不要**用 isTerminal()：
     手动数子时局面本来就不是终局，原写法（!isTerminal() 就清）会把结果**当场清掉** ——
     用户看到的就是「点了数子按钮什么都没发生」（2026-10-04 实测报过）。
     改成「局面变过才收起」：
       · 终局数子 → 悔棋 / 续下 → at ≠ viewAt → 收起 ✓
       · 手动数子 → 局面没动 → 留着 ✓；一旦落子 → at ≠ viewAt → 收起 ✓
     认输是终局，不动它 —— 认了就是认了。 */
  /* ★★ 2026-10-18 改判据：比的是**手数**，不是"正在看哪一手"。
     原来的写法（`at !== state.viewAt`）在回看时会把结果**清掉** ——
     再跳回最后那一手，isTerminal() 又成立、`!state.result` 又为真 →
     数子**再跑一遍**、结论条**又冒出来**。用户看到的就是"回看时胜负信息反复出现"。
     现在：只有**局面真的变了**（落子 / 悔棋）才清；回看不影响它。
     认输也记 at（见 doResign），所以认输后接着下也不会一直挂着那句"认输"。 */
  if (state.result && typeof state.result.at === 'number' && state.result.at !== state.moves.length) {
    state.result = null;
  }
  renderVerdict();

  draw();

  /* AI 该下就先让 AI 下（两个查询会互相打断，所以二选一）；否则刷新显示分析 */
  renderCurve();
  renderMoveList();
  renderCommentBox();    // 右下角「解说词」框跟着当前手数走（棋谱自带的那种）
  renderClocks();        // 名字（PLAYER / KATAGO / PLAYER1 / PLAYER2）随模式变
  syncTsumegoUI();       // 习题练习的左栏练习卡（不是习题模式时它会把自己藏起来）

  /* ★ 人机对弈：AI 该下就让它下；**同时也发一次分析** ——
     分析走 strong 引擎、AI 落子走 human 引擎，是两个独立进程，互不干扰。
     为什么必须同时发：用户落子后轮到 AI，若只跑 AI 不分析，用户刚下那一手的局面
     就永远没被评估过 → 手数列表里那一手没有「涨跌」（用户报过的现象）。
     ⚠️ 以前这里是 `if / else` 二选一，理由写着「两个查询会互相打断」——
        那是**单引擎时代**的限制，2026-10-03 拆成双引擎后已经不成立了。 */
  if (needAIMove()) scheduleAIMove();
  /* ★ 习题练习：解题阶段轮到 KATAGO 时，由**分析引擎**（强权重）出应手 ——
     题的正解是以「最强应对」为前提的，用段位引擎防守会把错着放过去。
     ⚠️ 判据用 `stillNeedDefend()`（不含 `!defendBusy`），**不能**用 `needDefendMove()`：
        上一条应手请求还在飞的时候，needDefendMove() 会是 false →
        这一次"需要应手"就**根本不会被记下来**，而 syncUI 是它的主要入口之一，
        于是 KATAGO 会一直不动（2026-10-14 实测的偶发就是这么来的）。
        武装定时器之后由 maybeDefendMove 负责"占着就稍后再排"，不会丢。 */
  if (stillNeedDefend()) scheduleDefendMove();
  scheduleAnalysis();

  /* 双方都停一手 → 自动判终局（约 4~5 秒出结果）
     试下中不判：草稿里的 pass 不算终局 */
  if (!state.draft && isTerminal() && !state.result) scheduleScore();
}

let flashTimer = null;
function flash(msg) {
  const el = $('status');
  el.textContent = msg;
  /* ★ 2026-10-24：顶栏状态只占**一行**（style.css 的 .topbar .status），
     极窄窗口下放不下就打省略号 —— 全文挂 title 上，鼠标停上去能看全。 */
  el.title = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(syncUI, 1800);
}

function gotoView(n) {
  state.viewAt = Math.max(0, Math.min(state.moves.length, n));
  clockTouch();          // 跳转后本手重新计时，免得把翻谱的时间算进去
  syncUI();
}

$('btn-first').onclick = () => gotoView(0);
$('btn-prev').onclick = () => gotoView(state.viewAt - 1);
$('btn-next').onclick = () => gotoView(state.viewAt + 1);
$('btn-last').onclick = () => gotoView(state.moves.length);
$('slider').oninput = e => gotoView(+e.target.value);

/* ---------------- 试下（打草稿） ----------------
   点「试下」= 在此处存档暂停，两边随便接着下（像打草稿）；
   再点一下 = 取消试下，**完整**回到点之前的状态。

   实现：进入时给整个局面拍一张快照，试下期间就在真实数据上随便下
   （相当于临时切成摆棋），退出时用快照整体盖回来。
   —— 用整体覆盖而不是逐项回滚：逐项回滚最容易漏字段（history / 打劫点 / 计时…），
      漏一个就会留下「回不去」的残迹。
   试下期间：AI 不自动落子、计时暂停、胜率曲线与导出的棋谱都不受影响。 */

function enterDraft() {
  if (state.draft) return;
  if (state.viewAt !== state.moves.length) { flash('回看中不能试下，先跳到最新一手'); return; }

  state.draft = {
    from: state.moves.length,
    snap: {
      moves: state.moves.slice(),
      viewAt: state.viewAt,
      toMove: state.toMove,
      koPoint: state.koPoint,
      candidates: state.candidates.slice(),
      candAt: state.candAt,
      history: state.history.slice(),
      histVisits: state.histVisits.slice(),
      result: state.result,
      lastEval: state.lastEval,
      clock: JSON.parse(JSON.stringify(state.clock)),   // 全是数字/布尔，可深拷贝
    },
  };
  state.clock.paused = true;      // 「存档暂停」—— 试下期间不走表
  syncUI();
  flash('已进入试下 · 两边都能下，不影响正式对局');
}

function exitDraft() {
  if (!state.draft) return;
  const s = state.draft.snap;
  state.moves = s.moves;
  state.viewAt = s.viewAt;
  state.toMove = s.toMove;
  state.koPoint = s.koPoint;
  state.candidates = s.candidates;
  state.candAt = s.candAt;
  state.history = s.history;
  state.histVisits = s.histVisits || [];
  resetAnalysisState();                  // history 被整体换回来了 → 欠账与上屏标记一起作废重来
  Object.assign(state.clock, s.clock);   // 保持同一个 clock 对象（renderClocks 一直指着它）
  state.result = s.result;
  state.lastEval = s.lastEval;
  state.draft = null;
  syncUI();
  flash('已退出试下 · 回到原局面');
}

function toggleDraft() { state.draft ? exitDraft() : enterDraft(); }

/* ---------------- 终局判定 / 数子 ---------------- */

/* 单位：中日韩「数目」→ 目；中国 / 明清「数子」→ 子。
   实测确认（9 路、双方都停一手）：
     中国（贴 7.5）scoreLead = -7.3   理论 -7.5
     日本（贴 6.5）scoreLead = -6.4   理论 -6.5
     明清（不贴目）scoreLead = +0.5   理论 0
   → KataGo 已经按各自规则算好了，**还棋头是它内置的**，我们直接用差值即可。
   精度：2000 visits 时误差约 ±0.2 子（200 visits 差到 0.4，所以终局查询用 2000）。 */
const SCORE_UNIT = { chinese: '子', ancient: '子', japanese: '目', korean: '目' };

/* 最后两手都是 pass = 双方都停手 = 终局 */
function isTerminal() {
  const n = state.moves.length;
  if (n < 2) return false;
  return !!(state.moves[n - 1].pass && state.moves[n - 2].pass);
}

let scoreBusy = false;
let scoreTimer = null;

function scheduleScore(delay) {
  clearTimeout(scoreTimer);
  scoreTimer = setTimeout(() => runScore(true), delay === undefined ? 700 : delay);
}

async function runScore(silent) {
  /* ★★ 复盘 / 全盘讲解跑着的时候**一律不数子**（2026-10-21 用户实测报障的根因）。
     这条守卫看着只是「让一让」，实际是必须的：runScore 一进门就 `window.api.cancel()`
     （见下面「终局查询优先」那句），而 cancel 会把**正在跑的那一块复盘**当成
     「用户点了停止」结算掉 —— 主进程 settleCollect(aborted) 只交回引擎已经算完的几手。
     用户看到的就是「复盘报告：只算了前 4 / 294 手」。
     触发路径很隐蔽：打开一份**下完的**棋谱 → syncUI 见 isTerminal() → 700ms 后自动数子
     → 正好落在复盘第一块请求发出之后。短棋谱（夹具 24 手，没终局）不会触发，所以
     之前那套测试全绿。复盘结束后 finally 里会补一次（见 runReview）。 */
  if (reviewBusy) return;
  /* ★ 正在数子时又点了一次 → **排队等前一次跑完**，而不是静默忽略。
     （被忽略的表现是「点了没反应」，用户会以为按钮坏了。实测踩过一次。） */
  let waited = 0;
  while (scoreBusy && waited < 60000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  if (!engineReady) {
    if (!silent) needEngine('analyze', '数子');   // 没加载 → 提示 + 把「加载」菜单弹出来
    return;
  }
  if (!state.moves.length) { if (!silent) flash('还没落子，没什么可数的'); return; }

  scoreBusy = true;
  const gen = gameGen;                       // ★ 这次数子属于哪一局
  /* ★★ 把「数的是第几手」**在这一刻定下来**（2026-10-06 审查发现）。
     请求用的是 `state.viewAt`、而结果里的 `at` 原来读的是 **await 之后**的 viewAt ——
     如果用户在等引擎的那一两秒里翻看了别的局面（滑块 / 点手数列表），
     结果就会被记到**错误的那一手**上；而且因为 `at === viewAt`，
     「局面变过就收起结果条」那条清理也不会触发，于是错的结果一直挂着。
     典型触发：点数子 → 等的时候顺手拖滑块 → 结果条上的结论其实属于另一手。 */
  const at0 = state.viewAt;
  const btn = $('btn-score');
  const oldTxt = btn.textContent;
  btn.disabled = true;
  if (!silent) btn.textContent = '数子中…';

  try {
    /* ★ 关键：必须让引擎看到「连续两个 pass」，它才会走**终局结算**而不是形势评估。
       实测踩过：空盘 + 两个 pass 引擎给 -0.9，而理论终局值是 -7.5 ——
       因为它看到还有 81 个空点可下，认为这局还没结束。 */
    window.api.cancel();                       // 终局查询优先，掐掉正在跑的分析
    const ms = state.moves.slice(0, at0)      // ★ 用定下来的 at0，不用当前的 viewAt
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]);
    /* ★ 必须让引擎看到「**连续两个** pass」，它才会走终局结算。只补一手是不够的 ——
       那样最后两手是「一手棋 + 一个 pass」：既不算终局，**又等于那一方白白放弃一手**，
       结果会严重偏向对方（实测：8 手均势局面数出「白胜 21.2 子」）。
       正确做法：轮谁走、谁先 pass，然后对方也 pass —— 补两手。 */
    const turn = sideToMove(state.viewAt);
    if (!ms.length || ms[ms.length - 1][1] !== 'pass') {
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
      ms.push([turn === 'b' ? 'W' : 'B', 'pass']);
    } else {
      // 最后一手已经是 pass（真终局局面）→ 只差对方这一手
      ms.push([turn === 'b' ? 'B' : 'W', 'pass']);
    }

    const res = await window.api.analyze({
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: ms,
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: 2000,
    });

    /* ★ 换了局（新对局 / 打开棋谱）→ 这次数子作废：
       否则刚开的新盘上会冒出上一局的胜负结果（用户重开一局时能实际看到）。 */
    if (gen !== gameGen) return;

    if (!res || res.error || !res.root) {
      if (!silent) flash('数子失败：' + ((res && res.error) || '引擎无响应'));
      return;
    }

    /* 视角：scoreLead 是「轮到走棋那一方」的（engine.cfg 里 SIDETOMOVE），换算成黑方 */
    const cp = String(res.root.currentPlayer || '').toUpperCase();
    const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : 'b';
    const raw = res.root.scoreLead;
    const blackLead = side === 'b' ? raw : -raw;

    state.result = {
      winner: blackLead > 0 ? 'b' : 'w',
      lead: Math.abs(blackLead),
      unit: SCORE_UNIT[settings.rules] || '子',
      resign: false,
      by: 'score',
      terminal: isTerminal(),
      /* ★ 记下「是在第几手时数的」：手动数子（局面非终局）时局面没变，结果应当留着；
         一旦落子/悔棋导致 viewAt 变化就自动收起（见 syncUI 里那句清理）。
         ⚠️ 用**发起时**定下来的 at0，不用当前的 viewAt —— 等引擎的那一两秒里
         用户可能拖了滑块，那样结果会被记到错误的手上（2026-10-06 审查发现）。 */
      at: at0,
    };
    syncUI();
  } finally {
    scoreBusy = false;
    /* ★ 数子期间被压住的分析，这里补一次（否则要等下次落子才更新）；
       而且数子前调过 window.api.cancel()，当前局面的分析被掐掉过 → 用 force 重算。 */
    scheduleAnalysis(0, true);
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

/* 认输：loser = 认输方，by = 'user' | 'ai' */
function doResign(loser, by) {
  if (state.result || !state.moves.length) return;
  state.result = {
    winner: loser === 'b' ? 'w' : 'b',
    lead: null,
    unit: SCORE_UNIT[settings.rules] || '子',
    resign: true,
    by: by || 'user',
    terminal: true,
    /* ★ 记下是第几手认输的（2026-10-18）：syncUI 靠它判断"局面变过没有" ——
       认输后接着下（或悔棋）就该把这条结论收起来，否则它会一直挂在棋盘上。 */
    at: state.moves.length,
  };
}

/* AI 认输：落后太多就投子（围棋惯例），免得用户单方面屠龙、局面僵在那里 */
function aiWantsResign() {
  const e = state.lastEval;
  if (!e) return false;
  const aiSide = state.myColor === 'b' ? 'w' : 'b';
  const aiWin = aiSide === 'b' ? e.blackWin : 1 - e.blackWin;
  const aiLead = aiSide === 'b' ? e.lead : -e.lead;
  return state.moves.length >= 30 && aiWin < 0.03 && aiLead < -20;
}

function renderVerdict() {
  const box = $('verdict');

  /* ★ 2026-10-17：习题练习的判定结论已按用户要求删掉 —— 这条结果条回到"只装对局结论"
     （数子 / 认输 / 超时）。当时把判定挪到这里是为了让练习卡高度恒定，沿革见 daily log。 */
  $('verdict-close').title = '收起（不影响对局，可随时按「数子」再看）';

  const r = state.result;
  if (!r) { box.hidden = true; return; }
  /* ★★ 只在**最后那一手**才显示结论（2026-10-18 用户报的：「回看时棋盘上反复出现胜负信息」）。
     回看历史手时这条结论属于"另一个局面"，挂着只会挡棋盘、还让人以为这一手就结束了。
     ⚠️ 注意是**隐藏**而不是把 state.result 清掉 —— 导出棋谱要用它写 RE[]。 */
  if (state.viewAt !== state.moves.length) { box.hidden = true; return; }
  /* ★ 用户手动按过叉 → 尊重它，别再自己冒出来（2026-10-06 审查发现）。
     新的一次数子 / 认输会整个替换 state.result，那时没有 dismissed 标记，照常显示。 */
  if (r.dismissed) { box.hidden = true; return; }

  const sideTxt = r.winner === 'b' ? '黑方' : '白方';
  let main, sub = [];
  if (r.resign) {
    /* ★ 超时要单独一条文案（2026-10-04 加超时判负时发现的）：
       超时也走 doResign（resign: true），如果只按「谁认输」渲染，
       结果条会写成「KATAGO 认输」—— 双人对弈时更是完全说不通。 */
    if (r.by === 'timeout') {
      main = sideTxt + '胜';
      sub.push((r.winner === 'b' ? '白方' : '黑方') + '超时判负');
    } else {
      main = r.by === 'user' ? '你认输' : 'KATAGO 认输';
      sub.push('本局结束');
    }
  } else {
    main = sideTxt + '胜';
    sub.push(r.lead.toFixed(1) + ' ' + r.unit);
    if (!r.terminal) sub.push('当前局面 · 非终局');
  }
  $('verdict-text').innerHTML = '<b>' + main + '</b>'
    + (sub.length ? ' <span class="vsub">' + sub.join(' · ') + '</span>' : '');
  box.hidden = false;
}

$('btn-score').onclick = () => { state.result = null; renderVerdict(); runScore(false); };
$('btn-resign').onclick = () => {
  if (state.result || !state.moves.length) return;
  doResign(state.myColor, 'user');
  flash('已认输 · ' + (state.myColor === 'b' ? '白' : '黑') + '方胜');
  syncUI();
};
$('verdict-close').onclick = () => {
  /* ★ 记下「用户手动关掉了」（2026-10-06 审查发现）：原来只把 box.hidden 设成 true，
     而下一次 syncUI → renderVerdict 又会 `box.hidden = false` 把它显示回来 ——
     表现为「点了叉，过一会儿结果条自己又冒出来」。
     记在 state.result 上（新的一次数子/认输会整个替换掉它，所以下次有结果照样会显示）。 */
  if (state.result) state.result.dismissed = true;
  $('verdict').hidden = true;
};

$('btn-draft').onclick = toggleDraft;

/* 「暂停 / 继续」自动对弈（只有"双方都由 KATAGO 走"时才出现）——
   ★ 暂停后**还要 clearTimeout**：定时器可能已经武装好了，光靠 needAIMove 里那道
     判断也行（它查 state.autoPaused），但清掉更干脆，不会有一次"多下出来"的落子。 */
$('btn-auto').onclick = () => {
  if (!state.autoBoth) return;
  state.autoPaused = !state.autoPaused;
  if (state.autoPaused) {
    clearTimeout(aiTimer);
    flash('自动对弈已暂停 —— 按「继续」接着下');
  } else {
    flash('继续自动对弈');
  }
  syncUI();
};

$('btn-undo').onclick = () => {  /* ★ 正在回看历史手时不许悔棋（2026-10-06 审查发现）。
     落子 / 停一手 / 试下都有这条约定（「回看中不能落子，先跳到最新」），**只有悔棋漏了** ——
     于是「看着第 50 手点悔棋」撤掉的是**最后一手**、画面还跳到 99 手，
     用户会以为软件撤错了手（他心里的"这一手"就是眼前看着的那一手）。 */
  if (state.viewAt !== state.moves.length) { flash('回看中不能悔棋，先跳到最新'); return; }
  if (!state.moves.length) return;
  /* 试下时不能退过存档点 —— 那等于把草稿起点也吃掉，退出试下后就亏了 */
  const floor = state.draft ? state.draft.from : 0;
  if (state.moves.length <= floor) {
    if (state.draft) flash('已经退到试下的起点了');
    return;
  }
  state.moves.pop();
  /* 人机对弈模式：撤到「又轮到自己」为止 —— 否则 AI 会立刻把这一手补回来，看着像没撤。
     试下时不做这个联动：草稿里你想退几手就退几手。 */
  if (!state.draft && !state.autoBoth) {
    while (settings.mode === 'play' && state.moves.length &&
           sideToMove(state.moves.length) !== state.myColor) {
      state.moves.pop();
    }
  }
  state.toMove = sideToMove(state.moves.length);
  /* ★★ 禁着点必须**重新算出来**，不能清成 null（2026-10-07 用户报的真 bug）。
     原来这里写的是 `state.koPoint = null;`，注释说「局面变了，打劫禁着点随之失效」——
     那句话只对了一半：**退掉了提劫那一手**时它确实该失效，但**退到"刚提完劫"那个局面**时
     它必须重新成立。清成 null 的后果就是用户报的：
       白提劫 → 我禁着 → 我在别处走一手 → 白在别处走 → 我悔棋回到"白提完劫"
       → 这时我居然能**直接提回去**（违反禁着点）。
     复现证据见 dev\_cdp_ko_user.mjs（用用户自己那份 GN[打劫BUG] 棋谱走的整条链）。
     ★ 同一处还有个反向错：悔棋**退掉一个"在别处走"的手**之后，劫其实又成立了
       （禁着点该回来），而原来是一律清 null —— 两个方向都错。 */
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  /* ★ 顺手补上每手的 `capAt`（"这一手提掉了哪一点"）——
     打劫判据要靠它判断"这一手是不是在上一手被提的那点回提"。
     悔棋之后手顺被截断，重算一遍最省心（只在悔棋时做，开销可忽略）。 */
  rebuildCapAt();
  state.pv = null;               // 变化图基于当前候选点，局面变了就失效
  state.viewAt = state.moves.length;
  /* ★ 局面变短了 → 必须截断分析队列与走势数据（truncateAnalysisTo 的注释里有实测数据）。
     漏了这一步会导致「悔棋后分析彻底停住」，用户 2026-10-06 报过。 */
  truncateAnalysisTo(state.moves.length);
  syncUI();
  /* syncUI 里会 scheduleAnalysis()，它按新的 viewAt 重新入队 —— 但**当前局面这一项
     若 history 里已经有值就不会入队**（scheduleAnalysis 的去重条件），
     而悔棋后的局面恰恰是「算过但画面要重画」的。所以这里显式强制重算当前局面。 */
  scheduleAnalysis(0, true);
};

$('btn-pass').onclick = () => {
  /* ★ 回看中停一手也走"开分支"（2026-10-19）—— 和落子一致；习题 / 试下照旧挡住 */
  if (state.viewAt !== state.moves.length) {
    if (tsOn() || state.draft) { flash('回看中不能落子，先跳到最新'); return; }
    cutForBranch();
  }
  state.moves.push({ pass: true, color: state.toMove });
  noteTreeMove();
  clearCoachAt(state.moves.length);      // 该手号上的旧讲解作废
  state.toMove = state.toMove === 'b' ? 'w' : 'b';
  state.koPoint = null;          // 脱先一手，劫自然消解
  state.viewAt = state.moves.length;
  syncUI();
};

/* 这个开关只管「棋盘上画不画推荐点」——右侧胜率是客观数据，始终显示。
   ★ 全软件只有**这一个**开关（「显示」菜单里，快捷键 T）。
     2026-10-07：外部 PR 曾在「推荐落点讲解」卡片里也加过一个同名开关，用户要求删掉 ——
     **两处重复只会让人搞不清该信哪个**，而且两个控件必须时刻同步、很容易漏。
     顺手加了 localStorage 记住选择（原来是启动默认关，每次都得重开）。 */
function setHintsVisible(visible) {
  state.showHints = !!visible;
  $('chk-show').checked = state.showHints;
  try { localStorage.setItem('rapacego.showHints', String(state.showHints)); } catch { /* 记不住也能用 */ }
  draw();
}
$('chk-show').onchange = e => setHintsVisible(e.target.checked);

$('chk-coords').onchange = e => {
  state.showCoords = e.target.checked;
  resize();          // 边距要跟着变（留白要放得下坐标）
};

$('chk-sound').onchange = e => {
  state.soundOn = e.target.checked;
  if (state.soundOn) playStoneSound();   // 打开时给个反馈，方便试听
};

/* 形势显示：总开关 + 画法偏好（雾 / 方块）。位置在底栏「音效」旁边。 */
$('chk-terr').onchange = e => {
  state.showTerritory = e.target.checked;
  if (!state.showTerritory) { state.ownership = null; state.ownAt = -1; }   // 关掉就清，别留残影
  syncUI();
  /* ★ 这个开关决定要不要向引擎要 ownership 数据（includeOwnership）→ 当前局面必须
     强制重算一遍，否则打开开关后要等到下一手才有雾（syncUI 那次不会重算已上屏的局面）。 */
  scheduleAnalysis(0, true);
};
$('sel-terr').onchange = e => { state.terrStyle = e.target.value; draw(); };

/* 拟人落子 —— 官方配方「How to get stronger human-style play」。
   不开：从候选里取首选（强，但不像人；而且如官方所说「搜索量给多了会比标称段位强」）。
   开了：按人类概率抽样，明显要崩的手会被压下去（见 pickAIMove / pickByHumanPolicy）。 */
$('chk-human').onchange = e => {
  settings.humanLike = e.target.checked;
  flash(settings.humanLike ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
  syncUI();
};

/* 盘上显示手数（快捷键 M）—— 复盘时看「这是第几手」 */
$('chk-nums').onchange = e => { state.showNums = e.target.checked; draw(); };

/* 变化图（快捷键 B）：鼠标停在推荐点上约 1 秒 → 显示这一手之后的预计变化 */
$('chk-pv').onchange = e => {
  state.showPV = e.target.checked;
  if (!state.showPV) { clearTimeout(pvTimer); pvTimer = null; state.pv = null; }
  draw();
};

/* ---------------- 底栏「显示」下拉（2026-10-04 用户选的方案 A） ----------------
   原来 6 个开关 + 形势画法下拉平铺在底栏，1240 宽的窗口下把底栏挤成三行
   （第三行只剩「认输 / 导出棋谱」，右边一大片空）。收进这个菜单后底栏回到一行。
   ★ 只是搬了个位置：里面 chk-xxx / sel-terr 的 id 全没变 —— 所以上面那些 onchange
     绑定、快捷键 T/Z/M/B/Y/X、以及 syncUI 的「开关状态统一从 state 画」统统不用改。 */
const DISP_MENU = $('disp-menu');
const closeDispMenu = () => { DISP_MENU.hidden = true; };

$('btn-disp').onclick = e => {
  e.stopPropagation();          // 别让下面那个「点外面关闭」在同一趟点击里立刻把它关掉
  DISP_MENU.hidden = !DISP_MENU.hidden;
};
/* 点菜单外面 / 按 Esc → 收起。
   （在菜单里点开关**不**收 —— 想连着开好几个是最常见的用法。） */
document.addEventListener('click', e => {
  if (!DISP_MENU.hidden && !$('disp').contains(e.target)) closeDispMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !DISP_MENU.hidden) closeDispMenu();
});

function buildSGF() {
  const R = RULES[settings.rules] || RULES.chinese;
  /* ★ 双方名字写进 PB / PW —— 别的棋谱软件（以及本软件自己再打开时）就能看到
     谁执黑谁执白，不用再靠 PLAYER / KATAGO 猜。
     SGF 属性值里不能出现 ] 和 \，先剔掉；太长也截一下。 */
  const sgfn = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  let s = `(;GM[1]FF[4]SZ[${N}]CA[UTF-8]AP[RapaceGo:0.3]KM[${settings.komi}]RU[${R.sgf}]`
    + `PB[${sgfn(clockName('b'))}]PW[${sgfn(clockName('w'))}]`;
  if (R.seats) s += 'GC[明清规则：座子制 · 还棋头]';
  /* ★ 2026-10-17：条件里加了 `state.setup.length` —— 打开**带摆子的棋谱**（死活题、古谱）
     再导出时，原来这几颗子会被整个丢掉（旧条件只认座子/让子）。 */
  if (R.seats || settings.handicap || state.setup.length) {
    const bs = state.setup.filter(p => p.color === 'b').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    const ws = state.setup.filter(p => p.color === 'w').map(p => `[${SGF_COLS[p.x]}${SGF_COLS[p.y]}]`).join('');
    if (!R.seats && settings.handicap) s += `HA[${settings.handicap}]`;   // 座子不是让子，不写 HA
    if (bs) s += `AB${bs}`;
    if (ws) s += `AW${ws}`;
  }
  /* 试下（草稿）里的手**不写进棋谱** —— 那是草稿，不是这一局 */
  const upto = state.draft ? state.draft.from : state.moves.length;
  /* 终局结果写进 RE[] —— 棋谱软件（围棋APP、CGoban 等）能直接读到胜负 */
  const r = state.result;
  if (r) {
    s += 'RE[' + (r.winner === 'b' ? 'B+' : 'W+')
      + (r.resign ? 'Resign' : r.lead.toFixed(1)) + ']';
    s += 'C[' + (r.resign
      ? (r.by === 'user' ? '认输' : 'AI 认输')
      : (r.winner === 'b' ? '黑方胜' : '白方胜') + r.lead.toFixed(1) + r.unit) + ']';
  }
  /* ★★ 有变化树（打开的棋谱带变体）→ 按**树**序列化，分支要保住（2026-10-17）。
     以前这里只写一条线：用户看过的变体，一导出就没了。
     ★ 只写手顺，不写每手的 C[]（与以前一致 —— 解说词走"存回原文件"那条路）。 */
  if (state.varRoot) {
    /* ★ 2026-10-19：分成「手顺」和「备注」两件事 ——
       · 手顺：树上每个节点一手；
       · 备注：① 树上本来就有的解说（打开棋谱再导出别丢）② 这一局算出来的分析
         （analysisNoteFor 只给"当前线上"的手算，而且有原生解说时自己会返回空）。
       原来这里一律不写 C[]，于是导出的棋谱再打开，解说词卡是一片空白。 */
    const path = varPath();
    /* ★★ 2026-10-22 用户报障：导出后**只有最后站的那条分支**的解说词进了 C[]，
       别的分支一片空白。根因：这里原来只按「当前这条线」的路径算备注
       （`analysisNoteFor` 读的是 `state.anaAt` —— 它只装当前线）。
       现在改成**给树上每个节点找它自己那条线**的分析：
         ① 当前线用 `curLineAnaAt()`（留档 + 现在的；★ 只读 anaAt 会缺后半段）；
         ② 其它分支用 `state.anaLines`（离开那条线时留的档，键 = 线指纹，见 archiveAnaLine）。
       同一个节点可能被几条线共用（共享前缀）→ 先到先得；那本来就是**同一个局面**，
       取谁的快照都一样。原生解说（节点自带的 C[]）一律不覆盖，这是老规矩。 */
    const curAt = curLineAnaAt();
    const noteOf = new Map();                       // 节点 → 备注文字
    const curMoves = movesOfNodePath(path);
    const noteAt = (moves, at, k, nd) => {
      if (!nd || nd.comment) return '';             // 有原生解说 → 不动它
      if (!at || !at[k] || !at[k - 1]) return '';   // 前后两个局面都分析过才有意义
      return moveAnalysisTextAt(moves, at, k);
    };
    const putNode = (nd, text) => { if (text && nd && !noteOf.has(nd)) noteOf.set(nd, text); };
    for (let i = 1; i <= path.length; i++) {
      putNode(path[i - 1], noteAt(curMoves, curAt, i, path[i - 1]));
    }
    for (const key of Object.keys(state.anaLines || {})) {
      const e = state.anaLines[key];
      const p2 = e && linePathOfList(e.moves);
      if (!p2) continue;                            // 这条线已经不在树上了（分支被删过）
      const mv2 = movesOfNodePath(p2);
      for (let i = 1; i <= p2.length; i++) {
        putNode(p2[i - 1], noteAt(mv2, e.at, i, p2[i - 1]));
      }
    }
    const mvSGF = (nd, extra) => {
      const m = nd.move;
      let out = ';' + (m.color === 'b' ? 'B' : 'W')
        + (m.pass ? '[]' : '[' + SGF_COLS[m.x] + SGF_COLS[m.y] + ']');
      const c = noteOf.get(nd) || extra || nd.comment || '';
      if (c) out += 'C[' + sgfValue(c) + ']';
      return out;
    };
    /* 树上没匹配上的尾巴 = 用户自己接着下的手（草稿之前的部分）。
       它们的备注仍然取**当前线**的分析（curAt 里就有）。 */
    const tail = state.moves.slice(path.length, upto).map((m, j) => {
      const k = path.length + j + 1;
      const t = (curAt[k] && curAt[k - 1])
        ? moveAnalysisTextAt(state.moves, curAt, k) : '';
      return mvSGF({ move: m, comment: '' }, t);
    }).join('');
    const tailNode = path.length ? path[path.length - 1] : state.varRoot;
    const walk = nd => {
      let out = nd.move ? mvSGF(nd) : '';
      const kids = nd.children.filter(c => c.move || c.children.length);
      if (nd === tailNode && tail) {
        /* 续下的手：这条线没分支就顺着接，已经有分支就当作又一条分支
           （SGF 里节点后面只能跟子树，不能再跟并列节点 —— 所以必须包起来）。 */
        if (!kids.length) return out + tail;
        return out + '(' + tail + ')' + kids.map(k => '(' + walk(k) + ')').join('');
      }
      if (kids.length === 1) out += walk(kids[0]);
      else if (kids.length > 1) out += kids.map(k => '(' + walk(k) + ')').join('');
      return out;
    };
    s += walk(state.varRoot);
    return s + ')';
  }
  for (let i = 0; i < upto; i++) {
    const m = state.moves[i];
    s += ';' + (m.color === 'b' ? 'B' : 'W') + (m.pass ? '[]' : `[${SGF_COLS[m.x]}${SGF_COLS[m.y]}]`);
    /* ★ 把这一手的分析写进 C[]（2026-10-18 用户要求）：
       导出的棋谱再打开时，右侧「解说词」卡要能显示当时的分析（手数/分数/胜率/目损/
       推荐选点/PV/直觉排名）。原来只写手顺，于是重新打开那张卡是空的。
       ★ 两个条件：① 这一手**前后两个局面**都分析过（否则存进去是一串"还在算…"）；
                   ② 这份棋谱在这个手号上**没有原生解说词**（不能把人家的解说盖掉）。 */
    const note = analysisNoteFor(i + 1);
    if (note) s += 'C[' + sgfValue(note) + ']';
  }
  return s + ')';
}

/* SGF 属性值转义：`\` 和 `]` 是保留字符（换行可以原样留着，SGF 允许） */
function sgfValue(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

/* 第 k 手要写进棋谱的「分析备注」。条件见 buildSGF 里那段注释。 */
function analysisNoteFor(k) {
  if (!state.anaAt[k] || !state.anaAt[k - 1]) return '';
  if ((state.sgfComments || [])[k]) return '';          // 有原生解说 → 不动它
  return moveAnalysisText(k);
}

/* ---------------- 棋谱库（打开 / 存进来 / 备注 / 删除） ----------------
   位置：软件目录下的 records/（见 main.js 的 RECORDS_DIR）。
   为什么不放用户的「我的棋谱」：那是他自己的目录，不该由软件往里写。
   删除一律走系统回收站（主进程里的 shell.trashItem），误删能捞回来。 */

/* 解析 SGF —— **只取主分支**。
   · 坐标：标准 SGF 是两个字母（如 pd），第一个是列、第二个是行，**行从最上面开始数** ——
     正好和我们的内部坐标 (x=列, y=行, y=0 在最上) 一一对应，不用做任何转换。
   · 变体：SGF 里第一个 '(' 是根节点，**之后再出现的 '(' 都是变体** → 到那里就截断。
   · 认得出：SZ / KM / RU / AB / AW / ;B[xx] / ;W[xx] / 空 [] = 停一手。 */
function parseSGF(text) {
  const s = String(text || '');

  /* ---------- 1) 切成 token：括号 / 节点 ----------
     ★ 一个节点里可以有多组「标识 + 若干值」，例如 `;AB[pd]AW[dd]C[注释]`
       —— 所以不能只挑 `;[BW][..]`，得把每组标识+值都正经读出来。
     ★ 属性值里的 `\]` 是 SGF 的转义，要当普通字符，否则值里带方括号就把 token 切歪。
     ★ 2026-10-06：改成**按节点分组**（`{ props, at, end }`）并记下每个节点在**原文里的位置** ——
       props 分组是为了正确取出「这一手的 C[] 解说词」（同一节点里 C 写在 B 前还是后都不影响）；
       at/end 是为了以后「在软件里改解说词 → 只替换原棋谱里那一个 C[]」时能精确落刀。 */
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(' || c === ')') { toks.push(c); i++; continue; }
    if (c !== ';') { i++; continue; }
    const at = i;                                      // 节点起点（';' 的位置）
    i++;
    const props = [];
    for (;;) {
      /* ★★ 2026-10-06 修正（用户报「棋谱说明（根节点那段）读不出来」）。
         原写法是：
               while (i < s.length && /\s/.test(s[i])) i++;   // 跳过标识前的空白
               let id = '';
               while (/[A-Za-z]/.test(s[i])) { id += s[i]; i++; }
               if (!id) break;                                // ← 这里就错了
         `/\s/` 把**换行**也算进去，而 SGF 的属性值允许跨行 ——
         真实棋谱大量这么写（题集的摆子几十个点分两三行、解说词本身也是多行）：
               AB[qh]…[im]<CRLF>[kn]…[ch]AW[qf]…C[手筋辞典…<CRLF>…第55图 黑先]
         于是「跳过空白后正好遇到 `[`（下一个值）」被误判成「这个节点读完了」，
         节点被从中间劈开：
           ① 这个属性剩下的值归到了下一个节点 → AB/AW 摆子点数变少（初始局面就是错的）；
           ② 同一节点后面的属性整组丢失 —— 最常见的就是 `C`（棋谱说明）
              和 `AW` 一起丢，这就是「根节点那段说明读不出来」的真因。
         实测抽样 300 份真实棋谱：**71 份（23.7%）被劈错**，其中一份的节点数
         从正确的 8 个虚增到 57 个。
         修法：只有「跳过空白后既不是标识、也不是值的开头」才认为节点结束。 */
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;        // 标识前的空白（含换行）
      let id = '';
      while (j < s.length && /[A-Za-z]/.test(s[j])) { id += s[j]; j++; }
      if (!id) {
        if (j < s.length && s[j] === '[') i = j;          // 值接着写 → 本属性还没完
        else break;                                      // 这个节点读完了
      } else {
        i = j;
      }
      const vals = [], valAt = [];
      /* ★ 另一个同类修正：**值之间**也可能夹着换行
         （`AW[fc][fb]<CRLF>[fa][ed]…` 这种写法很常见）。
         原循环条件 `while (s[i] === '[')` 遇到换行就退出，于是这个属性
         只读到换行前的那几个值，剩下的全被劈走 —— 摆子少、解说词只剩第一行。
         现在每读完一个值先跳过空白，再看有没有下一个值。 */
      for (;;) {
        let k = i;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k >= s.length || s[k] !== '[') break;
        i = k;
        i++;
        valAt.push(i);                                   // 值正文起点（'[' 之后）
        let v = '';
        while (i < s.length) {
          if (s[i] === '\\') { v += s[i] + (s[i + 1] === undefined ? '' : s[i + 1]); i += 2; continue; }
          if (s[i] === ']') break;
          v += s[i]; i++;
        }
        vals.push(v);
        i++;                                             // 越过 ']'
      }
      props.push({ id: id.toUpperCase(), vals, valAt });
    }
    toks.push({ props, at, end: i });
  }

  /* ---------- 2) 走主分支 ----------
     ★★ 2026-10-06 修正（用户报「导入棋谱只加载了前 N 手」）。
     SGF 里 `(;A;B(;C)(;D))` 这种结构，**主分支 = 每个分支点的第一个子节点**（A,B,C），
     不是「遇到第一个 ( 就收工」—— 旧写法正是后者，于是真实棋谱只要在中盘挂一个
     变化图，后面全部丢掉。
     实测本机 21433 份职业棋谱（抽样 1500 份）：
       正确主线 106760 手 vs 旧写法 103282 手 → **16.9% 的文件被截断**；
       最惨的一份原 305 手只剩 3 手；AlphaGo 对李世石那局原 280 手只剩 15 手。
     （旧写法当初是为了解决「注释里的括号被当成分支」而写的 —— 那个问题现在由
       第 1 步的 tokenizer 自然解决了：括号在属性值里根本不会被当成 token。） */
  /* ★★ 2026-10-17：旧写法是「顺着括号往下走，遇到第二棵子树就整块跳过」——
     它只留主分支，**变体全丢**（《玄玄棋经》347 题里就有 77 个变体子树读不到）。
     现在改成：**先建整棵树**，再从树里取主分支（每个节点取第一个孩子，语义与旧 walk
     一模一样）→ 树和主分支永远同源，不会各说一套。
     ⚠️ 变体挂在**当前最后一个节点**下面：`(;A;B(;C)(;D))` 里 C/D 都是 B 的孩子。
     ⚠️ 一个文件里可能有**多棵并列树**（题集），这里只取第一棵（旧行为不变），
        分段由 splitSgfGames 负责。 */
  const mkNode = t => ({ props: t.props, at: t.at, end: t.end, children: [] });
  let tree = null;
  {
    let k = toks.indexOf('(');
    const gameTree = () => {                             // k 指向 '('
      if (toks[k] !== '(') return null;
      k++;
      let root = null, cur = null;
      while (k < toks.length) {
        const t = toks[k];
        if (t === ')') { k++; break; }
        if (t === '(') {                                 // 变体
          const sub = gameTree();
          if (sub) {
            if (cur) cur.children.push(sub);
            else if (!root) root = sub;                  // 异常形态：子树写在节点之前
          }
          continue;
        }
        if (t && t.props) {
          const nd = mkNode(t);
          k++;
          if (!root) { root = nd; cur = nd; }
          else { cur.children.push(nd); cur = nd; }
        } else k++;
      }
      return root;
    };
    tree = gameTree();
  }
  /* 主分支 = 从根开始，每个节点都取**第一个**孩子，一直走到底 */
  const nodes = [];                                      // 主分支上的属性节点（按出现顺序）
  for (let cur = tree, guard = 0; cur && guard < 50000; cur = cur.children[0], guard++) nodes.push(cur);

  /* ---------- 3) 取出棋谱自带的东西 ----------
     C[] = 这个节点上的**解说词**（很多棋谱有，实测抽查 600 份里 353 份带 —— 见开发记录）。
     归属：带 B/W 的节点 → 属于**这一手**；根节点 → 属于「开局前」（下标 0）。
     ★ 必须按**节点**扫（同一节点里 C 写在 B 前或后都不能错位），所以第 1 步分了组。 */
  const firstProp = id => {
    for (const nd of nodes) {
      for (const p of nd.props) if (p.id === id && p.vals.length) return p.vals[0];
    }
    return null;
  };
  const allPts = id => {
    const out = [];
    for (const nd of nodes) {
      for (const p of nd.props) {
        if (p.id !== id) continue;
        for (const v of p.vals) {
          if (v.length === 2) out.push({ x: v.charCodeAt(0) - 97, y: v.charCodeAt(1) - 97 });
        }
      }
    }
    return out;
  };
  /* SGF 值里的转义：`\]` → `]`、`\\` → `\`（换行是原文里的换行，保留） */
  const unsgf = v => String(v).replace(/\\([\s\S])/g, '$1');

  /* ★ 盘面大小必须**在遍历之前**读出来 —— 下面判越界坐标要用它
     （最典型的是 `zz` 这种题集分隔标记，不判就会算出下标 500 越出 361 格的盘面）。
     SZ 出现在根节点，而 nodes 就是从根节点开始按主分支收集的，所以扫得到。 */
  /* nodes 是 { props, at, end }，SZ 在 props 内；复用属性读取器，
     避免把节点当成属性后永远回退到 19 路。 */
  const declaredSize = parseInt(firstProp('SZ'), 10);
  const boardSize = declaredSize >= 2 && declaredSize <= 52 ? declaredSize : 19;

  /* 给树上的每个节点补两样消费方要用的东西：`move`（这一手）与 `comment`（这一节点的解说）。
     · 空 [] = 停一手 → { color, pass: true }
     · 坐标越界（`;W[zz]` 这种题集分隔标记）→ move = null（**不是棋**，别当 pass）
     · 同一节点多个 B/W 只认第一个（SGF 不允许，真出现就按第一个算） */
  const attachMove = nd => {
    let mv = null, cm = '';
    for (const p of nd.props) {
      if (p.id === 'B' || p.id === 'W') {
        const color = p.id === 'B' ? 'b' : 'w';
        const v = p.vals.length ? p.vals[0] : '';
        if (!v) mv = { color, pass: true };
        else if (v.length === 2) {
          const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
          if (x >= 0 && y >= 0 && x < boardSize && y < boardSize) mv = { color, x, y };
        }
      } else if (p.id === 'C' && p.vals.length && !cm) {
        cm = unsgf(p.vals[0]);
      }
    }
    nd.move = mv;
    nd.comment = cm;
    for (const c of nd.children) attachMove(c);
  };
  if (tree) attachMove(tree);
  /* ★ 根节点自己带一手的情况（`(;B[pd];W[dp])` 这种写法）→ 套一层"空根"，
     让消费方可以无脑假设「根节点没有棋、第一手是某个孩子」。
     只动 tree，不动 nodes（主分支输出一个字节都没变，有基线快照比对）。 */
  if (tree && tree.move) {
    tree = { props: [], at: -1, end: -1, move: null, comment: '', children: [tree] };
  }

  const moves = [], comments = [], mainLine = [], seps = [];
  /* 根节点（棋谱开头那个节点）的说明文字 —— 单独存，不占「第 0 手」那个键。
     实测抽样 300 份真实棋谱：116 份的根节点带 C（38%），
     其中一部分以前**整段读不出来**（被后面第 0 手的 C、或被 tokenizer 劈错吃掉）。 */
  let rootComment = '';
  for (const nd of nodes) {
    /* 先看这个节点是不是一手棋（一次扫全部 props，所以 C 的位置无关） */
    let movesHere = [];
    for (const p of nd.props) {
      if (p.id !== 'B' && p.id !== 'W') continue;
      const color = p.id === 'B' ? 'b' : 'w';
      const v = p.vals.length ? p.vals[0] : '';
      if (!v) { movesHere.push({ color, pass: true }); continue; }   // [] = 停一手
      if (v.length !== 2) continue;
      /* ★ 这里用 charCode-97 而不是查表 —— SGF 是 a=1…h=8,**i=9**,j=10…s=19，
         与界面/GTP 那套「跳过 I」的字母表**不同**（见文件顶部 SGF_COLS 的注释）。 */
      const x = v.charCodeAt(0) - 97, y = v.charCodeAt(1) - 97;
      /* ★ 越界坐标不能当真实一手棋（2026-10-06 审查发现，真实棋谱里 2.97% 出现）。
         最常见的是 `;W[zz]` / `;B[zz]` —— 它不是坏数据，而是**死活题集里两张题
         之间的分隔标记**（前一节点的解说词正好写着「以上为第 N 图正解」）。
         原来的错：算成 x=25,y=25 → 下标 500，而盘面只有 361 格，
         TypedArray **静默忽略越界写、不报错** → 那手棋凭空消失，
         但它仍算进手数 → 后面全部手顺错位、黑白颠倒。
         现在：不生成 move（这一手在盘上不存在），并记成 sep 让上层知道
         「这里换了一道题」—— 具体要不要分段显示，见 renderCommentBox 的用法。 */
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x >= boardSize || y >= boardSize) {
        seps.push(moves.length + (movesHere.length - 1));
        continue;
      }
      movesHere.push({ color, x, y });
    }
    moves.push(...movesHere);
    /* 再收这个节点上的解说词，并记下它在**原文里的位置**（编辑时要用它精确落刀）
       ★ 根节点说明的归属：**主分支上第一个没有落子的节点**（它不属于任何一手）。
         为什么这么定（实测 300 份真实棋谱校出来的，三种形态都得覆盖）：
           a) 死活题集：第一个节点就是根节点，摆子 AB/AW 和说明 C 都在这上面
              （`(;AB[…]AW[…]C[手筋辞典…第55图 黑先]…`）；
           b) 古谱（当湖十局那类）：第一个节点只有 FF/PB/RE 这些元数据，
              摆子写在第二个节点上 —— 但说明也在第一个节点上；
           c) 目录页 / 只有元数据的棋谱：第一个节点没有摆子，
              只有一句 C（实测 `00_mulu.sgf` 是《兼山堂弈谱》目录、`Shusai-092.sgf`
              是「Moves after 128 not recorded」）—— 这两种原来**整段读不出来**。
         所以判据只能是「第一个没有落子的节点」，不能加「必须带摆子」这个条件。 */
    const isRoot = movesHere.length === 0 && !rootComment;
    let cSpan = null;
    for (const p of nd.props) {
      if (p.id !== 'C' || !p.vals.length) continue;
      if (p.valAt && p.valAt.length) cSpan = [p.valAt[0], p.valAt[0] + p.vals[0].length];
      /* ★★ 2026-10-06 深夜补（用户报「一点开编辑，所有文段自动划分并加空行」）。
         真凶：有些棋谱（实测用户那份「绝艺解说」的职业棋谱）换行写的是
         **`\r\r\n`（CR CR LF）**，全文 690 处；而 `<div pre-wrap>` 把它渲染成
         「一个换行」，`<textarea>` 按 HTML 规范只保留 LF → `\r\r\n` 变成 `\n\n`
         → **显示是紧凑的、编辑框里每句之间多一个空行**。
         也就是说：这段文字在文件里本来就"多了一个 CR"，只是在只读显示时看不出来。
         修法：解析时就用 nlForSGF 归一化（把 `\r\r\n` / 裸 CR / 裸 LF 全归成 CRLF）。
         这样显示与编辑拿到的是**同一个值**，而且写回磁盘的也是同一个口径（幂等）。 */
      /* 紧一点：把连续空行收成一个（见 tightenSGFText 的注释） */
      const txt = tightenSGFText(nlForSGF(unsgf(p.vals[0])));
      if (!txt.trim()) continue;
      if (isRoot) rootComment = txt;
      else comments[movesHere.length ? moves.length : 0] = txt;
    }
    mainLine.push({
      at: nd.at, end: nd.end,
      /* isRoot：这一条代表「根节点那段说明」。保存根节点说明时用它找落刀位置。 */
      isRoot: isRoot,
      moveIdx: movesHere.length ? moves.length : 0,
      cSpan,
    });
  }
  /* 盘面大小：上面已按 nodes 里的 SZ 算过 boardSize，这里直接用同一个值，
     **不重新解析** —— 两份口径（一个不限范围、一个限 2~52）万一哪天不一致，
     就会出现「按 19 路拦越界、却按 52 路开棋盘」这种错位。 */
  const size = boardSize;
  const kmRaw = firstProp('KM');
  const komi = kmRaw === null ? null : parseFloat(kmRaw);
  const ab = allPts('AB'), aw = allPts('AW');
  const ru = String(firstProp('RU') || '').toLowerCase();
  let rules = 'chinese';
  if (ru.indexOf('japan') >= 0) rules = 'japanese';
  else if (ru.indexOf('korea') >= 0) rules = 'korean';
  else if (ru.indexOf('chinese') >= 0 && komi === 0 && ab.length === 2 && aw.length === 2) {
    rules = 'ancient';       // 明清：导出时 RU 也写 Chinese，靠「座子各 2 + 不贴目」认出来
  }
  /* 双方名字（别的软件导出的棋谱大多有；没有就是 null） */
  const pb = firstProp('PB'), pw = firstProp('PW');
  /* ★ 先手（2026-10-14 加，给习题练习用）：SGF 的 PL 属性。
     为什么必须单独取出来：题集里"这道题该谁先走"就写在 PL 上，而主变化第一手的颜色
     通常与之相同、但**不是必须**（实测 347 题的题集里就有 2 处对不上：一题完全没写 PL）。
     所以两处都要留：调用方优先用 firstPlayer，没有时退回「第一手的颜色」。
     不写进返回值的话，导入题集就只能靠猜。 */
  const plRaw = String(firstProp('PL') || '').toUpperCase();
  const firstPlayer = plRaw === 'B' ? 'b' : (plRaw === 'W' ? 'w' : null);
  return {
    ok: moves.length > 0 || ab.length > 0, size, komi, rules, ab, aw, moves, pb, pw,
    firstPlayer,
    comments, rootComment, mainLine,
    /* ★ 2026-10-17 新增：整棵变化树（含变体）。节点形如
         { props, at, end, move: {color,x,y,pass}|null, comment, children: [] }
       根节点通常只有 AB/AW（move=null），主线是「一路取 children[0]」。
       题集用它实现「按正解」的多分支应对；棋谱浏览暂未接（见 README 的说明）。 */
    tree,
    /* 「换了一道题」的位置（题集里 `zz` 分隔标记所在的手数）。
       我们**不做多题分段显示**（用户定的：只显示主干），
       但保留这个信息 —— 将来若要做「第 3 题」这类提示，不用再改解析器。 */
    seps
  };
}

/* ---------- 把一份 SGF 切成「一道道题」（2026-10-14，导入习题用）----------
   ★ 为什么需要它：棋谱是「一个文件 = 一局棋」，而**题集不是** ——
     实测用户那份《玄玄棋经》（xxqj.sgf）是 `(…)(…)(…` **347 棵并列的顶层树**
     串在一个文件里，一道题一棵树。而 parseSGF 只解析**第一棵**（那是为棋谱写的：
     一个文件里可能串着好几局，只取第一局）。所以导入题集必须先把顶层树切开，
     再一棵一棵交给 parseSGF —— 这样 AB/AW/AE/zz 越界这些坑全都复用同一套已验证的代码，
     不用再写第二份解析器。
   ★ 扫描必须**认属性值**：SGF 的值可以跨行、里面能有括号和分号
     （`C[第 1 图（黑先）…]`），所以遇到 `[` 要一直跳到配对的 `]`（并处理 `\` 转义），
     否则括号数一错，整份文件就被切歪。
   ★ 只认**真的含节点**的段（`(;…)`）—— 挡掉空树 `()`。 */
function splitSgfGames(text) {
  const s = String(text || '');
  const n = s.length;
  const out = [];
  let i = 0;
  /* 从 '[' 跳到配对的 ']'（含 `\]` 转义） */
  const skipVal = () => {
    i++;
    while (i < n) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === ']') { i++; return; }
      i++;
    }
  };
  while (i < n) {
    if (s[i] === '[') { skipVal(); continue; }     // 顶层不该出现值，保险起见
    if (s[i] !== '(') { i++; continue; }
    const start = i;
    let depth = 0;
    while (i < n) {
      if (s[i] === '[') { skipVal(); continue; }
      if (s[i] === '(') { depth++; i++; continue; }
      if (s[i] === ')') { depth--; i++; if (!depth) break; continue; }
      i++;
    }
    const piece = s.slice(start, i);
    if (/\(\s*;/.test(piece)) out.push(piece);      // 必须真含节点
  }
  return out;
}

/* 把一份题集 SGF 解析成「一道道的题」。返回 { list, skipped }：
     list 里每项 = { size, setup:[{x,y,color}], first, answer:[{color,x,y}], ok }
       setup  初始局面（AB/AW 摆子）
       first  这道题该谁先走（PL 优先；没写 PL 就退回「正解第一手的颜色」；都没有 = 黑）
       answer 正解顺序（= SGF 的主变化。题集里"主变化"就是做者写进去的正解）
   ★ `skipped` 要报出来：题集里偶尔有一棵解析不出东西的树（空树 / 只有元数据），
     静默丢掉会让"第 N 题"的编号对不上用户手里的书 —— 所以数字要能对上，就靠它不算进 list。
   ★ 坐标一律经 parseSGF（它已经处理了「SGF 含 i、GTP 跳 I」和越界坐标），
     这里不自己解析坐标。 */
function parseProblemSet(text) {
  const pieces = splitSgfGames(text);
  const list = [];
  let skipped = 0;
  for (const piece of pieces) {
    let p = null;
    try { p = parseSGF(piece); } catch (e) { p = null; }
    if (!p || !p.ok || (!p.ab.length && !p.aw.length && !p.moves.length)) { skipped++; continue; }
    const setup = [];
    for (const s of p.ab) setup.push({ x: s.x, y: s.y, color: 'b' });
    for (const s of p.aw) setup.push({ x: s.x, y: s.y, color: 'w' });
    const answer = (p.moves || []).map(m => ({ color: m.color, x: m.x, y: m.y, pass: !!m.pass }));
    const first = p.firstPlayer
      || (answer.length ? answer[0].color : null)
      || 'b';
    /* 尺寸：题目自己声明的（题集偶尔混着小盘题）；没声明就是 19 */
    list.push({ size: p.size || 19, setup, first, answer, ok: true,
                rootComment: p.rootComment || '',
                /* ★ 2026-10-17：整棵正解树（含变体）。「按正解」那一档用它——
                   一道题有几条正确分支时，走到哪条就跟哪条；只读主变化会把它当"走偏"。 */
                tree: p.tree || null });
  }
  return { list, skipped };
}

/* ---------- 换行符归一（2026-10-06）----------
   ★ 用户报的现象：「显示没空行 → 点编辑有空行 → 保存后有空行」。
   根因：真实棋谱里换行**大多写的是 CRLF**（实测抽样 2000 份，根节点解说词里
   251 份含 CRLF）。而 HTML 的 <textarea> 有一条规范行为：
   **通过 .value 读回来时，CRLF 会被规范化成 LF**。于是：
     显示（div + pre-wrap）   拿到原文的 CRLF
     编辑（textarea.value） 拿到规范化后的 LF
   写回时把 ta.value 原样塞回 SGF —— 那处 CRLF 就被换成了 LF。
   同一个文件里 LF 与别处的 CRLF 混排，换个查看器打开，空行就冒出来了。

   修：写回前统一成 CRLF（Windows 上 SGF 的通行写法，也是原文件的口径）。
   ★ 顺序要紧：必须**先合并 CRLF 再统一转回 CRLF** ——
     少这一步会变成 CRCRLF，那才是真的多出一个空行。 */
function nlForSGF(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  return String(t == null ? '' : t)
    .split(CR + LF).join(LF)      // CRLF → LF
    .split(CR).join(LF)          // 落单的 CR → LF
    .split(LF).join(CR + LF);    // LF → CRLF
}

/* ---------- 把连续空行收成一个（2026-10-06 深夜，用户第二次报同一个现象）----------
   ★ 用户的原话：「一点开编辑，所有文段自动划分并加空行」。
   第一轮我只修了 `\r\r\n`（CR CR LF）——那确实是一种"假空行"。但用户又发来截图，
   指着第 38 手说还有。查下去才明白：**他嫌的不是假空行，是空行本身**。
   实测他这份「绝艺解说」职业棋谱（499 条 C[]）：25 条带换行，
      · 21 条是 `\r\r\n`（第一轮修的）
      · 4 条是正常的 `\r\n\r\n`（段落空行）
   两种在他的界面上都是「每句之间空一行」。而棋谱解说大多是**一句一行**的弹幕体，
   空行只是导出工具排版留下的，读起来反而散。
   所以这里再收一道：**连续两个及以上的换行压成一个**。
   ★ 三处一致：显示（div）、编辑（textarea）、写回磁盘都用这个口径 ——
     用户第一次报的正是"显示和编辑不一样"，不能再留这种缝。
   ★ 非破坏性：只影响**界面与写回**的呈现；原文件在被用户主动保存前一字不动。 */
function tightenSGFText(t) {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const CRLF = CR + LF;
  const parts = String(t == null ? '' : t).split(CRLF);
  /* ★ 第一版这里写错了两次，都记下来（判据/实现各错一次）：
     ① 条件写成 `blank(p) && out.length && 上一个 === ''` ——
        `'a'` 之后第一个空串会被 push，第二个空串来比较时比的是 `'a'`，
        于是一个也压不掉（实测输出与输入一模一样）。
     ② 我又想"保留一个空行当段落分隔"，但用户要的是**紧凑**：
        他这份棋谱的解说是一句一行的弹幕体（「等于芈昱廷和李钦诚的位置互换」
        这种），空行只是导出工具排版留下的 —— 留着就是"每句之间空一行"。
     所以现在：**空行一律去掉**（含只在空白字符的行、含首尾）。 */
  const kept = parts.filter(p => p.replace(/\s/g, '') !== '');
  return kept.join(CRLF);
}

/* ---- 把某一手（或根节点）的解说词写回 SGF 文本（2026-10-06） ----
   做法：**只在原文里替换/插入那一个节点上的 C[]**，其余字符一个都不动。
   为什么必须这么做（而不是用 buildSGF 重新生成一份）：
   我们的导出只写主分支、不认识变体/别的属性 —— 拿它覆盖用户下载来的棋谱，
   会把变体、引擎信息、别的注释**全部抹掉**。所以这里把文件当"文本"处理，
   靠 parseSGF 交出来的节点位置精确落刀。
   at：手数；at === -1 表示**根节点那段说明**（它不属于任何一手）。
   返回 { ok, text } 或 { error }。 */
function patchSGFComment(text, at, newText) {
  const p = parseSGF(text);
  const ent = at === -1
    ? (p.mainLine || []).find(x => x.isRoot)
    : (p.mainLine || []).find(x => !x.isRoot && x.moveIdx === at);
  if (!ent) {
    return { error: at === -1 ? '这份棋谱的根节点上没有说明文字' : '这份棋谱里找不到第 ' + at + ' 手' };
  }
  /* ★ 写回前把换行统一成 CRLF（见上面 nlForSGF 的注释） */
  const esc = nlForSGF(newText).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  if (ent.cSpan) {
    if (!newText) {
      /* 清空 → 把整个 C[..] 删掉（'C[' 在值的左两格：标识 1 字符 + '['） */
      const s = ent.cSpan[0] - 2, e = ent.cSpan[1] + 1;
      return { ok: true, text: text.slice(0, s) + text.slice(e) };
    }
    return { ok: true, text: text.slice(0, ent.cSpan[0]) + esc + text.slice(ent.cSpan[1]) };
  }
  if (!newText) return { ok: true, text };          // 本来没有、又要清空 → 什么都不用做
  /* 没有 C[] → 插在这个节点最后一个属性的后面 */
  return { ok: true, text: text.slice(0, ent.end) + 'C[' + esc + ']' + text.slice(ent.end) };
}

/* 把解析出来的棋谱装进当前局面。
   srcName = 棋谱库里的文件名（有它才能把讲解存回这份棋谱旁边） */
function applyRecord(rec, srcName) {
  if (!rec || !rec.ok) { flash('这份棋谱读不出手顺（格式可能不常见）'); return; }
  /* ★ 换棋谱时先退出解说词编辑态（2026-10-06）。
     不退的话：① 框里还留着上一份棋谱的半截文字，render 又不敢重画
     （「正在编辑就返回」那道守卫），于是那段文字会跟着走进新棋谱 ——
     用户以为在改新棋谱，实际在改旧的。 */
  exitCommentEdit();
  state.recName = String(srcName || '');
  /* 换了一份棋谱 → 上一局「导出到哪」的记录作废，否则导出会写进上一份棋谱里去。
     清空后导出仍可能写回**这份**棋谱（仅当它是本软件导出的，见 saveToRecords ②）。 */
  state.exportName = '';
  settings.size = [9, 13, 19].indexOf(rec.size) >= 0 ? rec.size : 19;
  settings.rules = RULES[rec.rules] ? rec.rules : 'chinese';
  settings.komi = (rec.komi !== null && !isNaN(rec.komi)) ? rec.komi : RULES[settings.rules].komi;
  settings.handicap = 0;                 // 让子 / 座子由 setup 表达
  settings.mode = 'free';                // 打开棋谱按「摆棋」看：两边都能接着摆
  state.noGame = false;                  // ★ 打开棋谱就是「有内容了」：解除未开局状态
  state.fromRecord = true;               // ★ 打谱：讲解三件套都能用（推荐落点会自己找点，见 pickCandidatesAt）
  clearCoachPanels();                    // 换了棋谱 → 两个框清空（「全盘讲解」按钮这时才露出来）
  N = settings.size;
  state.setup = [
    ...rec.ab.map(p => ({ x: p.x, y: p.y, color: 'b' })),
    ...rec.aw.map(p => ({ x: p.x, y: p.y, color: 'w' })),
  ];
  state.moves = rec.moves.slice();
  /* ★ 变化树（2026-10-17）：只有棋谱会带它。手数列表的分支标记、Alt+←/→ 切换都靠它；
     没有分支的棋谱是 null，行为与以前完全一样。 */
  state.varRoot = rec.tree || null;
  /* ★ 棋谱自带的解说词（SGF 的 C[]，主分支逐手）—— 右下角那个「解说词」框就是显示它。
     没有就是空数组（多数自己导出的棋谱没有）。 */
  state.sgfComments = Array.isArray(rec.comments) ? rec.comments.slice() : [];
  /* 棋谱**根节点**的说明文字（题集出处、第几图、谁整理的）——
     单独存，不跟「第 0 手」抢键。它在解说词框的「（开局前）」那一档显示。 */
  state.rootComment = String(rec.rootComment || '');
  /* 一份题集里串了多道题时的分界位置（`zz` 分隔标记所在的手数）——
     只用来显示「第 N 题 / 共 M 题」，**不做切换**。 */
  state.quizTips = Array.isArray(rec.seps) ? rec.seps.slice() : [];
  /* 棋谱里带的双方名字 → 右侧 ID 栏（没有就留空，回落到默认叫法） */
  const cleanName = v => String(v || '').replace(/[\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  state.names = { b: cleanName(rec.pb), w: cleanName(rec.pw) };
  state.toMove = sideToMove(state.moves.length);
  /* ★ 打开棋谱时**不拦打劫**（KaTrain 第 135 行同理：重放棋谱用 `ignore_ko=True`，
     因为那些手的合法性无法追溯、而且往往本来就是"打完劫之后"的局面）。
     但**禁着点要算出来** —— 用户接着往下摆时得受劫规则约束。
     先补 `capAt`（棋谱手顺里没有这个字段），再反推禁着点。 */
  state.koPoint = null;
  rebuildCapAt();
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  state.viewAt = state.moves.length;
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  state.history = [];
  state.leads = [];
  state.histVisits = [];
  resetAnalysisState();         // 换了棋谱：旧的分析欠账 / 「已上屏」标记全部作废
  state.result = null;
  state.draft = null;
  state.lastEval = null;
  state.review = null;          // 换了棋谱 → 上一次的复盘数据作废
  state.reviewDoc = null;       // 复盘文件也作废（随后 autoLoadReviewDoc 按新棋谱读）
  state.pv = null;              // 变化图也收掉（候选点马上就变了）
  state.anaAt = {};             // 逐手分析快照：换了一份棋，旧的张冠李戴
  state.anaLines = {};          // 各分支的分析存档也跟着作废（导出时要按线写报告）
  state.autoBoth = false;       // 打谱没有"双方自动"这回事（模式固定成双人摆棋）
  state.autoPaused = false;
  setSeg('seg-mode', 'free');
  clockReset();
  resize();
  syncUI();
  flash('已打开棋谱 · ' + state.moves.length + ' 手 · ' + RULES[settings.rules].label);
  /* ★ 这份棋谱以前做过「全盘讲解」的话，把讲解读回来（用户要求：
     结果跟棋谱一起保存，下次打开还要能看到）。异步读、不挡打开。 */
  if (state.recName) loadCoachForRecord(state.recName);
  /* ★ 2026-10-22：顺手把这份棋谱已经存过的复盘拉回来 —— 自己导出的棋局带着 AI 分析，
     一打开手数列表里就有目损，不用再点「复盘报告」。
     gen 取现在的代：期间换了棋谱就作废（见 autoLoadReviewDoc 的守卫）。 */
  if (state.recName) autoLoadReviewDoc(state.recName, gameGen);
}

/* 存进棋谱库 */
/* 存进棋谱库的文件名（2026-10-18 加；10-19 改成 "A vs B" 且段位挂在 AI 名字后）：
   「黑 vs 白-时间」，例如 `P1 vs AI(3段)-202610190015.sgf`；时间到分钟（YYYYMMDDHHmm）。
   · PLAYER1 → P1、PLAYER2 → P2、KATAGO → AI（用户指定的缩写）；
   · **段位挂在 AI 那一方的名字后面**（括号里）；**双方都是 AI（自动对弈）就两边都挂**：
     `AI(3段) vs AI(3段)-202610190015.sgf`；
   · 双人摆棋没有 AI，也就没有段位：`P1 vs P2-202610190015.sgf`；
   · 名字里可能带空格 / 斜杠 / 冒号（用户改过名），**只清洗名字本身** ——
     不能把 " vs " 两边那两个空格也洗掉（所以先清洗、后拼接）。 */
function recordFileName() {
  const short = raw => {
    const s = String(raw || '').trim();
    if (/^PLAYER1$/i.test(s)) return 'P1';
    if (/^PLAYER2$/i.test(s)) return 'P2';
    if (/^PLAYER$/i.test(s)) return 'P1';
    if (/^KATAGO$/i.test(s)) return 'AI';
    return s;
  };
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
  const lvLabel = settings.mode === 'play'
    ? String(((RANK_MAP.get(settings.level) || {}).label) || '').replace(/\s+/g, '')
    : '';
  /* AI 那一方 = 自动对弈时两边都是；否则人机对弈里「不是我执的那一边」 */
  const isAI = color => settings.mode === 'play'
    && (state.autoBoth || color !== state.myColor);
  const side = color => {
    const nm = short(clockName(color)).replace(/[\\/:*?"<>|\s]/g, '');
    return nm + (lvLabel && isAI(color) ? '(' + lvLabel + ')' : '');
  };
  return side('b') + ' vs ' + side('w') + '-' + stamp + '.sgf';
}

async function saveToRecords() {
  /* ★★ 2026-10-22 用户报障：同一局棋反复点「导出棋谱」会存出一堆副本
     （原来每次都按当前时间新起名字 → 棋谱库里 `…-2055.sgf`、`…-2058.sgf` 一长串）。
     现在按优先级挑目标文件：
       ① 这一局**已经导出过**（`state.exportName`）→ 覆盖那一份；
       ② 这一局是从棋谱库打开的、而且**这份棋谱本来就是本软件导出的**（SGF 头里有
          `AP[RapaceGo:…]`）→ 写回原来那份。改解说词本来就是直接写回原文件，导出也该一致。
          ★ 为什么只认自家棋谱：`buildSGF()` 是**重建**整份棋谱，导入的外来棋谱
          （古谱、别的软件导出的）里的 GN/DT/CP/自定义属性会在写回时丢掉 —— 那种只能另存。
       ③ 都不是（刚下完的新局 / 外来棋谱）→ 按「黑 vs 白-时间」新起名字，撞名再加 ` (2)`。
     ★ 覆盖不会丢原件：主进程 `records:save` 在**第一次**覆盖前留 `<名字>.bak`（有就不再动）。 */
  let target = state.exportName || '';
  let writeBack = false;
  if (!target && state.recName) {
    try {
      const rd = await window.api.records.read(state.recName);
      if (rd && rd.ok && /AP\[RapaceGo/i.test(String(rd.text || '').slice(0, 400))) {
        target = state.recName; writeBack = true;
      }
    } catch (e) { /* 读不到就另存一份（宁多一份副本，也别弄坏别人的棋谱） */ }
  }
  const reusing = !!target;
  let name = target || recordFileName();
  if (!reusing) {
    /* 文件名只到**分钟**，同一分钟内连存两局就会撞名 ——
       而 records:save 撞名是**覆盖**（只留一份 .bak）。所以先看一眼棋谱库，
       撞上了就加 ` (2)`、` (3)`…（老命名带秒，几乎撞不上，改成分钟后这是必须的）。 */
    try {
      const all = (await window.api.records.list()) || [];
      const stem = name.replace(/\.sgf$/i, '');
      if (all.some(it => it.name === name)) {
        let i = 2;
        while (all.some(it => it.name === stem + ' (' + i + ').sgf')) i++;
        name = stem + ' (' + i + ').sgf';
      }
    } catch (e) { /* 拿不到列表就按原名存（覆盖时主进程会留 .bak 兜底） */ }
  }
  const r = await window.api.records.save(name, buildSGF());
  if (!r || r.error) { flash('保存失败：' + ((r && r.error) || '未知')); return null; }
  const savedName = r.name || name;
  state.exportName = savedName;               // 下次导出还覆盖这一份
  /* ★★ 2026-10-23 用户要求：导出**只存棋谱本身**，不再把对弈过程中边下边算的 AI 结果
     一起落成复盘文件（`.review.json`）。
     理由（用户原话）：「不要保存对弈过程中的 ai 计算结果，如果用户需要复盘，
     在棋谱库直接点击相应的棋谱进行 ai 复盘就行」——
     那批数据的每手搜索量从 3 到 507 参差（AI 思考与后台分析混着），胜率/目损前后不可比，
     存下来还会被当成正式复盘、界面上得额外解释「毛糙」。要复盘就让复盘做：统一档位整盘算。
     ★ **SGF 里的解说词（C[]）照旧写** —— 那是这份棋谱的内容（每条分支每手一条），
       第 4 轮用户明确要求过；它和「分析报告」不是一回事。 */
  flash((writeBack ? '已写回 · ' : (reusing ? '已更新棋谱库 · ' : '已存进棋谱库 · ')) + savedName
    + (writeBack ? '（同一份，没另存副本）' : (reusing ? '（覆盖原局）' : ''))
    + ' · 要复盘就在「棋谱库」点它');
  return r;
}

/* ★ 2026-10-23 删掉了 saveLiveReviewFor()（«导出时把对弈过程的分析摊成复盘»）：
   用户明确要求导出只留棋谱本身，分析要另做就点「AI 复盘」。
   老文件里 source='live' 的报告仍会被读出来（showReviewReport 有专门的说法），
   只是不再新写。 */

$('btn-save').onclick = () => { saveToRecords(); };   // 原先下载到系统，现在改存进棋谱库

/* ---------- 棋谱库弹窗 ---------- */
const REC_MASK = $('records');

const fmtRecTime = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 棋谱库的搜索词 —— 纯前端过滤（列表本来就在内存里，不必再读盘）。
   打开面板时**不清空**：连着看好几份棋谱时，搜索词留着更方便。 */
let recFilter = '';

async function refreshRecords() {
  const ul = $('reclist');
  const all = (await window.api.records.list()) || [];
  /* ★ 搜索/筛选（2026-10-04 用户要求）：备注名 + 文件名 一起模糊匹配 */
  const kw = recFilter.toLowerCase();
  const list = kw ? all.filter(it => ((it.note || '') + ' ' + it.name).toLowerCase().includes(kw)) : all;
  const cnt = $('rec-count');
  if (cnt) {
    cnt.textContent = all.length
      ? (kw ? '筛出 ' + list.length + ' / 共 ' + all.length + ' 份' : '共 ' + all.length + ' 份')
      : '';
  }
  ul.textContent = '';
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '棋谱库还是空的 —— 下完棋点底栏「导出棋谱」就会存进来';
    ul.appendChild(li);
    return;
  }
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '没有匹配「' + recFilter + '」的棋谱';
    ul.appendChild(li);
    return;
  }
  for (const it of list) {
    const li = document.createElement('li');
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    /* 两行显示（用户要求「显示备注名和文件名」）：
       上行 = 备注名（存在 SGF 的 GN 字段里）；下行 = **真实文件名**（灰色小字）。
       没写过备注时就只显示文件名一行，免得两行是同一串东西。 */
    const info = document.createElement('div');
    info.className = 'rec-info';
    const hasNote = !!(it.note && it.note.trim());
    const nm = document.createElement('span');
    nm.className = 'rec-name';
    nm.textContent = hasNote ? it.note : it.name.replace(/\.sgf$/i, '');
    nm.title = hasNote ? (it.note + '\n文件：' + it.name) : it.name;
    info.appendChild(nm);
    if (hasNote) {
      const fn = document.createElement('span');
      fn.className = 'rec-file';
      fn.textContent = it.name;
      info.appendChild(fn);
    }
    /* ★ 2026-10-18 用户要求：这一行**只留文件名**（原来看大小 / 时间 / 已复盘）。
       理由：文件名现在带上了双方名字+棋力+时间（recordFileName），信息已经够；
       那一串元信息占掉半行，把文件名挤成省略号，反倒看不见了。
       「带讲解」保留 —— 它不看文件名看不出来，而且是"这份棋谱还多一份讲解"的入口提示。 */
    if (it.hasCoach) {
      const meta = document.createElement('span');
      meta.className = 'rec-meta';
      meta.textContent = '带讲解';
      li.append(info, meta);
    } else {
      li.append(info);
    }
    li.append(
      mk('打开', '载入这份棋谱', () => openRecord(it.name)),
      /* 「当题练」（2026-10-14）：把这份棋谱当成习题练。
         ★ 先**读一遍判它像不像题**（有没有 AB/AW 摆子），判过了才复制进题集 ——
           普通对局棋谱复制过去只会得到一张空盘，白占一份题集、还让人以为坏了。
           这一步的判断用的是 records:read（棋谱库那份），不写盘。 */
      mk('当题练', '把这份棋谱当习题练（会复制一份到题集里，原棋谱不动）', async () => {
        const rd = await window.api.records.read(it.name);
        if (!rd || rd.error || !rd.text) { flash('读不出来：' + ((rd && rd.error) || '未知')); return; }
        const { list } = parseProblemSet(rd.text);
        const stones = list.reduce((a, p) => a + p.setup.length, 0);
        if (!list.length || !stones) {
          flash('这份棋谱没有摆子（不像习题集）—— 习题的初始局面是用摆子写的');
          return;
        }
        const r = await window.api.puzzles.importRecord(it.name);
        if (!r || r.error) { flash('当题练失败：' + ((r && r.error) || '未知')); return; }
        REC_MASK.classList.remove('open');
        /* ★ r.reused = 题集里已经有一份**内容相同**的（见 main.js 的注释，2026-10-16）→
           直接打开它，不再生成 xxx (2).sgf。提示要写明是"复用"，
           否则用户以为还是老行为、又去题集面板里找重复项。 */
        await openPuzzleSet(r.name, r.reused ? '这份棋谱早就在题集里了（没重复复制）' : '');
      }),
      /* 复盘：**只留一个按钮**（2026-10-18 用户要求 —— 原来「AI 复盘」「复盘报告」并排，
         没复盘过时后者是灰的，纯占地方）。
         · 没复盘过 → 「AI 复盘」：开选档面板，点下去才真的算（2026-10-04 用户要求）；
         · 复盘过   → 「复盘报告」：直接打开 records/<棋谱名>.review.json 里那一份（最新）。
         两者是同一件事的两端，用一个按钮表达"现在该做哪一步"最清楚。 */
      (() => {
        const b = it.hasReview
          ? mk('复盘报告', '打开已存的复盘报告（显示当前这条分支的那一份 · 会载入这份棋谱）',
            () => openSavedReview(it.name, it.note))
          : mk('AI 复盘', '整盘逐手重算，出一份报告（点开会先让你选搜索量）',
            () => openReviewSetup(it));
        /* ★ 2026-10-19 用户要求：两个标签长度不一样（「AI 复盘」中间有空格），
           按钮就一宽一窄地跳；「复盘报告」又太扎眼。所以：
           ① 固定最小宽度 → 两种状态一样宽；② 「复盘报告」用**白底**（不加 primary），
           「AI 复盘」仍是主题绿（那是"该做这一步"的引导）。 */
        b.classList.add('rec-review');
        if (!it.hasReview) b.classList.add('primary');
        return b;
      })(),
      /* 备注：写在 SGF 的 GN 字段里，**不改文件名**。
         （Electron 里 window.prompt() 用不了 → 就地展开一个输入框） */
      mk('备注', '写一个备注名（存进棋谱的 GN 字段，文件名不动）', () => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = it.note || '';
        inp.placeholder = '给这份棋谱写个备注…';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const no = document.createElement('button');
        no.textContent = '取消';
        const commit = async () => {
          const r = await window.api.records.setNote(it.name, inp.value);
          if (r && r.error) flash('备注失败：' + r.error);
          else flash(r && r.note ? '备注：' + r.note : '已清空备注');
          refreshRecords();
        };
        ok.onclick = commit;
        no.onclick = () => refreshRecords();
        inp.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') refreshRecords();
        };
        li.textContent = '';
        li.append(inp, ok, no);
        inp.focus(); inp.select();
      }),
      /* 删除：不用 confirm（Electron 里不可靠）→ 就地变「确认删除？」按钮，3 秒后自动还原 */
      mk('删除', '移到系统回收站（可以恢复）', function () {
        if (this.dataset.armed !== '1') {
          this.dataset.armed = '1';
          this.textContent = '确认删除？';
          this.classList.add('danger');
          setTimeout(() => {
            if (this.dataset.armed === '1') {
              this.dataset.armed = '';
              this.textContent = '删除';
              this.classList.remove('danger');
            }
          }, 3000);
          return;
        }
        this.dataset.armed = '';
        window.api.records.remove(it.name).then(r => {
          flash(r && r.error ? '删除失败：' + r.error : '已移到回收站');
          refreshRecords();
        });
      }),
    );
    ul.appendChild(li);
  }
}

async function openRecord(name) {
  const r = await window.api.records.read(name);
  if (!r || r.error) { flash('读取失败：' + ((r && r.error) || '未知')); return; }
  REC_MASK.classList.remove('open');
  applyRecord(parseSGF(r.text), name);
}

$('btn-records').onclick = async () => {
  REC_MASK.classList.add('open');
  const d = await window.api.records.dir();
  $('rec-dir').textContent = d || '';
  refreshRecords();
};
$('rec-close').onclick = () => REC_MASK.classList.remove('open');
$('rec-open-dir').onclick = () => window.api.records.openDir();
/* 「更改文件夹…」：和「设置」里那一项是**同一个配置项**，只是入口不同（用户要求两个地方都能改）。
   改完会把已有棋谱**复制**一份过去（老的留着不删），并如实报复制了几份、跳过几份。 */
$('rec-change-dir').onclick = async () => {
  const r = await window.api.settings.choose('recordsDir');
  if (!r || r.canceled) return;
  if (!r.ok) { flash('这个文件夹用不了 —— 可能没写权限，换一个试试'); return; }
  const res = await window.api.records.setDir(r.path);
  if (!res || res.error) { flash(res && res.error || '换不了'); return; }
  $('rec-dir').textContent = res.dir || '';
  await refreshRecords();
  const m = res.moved || { copied: 0, skipped: 0, failed: 0 };
  let tip = '棋谱库已改到：' + (res.dir || '');
  if (m.copied) tip += '；已把 ' + m.copied + ' 份棋谱复制过去';
  if (m.skipped) tip += '；' + m.skipped + ' 份同名文件已存在，没覆盖';
  if (m.failed) tip += '；有 ' + m.failed + ' 份没搬成';
  if (m.copied) tip += '。**老位置的没删**，确认新地方对了你自己删掉就行。';
  flash(tip);
};
$('rec-save-now').onclick = async () => {
  if (!state.moves.length) { flash('还没落子，没什么可存的'); return; }
  await saveToRecords();
  refreshRecords();
};

/* 搜索框：边打边筛（列表不大，直接重渲染最简单可靠） */
$('rec-search').oninput = () => {
  recFilter = $('rec-search').value.trim();
  refreshRecords();
};

/* 导入棋谱（2026-10-04 用户要求）：弹系统文件框（可多选），主进程负责复制进棋谱库。
   校验、重名、非法文件都在主进程做 —— 前端只管把结果显示出来。 */
$('rec-import').onclick = async () => {
  const btn = $('rec-import');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '导入中…';
  let r;
  try { r = await window.api.records.importSgf(); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false; btn.textContent = old;

  if (!r || r.canceled) return;                     // 用户把选择框关掉了：什么都不做
  if (r.error) { flash('导入失败：' + r.error); return; }
  const okN = (r.imported || []).length;
  const bad = r.failed || [];
  if (okN && !bad.length) flash('已导入 ' + okN + ' 份棋谱');
  else if (okN) flash('导入 ' + okN + ' 份，跳过 ' + bad.length + ' 份：' + bad.join('；'));
  else flash('没能导入：' + (bad.join('；') || '没选到可用的 SGF 文件'));
  refreshRecords();
};
REC_MASK.addEventListener('click', e => { if (e.target === REC_MASK) REC_MASK.classList.remove('open'); });

/* HTML 转义：棋谱备注名是用户输入，塞进 innerHTML 前必须转义 */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------------- AI 复盘（整盘逐手重算） ----------------
   流程：顶栏「AI 复盘」→ 选棋谱 → 引擎**一次请求**算完每一手 → 出报告，
   并把每手的「目损」标到右下角手数列表和胜率走势图上。

   ★ 为什么不逐手发请求：KataGo 的 analysis 支持 analyzeTurns 数组，
     一次请求就能把整盘每一手都算完，逐手发会慢一个数量级（每手一次往返 + 每手重新建树）。
   ⚠️ 但「一整盘一次请求」本身也不是没问题：中途拿不到任何已完成结果，出一丁点差错就全丢。
   2026-10-21 起改成**分块**（每 10 手一块 + 落盘 + 断点续算），见 runReview。 */

/* 复盘每手的搜索量。
   历程：写死 200（快但糙）→ 跟随底栏「计算深度」→ ★ 2026-10-04 用户拍板
   「点 AI 复盘后手动设置，默认 500」：每次点「AI 复盘」先弹面板让他当场选档
   （见 openReviewSetup），选完写进 settings.reviewVisits。
   好处：不会因为底栏调到 3000 就把一次复盘意外拖成十几分钟，也不会因为底栏是 100
   就把目损算得太糙 —— 复盘该算多深，由点的那一刻决定。 */
function reviewVisits() { return settings.reviewVisits || 500; }

/* 复盘耗时估算 —— ★ 2026-10-21 重做：改成「按这台机器的实测速度算」。
   原来写死 0.4 秒/手（那是在小权重 b18c384 上量的）。换到 b40c768 这类重权重后，
   实测只有 ~31 次评估/秒 → 500 步要 16~20 秒一手，一盘 294 手要 **80 分钟**，
   而面板上还写着「约 2 分钟」，进度窗里还写着「0.3~0.6 秒/手」——
   用户当然会以为程序卡死了（这就是那次报障）。
   现在：每跑一次复盘就把真实速度（visits/秒）记下来，键里带权重文件名；
   换权重后旧数字自动失效（不同权重的速度差 4 倍以上，见 2026-10-21 实测：
   b18c384 = 139 v/s、b40c768 = 31.9 v/s）。没有记录就如实说"还没测过"。 */
const REVIEW_RATE_KEY = 'rapacego.reviewRate';
let analyzeModelName = '';        // 分析权重的文件名（由引擎状态带出来，见 applyEngineStatus）

function reviewRate() {
  try {
    const o = JSON.parse(localStorage.getItem(REVIEW_RATE_KEY) || 'null');
    if (!o || !(o.vps > 0)) return null;
    /* 换了权重 → 旧速度不算数（同一台机上 b18 和 b40 差 4 倍） */
    if (analyzeModelName && o.model && o.model !== analyzeModelName) return null;
    return o;
  } catch (e) { return null; }
}
function saveReviewRate(vps) {
  if (!(vps > 0)) return;
  try {
    localStorage.setItem(REVIEW_RATE_KEY,
      JSON.stringify({ model: analyzeModelName, vps: Math.round(vps * 10) / 10 }));
  } catch (e) { /* 存不下不影响功能，只是下次还得重新量 */ }
}

/* 秒 → 「1 小时 12 分钟」这种给人看的说法 */
function fmtDur(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 90) return sec + ' 秒';
  if (sec < 3600) return Math.round(sec / 60) + ' 分钟';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h + ' 小时' + (m ? ' ' + m + ' 分钟' : '');
}

/* 整盘复盘大约要多久；速度还没测过 → null（调用方必须如实说"不知道"，别瞎给数） */
function reviewEta(nMoves, visits) {
  const r = reviewRate();
  if (!r) return null;
  return fmtDur(nMoves * visits / r.vps);
}

/* 失误分级 —— 档位照抄 KaTrain 的 12 / 6 / 3 / 1.5 / 0.5 目 */
const LOSS_LEVELS = [
  { th: 12,  cls: 'lv5', label: '严重失误' },
  { th: 6,   cls: 'lv4', label: '大失误' },
  { th: 3,   cls: 'lv3', label: '失误' },
  { th: 1.5, cls: 'lv2', label: '小失误' },
  { th: 0.5, cls: 'lv1', label: '轻微' },
];
const lossLevel = v => LOSS_LEVELS.find(l => v >= l.th) || null;

/* 段位估算 —— ⚠️ **启发式**：按「整盘平均目损」粗略换算。
   没有官方标准，也没有「标准人类棋手」可对照（KataGo 官方对档位的措辞是「模仿」而非「等同」）。
   真正的校准方式是：挑一档跟 AI 下几盘看胜负。UI 上必须把这句话写给用户。 */
const RANK_BY_LOSS = [
  [1.0, '约 3 段以上'], [1.6, '约 1~2 段'], [2.4, '约 1~3 级'],
  [3.5, '约 4~8 级'], [5.0, '约 9~13 级'], [7.0, '约 14~18 级'],
  [Infinity, '约 18 级以下'],
];
const estRank = avg => (avg === null ? '—' : (RANK_BY_LOSS.find(r => avg < r[0]) || RANK_BY_LOSS[RANK_BY_LOSS.length - 1])[1]);

let reviewBusy = false;
/* 复盘的「进门取号」：每次点「开始复盘」同步 +1。
   用来挡住「判定与上锁之间那几毫秒内连点两次」的双开 —— 见 runReview 里的说明。 */
let reviewSeq = 0;

/* KataGo 的 scoreLead 是「**当前走棋方**视角」（跟 ownership / winrate 同一套视角规则），
   所以要比较两回合必须统一换算。这里统一成「黑方领先多少目」。 */
function blackLeadOf(root) {
  if (!root || typeof root.scoreLead !== 'number') return null;
  return String(root.currentPlayer || '').toUpperCase() === 'W' ? -root.scoreLead : root.scoreLead;
}

/* 逐手目损：拿相邻两个回合的「黑方领先」相减。
   turns[t] = 第 t 手**落下之前**的局面（t = 0..N —— 多算的那个 N 是「最后一手之后」，
   专门用来补出最后一手的损失，否则最后一手永远算不出来）。
   黑下的手 → 黑领先的减少量；白下的手 → 白领先的减少量（等价于黑领先的增加量）。

   ★ 为什么不用「AI 首选的分 − 实际手的分」：引擎会把明显差的手**剪枝掉**
     （实测 40% 的回合找不到实际手，而那恰恰是最该被点评的失误）。
     根节点评估则是**每一手都有**，覆盖率 100%，且实测与前者结果吻合
     （同一盘最大失误：这条路算 4.59 目 / 前者算 5.05 目）。 */
function computeLosses(turns) {
  const out = [];
  for (let t = 0; t + 1 < turns.length; t++) {
    const a = blackLeadOf(turns[t] && turns[t].root);
    const b = blackLeadOf(turns[t + 1] && turns[t + 1].root);
    if (a === null || b === null) { out.push(null); continue; }
    const isBlack = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase() !== 'W';
    out.push(Math.max(0, isBlack ? (a - b) : (b - a)));
  }
  return out;
}

/* 分段：按手数比例切（布局 / 中盘 / 终盘）。用比例而不是固定手数 —— 9 路棋谱只有几十手，
   固定写「1-50 手是布局」就全归到布局里了。 */
function segOf(i, n) {
  if (n <= 0) return 0;
  const r = i / n;
  return r < 0.3 ? 0 : (r < 0.75 ? 1 : 2);
}
const SEG_NAMES = ['布局', '中盘', '终盘'];

/* 复盘结果结构（**v2**，2026-10-04）：
   ★ 为什么改：v1 把**黑白双方**的目损混在一起算平均、混在一起数失误。
     实测一份 115 手的棋谱：混算得到「平均目损 0.35 目 · 3 手失误（最大 8.6 目）」，
     拆开却是 —— 黑方 0.23 目、**0 手失误**；白方 0.47 目、3 手失误（最大 8.6 目）。
     也就是说那些失误**全是白方下出来的**，却被算成了"这盘棋的水平"，
     还被拿去换算「估算水平」。复盘是为了看**自己**下得怎么样 ——
     混算等于替对手背一半锅、或把自己的问题稀释一半。
   v2 结构：{ v:2, losses:[每手目损], sides:{b:{…},w:{…}}, blunders:{b:[],w:[]} }
     sides[x] = { nMov, avg, est, n3, n6, n12, aiFirst, aiKnown, worst, segs }
     segs = [布局/中盘/终盘] 各 { name, n, avg, worst }
   （v1 报告**没有 sides 字段** → 打开时提示重新复盘，见 showReviewReport。） */
function buildReview(nMoves, turns) {
  const losses = computeLosses(turns);

  /* 这一手是谁下的：以「落下之前轮谁走」为准（turns[t].root.currentPlayer，权威），
     拿不到才退回棋谱里的手顺颜色。 */
  const sideOf = t => {
    const cp = String(((turns[t] || {}).root || {}).currentPlayer || '').toUpperCase();
    if (cp === 'B') return 'b';
    if (cp === 'W') return 'w';
    const m = state.moves[t];
    return (m && m.color === 'w') ? 'w' : 'b';
  };

  /* 与 AI 首选重合：turns[t].moves[0] 是引擎给该回合的第一推荐，
     turns[t].actualMove 是实际下的那手（主进程从请求的 moves 里取）。黑白分开记。 */
  const hit = { b: 0, w: 0 }, known = { b: 0, w: 0 };
  /* ★ 认「AI 首选」要用 `order === 0`，**别假定 moveInfos[0] 就是首选**
     （2026-10-06 审查发现）：引擎的 moveInfos 是按**访问次数**排的，不保证第一项是 order 0；
     而主进程只透传前 8 条。本文件别处（pickAIMove）早就是
     `find(m => m.order === 0) || infos[0]` 的写法，这里当时没跟上 ——
     判错会让报告里「与 AI 首选一致 N/M」和失误清单的「AI 想下 X」指错点。 */
  const firstMove = info => {
    const ms = (info && info.moves) || [];
    const f = ms.find(m => m.order === 0);
    return f ? f.move : (ms[0] ? ms[0].move : null);
  };
  for (let t = 0; t < nMoves; t++) {
    const info = turns[t];
    if (!info || !info.actualMove || !info.moves || !info.moves.length) continue;
    const sd = sideOf(t);
    known[sd]++;
    if (firstMove(info) === info.actualMove) hit[sd]++;
  }

  /* 每方一组指标（平均目损 / 失误档位 / 分段 / 与 AI 重合） */
  const sides = {};
  for (const sd of ['b', 'w']) {
    const vals = [];
    for (let t = 0; t < nMoves; t++) {
      if (sideOf(t) === sd && typeof losses[t] === 'number') vals.push(losses[t]);
    }
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const cnt = th => vals.filter(v => v >= th).length;

    /* 分段：按手数比例切（布局 / 中盘 / 终盘）—— 9 路棋谱只有几十手，
       固定写「1-50 手是布局」会全归到布局里，所以用比例。 */
    const segs = [0, 1, 2].map(k => {
      const sub = [];
      for (let t = 0; t < nMoves; t++) {
        if (sideOf(t) !== sd || segOf(t, nMoves) !== k) continue;
        if (typeof losses[t] === 'number') sub.push(losses[t]);
      }
      return {
        name: SEG_NAMES[k], n: sub.length,
        avg: sub.length ? sub.reduce((s, v) => s + v, 0) / sub.length : null,
        worst: sub.length ? Math.max(...sub) : null,
      };
    });

    sides[sd] = {
      nMov: vals.length, avg, est: estRank(avg),
      n3: cnt(3), n6: cnt(6), n12: cnt(12),
      aiFirst: hit[sd], aiKnown: known[sd],
      worst: vals.length ? Math.max(...vals) : null,
      segs,
    };
  }

  /* 失误清单：黑白分开，各自按目损从大到小，最多 8 条（只留 ≥3 目的「失误」档） */
  const blunders = { b: [], w: [] };
  for (let t = 0; t < nMoves; t++) {
    const v = losses[t];
    if (typeof v !== 'number' || v < 3) continue;
    const best = firstMove(turns[t]);   // 同上：用 order===0 认首选，别假定 moves[0]
    blunders[sideOf(t)].push({ t, loss: v, best });
  }
  blunders.b.sort((x, y) => y.loss - x.loss);
  blunders.w.sort((x, y) => y.loss - x.loss);

  return {
    v: 2,
    losses, sides,
    blunders: { b: blunders.b.slice(0, 8), w: blunders.w.slice(0, 8) },
    nBlunder: blunders.b.length + blunders.w.length,
  };
}

/* ---------------- 复盘界面 ---------------- */

const RV_MASK = $('review');

/* 最近一次的进度（重开进度窗要用 —— 见 showReviewAgain） */
let lastReviewProgress = { done: 0, total: 0, info: null };
/* 本次复盘的实测状态：
     t0       起算时刻（算「每秒多少次评估」用）
     visits   每手的搜索量
     visitsDone 已经算完的搜索次数（估速度）
     total    整盘要算多少个回合（n+1）
     doneSet  已经算完的回合号 —— ★ 全局进度**只认它**：
               引擎的进度消息是按「这一次请求」算的（分块后一块只有 10 手），
               直接拿它的 done/total 会让进度条每块从头再来一遍（测试踩到过）。 */
let rvRun = null;
/* 用户点了「停止」→ 分块循环下一次检查时收手（见 runReview / stopReview） */
let reviewAbort = false;

/* 复盘还在跑时又被点（AI 复盘 / 复盘报告 / 重新复盘 / 点遮罩）——
   把进度窗**重新打开**，而不是只弹一句提示：看不到进度会让人以为卡死了。 */
function showReviewAgain() {
  /* ★ 全盘讲解跑的也是这条「整盘逐手」通路 —— 别把复盘那个进度窗弹出来（审查发现）。 */
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 它跑了整盘分析，等它完再复盘'); return; }
  RV_MASK.classList.add('open');
  showReviewProgress(lastReviewProgress.info);
  flash('AI 正在复盘，算完会自动出报告');
}

/* 建一次 DOM，之后每秒只改数字/宽度。
   ★ 不能每次进度都重写 innerHTML：那样「停止」按钮每秒重建一次，点击正好落在
     重建那一瞬间就会丢（复核时踩到的老毛病，别再写回去）。 */
function ensureReviewProgressDom() {
  if ($('rv-fill')) return;
  $('review-body').innerHTML =
    '<div class="rv-wait">AI 正在逐手重算…</div>'
    + '<div class="rv-bar"><i id="rv-fill" style="width:0%"></i></div>'
    + '<div class="rv-wait-sub" id="rv-hand">准备中…</div>'
    + '<div class="rv-wait-sub" id="rv-eta"></div>'
    + '<div class="rv-wait-tip" id="rv-tip"></div>'
    + '<div class="mfoot"><div class="spacer"></div>'
    + '<button id="rv-stop">停止</button></div>';
  const b = $('rv-stop');
  if (b) b.onclick = () => stopReview();
}

/* 进度窗。info = 引擎最新一条 { live, at, visits, maxVisits }
             live=true：第 at 手正在搜，已搜到 visits/maxVisits。
   ★★ 为什么要有 info（2026-10-21）：原来进度只按「整手算完」推进，
   而重权重上一手要 15~20 秒 —— 进度条半分钟才动一格，看起来就是卡死。
   现在拿引擎每秒推的中途报告画本手的细进度，条子一直在动。 */
function showReviewProgress(info) {
  const total = (rvRun && rvRun.total) || lastReviewProgress.total || 0;
  /* ★ 多分支连算时，「已算完」= 前面几条线的合计（doneBase）+ 当前这条线的回合数。
     doneSet 只记**当前这条线**的（它同时被断点续算和进度条用来算 ETA）。 */
  const done = rvRun ? ((rvRun.doneBase || 0) + rvRun.doneSet.size) : (lastReviewProgress.done || 0);
  const maxV = (info && info.maxVisits) || (rvRun && rvRun.visits) || reviewVisits();
  const curV = (info && info.visits) || 0;
  const sub = (info && info.live && maxV) ? Math.min(1, curV / maxV) : 0;
  lastReviewProgress = { done, total, info: info || null };
  RV_MASK.classList.add('open');
  ensureReviewProgressDom();

  /* 1) 进度条：整手部分 + 本手的比例 */
  const frac = total ? Math.min(1, (done + sub) / total) : 0;
  const fill = $('rv-fill');
  if (fill) fill.style.width = (frac * 100).toFixed(1) + '%';

  /* 2) 第几手 / 本手搜到多少（多分支时再报一句「第几条线」——
        不然用户看到总数 260 手、而这条线只有 118 手，会以为算错了对象） */
  const hand = $('rv-hand');
  if (hand) {
    let s = '第 ' + Math.min(done + 1, total) + ' / ' + total + ' 手';
    if (rvRun && rvRun.lineCount > 1) {
      s += ' · 第 ' + (rvRun.lineIdx + 1) + ' / ' + rvRun.lineCount + ' 条分支';
    }
    if (info && info.live && maxV) s += ' · 本手已搜 ' + curV + ' / ' + maxV;
    else if (done > 0) s += ' · 已完成 ' + done + ' 手';
    hand.textContent = s;
  }

  /* 3) 已用 / 剩余：速度优先用**本次实测**，没有才用上次记的。
     ★ 算速度的分子必须用「全局已算完的手数 × 每手搜索量」——
     第一次写成「分块累加的 visitsDone」时，头 10 手一直不更新，
     于是面板上显示「57 秒/手」这种离谱数字（测试里当场抓出来）。 */
  let vps = 0;
  if (rvRun && rvRun.t0) {
    const sec = (Date.now() - rvRun.t0) / 1000;
    const dv = done * maxV + (info && info.live ? curV : 0);
    if (sec > 3 && dv > 0) vps = dv / sec;
  }
  const rec = reviewRate();
  if (!vps && rec) vps = rec.vps;
  const eta = $('rv-eta');
  if (eta) {
    if (vps > 0) {
      const used = rvRun && rvRun.t0 ? (Date.now() - rvRun.t0) / 1000 : 0;
      const left = Math.max(0, total - done) * maxV / vps;
      eta.textContent = (used > 3 ? '已用 ' + fmtDur(used) + ' · ' : '')
        + '剩余约 ' + fmtDur(left) + '（实测 ' + (maxV / vps).toFixed(1) + ' 秒/手）';
    } else {
      eta.textContent = '正在量这台机器的速度，稍后给出剩余时间…';
    }
  }

  /* 4) 脚注：说清「能停、停了不白算」—— 这是这次报障里用户最需要的两句话 */
  const tip = $('rv-tip');
  if (tip) {
    tip.textContent = '每手 ' + maxV + ' 次搜索，逐手算完才有报告。'
      + '可以点「停止」：已经算完的手会保留，下次接着算，不用从头来。';
  }
}

/* 复盘「暂停」面板（停止 / 引擎卡住之后）。
   ★ 为什么不直接弹报告：见 runReview 收尾那段。用户的观感差别很大 ——
   「这份报告没算完整盘，只算了前 4 / 294 手」像是程序坏了；
   「已算完 4 手，存好了，还剩 290 手」才是他能理解、能继续的状态。 */
function showReviewPaused(done, total, why, scope) {
  RV_MASK.classList.add('open');
  const maxV = (rvRun && rvRun.visits) || reviewVisits();
  const left = Math.max(0, total - done);
  const rec = reviewRate();
  const etaTxt = (rec && rec.vps > 0 && left > 0)
    ? '按这台机器的实测速度，剩下 ' + left + ' 手大约还要 ' + fmtDur(left * maxV / rec.vps)
    : '';
  const pct = total ? (done / total * 100) : 0;
  const nLine = (rvRun && rvRun.lineCount) || 1;
  $('review-body').innerHTML =
    '<h2>复盘暂停了</h2>'
    + '<div class="rv-sub">' + esc(why) + ' · 已算完 <b>' + done + ' / ' + total + '</b> 手'
    + (nLine > 1 && rvRun ? '（' + nLine + ' 条分支合计，当前在第 ' + (rvRun.lineIdx + 1) + ' 条）' : '')
    + '</div>'
    + '<div class="rv-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="rv-wait-sub">已经算完的手都<b>存在盘上了</b>，接着算只补剩下的，不会从头来。</div>'
    + (etaTxt ? '<div class="rv-wait-sub">' + esc(etaTxt) + '</div>' : '')
    + '<div class="mfoot"><button id="rv-continue" class="primary">接着算（还剩 ' + left + ' 手）</button>'
    + '<button id="rv-peek">先看已算的这部分</button>'
    + '<div class="spacer"></div><button id="rv-close">关闭</button></div>';
  const go = $('rv-continue');
  if (go) go.onclick = () => {
    /* ★ 接着算必须沿用**同一次的范围**（选了「全部分支」就别只补当前这条线），
       文件名也从 rvRun 拿 —— state.review 可能在多线场景里是空的（当前线不在目标里）。 */
    const nm = (rvRun && rvRun.name) || (state.review && state.review.file) || state.recName || '';
    if (!nm) { RV_MASK.classList.remove('open'); return; }
    runReview(nm, { scope: scope || 'line' });     // 会读中间文件，只补没算的手
  };
  const pk = $('rv-peek');
  if (pk) pk.onclick = () => showReviewReport();
  const cl = $('rv-close');
  if (cl) cl.onclick = () => RV_MASK.classList.remove('open');
}

/* 「停止」：把已算完的手留下来（main.js 的 cancel 会把 turns 交回来），
   并且真的让引擎停下 —— 不是只把前端弹窗关掉。 */
async function stopReview() {
  if (!reviewBusy) return;
  reviewAbort = true;
  const b = $('rv-stop');
  if (b) { b.disabled = true; b.textContent = '正在停止…'; }
  try { await window.api.cancel(); } catch (e) { /* 引擎没响应也照样往下走 */ }
}

function showReviewReport() {
  const R = state.review;
  if (!R) return;
  RV_MASK.classList.add('open');
  const f = v => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(1);
  const n = state.moves.length;
  /* 这份报告是**按多少步搜索**算出来的 —— 从报告自己身上读（而不是读当前设置的档位），
     这样看旧的报告时显示的也永远是它当时的真实档位。
     ★ 「下棋时攒的实时分析」（source='live'）没有统一档位：visits 记 0，文字另说。 */
  const live = R.source === 'live';
  const rv = live ? 0 : (R.visits || reviewVisits());
  const segRange = k => {          // 该段覆盖的手数区间（给用户看的）
    const a = Math.floor(n * [0, 0.3, 0.75][k]) + 1;
    const b = Math.floor(n * [0.3, 0.75, 1][k]);
    return a + '–' + b + ' 手';
  };
  /* 这份报告是「当前这条分支」的 —— 有分支的棋谱里必须写出来，
     否则用户会以为这是整盘（主分支）的成绩。 */
  const nLines = (state.reviewDoc && state.reviewDoc.lines)
    ? Object.keys(state.reviewDoc.lines).length : 1;

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(R.name || '') + '</span></h2>';
  h += '<div class="rv-sub">共 ' + n + ' 手 · '
    + (live ? '下棋时的实时分析（每手搜索量不统一）' : '每手 ' + rv + ' 次搜索')
    + ' · <b>黑白分开统计</b>'
    + (nLines > 1 ? ' · 这是<b>当前这条分支</b>的报告（共 ' + nLines + ' 条分支算过）' : '')
    + '</div>';
  /* ★ 下棋时攒的分析：诚实标注口径 —— 它和「整盘统一搜索量重算」不是一回事。
     ★★ 2026-10-22 第二版（用户追问「区别到底在哪」）：原来只写「目损会毛糙一些」，
        没说为什么。实测同一盘棋（12 手）下棋攒的快照搜索量是 3 / 67 / 177 / 179 / 188 /
        333 / 456 / 507 次，正式复盘每回合都是 506~507 —— 差别是**有的手没算完**，不是算式不同
        （两边都走 buildReview）。所以这里改成说清机制 + 报出这份报告**实际**的搜索量范围。 */
  if (live) {
    const lo = R.visitsLo, hi = R.visitsHi;
    h += '<div class="rv-warn">这份报告是<b>你下棋时边下边算</b>攒下来的（导出棋谱时一并存下）。'
      + '同一盘棋里各手的搜索量并不一样'
      + (typeof lo === 'number' && typeof hi === 'number' && hi > 0
        ? '（这份报告实际是 <b>' + lo + '~' + hi + ' 次</b>）' : '')
      + '：轮到你走、你多看了几秒的那几手能算满，'
      + 'AI 刚应手你就落子的那几手往往只算了几十次就<b>被下一手打断</b>了。'
      + '目损 = 前后两个局面的目差，只要有一端没算完，那个数字就会飘'

      + (typeof R.analyzed === 'number' && R.analyzed < n + 1
        ? '，其中 <b>' + (n + 1 - R.analyzed) + ' 手</b>对局时没来得及分析（那些手是空的）' : '')
      + '。想要口径统一的一份，点下面「重新复盘」即可（会用同一档搜索量重算）。</div>';
  }
  /* ★ 没算完整盘（停止 / 卡住）→ 报告里的平均目损只代表算过的那部分，
     不说清楚的话，用户会拿一份「只算了前 30 手」的报告判断整盘水平。
     ★ 按钮直接给在这儿：只写一句「再点 AI 复盘会接着算」，用户还得先关掉弹窗、
       回棋谱库找那颗按钮 —— 大多数人到这一步就以为「只能从来一遍」了。 */
  if (R.partial && R.partial.done < R.partial.total) {
    h += '<div class="rv-warn">只算了前 <b>' + R.partial.done + ' / ' + R.partial.total
      + '</b> 手（中间停过或引擎卡住了），下面的数字只覆盖这部分。已算完的手都存在盘上，'
      + '接着算不会重来。'
      + '<div style="margin-top:8px"><button id="rv-continue2" class="primary">接着算（还剩 '
      + (R.partial.total - R.partial.done) + ' 手）</button></div></div>';
  }

  /* ★ 旧版报告（v1 把黑白混算，口径已经变了）—— 不显示那份数据，直接请用户重算。
     拿错口径的数字下判断比没有数字更糟。 */
  if (!R.sides || !R.sides.b || !R.sides.w) {
    /* ★ 耗时按**这台机器的实测速度**给（reviewEta 没测过就返回 null → 如实说不知道）。
       原来这里写死「一盘约 1 分钟」，那是小权重上的数，重权重上差 40 倍。 */
    const etaOld = reviewEta(n, rv);
    h += '<div class="rv-warn">这份报告是<b>旧版算法</b>生成的（黑白双方混在一起算），'
      + '数据口径已经变了，所以这里<b>不再显示</b>。点下面的「重新复盘」按新算法重算一份就行'
      + '（每手 ' + rv + ' 步' + (etaOld ? '，按这台机器的速度约 ' + etaOld : '') + '）。</div>';
    h += '<div class="mfoot"><button id="review-again" class="primary">重新复盘</button>'
      + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
    $('review-body').innerHTML = h;
    bindReviewReport(R, false);
    return;
  }

  const kv = (lb, val) => '<div class="rv-kv"><span>' + lb + '</span><b>' + val + '</b></div>';
  const sideName = sd => (sd === 'b' ? '黑方' : '白方');

  /* ---------- 两张画像并排（黑方 / 白方） ---------- */
  h += '<div class="rv-sides">';
  for (const sd of ['b', 'w']) {
    const s = R.sides[sd] || {};
    h += '<div class="rv-side">'
      + '<div class="rv-side-h"><i class="dot ' + sd + '"></i>' + sideName(sd)
      + '<span class="rv-dim">' + (s.nMov || 0) + ' 手</span></div>'
      + kv('平均目损', f(s.avg) + '<span class="rv-un">目</span>')
      + kv('估算水平', '<span class="rv-est">' + esc(s.est || '—') + '</span>')
      + kv('最大单手', f(s.worst) + '<span class="rv-un">目</span>')
      + kv('与 AI 首选一致', s.aiFirst + '<span class="rv-un">/ ' + s.aiKnown + '</span>')
      + kv('失误（≥3 目）', s.n3 + '<span class="rv-un">手</span>')
      + '<div class="rv-kv-sub">其中 ≥6 目 ' + s.n6 + '，≥12 目 ' + s.n12 + '</div>'
      + '</div>';
  }
  h += '</div>';

  /* ---------- 分段表（黑/白各两列） ---------- */
  h += '<table class="rv-seg"><tr><th></th>'
    + '<th>黑方均损</th><th>黑方最大</th><th>白方均损</th><th>白方最大</th></tr>';
  for (let k = 0; k < 3; k++) {
    const b = R.sides.b.segs[k], w = R.sides.w.segs[k];
    h += '<tr><td>' + esc(b.name) + ' <span class="rv-dim">' + segRange(k) + '</span></td>'
      + '<td>' + f(b.avg) + '</td><td>' + f(b.worst) + '</td>'
      + '<td>' + f(w.avg) + '</td><td>' + f(w.worst) + '</td></tr>';
  }
  h += '</table>';

  /* ---------- 失误清单（黑白分开列） ---------- */
  h += '<div class="rv-h">最大失误 <span class="rv-dim">（点一下跳到那一手）</span></div>';
  for (const sd of ['b', 'w']) {
    const list = (R.blunders && R.blunders[sd]) || [];
    h += '<div class="rv-bl-h"><i class="dot ' + sd + '"></i>' + sideName(sd) + '</div>';
    if (!list.length) {
      h += '<div class="rv-bl-empty">没有 ≥3 目的失误 —— 这一方下得挺稳。</div>';
      continue;
    }
    h += '<ul class="rv-bl">';
    for (const b of list) {
      const m = state.moves[b.t];
      if (!m) continue;
      const pt = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);
      const lv = lossLevel(b.loss);
      h += '<li data-n="' + (b.t + 1) + '"><span class="rv-no">第 ' + (b.t + 1) + ' 手</span>'
        + '<span class="rv-pt">' + pt + '</span>'
        + '<span class="rv-loss rv-' + (lv ? lv.cls : '') + '">亏 ' + b.loss.toFixed(1) + ' 目</span>'
        + '<span class="rv-best">AI 想下 ' + (b.best || '—') + '</span></li>';
    }
    h += '</ul>';
  }

  h += '<div class="rv-note">「估算水平」是按<b>该方自己的平均目损</b>粗略换算的启发式，仅供参考 —— '
    + 'KataGo 的段位档是「模仿某段位棋手」，官方并没有给出与真实段位的换算表。'
    + '想知道准的，挑一档跟 AI 下几盘看胜负更实在。目损本身是数值估计，'
    + (live ? '搜索量低的时候' : rv + ' 次搜索时') + '有零点几目的噪声。</div>';

  /* 这次的结果已经写进 records/<棋谱名>.review.json —— 下次不用重算，点「复盘报告」直接看。
     ★ 有分支的棋谱：这个文件里按「线」存多份，同一条线重算才覆盖它自己那份。 */
  h += '<div class="rv-sub" style="margin:10px 0 0;color:var(--text-dim)">这份报告已经存下来了：'
    + '关掉后想再看，到棋谱库点这份棋谱的「复盘报告」就行'
    + (nLines > 1 ? '（别的分支各存各的，切到哪条线就看哪一份）。' : '（重新复盘会覆盖这一份）。')
    + '</div>';

  h += '<div class="mfoot"><button id="review-again" title="换个搜索量重新算一遍（会覆盖已存的报告）">重新复盘</button>'
    + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
  $('review-body').innerHTML = h;
  bindReviewReport(R, true);
}

/* 报告底部的按钮绑定（新版/旧版共用）。v2 = 新版才有「点失误跳过去」。 */
function bindReviewReport(R, v2) {
  $('review-close').onclick = () => RV_MASK.classList.remove('open');
  const again = $('review-again');
  if (again) again.onclick = () => {
    /* 重新复盘 = 回到选档面板（用户要求搜索量在点的时候定） */
    openReviewSetup({ name: R.file || (R.name + '.sgf'), note: R.name, hasReview: true });
  };
  /* 「接着算」（只在这份报告没算完整盘时存在）：直接续算，不用再绕一圈选档面板 ——
     搜索量和权重没变，中间文件的签名对得上，runReview 会把已算的手全部复用。 */
  const cont = $('rv-continue2');
  if (cont) cont.onclick = () => {
    const nm = R.file || ((R.name || '') + '.sgf');
    if (nm) runReview(nm);
  };
  if (!v2) return;
  $('review-body').querySelectorAll('.rv-bl li[data-n]').forEach(li => {
    li.onclick = () => { gotoView(+li.dataset.n); };   // 跳过去看那一手（弹窗留着，方便对照）
  });
}

/* ---------------- 「AI 复盘」的搜索量选择面板 ----------------
   ★ 2026-10-04 用户：「AI复盘搜索量我建议在点AI复盘后进行手动设置，默认500，可以调其他档」。
   复用复盘弹窗（#review）：先渲染选档面板，点「开始复盘」才真正开跑。 */
function openReviewSetup(it) {
  /* 已经在跑了就别再开选档面板（同一个弹窗，会盖掉进度）—— 直接把进度窗亮出来 */
  if (reviewBusy) { showReviewAgain(); return; }
  const name = (it && it.name) || '';
  const note = (it && it.note) || '';
  const hasReview = !!(it && it.hasReview);
  /* 读一下棋谱，只为在手数上给出「整盘大概多久」的估算 */
  window.api.records.read(name).then(async rd => {
    const p = (rd && !rd.error) ? parseSGF(rd.text) : null;
    const nMain = (p && p.ok && p.moves) ? p.moves.length : 0;
    /* ★★ 2026-10-22：同一份棋谱**已经开着**时，手数必须用「**当前这条线**」的。
       有分支的棋谱里 `state.moves` 可能不是主分支 —— 用户站在一条 118 手的变体上，
       面板却写「这盘 110 手」，点下去实际要算 118 手：估时错、连"这条线"是哪条都说不清。
       （`state.varRoot` 是当前打开的这棵树；没打开时才看解析出来的 `p.tree`。） */
    const openNow = state.recName === name;
    const nMoves = openNow ? state.moves.length : nMain;
    const branched = !!(openNow ? state.varRoot : (p && p.tree));
    /* ★ 顺手看一眼有没有**上次没算完的进度**（停止 / 卡住留下的中间文件）。
       不说这一句的话，用户以为「开始复盘」= 从头再等 50 分钟，干脆不点了 ——
       而实际上已算完的手全部会被复用。只有搜索量和上次一致时才提示（不一致会全量重算）。 */
    let part = null;
    let partLines = {};
    try {
      const r = await window.api.records.readReviewPart(name);
      if (r && r.text) {
        const o = JSON.parse(r.text);
        /* ★ v3 的中间文件是「一条线一项」—— 以前只数 o.turns，
           新版永远数出 0，于是「上次已算 N 手」这句提示整个消失（静默）。
           两种形状都认。 */
        if (o && o.lines) {
          for (const k of Object.keys(o.lines)) {
            const cnt = Object.keys((o.lines[k] || {}).turns || {}).length;
            if (cnt) partLines[k] = cnt;
          }
          const tot = Object.values(partLines).reduce((a, b) => a + b, 0);
          /* v3 没单独存 visits —— 它在环境签名里（'e1|500|6.5|chinese|19|…'的第二段） */
          const anyL = o.lines[Object.keys(o.lines)[0]] || {};
          const envV = parseInt(String(o.env || anyL.env || '').split('|')[1], 10);
          if (tot) part = { n: tot, visits: envV || 0 };
        } else {
          const cnt = (o && o.turns) ? Object.keys(o.turns).length : 0;
          if (cnt) part = { n: cnt, visits: o.visits || 0 };
        }
      }
    } catch (e) { /* 没有中间文件就算了 */ }

    /* ★ 有分支时：把每条线的回合数、哪几条已经有报告都算出来（2026-10-22 用户要求
       「复盘时能选只算当前分支 / 全部分支 / 剩下没算的」）。
       这几个数决定面板上显示什么，缺一个就没法如实告诉用户"这次要算多少手"。 */
    let lines = [], doneKeys = {}, curKey = '';
    if (branched) {
      const root = openNow ? state.varRoot : (p && p.tree);
      const seenK = new Set();
      for (const path of linesOfTree(root)) {
        const l = lineGtpOf(movesOfNodePath(path));
        const k = lineKeyOfList(l);
        if (seenK.has(k)) continue;
        seenK.add(k);
        lines.push({ n: l.length, key: k });
      }
      if (openNow) {
        const curL = lineGtpOf(state.moves);
        curKey = lineKeyOfList(curL);
        const hit = lines.find(x => x.key === curKey);
        if (hit) hit.cur = true;
        else lines.unshift({ n: curL.length, key: curKey, cur: true });
      }
      try {
        const rv = await window.api.records.readReview(name);
        if (rv && rv.text) {
          const o = JSON.parse(rv.text);
          if (o && o.lines) doneKeys = o.lines;
        }
      } catch (e) { /* 还没有报告文件 = 一条都没算过 */ }
    }
    renderReviewSetup(name, note, nMoves, hasReview, part,
      { branched, openNow, nMain, lines, doneKeys, curKey, partLines });
  }).catch(() => renderReviewSetup(name, note, 0, hasReview));
}

function renderReviewSetup(name, note, nMoves, hasReview, part, extra) {
  const ex = extra || {};
  const lines = Array.isArray(ex.lines) ? ex.lines : [];
  const docKeys = ex.doneKeys || {};
  const curKey = ex.curKey || '';
  /* 只有「真的有分支」才给范围选择：一条线的棋谱多一个选项只会让人犹豫 */
  const multi = !!ex.branched && lines.length > 1;
  const doneCnt = lines.filter(l => docKeys[l.key]).length;
  const missLines = lines.filter(l => !docKeys[l.key]);
  /* 从棋谱库直接点「AI 复盘」（这份棋谱还没打开）时没有「当前线」——
     点下去会先打开它、站在主分支上，所以这里就拿主分支的手数。 */
  const curLine = lines.find(l => l.key === curKey) || (ex.openNow ? null : (lines[0] || null));
  /* 默认 = 只算当前这条线（和以前一样）；当前线已经算过时，默认落到「还没算过的」——
     否则用户点「AI 复盘」十有八九是想补别的分支，却又被算了一遍当前线。 */
  let scope = 'line';
  if (multi && !missLines.length) scope = 'line';
  else if (multi && curLine && docKeys[curKey] && missLines.length) scope = 'missing';

  RV_MASK.classList.add('open');
  const cur = reviewVisits();
  const labelOf = v => (VISIT_OPTS.find(o => o[0] === v) || ['', ''])[1];

  let seg = '<div class="seg rv-picks" id="rv-picks">';
  for (const [v, lb] of VISIT_OPTS) {
    seg += '<button data-v="' + v + '"' + (v === cur ? ' class="on"' : '')
      + ' title="' + esc(lb) + ' · ' + v + ' 次搜索">' + v + '</button>';
  }
  seg += '</div>';

  let h = '';
  h += '<h2>AI 复盘 <span class="rv-name">' + esc(note || name.replace(/\.sgf$/i, '')) + '</span></h2>';
  h += '<div class="rv-sub">整盘逐手重算' + (nMoves ? '（共 ' + nMoves + ' 手）' : '')
    + ' —— 每手算多少步由你定：越大越准，也越慢。</div>';
  h += seg;
  /* ★★ 范围选择（2026-10-22 用户要求）：有分支时自己挑「这条 / 全部 / 剩下的」。
     这三颗按钮只在**真的有分支**时出现，单线棋谱的流程一个字都没变。 */
  if (multi) {
    const totalAll = lines.reduce((s, l) => s + l.n + 1, 0);
    const totalMiss = missLines.reduce((s, l) => s + l.n + 1, 0);
    h += '<div class="seg rv-scope" id="rv-scope" data-all="' + totalAll + '" data-miss="' + totalMiss + '">'
      + '<button data-s="line"' + (scope === 'line' ? ' class="on"' : '') + '>'
      + '当前这条线' + (curLine ? '（' + curLine.n + ' 手）' : '') + '</button>'
      + '<button data-s="missing"' + (scope === 'missing' ? ' class="on"' : '')
      + (missLines.length ? '' : ' disabled') + '>'
      + '还没算过的 ' + missLines.length + ' 条</button>'
      + '<button data-s="all"' + (scope === 'all' ? ' class="on"' : '') + '>'
      + '全部分支（' + lines.length + ' 条）</button>'
      + '</div>';
  }
  h += '<p class="rv-pick-note" id="rv-pick-note"></p>';
  /* ★★ 有分支的棋谱：把「这次算的是哪条线」说到明处（2026-10-22 用户问
     「没看到复盘这条分支按钮」—— 其实这个面板就是那个入口，只是原来一个字都没提分支，
     用户没法知道点下去只算当前这条线、更不知道换线是 Alt+←/→）。
     不新增按钮：棋谱库那行只留一个按钮（2026-10-18 用户拍板），说明放在这里最省地方。 */
  if (ex.branched) {
    h += '<div class="rv-sub" style="margin:0 0 12px;color:var(--text-dim)">'
      + '这份棋谱<b>有分支</b>，一共 <b>' + lines.length + '</b> 条线，已经算过 '
      + '<b>' + doneCnt + '</b> 条。'
      + (ex.openNow && ex.nMain && ex.nMain !== nMoves
        ? '（主分支是 ' + ex.nMain + ' 手 —— 你现在不在主线上。）' : '')
      + '想换到某条分支：跳到分叉的那一手、按 <b>Alt+← / Alt+→</b>。'
      + '每条线各存各的，不会互相覆盖。</div>';
  }
  if (hasReview) {
    h += '<div class="rv-sub" style="margin:0 0 12px;color:var(--text-dim)">'
      + '这份棋谱已经有一份报告了；重新复盘<b>算完整盘</b>才会覆盖<b>它那条线</b>的那份'
      + '（中途停下不算，旧报告原样留着；别的分支也各存各的）。'
      + '只想再看看上次的结果 → 点「看已存报告」。</div>';
  }
  h += '<div class="mfoot">'
    + (hasReview ? '<button id="rv-view">看已存报告</button>' : '')
    + '<div class="spacer"></div>'
    + '<button id="rv-cancel">取消</button>'
    + '<button id="rv-go" class="primary">开始复盘</button>'
    + '</div>';
  $('review-body').innerHTML = h;

  const noteEl = $('rv-pick-note');
  const goBtn = $('rv-go');
  const chosenMoves = () => {
    if (!multi || scope === 'line') return nMoves || 0;
    const box = $('rv-scope');
    return scope === 'missing' ? +box.dataset.miss : +box.dataset.all;
  };
  const refresh = v => {
    const label = labelOf(v) ? '（' + labelOf(v) + '）' : '';
    let s = '每手 ' + v + ' 步' + label;
    if (multi && scope !== 'line') {
      const k = scope === 'missing' ? missLines.length : lines.length;
      const tot = chosenMoves();
      s += ' · ' + k + ' 条线合计 ' + tot + ' 手';
      const eta = reviewEta(tot, v);
      s += eta ? '，最多约 ' + eta : '';
      s += '（前面共享的手会直接复用，通常明显更快）';
      if (part && part.n && part.visits === v) s += ' · 上次算过 ' + part.n + ' 手会复用';
    } else if (nMoves) {
      /* ★ 只有这台机器量过速度（跑过一次复盘）才给数字 —— 宁可说不知道，也别瞎估。
         以前这里写死「0.4 秒/手」，在重权重上差了 40 倍，用户以为程序卡死了。 */
      const eta = reviewEta(nMoves, v);
      s += eta ? ' · 这盘 ' + nMoves + ' 手，整盘 ' + eta
        : ' · 这盘 ' + nMoves + ' 手（这台机器还没量过速度，跑完一次就有准数）';
      /* ★ 上次没算完的进度：只有搜索量和上次一样时才说「接着算」——
         改过搜索量的话中间文件签名对不上，runReview 会整盘重算，
         这时候还说「已有 4 手」就是骗人。 */
      if (part && part.n && part.visits === v) {
        s += ' · 上次已算 ' + part.n + ' 手（点「开始复盘」是接着算，不从头来）';
      }
    } else {
      const eta = reviewEta(200, v);
      s += eta ? ' · 一盘 200 手大约 ' + eta : ' · （还没量过这台机器的速度）';
    }
    noteEl.textContent = s;
    if (goBtn) {
      goBtn.textContent = !multi ? ((ex.branched && ex.openNow) ? '复盘这条线' : '开始复盘')
        : (scope === 'line' ? '复盘这条线'
          : (scope === 'all' ? '全部复盘（' + lines.length + ' 条）'
            : '算剩下的 ' + missLines.length + ' 条'));
    }
  };

  let pick = cur;
  $('rv-picks').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      $('rv-picks').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      pick = parseInt(b.dataset.v, 10);
      refresh(pick);
    };
  });
  const scopeBox = $('rv-scope');
  if (scopeBox) {
    scopeBox.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        if (b.disabled) return;
        scopeBox.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        scope = b.dataset.s;
        refresh(pick);
      };
    });
  }
  refresh(pick);

  $('rv-cancel').onclick = () => RV_MASK.classList.remove('open');
  const vw = $('rv-view');
  if (vw) vw.onclick = () => openSavedReview(name, note);
  $('rv-go').onclick = () => {
    settings.reviewVisits = pick;      // 记住这次的选择，下次默认就是它
    runReview(name, { scope });
  };
}

/* 打开**已存的复盘报告**（棋谱库每行的「复盘报告」按钮 / 选档面板里的「看已存报告」）。
   ★ 一份文件里可能存着**好几条分支线**的报告（v3）：显示哪一份，取决于**当前站在哪条线上**。
     所以这里先看「这份棋谱是不是已经开着」——开着就**不动局面**（用户可能正站在某条分支上），
     只有从棋谱库另开一份时才 applyRecord。
   ★ 只有**整盘算完**才会写进报告文件（中途停下的那次只留在中间文件里，
     否则会把上一份完整报告覆盖成残缺的 —— 那是最坏的情况）。 */
async function openSavedReview(name, note) {
  if (reviewBusy) { showReviewAgain(); return; }
  const cached = await window.api.records.readReview(name);
  if (!cached || !cached.text) {
    /* ★ 2026-10-22：这句话要说清「复盘是按线的」，否则用户会以为「报告没了」。
       有分支的棋谱里，报告**可能只存在于另一条分支**上（那也要先有文件才有得看）。 */
    flash('这份棋谱还没有复盘报告 —— 先点「AI 复盘」'
      + (state.varRoot ? '（只算当前这条线）' : ''));
    return;
  }
  let raw = null;
  try { raw = JSON.parse(cached.text); } catch (e) { raw = null; }
  if (!raw) { flash('报告文件读不出来，请重新复盘'); return; }

  if (state.recName !== name) {
    const rd = await window.api.records.read(name);
    if (!rd || rd.error) { flash('读取棋谱失败：' + ((rd && rd.error) || '未知')); return; }
    const p = parseSGF(rd.text);
    if (!p || !p.ok) { flash('棋谱解析失败，看不了报告'); return; }
    REC_MASK.classList.remove('open');
    applyRecord(p, name);               // 载入棋谱（会清掉旧复盘），报告里「跳到那一手」才能用
  }
  state.reviewDoc = normalizeReviewDoc(raw, state.moves);
  if (state.reviewDoc && !state.reviewDoc.name) {
    state.reviewDoc.name = note || name.replace(/\.sgf$/i, '');
  }
  const got = syncReviewForLine();
  renderMoveList();
  renderCurve();
  if (got) { showReviewReport(); return; }
  showReviewNoLine(name);               // 这条分支还没算过 → 说明情况 + 一键开算
}

/* 「当前这条分支还没复盘」面板。
   ★ 不能只弹一句「没有报告」：用户刚刚才看过报告，会觉得程序把数据弄丢了。
     实际是**报告属于另一条分支** —— 把「差在第几手」说清楚，
     再给一个「复盘这条分支」按钮（前面的共享部分会直接复用，不用重算）。 */
function showReviewNoLine(name) {
  const nm = name || state.recName || '';
  const doc = state.reviewDoc || emptyReviewDoc(nm);
  const mine = lineGtpOf(state.moves);
  let best = null, bestL = -1;
  for (const k of Object.keys(doc.lines || {})) {
    const e = doc.lines[k];
    if (!e || !Array.isArray(e.moves)) continue;
    const L = sharedPrefixLen(e.moves, mine);
    if (L > bestL) { bestL = L; best = e; }
  }
  RV_MASK.classList.add('open');
  let h = '<h2>这条分支还没复盘</h2>';
  h += '<div class="rv-sub">' + esc(nm.replace(/\.sgf$/i, '')) + ' · 当前这条线共 '
    + state.moves.length + ' 手</div>';
  if (best && bestL > 0) {
    h += '<div class="rv-note">已存的报告是<b>另一条分支</b>的（第 ' + (bestL + 1)
      + ' 手起走的不是同一条线）。这条分支可以<b>从第 ' + (bestL + 1)
      + ' 手接着算</b> —— 前面的 ' + bestL + ' 手是同一个局面，直接复用，不会重算。</div>';
  } else if (best) {
    h += '<div class="rv-note">已存的报告是<b>另一条分支</b>的，而且这条分支从第一手就不一样 —— '
      + '得从头算一遍。</div>';
  } else {
    h += '<div class="rv-note">这份棋谱还没有任何一条分支的复盘。</div>';
  }
  /* 换线的手势写在按钮上面（2026-10-22 用户问「没看到复盘这条分支按钮」——
     一部分原因就是不知道换线怎么换：面板只说"另一条分支"，没说怎么回去）。 */
  if (state.varRoot) {
    h += '<div class="rv-sub" style="margin:10px 0 0;color:var(--text-dim)">'
      + '换线：跳到分叉的那一手，按 <b>Alt+← / Alt+→</b>；手数列表里带「变」标记的就是分叉点。</div>';
  }
  h += '<div class="mfoot">'
    /* ★ 2026-10-22：能定位到那条分支就再给一个「跳过去看」——
       用户的诉求常常只是"我报告呢"，而不是"帮我把这条也算一遍"。
       跳过去比解释"怎么按 Alt+←"直白得多。 */
    + (best ? '<button id="rv-line-jump">跳到有报告的那条分支</button>' : '')
    + '<button id="rv-line-go" class="primary">复盘这条分支</button>'
    + '<div class="spacer"></div><button id="review-close">关闭</button></div>';
  $('review-body').innerHTML = h;
  $('review-close').onclick = () => RV_MASK.classList.remove('open');
  const jump = $('rv-line-jump');
  if (jump) jump.onclick = () => {
    const path = linePathOfList(best.moves || []);
    if (!path) { flash('那条分支在当前的树里定位不到（可能已经被删了）'); return; }
    state.viewAt = Math.min(state.moves.length, bestL); syncUI();
    applyVariationLine(path, bestL);
    if (state.review) { showReviewReport(); return; }
    flash('已跳到那条分支，但它那份报告没读出来');
  };
  const go = $('rv-line-go');
  if (go) go.onclick = () => runReview(nm, { scope: 'line' });
}

/* ---------------- 切到「还没复盘」的分支时问一句（2026-10-22 用户要求） ----------------
   ★ 为什么要有：用户复盘了主线，切到另一条分支一看，走势/目损全空 ——
     不知道是"程序坏了"还是"这条还没算"。问一句「要不要现在算」比什么都不说好。
   ★ 什么时候**不问**（否则会变成骚扰）：
     · 这份棋谱还没存过任何一条线的报告（那就不是"漏了一条"，是压根没复盘过）；
     · 正在复盘 / 复盘弹窗开着（别盖住进度或刚弹出的报告）；
     · 这条线这次会话里已经问过、用户点了「暂不」；
     · 用户在对话框里勾了「别再自动问」。
   ★ 也不在新局的棋盘上问：只有「从棋谱库打开的棋谱」（state.recName）
     才可能是"有报告、但这条线没有"的情形。 */
let askReviewTimer = null;
function scheduleAskReviewLine() {
  clearTimeout(askReviewTimer);
  if (reviewBusy || !state.recName) return;
  const doc = state.reviewDoc;
  if (!doc || !doc.lines || !Object.keys(doc.lines).length) return;
  if (localStorage.getItem('rapacego.noAskLine') === '1') return;
  const key = lineKeyOfMoves(state.moves);
  if (doc.lines[key]) return;
  if (state.noAskKeys && state.noAskKeys.has(key)) return;
  if (state.moves.length < 2) return;
  askReviewTimer = setTimeout(() => {
    if (reviewBusy || RV_MASK.classList.contains('open')) return;
    showAskReviewLine(state.recName);
  }, 400);
}

function showAskReviewLine(name) {
  if (reviewBusy) return;
  const doc = state.reviewDoc;
  const key = lineKeyOfMoves(state.moves);
  if (!doc || !doc.lines || doc.lines[key]) return;
  /* 「还剩几条没算」= 包含当前这条在内（它是没复盘的那条） */
  const miss = reviewTargets('missing', doc);
  /* 「另一条分支」的共享前缀 —— 决定这一条能不能接着算，而不是从头 */
  const mine = lineGtpOf(state.moves);
  let bestL = 0;
  for (const k of Object.keys(doc.lines)) {
    const e = doc.lines[k];
    if (!e || !Array.isArray(e.moves)) continue;
    bestL = Math.max(bestL, sharedPrefixLen(e.moves, mine));
  }
  RV_MASK.classList.add('open');
  let h = '<h2>这条分支还没复盘</h2>';
  h += '<div class="rv-sub">' + esc(String(name || '').replace(/\.sgf$/i, ''))
    + ' · 当前这条线共 ' + state.moves.length + ' 手 · 这份棋谱已经算过 '
    + Object.keys(doc.lines).length + ' 条分支</div>';
  h += '<div class="rv-note">' + (bestL > 0
    ? '前面 <b>' + bestL + ' 手</b>和已复盘的分支是同一个局面，会<b>直接复用</b>，只算第 '
      + (bestL + 1) + ' 手往后。'
    : '这条分支从第一手就和别的不一样，得整条算一遍。')
    + ' 算完和别的分支存在同一个复盘文件里，切回哪条线就看哪一份。</div>';
  h += '<div class="mfoot">'
    + (miss.length > 1 ? '<button id="ra-more">剩下的 ' + miss.length + ' 条一起算</button>' : '')
    + '<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-dim)">'
    + '<input type="checkbox" id="ra-mute"> 别再自动问</label>'
    + '<div class="spacer"></div>'
    + '<button id="ra-no">暂不</button>'
    + '<button id="ra-go" class="primary">复盘这条分支</button>'
    + '</div>';
  $('review-body').innerHTML = h;
  const mute = $('ra-mute');
  const close = () => RV_MASK.classList.remove('open');
  $('ra-no').onclick = () => {
    state.noAskKeys.add(key);          // 这条线这次不再问（切走再切回来也不烦）
    if (mute && mute.checked) localStorage.setItem('rapacego.noAskLine', '1');
    close();
  };
  $('ra-go').onclick = () => {
    if (mute && mute.checked) localStorage.setItem('rapacego.noAskLine', '1');
    runReview(name, { scope: 'line' });
  };
  const more = $('ra-more');
  if (more) more.onclick = () => {
    if (mute && mute.checked) localStorage.setItem('rapacego.noAskLine', '1');
    runReview(name, { scope: 'missing' });
  };
}

/* 真正跑复盘（选档面板点「开始复盘」后进来）。
   ★ 不再自动用缓存：报告由「复盘报告」按钮负责看；点「AI 复盘」就是要重算一份新的。

   ★★ 2026-10-21 改成**分块 + 断点续算**，为什么：
     ① 一整盘一次发出去，在重权重上要几十分钟，中途「停止 / 关窗口 / 引擎崩了」
        就**全丢** —— 用户报的「卡住」里有一半是这种：等不下去、关掉、又得从头来；
     ② 一条巨型请求出问题时（某手非法、引擎半死），整盘一个字都拿不到。
     分块之后：每块（REVIEW_CHUNK 手）算完就落盘到 <棋谱名>.review.part.json，
     下次只补缺的手。分块本身**不会**让结果变差 —— 每手照样是同一档搜索量、
     同一个权重；KataGo 的 analysis 换手时本来就不保留搜索树。 */
const REVIEW_CHUNK = 10;

/* ---------------- 分支感知的复盘：一条线一份，全存同一个 json ----------------

   背景（2026-10-22 用户要求）：一份棋谱可以有好几条分支（SGF 变体 / 回看中落子开的分支）。
   原来复盘只认「打开时那条主线」，一换线数据整批作废 —— 想复盘另一条分支只能从头再算，
   可两条线前 100 手明明是**同一个局面**。

   做法：
     · 每条线用一个「手顺指纹」lineKey 标识（颜色+坐标序列的哈希 + 手数）；
     · 同一个 <棋谱名>.review.json 里按 lineKey 存多份（v3 结构，旧的 v2 读的时候自动升级）；
     · 换到别的分支时：① 这条线算过 → 直接显示它那份；
                       ② 没算过 → **复用共享前缀**那几手的引擎输出，只补后面分叉的部分；
     · 打开棋谱 / 切分支 / 看报告，一律按「当前这条线」挑报告（syncReviewForLine）。

   ★ 每条线还存一份 `turns`（slim 过的逐回合数据）：换分支时共享前缀直接拿来用。
     只留 buildReview 真正要用的字段（root 三项 + 候选点的 move/order + actualMove），
     一手约 100 字节；原始报文带 8 条 PV，是它的十几倍。 */

function hash32(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* 手顺 → ["BQ16", "WD4", "Wpass"]。两种输入都吃：state.moves（对象）/ 引擎请求（数组）。 */
function lineGtpOf(moves) {
  const out = [];
  for (const m of moves || []) {
    if (!m) continue;
    if (Array.isArray(m)) out.push((m[0] === 'W' ? 'W' : 'B') + String(m[1] || 'pass'));
    else out.push((m.color === 'w' ? 'W' : 'B') + (m.pass ? 'pass' : toGTP(m.x, m.y)));
  }
  return out;
}

/* 线的指纹：手顺一致 + 手数一致才是同一条线（只看手数会把不同分支当成同一条）。 */
function lineKeyOfList(list) { return hash32((list || []).join(',')) + '-' + (list || []).length; }
function lineKeyOfMoves(moves) { return lineKeyOfList(lineGtpOf(moves)); }

/* 两条线共享开头多少手（= 这些回合的局面完全相同，引擎结果可以直接复用） */
function sharedPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/* 树上所有「根→叶」的线（每条叶子算一条）。节点形状对 `state.varRoot`
   和 parseSGF 交出来的 `p.tree` 完全一样（move / children），所以两处共用一个。
   ★ 上限 40 条：变体多到离谱的棋谱（上千个叶子）不该把引擎和界面压死；
     真到那一步，报出来的「全部」也只是前 40 条 —— 面板上会写明。 */
const MAX_LINES = 40;
function linesOfTree(root) {
  const out = [];
  if (!root) return out;
  const walk = (nd, path) => {
    if (out.length >= MAX_LINES) return;
    const kids = (nd.children || []).filter(c => c.move);
    if (!kids.length) { if (path.length) out.push(path); return; }
    for (const k of kids) walk(k, path.concat([k]));
  };
  walk(root, []);
  return out;
}
function movesOfNodePath(path) {
  return (path || []).map(x => ({
    color: x.move.color, x: x.move.x, y: x.move.y, pass: !!x.move.pass,
  }));
}

/* 反过来：一串手顺（GTP 字符串）→ 树上那条节点链。找不到 = null（手顺不在树里）。 */
function linePathOfList(list) {
  const root = state.varRoot;
  if (!root || !Array.isArray(list) || !list.length) return null;
  const path = [];
  let nd = root;
  for (const g of list) {
    const want = String(g);
    const next = (nd.children || []).find(c => {
      if (!c.move) return false;
      const color = c.move.color === 'w' ? 'W' : 'B';
      const pt = c.move.pass ? 'pass' : toGTP(c.move.x, c.move.y);
      return (color + pt) === want;
    });
    if (!next) return null;
    path.push(next); nd = next;
  }
  return path;
}

/* 这次复盘要算哪几条线（scope）：
     'line'    = 当前这条线（默认，和原来完全一样）
     'all'     = 树上所有分支（按手顺指纹去重）
     'missing' = 只算还没存过报告的那些
   返回 [{ list, key, n, cur }]。scope 不是 line 时，**当前线排第一**
   （用户点的就是「复盘」，第一眼要看到自己站的这条）。 */
function reviewTargets(scope, doc) {
  const curList = lineGtpOf(state.moves);
  const cur = { list: curList, key: lineKeyOfList(curList), n: curList.length, cur: true };
  if (scope !== 'all' && scope !== 'missing') return [cur];
  const has = k => !!(doc && doc.lines && doc.lines[k]);
  const seen = new Set();
  const list = [];
  const push = t => { if (!t.list.length || seen.has(t.key)) return; seen.add(t.key); list.push(t); };
  if (!(scope === 'missing' && has(cur.key))) push(cur);
  for (const path of linesOfTree(state.varRoot)) {
    const l = lineGtpOf(movesOfNodePath(path));
    const k = lineKeyOfList(l);
    if (scope === 'missing' && has(k)) continue;
    push({ list: l, key: k, n: l.length, cur: false });
  }
  return list;
}

/* 把「当前这条线」的分析快照留一份到 state.anaLines（换线 / 开分支之前调）。
   ★ 必须在**截断 anaAt 之前**调 —— 否则删掉的就是要留的那些。
   ★★ 同一个线指纹可能被留档多次，**必须合并、不能覆盖**（2026-10-22 实测踩到）：
     进出一条分支会各留一次；第二次手里往往只有共享前缀（后面被截掉了），
     直接覆盖就把第一次那份完整数据换成了残的 —— 导出时那条线的报告只剩前几手。
     合并规则：按回合取并集（同一个回合的局面是同一个，取哪份都对）。 */
function archiveAnaLine() {
  const list = lineGtpOf(state.moves);
  if (!list.length) return;
  const key = lineKeyOfList(list);
  const prev = state.anaLines[key];
  const at = Object.assign({}, (prev && prev.at) ? prev.at : {});
  let added = 0;
  for (const k in state.anaAt) {
    const i = +k;
    if (i > list.length) continue;          // 比这条线还长 → 属于别的线（理论上不该有）
    if (!at[k]) added++;
    at[k] = state.anaAt[k];
  }
  if (!added && prev) return;               // 没有新东西就别动
  state.anaLines[key] = { key, moves: list, at };
}

/* 当前这条线的**完整**分析快照（★ 2026-10-22 第二处坑）。
   `state.anaAt` 只装「这次站上来之后算过的」：从别的分支切回来时，它已经被截成共享前缀了，
   后半段还躺在 `state.anaLines[本线指纹]` 里。导出时只读 anaAt 就会把这条线导成半截
   （解说词缺后半段）—— 所以两边合一下：
   **留档打底、当前覆盖**（同一个回合是同一个局面，当前那份更新）。
   ★ 2026-10-23：`liveLineBundles()` 随「导出不再存分析」一起删了，这个函数现在只服务
     buildSGF 的解说词（每条分支都要自己的那份快照）。 */
function curLineAnaAt() {
  const key = lineKeyOfList(lineGtpOf(state.moves));
  const arch = state.anaLines && state.anaLines[key];
  return Object.assign({}, (arch && arch.at) ? arch.at : {}, state.anaAt);
}

/* 「环境签名」= 搜索量 / 贴目 / 规则 / 棋盘 / 摆子 / 权重。
   ★ 和「手顺」分开是必须的：换分支时环境没变，共享前缀才敢复用；
     混在一起（老写法）会让每条线的签名都不同，前缀复用就失效了。 */
function reviewEnvSig(req, model) {
  const stones = (req.initialStones || []).map(s => s[0] + s[1]).join(',');
  return ['e1', req.maxVisits, req.komi, req.rules, req.size, hash32(stones), model || ''].join('|');
}

/* 「环境核心」= 上面那个签名**去掉搜索量**之后剩下的部分（贴目/规则/棋盘/摆子/权重）。
   ★★ 2026-10-23 用户报障：「已经有 AI 复盘结果的棋局，点全盘讲解还要用 KataGo 算一遍」。
   查下来根因就在这：`env` 里带着 `maxVisits`，而复盘默认档会变（老的复盘文件是 100 次，
   现在的默认是 500 次）—— 一比对就不等，**整盘一个回合都借不到**，于是白算一遍
   （294 手 × 500 步 = 几十分钟，用户当然炸）。
   搜索量只影响**精度**，不影响「这是不是一个局面」：同一个局面上不管搜 100 还是 500，
   它都是那个局面。所以能不能借看"核心"，借的时候**整盘沿用那份复盘的搜索量**
   （见 coachTurnsForLine 的 useVisits）—— 精度统一，不混着用。
   ⚠️ 权重 / 贴目 / 规则 / 棋盘 / 摆子不一样就真的不能借（评估标准都变了）。 */
function reviewEnvCore(req, model) {
  const stones = (req.initialStones || []).map(s => s[0] + s[1]).join(',');
  return ['e1', req.komi, req.rules, req.size, hash32(stones), model || ''].join('|');
}
/* 从存盘的完整签名里取「核心」那一段（形状必须和 reviewEnvCore 完全一致） */
function envCoreOf(sig) {
  const a = String(sig || '').split('|');
  if (a.length < 7) return '';
  return [a[0], a[2], a[3], a[4], a[5], a[6]].join('|');
}

/* 一条线自己的完整签名（中间文件用它校验「这份数据是不是这条线、这一档搜索量」） */
function reviewSignature(req, model) {
  return reviewEnvSig(req, model) + '|' + lineKeyOfMoves(req.moves || []);
}

/* 逐回合数据瘦身（存盘用）：buildReview 只读 root 三项、候选点的 move/order、actualMove。
   ★ 2026-10-22 多存一个候选点胜率 `winrate`：「全盘讲解」复用复盘数据时要说
     「AI 当时想下的是 X（胜率 47.6%）」，原来那版瘦身把它丢了，只能整盘重算。
     一个候选点约 20 字节，300 手的棋谱多 40KB 左右 —— 换来「复盘过的盘不用再算一遍」。 */
function slimTurn(t) {
  if (!t) return null;
  const r = t.root || {};
  return {
    turn: typeof t.turn === 'number' ? t.turn : 0,
    root: { currentPlayer: r.currentPlayer, winrate: r.winrate,
            scoreLead: r.scoreLead, visits: r.visits },
    moves: (t.moves || []).slice(0, 8).map(m => ({ move: m.move, order: m.order, winrate: m.winrate })),
    actualMove: t.actualMove || null,
  };
}
function slimTurns(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) { const v = obj[k]; if (v) out[k] = slimTurn(v); }
  return out;
}

/* 走势两条曲线（胜率 / 目差，都换算成黑方视角）—— 复盘和「下棋时攒的分析」共用 */
function seriesFromTurns(arr) {
  const isWhiteTurn = x => String(((x && x.root) || {}).currentPlayer || '').toUpperCase() === 'W';
  const history = (arr || []).map(x => {
    const wr = x && x.root && x.root.winrate;
    if (typeof wr !== 'number') return undefined;
    return isWhiteTurn(x) ? 1 - wr : wr;
  });
  const leads = (arr || []).map(x => {
    const sl = x && x.root && x.root.scoreLead;
    if (typeof sl !== 'number') return undefined;
    return isWhiteTurn(x) ? -sl : sl;
  });
  return { history, leads };
}

function emptyReviewDoc(name) {
  return { v: 3, name: String(name || '').replace(/\.sgf$/i, ''), updated: 0, lines: {} };
}

/* 读到的报告 → v3（旧版 v2 是"一个文件一份报告、只对应主分支"，就按当前这条线收编） */
function normalizeReviewDoc(raw, moves) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.lines && typeof raw.lines === 'object') {
    raw.v = 3;
    if (!raw.name) raw.name = '';
    return raw;
  }
  if (!Array.isArray(raw.losses)) return null;
  const list = lineGtpOf(moves || []);
  const key = lineKeyOfList(list);
  const doc = emptyReviewDoc(raw.name || '');
  doc.lines[key] = {
    key, moves: list, n: list.length, env: '', sig: '',
    visits: raw.visits || 0, source: 'review',
    report: raw, history: raw.history || null, leads: raw.leads || null,
  };
  return doc;
}

async function loadReviewDoc(name, moves) {
  try {
    const r = await window.api.records.readReview(name);
    if (!r || !r.text) return emptyReviewDoc(name);
    return normalizeReviewDoc(JSON.parse(r.text), moves) || emptyReviewDoc(name);
  } catch (e) { return emptyReviewDoc(name); }
}

function reviewEntryFor(doc, moves) {
  if (!doc || !doc.lines) return null;
  return doc.lines[lineKeyOfMoves(moves)] || null;
}

/* 把「当前这条线」的复盘装进 state（没有就清掉）。
   换线 / 打开报告 / 复盘结束都走这里 —— 保证界面上看到的目损、走势、报告
   永远是**眼前这条线**的，而不是上一次打开时那条主线的。 */
function syncReviewForLine() {
  const doc = state.reviewDoc;
  const entry = reviewEntryFor(doc, state.moves);
  if (!entry) {
    state.review = null;
    state.history = []; state.leads = []; state.histVisits = [];
    return false;
  }
  const rep = entry.report || {};
  state.review = Object.assign({}, rep, {
    file: state.recName || rep.file || '',
    name: rep.name || (doc && doc.name) || String(state.recName || '').replace(/\.sgf$/i, ''),
    visits: typeof entry.visits === 'number' ? entry.visits : (rep.visits || 0),
    source: entry.source || rep.source || 'review',
    partial: entry.partial || rep.partial || null,
    lineKey: entry.key, lineN: entry.n, lineMoves: entry.moves || null,
  });
  state.history = Array.isArray(entry.history) ? entry.history.slice()
    : (Array.isArray(rep.history) ? rep.history.slice() : []);
  state.leads = Array.isArray(entry.leads) ? entry.leads.slice()
    : (Array.isArray(rep.leads) ? rep.leads.slice() : []);
  state.histVisits = state.history.map(() => state.review.visits || reviewVisits());
  return true;
}

/* 打开棋谱时顺手把复盘拉回来（异步、不挡打开）：
   这样自己导出的棋谱一打开，手数列表里就有目损，不用先去点「复盘报告」。
   ★ 三道守卫：复盘正在跑 / 期间换过棋谱 / 期间换了另一份，都不许覆盖当前界面。 */
async function autoLoadReviewDoc(name, gen) {
  if (!name) return;
  const doc = await loadReviewDoc(name, state.moves);
  if (reviewBusy || gen !== gameGen || state.recName !== name) return;
  if (!doc || !doc.lines || !Object.keys(doc.lines).length) return;
  state.reviewDoc = doc;
  if (syncReviewForLine()) { renderMoveList(); renderCurve(); return; }
  /* ★ 2026-10-22：当前这条线没有、但**别的分支**有报告 → 说一句。
     不说的话用户会以为「我明明复盘过，报告丢了」（其实报告在另一条线上）。
     有分支的棋谱最容易踩：自己下的棋导出后重开默认回到主线，
     而复盘报告属于当时站的那条分支（见 dev/_cdp_review_branch.mjs 的 ⑦）。 */
  const nk = Object.keys(doc.lines || {}).length;
  if (nk) {
    flash('这份棋谱的另' + (nk > 1 ? '外 ' + nk + ' 条分支' : '一条分支') + '有复盘 —— '
      + '跳到分叉处，Alt+←/→ 切过去看');
  }
}

/* 复盘 = 「一条线一份报告」。opts.scope 决定这一次算哪几条：
     'line'（默认）  只算**当前这条线**
     'missing'       只算还没存过报告的（剩下的）
     'all'           树上所有分支
   ★ 2026-10-22 用户要求：点「AI 复盘」时能选「只算当前分支 / 全部分支 / 剩下没算的」。
     scope='line' 时的行为与以前**一模一样**（进度、暂停、断点续算都不变）。 */
async function runReview(name, opts) {
  if (reviewBusy) { showReviewAgain(); return; }
  if (!engineReady) { needEngine('analyze', '复盘'); return; }
  const scope = (opts && opts.scope) || 'line';
  /* ★ 进门取号（2026-10-06 审查发现 + 定的修法）。
     原来判定与上锁之间隔着一个 await（读棋谱文件），那几毫秒里再点一次
     「开始复盘」会**真的开第二遍**（两份整盘请求、还会互相覆盖同一份报告文件）。
     修法不是「提前上锁」—— reviewBusy 是给后台分析当闸门用的，早置会让分析多停一段，
     而且提前上锁意味着每条提前 return 都要补复位，**漏一处就锁死**（比偶发双开严重得多）。
     改成同步取号 + 在一次 await 之后校验：连点时**先来的那个主动退出**，
     最坏情况也只是退回原来的行为，不会锁死、不会多做一份。 */
  const myRun = ++reviewSeq;
  const rd = await window.api.records.read(name);
  if (myRun !== reviewSeq) return;               // 期间又点了一次 → 这次作废，交给后来者
  if (!rd || rd.error) { flash('读取失败：' + ((rd && rd.error) || '未知')); return; }
  const p = parseSGF(rd.text);
  if (!p || !p.ok || !p.moves.length) { flash('这份棋谱里没有手顺，复盘不了'); return; }

  /* ★★ 2026-10-22：**同一份棋谱已经开着**时不再 applyRecord。
     为什么：有分支的棋谱里，用户可能正站在某条分支上点「复盘这条分支」——
     applyRecord 会把局面拉回打开时那条主线，于是复盘算的是**另一条线**，
     结果还会存到那条线的名下（用户看到的报告"不是我这盘"）。
     同一份棋谱开着时，尺寸 / 规则 / 贴目 / 变化树 / 当前手顺都已经是它的，直接用最稳。 */
  const sameOpen = state.recName === name;
  if (!sameOpen) {
    REC_MASK.classList.remove('open');
    applyRecord(p, name);               // 载入棋谱（顺便切摆棋模式、清掉上一次复盘）
    /* ★ applyRecord 里 syncUI 见 isTerminal() 会**排一个 700ms 后的自动数子**。
       那个数子一进门就 cancel()，会把复盘第一块掐死（详见 runScore 开头的注释）。
       runScore 那边已经加了 reviewBusy 守卫，这里再清掉已经排上的定时器 ——
       两道都留着：守卫挡「之后排的」，clearTimeout 挡「之前就排好的」。 */
    clearTimeout(scoreTimer);
  }
  const gen = gameGen;                  // ★ 这次复盘属于哪一局（applyRecord 刚把它 +1 过）

  /* 引擎请求的公共部分 —— **不含手顺**：每条线各填各的（见 reviewLineJob）。
     ★ 也正因为它不含手顺，换分支时 envSig 一致，共享前缀才敢复用。 */
  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
    maxVisits: reviewVisits(),
  };
  const envSig = reviewEnvSig(base, analyzeModelName);

  reviewBusy = true;
  reviewAbort = false;
  rvRun = {
    t0: Date.now(), visitsDone: 0, visits: base.maxVisits,
    total: 0, doneSet: new Set(), doneBase: 0,
    lineIdx: 0, lineCount: 1, scope, name,
  };
  $('review-body').innerHTML = '';        // 丢掉上一份报告的 DOM，重建进度窗
  showReviewProgress(null);

  /* ★★ 整段包在 try/finally 里（不是审美问题）：
     reviewBusy 是「分析引擎被复盘占着」的闸门，**漏放一次就永久锁死** ——
     自动分析再也不发请求，界面上的胜率条、候选点全部停摆，只能重启软件。
     所以释放只有一个出口：finally。中间任何 return / 异常都绕不过它。 */
  try {

    /* ---------- ① 把这的棋谱已有的报告 / 中间结果读进来 ---------- */
    const doc = await loadReviewDoc(name, state.moves);
    state.reviewDoc = doc;

    /* 目标线。★ 'missing' 要知道哪些已经有报告，所以必须等 doc 读回来之后再算。 */
    const targets = reviewTargets(scope, doc);
    if (!targets.length) {
      RV_MASK.classList.remove('open');
      flash('每条分支都复盘过了 —— 想重算就选「当前这条线」或「全部分支」');
      return;
    }
    rvRun.lineCount = targets.length;
    /* 多线时总数 = 各线回合数之和（多条线共享的前缀会直接复用，所以这是**上限**估算）。
       单线时 = n+1，和以前完全一致。 */
    rvRun.total = targets.reduce((s, t) => s + t.n + 1, 0);
    showReviewProgress(null);

    let partObj = null;
    try {
      const pr = await window.api.records.readReviewPart(name);
      if (pr && pr.text) partObj = JSON.parse(pr.text);
    } catch (e) { /* 读不出来就当没有，全量重算 */ }
    /* 中间文件也是「一条线一项」（v3）。老版本是一份文件一条线，字段对不上 → 直接当没有：
       丢掉的是上一次跑了一半的数据，比重算错了好。 */
    const partLines = (partObj && partObj.lines && typeof partObj.lines === 'object') ? partObj.lines : {};

    /* ---------- ② 一条一条线算 ---------- */
    let doneAll = 0, wholeAll = 0, stopped = false, stopWhy = '', engineErr = '';
    for (let i = 0; i < targets.length; i++) {
      if (reviewAbort) { stopped = true; stopWhy = '你点了停止'; break; }
      const one = await reviewLineJob({
        name, doc, partLines, t: targets[i], idx: i, base, envSig, gen,
      });
      doneAll += one.done || 0;
      rvRun.doneBase = doneAll;
      if (one.error) engineErr = one.error;
      if (one.whole) wholeAll++;
      if (one.aborted) { stopped = true; stopWhy = one.why || ''; break; }
      if (gen !== gameGen) break;
      if (one.error && !one.done) break;
    }

    /* ★ 复盘期间用户换了局（点了新对局 / 又打开了另一份棋谱）→ 这次复盘整体作废：
       否则会把**上一份棋谱的目损**画到当前这盘上，报告还会存到别的棋谱名下。
       （中间结果已经按这份棋谱的文件名落盘了，不会串到别的棋谱上。） */
    if (gen !== gameGen) { RV_MASK.classList.remove('open'); return; }

    /* 实测速度记下来：下次开选档面板 / 画剩余时间就有准数（见 reviewRate） */
    const elapsed = (Date.now() - rvRun.t0) / 1000;
    if (elapsed > 5 && rvRun.visitsDone > 0) saveReviewRate(rvRun.visitsDone / elapsed);

    if (engineErr && !doneAll) { RV_MASK.classList.remove('open'); flash('复盘失败：' + engineErr); return; }
    if (!doneAll) { RV_MASK.classList.remove('open'); flash('复盘没拿到足够数据'); return; }

    /* ★★ 没算完整盘**不直接弹报告**（2026-10-21 用户实测报障）。
       原来的行为：点停止 → 立刻弹一份「AI 复盘」报告，页眉写着
       「这份报告没算完整盘：只算了前 4 / 294 手」—— 用户的感受是
       「复盘坏了 / 程序只肯算 4 手」，而不是「我停下来了，可以接着算」。
       现在改成专门的「暂停」面板：说清已经存盘、还剩多少、大约还要多久，
       并且「接着算」的按钮就在手边（不用再绕回棋谱库点 AI 复盘）。
       ⚠️ 这里**不能先 syncReviewForLine**：残缺的报告不在 doc.lines 里
          （只有整盘算完才写文件），一 sync 就把刚算出来的部分清掉了 ——
          暂停面板上「先看已算的这部分」于是变成空白（2026-10-22 实测到）。
          reviewLineJob 已经把「当前这条线」的那份装在 state.review 上了。 */
    if (stopped || !wholeAll) {
      renderMoveList();    // 手数列表要标目损
      renderCurve();       // 走势图要标失误点
      showReviewPaused(doneAll, rvRun.total, stopWhy || '这次没算完', scope);
      return;
    }

    /* 全部目标线整盘算完 → 按**当前这条线**重新装一份（中途换了线也不会画错） */
    const got = syncReviewForLine();
    renderMoveList();    // 手数列表要标目损
    renderCurve();       // 走势图要标失误点

    if (got) { showReviewReport(); return; }
    /* 算完了，但**当前站的这条线**不在这次的目标里（选了「只算没算过的」，或中途切走） */
    if (scope === 'line') {
      flash('那条分支的复盘算完了，已经存进这份棋谱的复盘文件');
      RV_MASK.classList.remove('open');
      return;
    }
    showReviewDone(targets.length, doneAll);
  } finally {
    reviewBusy = false;
    /* 复盘期间分析是被压住的（runAnalysis 见了 reviewBusy 直接 return）→ 复盘一结束就补一次，
       让棋盘的胜率条 / 推荐点重新长出来（force：复盘把 history 整盘重写了，当前局面得重算）。 */
    scheduleAnalysis(0, true);
    /* 复盘期间数子也被压住了（见 runScore 开头的守卫）→ 这盘要是已经下完，
       把当时被挡掉的那次数子补回来，否则结果条会一直空着。延迟一点，
       让 scheduleAnalysis 那个请求先发出去（数子一进门就 cancel，会把它掐掉）。 */
    if (!state.draft && isTerminal() && !state.result) scheduleScore(1200);
  }
}

/* 算**一条线**：断点续算（含别的分支的共享前缀）→ 分块请求 → 整盘算完才写报告。
   返回 { done, whole, aborted, why, error }。
   ★ 界面上的「装不装」由调用方判断：算的时候用户可能已经切到别的分支了，
     那就只落盘、不改界面（拿 A 线的目损看 B 线，比没有数字糟得多）。 */
async function reviewLineJob(o) {
  const { name, doc, partLines, t, idx, base, envSig, gen } = o;
  const myList = t.list;
  const myKey = t.key;
  const n = t.n;
  const reqMoves = myList.map(g => [g[0] === 'W' ? 'W' : 'B', String(g).slice(1)]);
  const sig = reviewSignature(Object.assign({}, base, { moves: reqMoves }), analyzeModelName);

  rvRun.lineIdx = idx;
  rvRun.doneSet = new Set();

  /* ---------- ① 断点续算：上一次（停止 / 崩溃 / 卡住）已经算完的手直接复用 ---------- */
  /* ★★ 复用已有数据：① 这条线自己的中间结果；② **别的分支的共享前缀**。
     ②是 2026-10-22 用户要求的核心 —— 换个分支复盘时，前 N 手明明是同一批局面，
     没有理由让引擎再算一遍（重权重上每手十几秒）。 */
  const have = {};
  let fromOther = 0;
  const trySeed = (line, key) => {
    if (!line || !line.turns) return;
    /* 环境不同（换了搜索量 / 权重 / 贴目 / 规则）→ 一个数都不能借 */
    if (line.env && line.env !== envSig) return;
    const L = sharedPrefixLen(line.moves || [], myList);
    for (let tt = 0; tt <= L; tt++) {
      const v = line.turns[tt];
      if (!v) continue;
      const c = Object.assign({}, v);
      /* ★ 共享前缀里的**最后一回合**，它后面那一手正是分叉的那一手：
         别的线走 a、我们走 b，直接沿用会把「实际手」算到别人头上，
         于是「与 AI 首选一致」这条统计就串线了。改成这条线自己的手。 */
      if (tt === L && L < myList.length) c.actualMove = myList[tt] ? myList[tt].slice(1) : null;
      if (!have[tt]) { have[tt] = c; if (key !== myKey) fromOther++; }
    }
  };
  if (partLines[myKey]) trySeed(partLines[myKey], myKey);
  for (const k of Object.keys(partLines)) if (k !== myKey) trySeed(partLines[k], k);
  for (const k of Object.keys(doc.lines || {})) {
    const e = doc.lines[k];
    /* 下棋时攒的实时分析搜索量不统一 → 不当复盘数据复用（要复用就重算一遍） */
    if (!e || e.source === 'live') continue;
    trySeed(e, k);
  }
  /* 别的线可能更长 → 超出本线的回合（理论上不该有）一律丢掉，别把 n+1 以外的东西算进去 */
  for (const k of Object.keys(have)) if (+k > n) delete have[k];

  const resumeN = Object.keys(have).length;
  if (idx === 0 && resumeN > 1 && fromOther > 1) {
    flash('这条分支复用前面共享的 ' + fromOther + ' 手，只算分叉之后的部分');
  } else if (idx === 0 && resumeN > 1) {
    flash('接着上次算：已有 ' + resumeN + ' 手，只补剩下的');
  }

  const missing = [];
  for (let tt = 0; tt <= n; tt++) if (!have[tt]) missing.push(tt);
  rvRun.visitsDone += resumeN * base.maxVisits;
  rvRun.doneSet = new Set(Object.keys(have).map(k => Number(k)));
  showReviewProgress(null);

  /* ---------- ② 分块算 ---------- */
  let turns = have, aborted = false, stalled = false, engineErr = '';
  let pos = 0, retries = 0;
  while (pos < missing.length) {
    /* ★ 换分支也算「走了」：复盘算的是发请求那一刻那条线；用户切走之后再往
       state.moves 上写结果，就会把 A 线的目损画到 B 线上（而且要白烧 GPU）。
       ⚠️ 这条判据只对**当前线**成立 —— 多线连算时 state.moves 本来就停在别的线上。 */
    if (reviewAbort || gen !== gameGen || (t.cur && lineKeyOfMoves(state.moves) !== myKey)) {
      aborted = true; break;
    }
    const chunk = missing.slice(pos, pos + REVIEW_CHUNK);
    let res;
    try { res = await window.api.review(Object.assign({}, base, { moves: reqMoves, analyzeTurns: chunk })); }
    catch (e) { res = { error: String(e) }; }

    if (res && res.aborted) { aborted = true; }           // 「停止」→ 已算完的那些还在 res.turns 里
    if (res && res.error) { engineErr = res.error; }
    /* ★★ 两种回包形状都收（2026-10-22）：
       `{turns:[...]}` = 整盘逐手的收集模式；单个 payload = 只有一个回合时主进程
       曾经回的那个形状（collect 判据写错的那一版 —— 见 main.js analyze() 里的注释）。
       只认前一种的话，形状对不上就是**静默漏手**：一条都收不到、也不报错。
       现在兜住：收不齐还有下面的空块检查兜底。 */
    const got = (res && res.turns) ? res.turns
      : ((res && typeof res.turn === 'number') ? [res] : []);
    for (const tt of got) turns[tt.turn] = tt;

    /* 每块落盘 —— 这就是「下次接着算」的锚点，也是崩溃时的止损点。
       ★ 按线存：A 线算了一半去切 B 线，A 的进度不会丢（回来接着算）。 */
    if (res && !res.error) {
      rvRun.visitsDone += chunk.length * base.maxVisits;
      try {
        partLines[myKey] = {
          key: myKey, moves: myList, n, env: envSig, sig,
          turns: slimTurns(turns),
        };
        await window.api.records.saveReviewPart(name,
          JSON.stringify({ v: 3, env: envSig, lines: partLines }));
      } catch (e) { /* 存不下不阻止继续算 */ }
    }
    if (gen !== gameGen) break;
    if (res && res.error) break;
    if (aborted) break;
    /* ★ 引擎卡住（主进程的 stall 心跳超时）→ **同一块当场重试一次**。
       卡住多半是偶发（GPU 被别的程序抢、系统睡眠、驱动抽风），而 KataGo
       已经把这块算过一部分 —— 重发同一批 analyzeTurns 会接着那棵树往下算，
       通常几秒就补齐。直接认输的话用户拿到的就是「只算了前 4 手」这种残缺报告
       （2026-10-21 用户实测报的正是这个）。重试只给一次，真挂了别在这儿打转。 */
    if (res && res.incomplete) {
      stalled = true;
      if (retries < 1) { retries++; continue; }   // 不推进 pos = 重算同一块
      break;
    }
    /* ★★ 请求了 N 个回合、一条结果都没回来 → **不许当成「这块过去了」**。
       踩过的样子（2026-10-22 用户实测）：110 手的棋谱算到「110 / 111 手」停住，
       面板说「这次没算完」，点「接着算」还是同一块、还是空手，永远补不上。
       根因在主进程的 collect 判据（单回合的最后一块被当成单局面请求），但**前端也得兜**：
       没有这条检查，漏手是完全静默的（不报错、不算卡住、pos 照样前进）。
       处置与「卡住」一致：当场重试一次；还空就停在这里并说清原因。 */
    if (chunk.length && !got.length) {
      stalled = true;
      engineErr = engineErr || '引擎这一块没回结果';
      if (retries < 1) { retries++; continue; }
      break;
    }
    stalled = false;
    pos += REVIEW_CHUNK;                          // 只有正常才算「这一块过去了」
  }

  /* 把「回合号 → 报告」摊成 0..n 的数组（缺的手留 null：没算到就是没算到，
     别拿邻居的值顶上去 —— 目损是差值，顶一个假数会让相邻两手都错）。 */
  const arr = Array.from({ length: n + 1 }, (_, i) => turns[i] || null);
  const doneN = arr.filter(Boolean).length;
  const whole = doneN === n + 1;
  if (engineErr && doneN < 2) return { done: doneN, whole: false, aborted, why: '', error: engineErr };
  if (doneN < 2) return { done: doneN, whole: false, aborted, why: '', error: engineErr || '' };

  const rep = buildReview(n, arr);
  rep.name = name.replace(/\.sgf$/i, '');
  /* 走势：胜率和目差**各填一份**（都换算成黑方视角）—— 曲线两种纵轴要用 */
  const series = seriesFromTurns(arr);
  rep.file = name;
  rep.visits = reviewVisits();              // 报告里要显示「这是按多少步算出来的」
  rep.history = series.history.slice();
  rep.leads = series.leads.slice();
  rep.partial = whole ? null : { done: doneN, total: n + 1 };
  rep.lineKey = myKey;
  rep.lineN = n;

  /* ★★ 只有**整盘算完**才写报告文件。
     没算完就写会把上一份完整报告覆盖成残缺的一份 —— 那是最坏的情况：
     用户点一次「重新复盘」、中途停了，结果连旧报告都没了。
     ★ 2026-10-22：写进去的是 **v3 文档**（这条线一项），别的分支的报告原样保留 ——
       这正是「换分支复盘，结果存到同一个 json」的落地方式。 */
  if (whole) {
    doc.lines[myKey] = {
      key: myKey, moves: myList, n, env: envSig, sig,
      visits: rep.visits, source: 'review',
      report: rep,
      history: series.history.slice(), leads: series.leads.slice(),
      turns: slimTurns(turns),
    };
    doc.name = doc.name || name.replace(/\.sgf$/i, '');
    doc.updated = Date.now();
    try { await window.api.records.saveReview(name, JSON.stringify(doc)); }
    catch (e) { /* 存不下也不影响本次查看 */ }
    /* 这条线完成了 → 它在中间文件里的那份数据没用了（留着会让下次误以为还没算完） */
    delete partLines[myKey];
    try {
      if (Object.keys(partLines).length) {
        await window.api.records.saveReviewPart(name, JSON.stringify({ v: 3, env: envSig, lines: partLines }));
      } else {
        await window.api.records.deleteReviewPart(name);
      }
    } catch (e) { /* 没中间文件就算了 */ }
    refreshRecords();    // 让棋谱库里的「已复盘」标记和「复盘报告」按钮立刻变亮
  }

  /* 只有**现在还站在这条线上**才装进界面（用户中途切走 → 只落盘） */
  if (lineKeyOfMoves(state.moves) === myKey) {
    state.reviewDoc = doc;
    state.review = rep;
    state.history = series.history;
    state.leads = series.leads;
    /* ★ 整盘复盘的每一手都是**同一档搜索量**一起算出来的 → 精度标记统一填上。
       填了它，rememberEval 之后就不会用零散的中间报告去改写这些格
       （否则复盘完再随手一看某手，那一手的涨跌就会被一次粗算覆盖掉）。 */
    state.histVisits = arr.map(() => reviewVisits());
  }
  return {
    done: doneN, whole, aborted,
    why: aborted ? '你点了停止' : (stalled ? '引擎那边卡住了' : '这次没算完'),
    error: engineErr,
  };
}

/* 多分支一起算、全都算完之后，如果用户站的这条线不在目标里（选了「只算没算过的」
   或中途切走），给个收尾面板 —— 别让弹窗就这么空着，也别假装「什么都没发生」。 */
function showReviewDone(nLines, doneTurns) {
  RV_MASK.classList.add('open');
  $('review-body').innerHTML =
    '<h2>' + nLines + ' 条分支都算完了</h2>'
    + '<div class="rv-sub">共 ' + doneTurns + ' 手 · 报告已经存进这份棋谱的复盘文件</div>'
    + '<div class="rv-note">你<b>现在站的这条分支</b>这次不在目标里。'
    + '跳到分叉那一手、按 <b>Alt+← / Alt+→</b> 换过去，就能看到它那份报告。</div>'
    + '<div class="mfoot"><div class="spacer"></div><button id="review-close">关闭</button></div>';
  $('review-close').onclick = () => RV_MASK.classList.remove('open');
}

/* 点遮罩空白处关掉复盘弹窗 —— ★ 但**复盘进行中不许关**：
   否则用户以为是「取消了」，其实后台还在算（弹窗没了、界面又能点了 ——
   用户报的「灰色背景还能点击」就是点在这儿：一点就把进度窗关掉了）。 */
if (RV_MASK) RV_MASK.addEventListener('click', e => {
  if (e.target !== RV_MASK) return;
  if (reviewBusy) { showReviewAgain(); return; }
  RV_MASK.classList.remove('open');
});
/* ★ 加 !state.coach.batch：全盘讲解也会走这条「整盘逐手」的通路（它借了复盘接口），
   但它有自己的进度条 —— 别把「复盘」那个进度窗弹出来。
   ★ 2026-10-21：payload 里除了 done/total，还带本手的 { live, at, visits, maxVisits }，
   用来画「本手已搜到 x/500」的细进度；**整盘完成数只认 rvRun.doneSet**
   （done/total 是「本次请求」的口径，分块后一块只有 10 手，直接用会把进度条打回去）。 */
window.api.onReviewProgress(d => {
  if (!reviewBusy || !d || state.coach.batch) return;
  if (rvRun && d.live === false && typeof d.at === 'number') rvRun.doneSet.add(d.at);
  showReviewProgress(d);
});

/* ⚠️ 顶栏不再单独放「AI 复盘」按钮（2026-10-04 用户拍板）：
   复盘入口就是棋谱库每行的「AI 复盘」按钮 —— 两个入口反而多余。
   ★ 教训：删按钮时**必须同时删掉对应的 `$('id').onclick = ...`**，
     否则 `null.onclick = ...` 会抛 TypeError，**把它后面所有顶层代码全部中断**
     （键盘、初始化、启动逻辑都在后面）。 */


/* ---------------- 新对局面板 ---------------- */

function initSeg(id, apply) {
  const box = $(id);
  box.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      box.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      apply(btn.dataset.v);
    };
  });
}

function setSeg(id, val) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
}

initSeg('seg-color', v => { settings.color = v; });
initSeg('seg-size', v => { settings.size = +v; });
/* ★ 让子棋按标准**不贴目**（让子本身就是补偿，再贴就是双重补偿）。
   实测（2026-10-04）：让 3 子时多贴 7.5 目 = 白方白拿 7 目多 —— 引擎**不会**替我们
   处理这件事，得我们自己把贴目带去 0。取消让子则回到该规则的默认贴目。 */
initSeg('seg-handicap', v => {
  settings.handicap = +v;
  settings.komi = settings.handicap ? 0 : (RULES[settings.rules] || RULES.chinese).komi;
  setSeg('seg-komi', settings.komi);
});
initSeg('seg-komi', v => { settings.komi = +v; });

/* 对局类型（AI 对弈 / 双人摆棋）—— 2026-10-04 用户要求「新对局面板分两块」：
   「我执」这个词只在**有 AI 的时候**才成立，双人摆棋没有「我方」，
   所以那两行直接收起来（原来摆棋时还让人挑「我执」，纯属自找歧义）。
   ★ 这里直接改 settings.mode（跟面板里其它项一样是即时生效的设置），
     并把顶栏那个模式开关一起点亮，免得两处显示不一致。
     ⚠️ 点「取消」时会把它还原（cancelNewGame）—— 因为面板里的其它项只在点「开始」时才
        起作用，而模式是"当前正在用的工作台"，顶栏还亮着它，不能就这么留着。 */
initSeg('seg-ntype', v => {
  settings.mode = v;
  setSeg('seg-mode', v);
  syncNewGameRows();
});

/* 「双方都由 KATAGO 走」（2026-10-18 用户要求）—— 只在 AI 对弈里出现。
   勾上后「我执」那一行藏起来（没有"你执哪边"这回事）；真正生效是点「开始」时
   （applyNewGame 把它落到 state.autoBoth 上，中途不开新局也能用「接着当前局面下」）。
   ⚠️ 取消勾选时同样要把 row-color 放回来 —— 由 syncNewGameRows 统一处理。 */
$('chk-autoboth').onchange = e => {
  settings.autoBoth = e.target.checked;
  syncNewGameRows();
};

/* 按对局类型显隐面板里的行。注意 CSS 里有一条 `.mrow[hidden]{display:none}` ——
   .mrow 是 flex，不显式写就会被 display:flex 压过去（本项目踩过好几次）。 */
function syncNewGameRows() {
  const play = settings.mode === 'play';
  const ts = settings.mode === 'tsumego';
  /* 三块互斥的专用设置：
     · 人机对弈才需要「我执 / 对手棋力 / 档位说明」
     · 习题练习不需要「让子 / 计时 / 规则 / 贴目」——
       让子会和"用户自己摆"打架；做题不计时；
       死活题与规则、贴目都无关（判死活用归属，不看数子/数目、也不看贴几目），
       留着反而让人以为"改了有用"。发给引擎的固定是中国规则 · 贴 0 目（见 TS_RULE / TS_KOMI）。 */
  $('row-color').hidden = !play || !!settings.autoBoth;   // 我执（双方都自动时没有"我执"）
  $('row-autoboth').hidden = !play;   // 双方都由 KATAGO 走（只有 AI 对弈有）
  $('row-level').hidden = !play;      // 对手棋力
  $('level-note').hidden = !play;     // 档位说明（跟着对手棋力走）
  $('row-handicap').hidden = ts;
  $('row-clock').hidden = ts;
  $('row-rules').hidden = ts;
  $('row-komi').hidden = ts;
  ['row-tsplace', 'row-tsfirst', 'row-tsframe', 'row-tsaicolor'].forEach(id => {
    const el = $(id);
    if (el) el.hidden = !ts;
  });
  const fn = $('ts-frame-note');
  if (fn) { fn.hidden = !ts; if (ts) updateFrameNote(); }
  const rn = $('ts-role-note');
  if (rn) { rn.hidden = !ts; if (ts) updateRoleNote(); }
  /* ★ 「接着当前局面下」只在这三个条件都满足时出现（2026-10-14）：
     ① 已经在下棋（有盘面或手顺），② 目标是 人机对弈 / 双人摆棋，
     ③ **当前不是在习题练习里**（`state.tsumego` 还在 = 盘上那道题的摆子/手顺）。
     理由：① 习题练习永远从空盘开始摆题，没有"接着"这回事；
     ② 别把一道做完的题"接着"成人机对弈 —— 题目的摆子在 play 模式下会被当成让子局
      （先手判据按"有没有摆子"走），轮次显示会跟手顺对不上。
     那一项收起来时也顺手取消勾选，免得"看不见却已经勾上"。 */
  const hasGame = !state.noGame && (state.setup.length > 0 || state.moves.length > 0);
  const keepable = hasGame && settings.mode !== 'tsumego' && !state.tsumego;
  $('row-keep').hidden = !keepable;
  const kn = $('keep-note');
  if (kn) kn.hidden = !keepable;
  if (!keepable) $('chk-keep').checked = false;
  const hint = $('m-hint');
  if (hint) {
    hint.textContent = play
      ? '提示：学棋用「人类棋风」对手 + 让子，最容易看出「正常该往哪下」。'
      : ts
        ? '提示：先摆出题目的初始局面（或导入 SGF 习题）→ 点「开始解题」。判定按「题目目标」给结论；手筋 / 对杀 / 官子这类没有统一死活的题，目标选「只看提示」。（规则与贴目在这一模式下固定为「中国规则 · 不贴目」—— 死活判定与它们无关，所以这两行先收起来了。）'
        : '提示：两边都由你下，方便接着研究变化。让 N 子＝黑方开局先摆 N 个黑子，摆完由白方先走（让子局按标准不贴目）。';
  }
}

/* ---------------- 顶栏「对局模式」：单按钮 + 下拉菜单（2026-10-14 用户要求）----------------
   原来并排三个按钮（人机对弈 / 双人摆棋 / 习题练习），现在合成一个：
   **按钮上写当前模式**，点开是那三个选项。
   ★ 选中任一项 = **打开「新对局」设置面板**并把类型预选成它（2026-10-14 用户要求的老行为）——
     模式要等面板里点「开始」才真的切，点「取消」什么都不变（见 cancelNewGame）。
     所以**不要**把被点的那一项点亮：菜单高亮一律跟着 `settings.mode`（真实模式）走，
     这个唯一出口就是 `syncModeBtn()`（由 syncUI 每帧调用）。
   ★ 菜单容器仍叫 `#seg-mode`、项仍带 `data-v` → `setSeg('seg-mode', …)`、`lit('seg-mode')`、
     测试脚本的 `seg('seg-mode', …)` 全部照旧可用（这也是没给它改名换 id 的原因）。
   ★ 定位照抄底栏「显示 ▾」：父级 .modepick 是 position:relative，菜单绝对定位右对齐。 */
const MODE_TEXT = { play: '人机对弈', free: '双人摆棋', tsumego: '习题练习' };
const MODE_MENU = $('seg-mode');
function closeModeMenu() {
  MODE_MENU.hidden = true;
  $('modepick').classList.remove('open');
}
/* 按钮文字 + 菜单高亮：**只认 settings.mode**。放在 syncUI 里每帧调（幂等、开销可忽略）。 */
function syncModeBtn() {
  const el = $('mode-cur');
  const txt = MODE_TEXT[settings.mode] || '对局模式';
  if (el && el.textContent !== txt) el.textContent = txt;
  setSeg('seg-mode', settings.mode);
}

$('btn-mode').onclick = e => {
  e.stopPropagation();   // 别让下面那个「点外面关闭」在同一趟点击里又把它关掉
  if (MODE_MENU.hidden) {
    syncModeBtn();       // 保证高亮/文字是最新的再展开
    MODE_MENU.hidden = false;
    $('modepick').classList.add('open');
  } else closeModeMenu();
};
MODE_MENU.querySelectorAll('button').forEach(b => {
  b.onclick = () => { closeModeMenu(); openNewGame(b.dataset.v); };
});
document.addEventListener('click', e => {
  if (!MODE_MENU.hidden && !$('modepick').contains(e.target)) closeModeMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !MODE_MENU.hidden) closeModeMenu();
});

/* ---------------- （已退役）「摆棋 → AI 对弈：先问 AI 执哪一方」----------------
   2026-10-04 用户要求加的确认弹窗；2026-10-14 用户改成"顶栏点模式按钮 = 打开新对局面板"，
   于是它的职责被**面板里的「我执」那一行**接过去了（同屏就能看到，还不用叠两个弹窗）。
   代码与 HTML/CSS 一并删掉，不留死代码。
   ⚠️ 代价要说清楚：原来从「摆棋」切到「人机对弈」是**保留当前盘面**的（只是换谁执子），
      现在走「新对局 → 开始」，会开一盘新棋。要"接着当前局面下"的需求如果回来了，
      就在面板里加一个「保留当前盘面」的勾选，而不是把弹窗搬回来。 */

/* ==================== 习题练习 · 控件接线（2026-10-12）==================== */

/* 框架说明（跟着「框架 / 框架距离」实时变，写在面板下方那行小字里）。
   为什么要有它：光一个数字框「4」看不出是"4 什么" —— 这里把它换算成"框大约多大"，
   用户才知道该调大还是调小。 */
function updateFrameNote() {
  const el = $('ts-frame-note');
  if (!el) return;
  if (settings.tframe === 'off') {
    el.textContent = '不加框架：引擎会在全盘找点 —— 空盘上的小题会推荐「脱先走大场」那种对做题没用的点。';
    return;
  }
  const side = 5 + settings.tdist * 2;
  el.textContent = '框架距离 ' + settings.tdist + ' 路：框边比题目棋子最外沿多留 ' + settings.tdist
    + ' 路。角上一道小题的棋子约占 5×5 → 框约 ' + side + '×' + side + '。';
}

/* ---- 框架 / 框距：**同一个值有两个地方能改**（「新对局」面板 + 练习卡），
     所以显示与副作用都各自只有一个出口，免得出现"一处亮了、另一处还是旧值"。
     ★ 为什么练习卡上也要有一份：「新对局」面板点「开始」会把题目重置 ——
     做题中途发现框太小（想在框外落子）时，只有练习卡能当场调大。
     框同时决定引擎的 allowMoves 范围，所以改完要重画 + 重发一次分析。 */
const TDIST_MIN = 0, TDIST_MAX = 10;

/* 值 → 显示（两处开关 + 框距数字 + 面板下方说明文字）。只拉显示，不重画、不发分析。 */
function syncFrameUI() {
  setSeg('seg-tframe', settings.tframe);      // 「新对局」面板
  setSeg('seg-tsframe', settings.tframe);     // 练习卡
  const inp = $('inp-tdist'); if (inp) inp.value = settings.tdist;
  const txt = $('ts-dist-txt'); if (txt) txt.textContent = settings.tdist;
  updateFrameNote();
}

/* 用户改了框架设置 → 拉齐显示，并让棋盘与引擎跟上（框变了 = allowMoves 的范围变了）。 */
function applyFrameChange() {
  syncFrameUI();
  if (tsOn()) { draw(); scheduleAnalysis(120); }
}

/* 改框距（唯一的入口：面板的数字框、练习卡的两个加减按钮都走它） */
function setFrameDist(v) {
  const n = parseInt(v, 10);
  settings.tdist = Math.max(TDIST_MIN, Math.min(TDIST_MAX, Number.isFinite(n) ? n : 4));
  applyFrameChange();
}

/* KATAGO 执哪一方（'b'/'w'）—— 「新对局」面板与练习卡**两处控件写的是同一个值**，
   所以显示只走这一个出口（跟 syncFrameUI 一个道理：分开写就会出现"一处变了另一处没变"）。
   同时更新那行小字：光看"KATAGO 执白"看不出你是解题还是防守，得把"谁先动手"讲明白。 */
function updateRoleNote() {
  const el = $('ts-role-note');
  if (!el) return;
  const first = settings.tfirst === 'b' ? '黑先' : '白先';
  const ai = tsAIColor() === 'b' ? '黑' : '白';
  const mine = tsMyColor() === 'b' ? '黑' : '白';
  el.textContent = (tsAIColor() === settings.tfirst)
    ? 'KATAGO 执' + ai + '（' + first + '）：由它先动手，你执' + mine + '防守。'
    : 'KATAGO 执' + ai + '，你执' + mine + '（' + first + '）：你先动手、你解题（默认）。';
}

function syncTkaicolorUI() {
  setSeg('seg-tkaicolor', tsAIColor());   // 「新对局」面板
  setSeg('seg-tsaicolor', tsAIColor());   // 练习卡
  updateRoleNote();
}

/* 改了 KATAGO 的颜色（两个控件共用）：拉齐显示；我执跟着换，然后 syncUI 决定要不要让它动手。
   中途改不会推翻已走的手顺：谁执哪方只影响"下一手该谁点"。
   （2026-10-17：原来还要"把上一次的判定作废"，判定删了。） */
function applyRoleChange() {
  syncTkaicolorUI();
  if (!tsOn() || !state.tsumego) return;
  state.myColor = tsMyColor();
  syncTsumegoUI();
  draw();
  syncUI();
}

/* ---------- 先手（黑先 / 白先）----------
   ★ 2026-10-16 用户要求：练习卡上要能一眼看到"这道题谁先走"。它是**题目的属性**
     （同时是发给引擎的 initialPlayer），所以做成常驻行、摆题阶段也看得见、也改得了。
   ★ 两处控件写同一个值（练习卡 + 「新对局」面板）→ 显示只有一个出口，跟框架/KATAGO 一个道理。 */
function syncFirstUI() {
  setSeg('seg-tsfirst', settings.tfirst);   // 练习卡（常驻行）
  setSeg('seg-tfirst', settings.tfirst);    // 「新对局」面板
}

/* 练习卡上**当场**改先手。
   ★ 与「新对局」面板里那个 seg-tfirst 不是一回事：面板是"改预设置、点开始才建题"，
     这里是"当场改这道题"，所以要顺手把手顺清掉 —— 先手一变，第一手的颜色就变了，
     旧手顺是按旧先手记的，留着会串（黑先的题改成白先，盘上第 1 手却还是黑）。
   ★ 顺手把 KATAGO 翻到对方（与面板同一条默认语义：它执先手的对方 = 你来解题）。 */
function applyFirstChange(v) {
  settings.tfirst = (v === 'w' ? 'w' : 'b');
  settings.taicolor = (settings.tfirst === 'b' ? 'w' : 'b');
  syncFirstUI();
  const t = state.tsumego;
  if (!t) { syncTkaicolorUI(); return; }
  t.nextColor = settings.tfirst;
  state.myColor = tsMyColor();
  state.toMove = settings.tfirst;
  tsResetBoardState();     // 手顺不再成立（顺带 +1 局面代，在飞的应手会作废）
  syncTsumegoUI();         // 内含 syncTkaicolorUI
  draw();
  syncUI();
  flash('这道题改成' + (settings.tfirst === 'b' ? '黑先' : '白先') + '了 · 手顺已清空 · KATAGO 执'
    + (tsAIColor() === 'b' ? '黑' : '白') + '（你来解题）');
}

/* 「新对局」面板里的四个习题设置（即时写进 settings；点「开始」时才真正建题） */
initSeg('seg-tmode', v => { settings.tmode = v; });
/* ★ 改「先手」时**顺手把 KATAGO 的颜色翻到对方**（2026-10-14）：
   默认语义 = "你来解题、KATAGO 防守"。不跟着翻的话，白先的题会变成
   "KATAGO 执白先动手、你来守" —— 跟绝大多数人的预期相反。
   想练防守的话，把它改成先手那一方即可（面板或练习卡都行）。 */
initSeg('seg-tfirst', v => {
  settings.tfirst = v;
  settings.taicolor = (v === 'b' ? 'w' : 'b');
  syncFirstUI();
  syncTkaicolorUI();
});
/* 练习卡上的先手（常驻行）。★ 走 applyFirstChange —— 当场生效，会清手顺（见它的注释）。 */
initSeg('seg-tsfirst', v => applyFirstChange(v));
initSeg('seg-tkaicolor', v => {
  settings.taicolor = (v === 'b' ? 'b' : 'w');
  applyRoleChange();
});
initSeg('seg-tframe', v => { settings.tframe = v; applyFrameChange(); });
$('inp-tdist').oninput = e => setFrameDist(e.target.value);

/* 练习卡上的框架 / 框距（和面板那份写的是同一对设置） */
initSeg('seg-tsframe', v => { settings.tframe = v; applyFrameChange(); });
$('btn-ts-dist-less').onclick = () => setFrameDist(settings.tdist - 1);
$('btn-ts-dist-more').onclick = () => setFrameDist(settings.tdist + 1);

/* 练习卡上的 KATAGO 执哪一方（和面板那份写的是同一个值） */
initSeg('seg-tsaicolor', v => {
  settings.taicolor = (v === 'b' ? 'b' : 'w');
  applyRoleChange();
});

/* 练习卡 · 摆题阶段：落子工具（黑 / 白 / 擦） */
initSeg('seg-tscolor', v => {
  if (!state.tsumego) return;
  state.tsumego.placeTool = v;
  syncTsumegoUI();
});

/* 练习卡 · 解题阶段：对手（按正解 / KATAGO / 我下两边）。
   ★ 切完主动 syncUI 一次 —— 若此刻正好轮到对方，对手会立刻应一手。 */
initSeg('seg-tsdefend', v => {
  if (!state.tsumego) return;
  state.tsumego.defend = v;
  syncTsumegoUI();
  syncUI();
  flash(v === 'solution'
    ? '按正解：对手照题集的正解应对；你走偏了就改用 KATAGO'
    : v === 'ai'
      ? 'KATAGO：对手由强引擎走，只在题目附近（离棋子 2 路内）找点'
      : '我下两边：黑白交替、两边都由你走（自己推演变化）');
});

$('btn-ts-start').onclick = () => tsStartSolve();
$('btn-ts-back').onclick = () => tsBackToSetup();
$('btn-ts-clear').onclick = () => tsClearSetup();
$('btn-ts-reset').onclick = () => tsResetSolve();
$('btn-ts-answer').onclick = () => tsToggleAnswer();

/* ==================== 习题题集 · 控件接线（2026-10-14）==================== */
/* 弹窗遮罩。⚠️ 这个 const 必须在使用它的那些函数**被调用之前**初始化 ——
   函数声明会提升，但 const 不会（TDZ）。这里在模块顶层、且调用都来自用户点击，
   所以安全。 */
const PUZ_MASK = $('puzzles');

$('btn-pset').onclick = () => openPuzzles();
$('btn-ts-prev').onclick = () => tsGotoProblem(-1);
$('btn-ts-next').onclick = () => tsGotoProblem(1);
$('puz-close').onclick = () => PUZ_MASK.classList.remove('open');
PUZ_MASK.addEventListener('click', e => { if (e.target === PUZ_MASK) PUZ_MASK.classList.remove('open'); });
$('puz-open-dir').onclick = () => window.api.puzzles.openDir();
$('puz-import').onclick = async () => {
  const btn = $('puz-import');
  btn.disabled = true; btn.textContent = '导入中…';
  try {
    const r = await window.api.puzzles.import();
    if (!r || r.canceled) return;
    if (r.error) { flash('导入失败：' + r.error); return; }
    flash('已导入题集「' + String(r.name).replace(/\.sgf$/i, '') + '」');
    await refreshPuzzles();
    await openPuzzleSet(r.name);          // 导入完直接开始练第 1 题
    PUZ_MASK.classList.remove('open');
  } finally {
    btn.disabled = false; btn.textContent = '导入题集…';
  }
};

/* 走势图纵轴切换：黑方胜率（%）/ 黑方领先目数。两者视角都是**黑方**，只是量纲不同。 */
initSeg('seg-curve', v => {
  state.curveMode = (v === 'lead') ? 'lead' : 'win';
  renderCurve();
});

/* 规则联动：切换规则时带出该规则的默认贴目；明清规则（座子制）下不能再让子 */
function syncRulesUI(rules, withKomi) {
  const R = RULES[rules] || RULES.chinese;
  if (withKomi) settings.komi = settings.handicap ? 0 : R.komi;   // ★ 有让子就不贴目
  setSeg('seg-komi', settings.komi);
  const dis = !!R.seats;
  const box = $('seg-handicap');
  box.querySelectorAll('button').forEach(b => { b.disabled = dis; });
  box.classList.toggle('off', dis);
  if (dis) { settings.handicap = 0; setSeg('seg-handicap', 0); }
}

$('m-rules').onchange = () => syncRulesUI($('m-rules').value, true);

/* ---------- 对手棋力下拉（真实段位） ----------
   顶栏 sel-level 与面板 m-level 都从 RANKS 生成，避免两处手写不同步。 */
function fillLevelSelects() {
  for (const id of ['sel-level', 'm-level']) {
    const sel = $(id);
    if (!sel) continue;
    sel.textContent = '';
    for (const g of RANK_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const r of RANKS) {
        if (r.group !== g) continue;
        const o = document.createElement('option');
        o.value = r.v;
        o.textContent = r.label;
        og.appendChild(o);
      }
      if (og.children.length) sel.appendChild(og);
    }
    sel.value = settings.level;
  }
}

/* 选中档位 → 显示「这个档位大概什么水平」
   （用户原话：我想先知道对方的水平，然后再开始跟他下） */
function refreshLevelNote() {
  const r = RANK_MAP.get(settings.level) || RANK_MAP.get('rank_3d');
  const note = $('level-note');
  if (note && r) note.textContent = r.label + ' · ' + r.note;
  const sel = $('sel-level');
  if (sel && r) sel.title = r.label + '：' + r.note;
}

function setLevel(v) {
  settings.level = RANK_MAP.has(v) ? v : 'rank_3d';
  $('sel-level').value = settings.level;
  $('m-level').value = settings.level;
  refreshLevelNote();
}

/* 顶栏改难度要立刻生效（原来只同步了下拉，settings 没跟着变） */
$('sel-level').onchange = () => { setLevel($('sel-level').value); syncUI(); };
$('m-level').onchange = () => { setLevel($('m-level').value); syncUI(); };

/* ---------- 分析搜索量（「计算深度」）----------
   生成下拉 + 说明当前档位的「快慢 / 精度」取舍。
   耗时数字是**实测**出来的（见 VISIT_OPTS 注释），不是估的。 */
/* 分析搜索量（「计算深度」）—— **两处下拉共用一个设置**：
   底栏（随时调，用户 2026-10-04 要求「要在下面设一个出来」）+ 「新对局」面板。 */
function fillVisitSelect() {
  const panel = $('m-visits');       // 面板：带档位名，看得懂
  if (panel) {
    panel.textContent = '';
    for (const [v, name] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = name + ' · ' + v + ' 次';
      panel.appendChild(o);
    }
  }
  const bar = $('sel-visits');       // 底栏：只写「N 步」，省地方
  if (bar) {
    bar.textContent = '';
    for (const [v] of VISIT_OPTS) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v + ' 步';
      bar.appendChild(o);
    }
  }
  setVisits(settings.visits);
}

/* 设定搜索量：写进 settings，并让两个下拉保持一致 */
function setVisits(v) {
  const n = parseInt(v, 10);
  settings.visits = VISIT_OPTS.some(o => o[0] === n) ? n : 500;
  for (const id of ['m-visits', 'sel-visits']) {
    const el = $(id);
    if (el) el.value = String(settings.visits);
  }
  refreshVisitsNote();
}

/* 改档位 → 立即生效。★ 热切换：maxVisits 是**每个分析请求自带的参数**，
   runAnalysisOnce 每次现读 settings.visits，所以改完下一次分析就用新值，
   不用重开对局、不用重启程序。这里顺手重算一次，免得用户要等下一手才看到效果。 */
function applyVisits(v) {
  setVisits(v);
  flash('计算深度：每手 ' + settings.visits + ' 步 · 已生效');
  scheduleAnalysis(0, true);      // ★ force：档位变了，当前局面要用新搜索量重算一遍
}

function refreshVisitsNote() {
  const note = $('visits-note');
  if (!note) return;
  const v = settings.visits;
  /* 耗时按实测点（500→0.4s、1600→0.7s、3000→约 1.2s）内插 */
  const sec = v <= 150 ? '约 0.1 秒' : v <= 250 ? '约 0.2 秒' : v <= 400 ? '约 0.3 秒'
    : v <= 600 ? '约 0.4 秒' : v <= 900 ? '约 0.5 秒' : v <= 1200 ? '约 0.6 秒'
      : v <= 1700 ? '约 0.75 秒' : v <= 2500 ? '约 1.0 秒' : '约 1.3 秒';
  note.textContent = '每手思考 ' + v + ' 步 · ' + sec + '出推荐点。' + (
    v <= 300 ? '最快；复杂局面的选点会飘。' :
      v <= 800 ? '速度与精度平衡，日常看棋够用。' :
        '更稳；推荐点出现更慢。'
  );
}

$('m-visits').onchange = e => applyVisits(e.target.value);
$('sel-visits').onchange = e => applyVisits(e.target.value);

/* 打开「新对局」设置面板。
   · 默认（顶栏「新对局」按钮 / 未开局时棋盘中央那个按钮）：对局类型 = 当前模式
   · ★ 传了 type（2026-10-14 起，顶栏那个对局模式下拉走这条）：把这个类型预选上
   ⚠️ 打开时会先把 settings.mode 改成预选的那个类型 —— 面板里所有"按类型显隐"的行
     都读它（本项目「面板选项即时生效」的一贯做法）。但**点取消要还回去**，
     否则顶栏会亮着一个其实没生效的模式（见 cancelNewGame）。 */
let ngPrevMode = null;

function openNewGame(type) {
  /* ★ 只在**面板原本是关着**的时候记"上一个模式"（2026-10-14）。
     为什么：settings.mode 在面板开着时可能是**还没应用**的预选值（面板选项即时生效），
     拿它当"上一个模式"，取消之后就会还原成一个同样没生效的值。
     （顶栏那三个按钮点起来本来就在遮罩后面，正常点不到；但代码要经得起） */
  if (!$('newgame').classList.contains('open')) ngPrevMode = settings.mode;
  const t = (type === 'play' || type === 'free' || type === 'tsumego') ? type : settings.mode;
  settings.mode = t;
  setSeg('seg-mode', t);                // 顶栏跟着亮，免得两处显示打架
  $('m-rules').value = settings.rules;
  setLevel(settings.level);
  setSeg('seg-color', settings.color);
  setSeg('seg-size', settings.size);
  setSeg('seg-handicap', settings.handicap);
  setSeg('seg-komi', settings.komi);
  setSeg('seg-ntype', t);               // 对局类型（顶栏点进来的就是它）
  $('m-clock').value = settings.clock;
  /* ★ 习题练习的四个设置也要同步到面板（值来自 settings，用户上次选过的保留） */
  setSeg('seg-tmode', settings.tmode);
  setSeg('seg-tfirst', settings.tfirst);
  syncFrameUI();                         // 框架 / 框距（面板 + 练习卡两处一起拉齐）
  syncTkaicolorUI();                     // KATAGO 执哪一方（两处 + 说明文字）
  $('chk-keep').checked = false;         // 「接着当前局面下」每次都从**不勾**开始（要显式选）
  $('chk-autoboth').checked = !!settings.autoBoth;   // 「双方都由 KATAGO 走」：保留上次的选择
  fillVisitSelect();                     // 搜索量下拉（值同步 + 说明文字）
  syncRulesUI(settings.rules, false);   // 只做禁用联动，不覆盖用户选过的贴目
  syncNewGameRows();                     // 按类型显隐各行
  $('newgame').classList.add('open');
}

/* 关掉面板而**不**应用：把模式还原成打开之前那一个。
   为什么只有 mode 要还原：面板里其它选项（我执 / 规则 / 棋盘…）虽然也是即时写进 settings，
   但它们**只在点「开始」时才起作用**；而模式不一样 —— 它是"当前正在用的工作台"，
   顶栏还亮着它、右栏双方名字也跟着变。不还原就会出现
   "顶栏写着习题练习、其实还在下棋"这种自相矛盾的状态。 */
function cancelNewGame() {
  $('newgame').classList.remove('open');
  if (ngPrevMode && ngPrevMode !== settings.mode) {
    settings.mode = ngPrevMode;
    setSeg('seg-mode', ngPrevMode);
    setSeg('seg-ntype', ngPrevMode);
    syncNewGameRows();
    syncUI();                            // 右栏名字 / 状态栏跟着回原样
  }
  ngPrevMode = null;
}

$('btn-new').onclick = () => openNewGame();       // ⚠️ 不能直接挂 openNewGame：
$('btn-gate-new').onclick = () => openNewGame();  //    那样第一个参数会收到 Event 对象
/* 引擎没起来时，中央那条提示里的「去设置」（openSettings 是函数声明，会提升） */
$('gate-setup').onclick = () => openSettings();
$('m-cancel').onclick = cancelNewGame;
$('newgame').onclick = e => { if (e.target === $('newgame')) cancelNewGame(); };

$('m-start').onclick = () => {
  settings.rules = $('m-rules').value;
  setLevel($('m-level').value);
  settings.clock = $('m-clock').value;
  /* ★ 习题练习的专用设置（面板上那几行）—— 只在这里读一次，之后由练习卡改 */
  settings.tmode = ($('seg-tmode').querySelector('.on') || { dataset: {} }).dataset.v || settings.tmode;
  settings.tfirst = ($('seg-tfirst').querySelector('.on') || { dataset: {} }).dataset.v || settings.tfirst;
  settings.tframe = ($('seg-tframe').querySelector('.on') || { dataset: {} }).dataset.v || settings.tframe;
  const dv = parseInt($('inp-tdist').value, 10);
  settings.tdist = Number.isFinite(dv) ? Math.max(0, Math.min(10, dv)) : 4;
  /* （2026-10-17：原来这里还读一档「题目目标」sel-tgoal —— 随判定/提示一起删了） */
  /* 类型以面板上亮着的那一个为准（点它时已经改过 settings.mode，这里再对齐一次） */
  const nt = $('seg-ntype').querySelector('.on');
  if (nt) settings.mode = nt.dataset.v;
  /* ★ 「接着当前局面下」：勾了 + 这一项确实适用（面板正显示着它）→ 保留盘面只换模式 */
  const keep = $('chk-keep').checked && !$('row-keep').hidden;
  ngPrevMode = null;                   // 已应用 → 不再是"待还原"的状态
  $('newgame').classList.remove('open');
  /* ★ 习题练习有自己的开局路径（空盘 + 摆题阶段），**不能走 applyNewGame** ——
     applyNewGame 是"开一局棋"，会按让子 / 座子填 state.setup，和"用户自己摆题"冲突。
     它也永远从空盘开始，所以「接着当前局面下」在它这里不适用（那一项也会收起来）。 */
  if (settings.mode === 'tsumego') { enterTsumego(); return; }
  if (keep) { continueCurrentGame(); return; }
  applyNewGame();
};

/* 「接着当前局面下」——保留盘面与手顺，只把模式换掉（2026-10-14 用户要求）。
   这件事实质上就是原来那个「摆棋 → AI 对弈：先问 AI 执哪一方」弹窗在做的事：
   顶栏改成"打开设置面板"之后，那个能力得在这里补回来。
   · 盘面 / 手顺 / 历史 / 已算出的分析**一概不动**（所以不走 applyNewGame）
   · 我执按面板上的 settings.color 定下来（含「随机」），人机对弈下另一半就是 AI
   · 换完 syncUI：若正好轮到 AI，它会立刻接手落子 —— 这正是"接着下"的意思
   · 棋盘 / 让子 / 贴目 这几项**不生效**（局面保持原样），面板上那行小字写了 */
function continueCurrentGame() {
  if (state.tsumego) exitTsumego();      // 从习题练习切过来：练习状态要收掉
  if (settings.mode === 'play') {
    const c = settings.color === 'r' ? (Math.random() < 0.5 ? 'b' : 'w') : settings.color;
    settings.color = c;                  // 「随机」也定下来，免得下次开新局又随掉
    state.myColor = c;
  }
  /* ★ 双方都由 KATAGO 走：接着下也能用（继续当前局面 → 两边都交给它） */
  state.autoBoth = settings.mode === 'play' && !!settings.autoBoth;
  state.autoPaused = false;
  setSeg('seg-mode', settings.mode);
  syncUI();
  flash('接着当前局面下 · ' + (settings.mode === 'play' ? '人机对弈' : '双人摆棋')
    + (state.autoBoth ? ' · 双方都由 KATAGO 走' : ''));
}

/* idle = true → 只把界面摆成「未开局」的中性样子（**软件启动时**用，见文件末尾的启动段）。
   点「新对局 → 开始」时不传这个参数，等于真的开一局。 */
function applyNewGame(idle) {
  /* ★ 从习题练习切到别的模式时**必须收掉练习状态**（2026-10-14 补）。
     原来这条逻辑在顶栏的模式开关里（`if (tsOn()) exitTsumego()`）——
     顶栏改成"打开新对局面板"之后，切模式走的是 `m-start → applyNewGame`，
     于是 state.tsumego 会**留在那儿**：卡片虽然藏了（tsOn() 为假），
     但下次进习题练习时那是个旧对象，而且 `defaultName` 之类的判断会读到它。
     实测就是这么漏的：切到摆棋之后 `state.tsumego` 还在。 */
  if (state.tsumego) exitTsumego();
  N = settings.size;
  state.fromRecord = false;     // 新开的局不是打谱
  state.sgfComments = [];       // 新开局没有「棋谱自带的解说词」
  state.varRoot = null;         // 新开局没有变化树（分支来自棋谱）
  state.rootComment = '';       // 也没有「棋谱说明」（那是某份棋谱根节点上的文字）
  state.quizTips = [];           // 也不是题集，没有「第几题」
  state.recName = '';           // ★ 也不是某份棋谱了 —— 讲解没有存放处（全盘讲解按钮会收起）
  state.exportName = '';        // 新局 → 下次导出该新起名字（别覆盖上一局那份）
  clearCoachPanels();           // 讲解只在对局期间保留（用户要求：开新局就清）
  const R = RULES[settings.rules] || RULES.chinese;

  if (R.seats) {
    state.setup = seatStones(N);      // 明清规则：四角座子（黑白各二）
    state.toMove = 'w';               // 古谱白先
  } else if (settings.handicap) {
    state.setup = handicapStones(N, settings.handicap);
    state.toMove = 'w';
  } else {
    state.setup = [];
    state.toMove = 'b';
  }

  state.moves = [];
  state.candidates = [];
  state.candAt = -1;
  state.ownership = null;
  state.ownAt = -1;
  state.history = [];               // 走势数据随之清空（胜率 + 目差两条）
  state.leads = [];
  state.histVisits = [];            // ★ 精度标记一起清（它跟 history 是一对，见 state 注释）
  resetAnalysisState();             // 换局：旧的分析欠账 / 「已上屏」标记全部作废
  state.viewAt = 0;
  state.thinking = false;
  state.koPoint = null;
  state.draft = null;              // 新对局：退出试下状态
  state.result = null;             // 新对局：清掉终局结果
  state.lastEval = null;
  state.review = null;             // 新对局：清掉上一次的复盘数据（目损标记）
  state.reviewDoc = null;          // 连着复盘文件一起丢（否则会给新局画上旧局的目损）
  state.pv = null;                 // 新对局：收掉变化图
  state.names = { b: '', w: '' };  // 新对局：名字回到默认（人机 PLAYER/KATAGO、摆棋 PLAYER1/2）
  state.noGame = !!idle;           // ★ 启动时停在「未开局」；「新对局 → 开始」时解除
  state.anaAt = {};                // ★ 逐手分析快照（「解说词」卡用）—— 新局从零开始
  state.anaLines = {};             // ★ 各分支的分析存档（导出时一起写进复盘文件）
  /* ★ 双方都由 KATAGO 走（只有 AI 对弈模式有意义；启动时的"未开局"一律不算） */
  state.autoBoth = !idle && settings.mode === 'play' && !!settings.autoBoth;
  state.autoPaused = false;
  hover = null;

  if (settings.color === 'r') state.myColor = Math.random() < 0.5 ? 'b' : 'w';
  else state.myColor = settings.color;

  setSeg('seg-mode', settings.mode);
  clockReset();          // 计时按新设置重置（不限时则隐藏计时面板）
  resize();
  syncUI();
  /* 自我对弈开了就明说一声 —— 否则用户会以为"我怎么下不了棋" */
  if (state.autoBoth) flash('双方都由 KATAGO 走 · 底栏「暂停」可以随时停住');
}

/* ==================== 习题练习（tsumego，2026-10-12）====================

   要解决什么：拿一道题（死活 / 手筋 / 对杀 / 中盘 / 官子）反复练，做完能知道对不对。

   ★ 和「摆棋」最根本的区别是**两阶段**：
     ① 摆题阶段：落子进 `state.setup`（初始局面），**不进 `state.moves`**。
        为什么必须这样：题的第一手要当「第 1 手」用 —— 手数、分析请求的 initialStones、
        复盘、讲解全靠这个区分。摆进 moves 的话初始局面会变成"前 N 手棋"，
        手数列表、胜率曲线、判定全都错位。
     ② 解题阶段：落子进 `state.moves`，`state.toMove` 从「先手」起。
        `state.setup` 全程不动（就是这道题的初始局面）。

   ★ KATAGO 走「分析引擎」（强权重）而不是人机对弈那套段位引擎。理由：
     死活题的正解是以「对方最强应对」为前提的；拿"模仿业余 3 段"的模型去防守，
     它自己会应错，会把用户的错着放过去，判定就不成立了。

   ★ 死活框架：自动框住题目棋子 + 外扩「框距」路。它同时干两件事 ——
     视觉上圈出局部；计算上通过 allowMoves 把引擎锁在框内（否则空棋盘上的小题，
     引擎会推荐"脱先走大场"这种对做题毫无意义的点）。
*/

/* 建一份习题状态。字段含义：
     phase    'setup' 摆题 / 'solve' 解题
     placeTool 摆题阶段的落子工具：'b' | 'w' | 'erase'（只在自由摆棋下用）
     nextColor 交替摆棋用：下一子该谁
     defend   'ai' = KATAGO 应手（强引擎）/ 'both' = 我下两边（两边都由你走）
     source   来自哪份棋谱（导入习题时记下；手摆的是空串）
   （2026-10-17：hint / target / judge / lastGoal / targetManual 随「提示 / 判定 / 题目目标」一起删了） */
function makeTsumego() {
  return {
    phase: 'setup', placeTool: 'b', nextColor: 'b',
    defend: 'ai', source: '',
    /* 正在展示「参考答案」（把题集里写着的正解摆出来）。
       ★ 它为 true 时：不许落子、KATAGO 不许应手（否则会把答案后面接下去走），
         「重来 / 重摆」会把它清掉。见 tsToggleAnswer。 */
    showAnswer: false,
    /* KATAGO 上次是**为什么**没应子（「被掐断，重试中」/ 引擎原话 / 停一手）。
       ★ 为什么留这个字段：第一版把失败吞在空 catch 里，端到端测试只看到
         「AI 一声不吭」，完全查不出原因。诊断信息要留得住。 */
    defendNote: '',
  };
}

/* ⚠️ 必须**同时**判 settings.mode 和 state.tsumego：
   「新对局」面板里点一下「习题练习」就会立刻把 settings.mode 改成 'tsumego'
   （那是本项目"面板选项即时生效"的一贯做法），但这时候还没建题 ——
   用户点了「取消」时 state.tsumego 仍是 null。只判 mode 的话，整个应用会以为
   自己在习题模式里、到处走习题的分支，而 state.tsumego 是空的 → 必崩或行为诡异。 */
const tsOn = () => settings.mode === 'tsumego' && !!state.tsumego;
const tsPhase = () => (state.tsumego ? state.tsumego.phase : null);

/* 框架矩形：**题目的初始棋子**（state.setup）的外接矩形，四边各外扩 settings.tdist 路，
   clamp 到棋盘内。没有任何摆子 → null（框不起来，也正好对上「引擎也没东西可约束」）。

   ★★ 只看 state.setup，**绝不看 state.moves**（2026-10-12 用户报错后改）。
   原来把 state.moves 也算进去，后果是：解题时你每落一子，框就跟着往外长一格 ——
   一手走出棋子外接矩形的边，框就"长大"一块，越下越大，看着像框在飘。
   而且这不是纯视觉问题：框同时是 allowMoves 的范围，框一变、
   发给引擎的约束也跟着变 —— 同一道题，框应该在解题开始那一刻就定死。
   只看 setup 就自然满足：摆题阶段框跟着你摆的子走（那时 moves 本来就是空的），
   一旦进了解题阶段 setup 不再变 → 框彻底固定。 */
function frameRect() {
  if (!tsOn() || settings.tframe === 'off') return null;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (const s of state.setup) {
    if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x;
    if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y;
  }
  if (x1 < 0) return null;
  const d = Math.max(0, Math.min(10, parseInt(settings.tdist, 10) || 0));
  return {
    x0: Math.max(0, x0 - d), y0: Math.max(0, y0 - d),
    x1: Math.min(N - 1, x1 + d), y1: Math.min(N - 1, y1 + d),
  };
}

/* ★★ 「贴题半径」（2026-10-17）：引擎找点时**只允许落在离最近棋子 ≤ 2 路的空点**上。
   来龙去脉（实测数据见 daily log 2026-10-17）：原来 allowMoves 只给「整个框」，
   框距默认 4、框里 100~195 个点，大半离战斗 4~6 路。而死活题的胜率几乎是常数
   （黑已大优 → 99.9%），引擎没有"必须应"的动机，就在框内随手挑个大场 —— 这就是
   用户看到的"KATAGO 老脱先 / 落在框边"。实测《玄玄棋经》前 24 题：
     · 整框：首选距最近棋子 >2 路的占 25~33%（另一次跑 33%，引擎有随机性）
     · 收成 2 路：**0%**，与 SGF 正解应手的吻合率不变（42%）
     · 把框距从 4 调到 2：仍是 29% —— **调框距治不了**（框的角落照样离棋子 4~5 路）
   ⚠️ 这只影响**引擎**（allowMoves / 候选过滤）；人的落子范围仍由框架管。 */
const TS_BAND = 2;

/* 「离棋子 ≤ maxD 路」的空点集合（按当前局面：摆子 + 手顺到 state.moves.length）。
   19×19 只有 361 点，直接对每颗棋子做一次切比雪夫膨胀，够快也够直白。 */
function bandNear(maxD) {
  const b = boardAt(state.moves.length);
  const set = new Set();
  for (let i = 0; i < N * N; i++) {
    if (!b[i]) continue;
    const sx = i % N, sy = Math.floor(i / N);
    for (let y = Math.max(0, sy - maxD); y <= Math.min(N - 1, sy + maxD); y++)
      for (let x = Math.max(0, sx - maxD); x <= Math.min(N - 1, sx + maxD); x++)
        if (!b[idx(x, y)]) set.add(y * N + x);      // 已有子的点不算（引擎也不会往那儿走）
  }
  return set;
}

/* 框内 ∩ 贴题半径。带太窄时（盘上只有一两颗子、或题目本身很空）依次放宽到 3 路、
   最后退回整框 —— 宁可给引擎一点余地，也不能让它无点可选（无点 = 应手直接失败）。 */
function bandPointsInFrame(fr) {
  const all = [];
  for (let y = fr.y0; y <= fr.y1; y++)
    for (let x = fr.x0; x <= fr.x1; x++) all.push([x, y]);
  for (const d of [TS_BAND, TS_BAND + 1]) {
    const set = bandNear(d);
    const pts = all.filter(([x, y]) => set.has(y * N + x));
    if (pts.length >= 20) return pts;
  }
  return all;
}

/* 候选过滤（方案 3 的兜底）：只留贴题的候选，pass 永远留着（该收束时允许停一手）。
   正常情况用不上 —— 请求里已经把搜索限在带内了。留这一层是因为 allowMoves 是引擎标注
   「experimental」的字段，而且带太窄时我们会退回整框：万一引擎给了远处大场，
   这一层保证"不会当真落下去"。返回空数组时调用方要保留原列表（别把候选清空）。 */
function filterLocalMoves(infos, maxD) {
  const set = bandNear(maxD);
  return infos.filter(m => {
    const s = String(m.move || '');
    if (!s || s.toLowerCase() === 'pass') return true;
    const p = fromGTP(s);
    return !!p && set.has(p.y * N + p.x);
  });
}

/* 发分析请求时要额外带的两个字段（习题专用）。**每个分析请求都要带上** ——
   漏了 initialPlayer 引擎会自己猜先手（纯黑子判白先），漏了 allowMoves 就会推荐脱先。 */
function tsAnalyzeExtras() {
  if (!tsOn()) return {};
  const extra = {};
  /* ★ 规则与贴目**一律用固定值**（2026-10-14）：死活题与它们无关，面板里那两行也藏了。
     放在这里覆盖，是因为三个请求点（常规分析 / KATAGO 应手 / 判定）都是
     `Object.assign({...}, req, tsAnalyzeExtras())` —— 附加项在**最后**，能盖掉 req 里的值，
     而 settings.rules / settings.komi 本身不动（退出习题模式后还是用户原来那套）。 */
  extra.rules = TS_RULE;
  extra.komi = TS_KOMI;
  /* moves 为空时先手只能靠它告诉引擎。有 moves 时不必传（引擎从第一手的颜色就知道）。 */
  if (!state.moves.length) extra.initialPlayer = (state.toMove === 'b') ? 'B' : 'W';
  const fr = frameRect();
  if (fr) {
    /* ★ 2026-10-17：从「整框」收成「框内 ∩ 离棋子 2 路内」—— 治"脱先"的关键一层。
       详见 TS_BAND 顶上那段实测数据。 */
    const pts = bandPointsInFrame(fr).map(([x, y]) => toGTP(x, y));
    extra.allowMoves = [
      { player: 'B', moves: pts, untilDepth: 1000 },
      { player: 'W', moves: pts, untilDepth: 1000 },
    ];
  }
  return extra;
}

/* ★ 「局面代」：每次进入/重置局面就 +1（进入练习、开始解题、重来、重摆、清空都算）。
   为什么需要它 —— **实测踩到过**（2026-10-12）：AI 应手的请求要算几秒，
   这期间用户按了「重来」，请求回来时把应手落在**已经清空的盘**上，成了第 1 手：
   盘上凭空多一手、双方轮次错乱，看着像"AI 乱下"，而且不报任何错。
   光比手数不够（悔棋会把手数变回去），所以要一个只增不减的记号。
   ⚠️ 声明必须放在**调用点之前**（tsResetBoardState 从这里往下就会调它），
      否则模块加载阶段若直接进习题模式会踩 `let` 的暂时性死区。 */
let defendSeq = 0;
/* 局面重置的唯一出口（凡是"手顺/摆子被改掉"的地方都调它）。 */
function tsBumpSeq() { defendSeq++; }

/* 清掉"跟着手顺走"的那一堆状态。换阶段 / 重来 / 重摆都走它，避免各处漏清。 */
function tsResetBoardState() {
  /* ★ 局面被重置 → 让**在飞的防守请求**作废（它算的是别的局面，回来会乱插一手）。 */
  tsBumpSeq();
  state.moves = [];
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  state.history = []; state.leads = []; state.histVisits = [];
  resetAnalysisState();
  state.viewAt = 0;
  state.thinking = false;
  state.koPoint = null;
  state.draft = null;
  state.result = null;
  state.lastEval = null;
  state.review = null;
  state.reviewDoc = null;
  state.pv = null;
  hover = null;
}

/* 进入习题练习（空盘、摆题阶段）。顶栏开关与「新对局 → 开始」都走这条。 */
function enterTsumego() {
  settings.mode = 'tsumego';
  state.tsumego = makeTsumego();
  state.tsumego.nextColor = settings.tfirst;
  /* ★ 清掉上一个模式残留的定时器（2026-10-12 加的保险）。
     来龙去脉要说清楚：跑端到端测试时出现过**一次没复现的**异常
     （`reading 'phase'`，界面停在了人机对弈、盘上却有一手棋）——
     根因没查到，但"换模式时旧定时器还在跑"是一个合理嫌疑：
     `scheduleAIMove` / `scheduleDefendMove` 都是 setTimeout，
     排上之后如果模式被切走，回调醒来仍会按旧模式的状态去落子 / 改 state。
     清掉是零成本的，先堵上这一条。 */
  clearTimeout(aiTimer); aiTimer = null;
  clearTimeout(defendTimer); defendTimer = null;
  N = settings.size;
  state.fromRecord = false;     // 不是打谱
  state.varRoot = null;         // 习题的"题集变体"走自己的 tree，别把上一份棋谱的分支带进来
  state.sgfComments = [];
  state.rootComment = '';
  state.quizTips = [];
  state.recName = '';           // 不是某份棋谱 → 没地方存全盘讲解（按钮会收起）
  state.exportName = '';        // 换到习题 → 上一局的导出目标作废
  clearCoachPanels();
  state.setup = [];             // 空盘开始摆题
  state.myColor = tsMyColor();   // 你执 KATAGO 的另一方（见 settings.taicolor）
  state.toMove = settings.tfirst;
  state.names = { b: '', w: '' };
  tsResetBoardState();
  state.noGame = false;         // 进练习就是「有内容了」
  setSeg('seg-mode', 'tsumego');
  clockReset();
  resize();
  syncTsumegoUI();
  syncUI();
  /* ★ 有题集打开时：接着**上次那道题**载入（而不是空盘）。
     为什么：切去人机对弈下两盘再切回来，练习册不该翻回第一页、更不该变成空盘。
     （openPuzzleSet 会先把自己的 tsumegoSet 清掉再调这里，所以不会串到上一份题集。） */
  if (tsSet() && tsSet().list.length) tsLoadProblem(tsSet().idx);
  /* ★ 这里**故意不发 flash**（2026-10-12 用户要求）。
     flash 写的是顶栏「帮助」右边那个状态栏，会挂 1.8 秒 ——
     进个模式就弹一段说明，属于打扰。该怎么操作，左栏练习卡上已经写着，
     不必再往状态栏塞一遍。（状态栏留给"动作反馈"：开始解题 / 重来 / 判定结果这类。） */
}

/* 离开习题练习（切到别的模式时调）。 */
function exitTsumego() {
  /* 把还没跑的防守定时器掐掉 —— 否则切走之后它醒来还会照旧模式去落子（见 enterTsumego 的注释） */
  clearTimeout(defendTimer); defendTimer = null;
  defendBusy = false;
  state.tsumego = null;
  syncTsumegoUI();
}

/* ==================== 习题题集（2026-10-14，「导入 SGF 习题」）====================

   先把一件事说清：**题集 ≠ 棋谱**。
     · 棋谱：一个文件 = 一局棋（有手数、能复盘、能逐手讲解）。
     · 题集：一个文件里往往**并列串着几百道题**（实测用户那份《玄玄棋经》
       xxqj.sgf 就是 347 棵顶层树串在一起），一道题一棵树。
   所以题集单独一个目录（`puzzles/`，见 main.js），不混进棋谱库 ——
   一份 347 题的 SGF 放进棋谱库，列表会把它当成"一局棋"，手数和复盘按钮全是错的。

   每道题从 SGF 里取三样东西（见 parseProblemSet）：
     初始局面（AB/AW 摆子）、先手（PL）、正解（主变化 = 做者写进去的答案）。
   ★ 判定**不看** SGF 里的正解 —— 仍然让 KATAGO 算死活（那是客观结论）。
     SGF 的正解只喂给「正解」按钮（手动按才摆出来）。两条路互不依赖，
     所以题集里没写正解也不影响判定；反过来手摆的题没有正解也不影响判定。 */

const tsSet = () => state.tsumegoSet;

/* ---------- 题集进度：记住每份题集"练到第几题"（2026-10-16 用户要求）----------
   ★ 为什么需要：用户那份《玄玄棋经》有 347 道题。练到第 100 题时切去下盘棋、
     再打开这份题集又回到第 1 题 —— 想接着练得按 99 次 ‹。
   ★ 为什么存 localStorage 而不是岔进 puzzles/ 或 settings.json：
     这是**本机、本用户的界面进度**，跟题集文件本身无关（题集可能是从别人那儿
     拷来的、也可能是只读的）；项目里已有同样的先例（「显示」菜单那几项就存在
     localStorage，见 rapacego.showHints）。存在不下也不影响功能，只是不记进度。 */
const PSET_PROG_KEY = 'rapacego.pset.progress';

function psetProgAll() {
  try {
    const o = JSON.parse(localStorage.getItem(PSET_PROG_KEY) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}
function psetProgWrite(all) {
  try { localStorage.setItem(PSET_PROG_KEY, JSON.stringify(all)); } catch (e) { /* 记不住也能用 */ }
}
/* 这份题集上次练到第几题（0 起；没记过或值不合法 → 0）。也接受"带不带 .sgf"两种写法。 */
function psetProgGet(name) {
  const all = psetProgAll();
  const v = (name in all) ? all[name] : all[String(name).replace(/\.sgf$/i, '')];
  return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? (v | 0) : 0;
}
function psetProgSet(name, idx) {
  if (!name) return;
  const all = psetProgAll();
  if (all[name] === (idx | 0)) return;              // 没变就不用写
  all[name] = idx | 0;
  psetProgWrite(all);
}
/* 题集改名 / 删除 → 进度跟着走（不然进度会认不出改过名的那一份） */
function psetProgRename(oldName, newName) {
  const all = psetProgAll();
  if (!(oldName in all)) return;
  all[newName] = all[oldName];
  delete all[oldName];
  psetProgWrite(all);
}
function psetProgDrop(name) {
  const all = psetProgAll();
  if (!(name in all)) return;
  delete all[name];
  psetProgWrite(all);
}
/* 当前这道题（题集里那一项）；手摆的题 → null */
function tsSetProblem() {
  const s = tsSet();
  return (s && s.list && s.list[s.idx]) ? s.list[s.idx] : null;
}

/* 载入题集里的第 i 道题（0 起）。成功返回 true。 */
function tsLoadProblem(i, why) {
  const s = tsSet();
  const t = state.tsumego;
  if (!s || !s.list.length || !t) return false;
  const n = s.list.length;
  const idx = Math.max(0, Math.min(n - 1, i | 0));
  s.idx = idx;
  const p = s.list[idx];

  /* 尺寸：题集里可能混着小盘题（9/13 路）。settings.size 也跟着切 ——
     不切的话退出习题模式后开新局会用错尺寸（新对局面板读的就是这个值）。 */
  if (p.size && p.size !== N) {
    settings.size = p.size;
    N = p.size;
    if (p.size !== 19 && settings.handicap) settings.handicap = 0;   // 让子只对 19 路有意义
  }

  state.setup = p.setup.map(x => ({ x: x.x, y: x.y, color: x.color }));
  /* 先手是**题目的属性**，逐题不同 → 必须写进 settings（它同时也是发给引擎的 initialPlayer）。
     ★ 谁坐哪边（taicolor）**每题都重置成默认**（KATAGO 执先手的对方 = 你来解题）。
       为什么不沿用上一题的：先手逐题变，沿用会出现"这道题突然变成我防守"，
       跟"练题"这件事本身矛盾。想练防守，当场把练习卡上那个值改掉即可。 */
  settings.tfirst = p.first;
  settings.taicolor = (p.first === 'b' ? 'w' : 'b');

  t.phase = 'setup';          // ★ 停在摆题阶段：让你先核对题目 + 调框距，再按「开始解题」
  t.showAnswer = false;
  /* ★ 对手默认「按正解」（2026-10-17）：题集自带正解，照它应才真正贴题（一手不脱先）。
     题集里没写主变化（rare）→ 退回 KATAGO。每题都重置，和 taicolor 同一个道理：
     这两样都是"这道题"的属性，沿用上一题容易莫名其妙。 */
  t.defend = (p.answer && p.answer.length >= 2) ? 'solution' : 'ai';
  t.nextColor = p.first;
  t.placeTool = 'b';
  t.defendNote = '';
  t.source = s.name + ' · 第 ' + (idx + 1) + ' 题';
  state.myColor = tsMyColor();
  state.toMove = p.first;
  state.names = { b: '', w: '' };
  tsResetBoardState();        // 手顺 / 候选全清（顺带 +1 局面代，在飞的应手会作废）
  /* ★ 记下"这份题集练到第几题"（2026-10-16）：下次打开这份题集直接定位过来。
     写在这里而不是 tsGotoProblem 里 —— 翻题、面板点开、切模式回来都要记，
     而它们最终都会经过 tsLoadProblem（唯一的载入出口）。 */
  psetProgSet(s.name, idx);
  draw();
  syncTsumegoUI();
  syncUI();
  if (why) flash(why);
  return true;
}

function tsGotoProblem(delta) {
  const s = tsSet();
  if (!s || !s.list.length) { flash('还没有打开题集 —— 点练习卡上的「题集」导入一份 SGF 题集'); return; }
  const to = s.idx + delta;
  if (to < 0) { flash('已经是第一题' ); return; }
  if (to >= s.list.length) { flash('已经是最后一题（共 ' + s.list.length + ' 题）'); return; }
  const p = s.list[to];
  tsLoadProblem(to, '第 ' + (to + 1) + ' / ' + s.list.length + ' 题 · '
    + (p.first === 'b' ? '黑先' : '白先') + ' · 摆子 ' + p.setup.length
    + (p.answer.length ? ' · 正解 ' + p.answer.length + ' 手' : ''));
}

/* 打开一份题集（从 puzzles/ 里按文件名读）→ 进习题模式 → 摆好题。
   ★ 2026-10-16：起始题从"永远第 1 题"改成**上次练到的那一题**（见 psetProgGet）——
     347 道的题集不然每次都要从头翻。
   pre 是可选的前缀说明（「当题练」复用已有题集时用它，见棋谱库那行）。 */
async function openPuzzleSet(name, pre) {
  if (!name) return;
  const r = await window.api.puzzles.read(name);
  if (!r || r.error) { flash('打开题集失败：' + ((r && r.error) || '未知')); return; }
  const { list, skipped } = parseProblemSet(r.text);
  if (!list.length) { flash('这份文件里没解析出题目 —— 它可能是一局棋而不是题集'); return; }
  /* 先进习题模式（enterTsumego 会把盘面清空、并把 state.tsumego 建起来），
     再把题集挂上、载入上次那一题。顺序反过来的话 enterTsumego 会把刚摆好的题清掉。
     ⚠️ enterTsumego 里有一句"若有题集就接着上次那道题载入" —— 那一刻
        state.tsumegoSet 还是**上一份**题集，所以要先把它清掉，避免串题。 */
  state.tsumegoSet = null;
  enterTsumego();
  state.tsumegoSet = { name, list, idx: 0, skipped };
  const start = Math.max(0, Math.min(list.length - 1, psetProgGet(name)));
  tsLoadProblem(start);
  flash((pre ? pre + ' · ' : '')
    + '已打开题集「' + name.replace(/\.sgf$/i, '') + '」· ' + list.length + ' 题'
    + (start > 0 ? ' · 接着第 ' + (start + 1) + ' 题' : '')
    + (skipped ? '（跳过 ' + skipped + ' 段）' : ''));
}

/* 「正解」按钮：把这道题的正解顺序摆出来（题集里写着的答案）。
   只手动触发 —— 分级提示（提示①②③）仍然按原来的节奏，一按就给答案等于没得练。
   ★ 为什么要求"先回到初始局面"再摆：题集里的正解是从**初始局面**起算的，
     盘上已经有手顺时直接接上去会牛头不对马嘴。用户的落子不能悄悄丢掉，
     所以这里只是提示他先按「重来」。
   ★ 摆出来之后用 ← → （或手数列表）可以一手一手回看 —— 复用已有的回看机制，
     不另做一套动画（动画要管定时器，换题/重来时还得清，不值当）。 */
function tsToggleAnswer() {
  const t = state.tsumego;
  if (!t) return;
  if (t.phase !== 'solve') { flash('先点「开始解题」，再看参考答案'); return; }
  if (t.showAnswer) {
    t.showAnswer = false;
    tsResetSolve();
    flash('已收起参考答案');
    return;
  }
  const p = tsSetProblem();
  if (!p || !p.answer.length) {
    flash(tsSet() ? '这道题在 SGF 里没写正解手顺' : '手摆的题没有参考答案（正解来自导入的题集）');
    return;
  }
  if (state.moves.length) { flash('盘上已有手顺 —— 先按「重来」回到初始局面'); return; }
  if (t.defend === 'ai') { /* 摆答案时不需要 KATAGO 插嘴，下面的守卫会挡住应手 */ }
  t.showAnswer = true;
  state.moves = p.answer.map(m => ({ color: m.color, x: m.x, y: m.y, pass: !!m.pass }));
  state.viewAt = state.moves.length;
  state.candidates = []; state.candAt = -1;
  /* ★ 必须走 syncUI()（它内含 draw + syncTsumegoUI）—— 只调这两个的话，
     **左栏「手数」卡和底部滑块不会更新**：正解摆在盘上了、右下角却还写着"还没有落子"、
     滑块还是 0/0（2026-10-15 在截图里看出来的，断言没覆盖到，已补一条）。
     走 syncUI 也不会让 KATAGO 应手 —— `stillNeedDefend()` 在 showAnswer 期间为假。 */
  syncUI();
  flash('参考答案 · ' + state.moves.length + ' 手 —— 用 ← → 回看；再按「正解」收起');
}

/* 摆题 → 解题 */
function tsStartSolve() {
  const t = state.tsumego;
  if (!t) return;
  if (!state.setup.length) { flash('先在棋盘上摆出题目的初始局面（点棋盘落子）'); return; }
  t.phase = 'solve';
  t.showAnswer = false;      // 开始解题 = 收起参考答案（那是"看答案"，不是解题）
  state.myColor = tsMyColor();   // 你执 KATAGO 的另一方（见 settings.taicolor）
  state.toMove = settings.tfirst;
  tsResetBoardState();
  draw();
  syncTsumegoUI();
  syncUI();
  scheduleAnalysis(0, true);
  flash('开始解题 · ' + (settings.tfirst === 'b' ? '黑先' : '白先')
    + (t.defend === 'solution' ? ' · 对手按正解应对'
      : t.defend === 'ai' ? ' · 另一方由 KATAGO 走' : ' · 两边都由你走'));
}

/* 解题 → 摆题（重摆） */
function tsBackToSetup() {
  const t = state.tsumego;
  if (!t) return;
  t.phase = 'setup';
  t.showAnswer = false;
  state.toMove = settings.tfirst;
  tsResetBoardState();
  draw();
  syncTsumegoUI();
  syncUI();
  flash('回到摆题阶段 —— 可继续改初始局面');
}

/* 重来：摆子保留，手顺清掉，回到初始局面（仍在解题阶段） */
function tsResetSolve() {
  const t = state.tsumego;
  if (!t || t.phase !== 'solve') return;
  t.showAnswer = false;
  state.myColor = tsMyColor();   // 你执 KATAGO 的另一方（见 settings.taicolor）
  state.toMove = settings.tfirst;
  tsResetBoardState();
  draw();
  syncTsumegoUI();
  syncUI();
  scheduleAnalysis(0, true);
  flash('已回到这道题的初始局面');
}

function tsClearSetup() {
  const t = state.tsumego;
  if (!t) return;
  tsBumpSeq();                    // 摆子清空 = 局面变了，在飞的请求作废（见 defendSeq）
  state.setup = [];
  t.nextColor = settings.tfirst;
  draw();
  syncTsumegoUI();
}

/* 摆题阶段落子 —— **写 state.setup，不写 moves**（见本节开头）。 */
function placeSetupStone(x, y, forceErase) {
  const t = state.tsumego;
  if (!t || t.phase !== 'setup') return false;
  if (state.noGame) { flash('还没开局 —— 点棋盘中间的「新建对局」开始'); return false; }

  const i = state.setup.findIndex(s => s.x === x && s.y === y);
  const asErase = forceErase || t.placeTool === 'erase';

  if (asErase) {
    if (i < 0) return false;
    state.setup.splice(i, 1);
  } else if (settings.tmode === 'alt') {
    /* 交替摆棋：空点落「下一子」的颜色并轮换；点已有的子 = 擦掉（改错用） */
    if (i >= 0) state.setup.splice(i, 1);
    else {
      state.setup.push({ x, y, color: t.nextColor });
      t.nextColor = t.nextColor === 'b' ? 'w' : 'b';
    }
  } else {
    /* 自由摆棋：落当前颜色。同色再点 = 撤掉；异色 = 改成当前色（都符合"摆棋"的直觉） */
    const color = t.placeTool === 'w' ? 'w' : 'b';
    if (i < 0) state.setup.push({ x, y, color });
    else if (state.setup[i].color === color) state.setup.splice(i, 1);
    else state.setup[i].color = color;
  }

  /* 初始局面变了 → 之前的候选点/形势作废（局面已经不是那个局面了） */
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  resetAnalysisState();
  draw();
  syncTsumegoUI();
  /* 摆题时也让引擎跟着看（有子才发 —— 空盘没什么可算的，而且没有框架时
     引擎会推荐"脱先走大场"，对摆题没帮助）。延时一点，免得连续摆子时狂发请求。 */
  if (state.setup.length) scheduleAnalysis(280);
  return true;
}

/* ---------- 摆题阶段画在棋盘上的东西 ---------- */

/* 框架：一圈圆角矩形 + 四角加重，让人一眼看出"题目在这一块"。
   ⚠️ 画在棋子**之上**（半透明线），否则会被棋子压住看不清。 */
function drawFrame() {
  const fr = frameRect();
  if (!fr) return;
  const [ax, ay] = pxOf(fr.x0, fr.y0);
  const [bx, by] = pxOf(fr.x1, fr.y1);
  const m = gap * 0.5;
  const x = ax - m, y = ay - m, w = (bx - ax) + m * 2, h = (by - ay) + m * 2;

  ctx.save();
  /* （2026-10-17：原来这里有一条"提示②把框画亮"的联动，随分级提示一起删了 —— 框恒为虚线） */
  ctx.strokeStyle = 'rgba(24,95,165,.62)';
  ctx.lineWidth = Math.max(1.4, gap * 0.06);
  ctx.setLineDash([gap * 0.34, gap * 0.26]);
  roundRect(x, y, w, h, gap * 0.34);
  ctx.stroke();
  ctx.restore();
}

/* ---------- KATAGO 应手（强引擎） ---------- */
let defendBusy = false;
let defendTimer = null;
/* 「本次应手」的令牌：每次进入 maybeDefendMove 就 +1。
   为什么要它：两个应手请求**可能重叠**（旧的被新的掐断后还在等结果），
   而 defendBusy 是个共享的布尔 —— 旧的那次先回来、在 finally 里把它放掉，
   新的那次还在跑，标志却已经松了 → 又会被排一次应手，盘上可能多出一手。
   所以只有"最新那一次"负责放开（见 finally）。 */
let defendToken = 0;
/* 「正解这一手落不下去」的**局面代**（打劫/自填眼之类，极罕见）。
   记下当时的 defendSeq，同一局面就不再试正解、直接交给 KATAGO；
   任何局面重置都会 +1 局面代 → 这个记号自动失效（不会一直卡住）。 */
let solutionFailSeq = -1;
/* 「按正解」这一档退回 KATAGO 的**次数**（诊断用，只增不减）。
   为什么不靠 defendTrace：那个数组只留最近 14 条，一次应手就能把几条挤出去 ——
   测试按"切片"去查会被挤出窗口，产生假红（2026-10-17 实测踩到）。 */
let solutionFallbacks = 0;
/* KATAGO 应手的诊断轨迹（最近 14 条）。**必须留得住**：应手这条链路有
   "请求被掐断 / 重试 / 作废 / 引擎没给点"多种正常路径，出问题时只看最后一句 note
   根本判断不出卡在哪一步 —— 上一次就是这么查了半天的（当时把失败吞在空 catch 里）。 */
let defendTrace = [];
function dlog(s) {
  defendTrace.push(s);
  if (defendTrace.length > 14) defendTrace.shift();
}

/* ★★ 对手「按正解」（2026-10-17）：照题集自带的主变化应一手。
   为什么需要它：KATAGO 再强也不是"会做死活题的人" —— 死活题的胜率几乎是常数，
   它没有"必须应"的动机（实测：整框约束下 25~33% 的首选落在 4~6 路外；就算把搜索
   收到 2 路内，"与正解一致"也只有 42%）。正解是**题目的答案**，照它应才真正贴题。

   规则（刻意保守）：
     · 你前面每一手都和正解一样 → 对手走正解的第 n 手（n = 已经走了几手）；
     · 你有任何一手和正解不一样 → 这道题后面不再用正解，整段交给 KATAGO
       （否则会出现"你走错了、它却还按正解往下摆"的假象）；
     · 没有正解 / 正解走完了 / 这一手在框外 / 颜色对不上 → 返回 null（交给 KATAGO）。
   ⚠️ 只读 `p.answer`（主变化），不读变体树 —— 等价变化会被当成"走偏"，退回 KATAGO
      处理，属于可接受的降级（不会乱走）。 */
function solutionReply() {
  const p = tsSetProblem();
  const t = state.tsumego;
  if (!t || !p) return null;
  if (solutionFailSeq === defendSeq) return null;      // 这一手刚刚落不下去 → 本局面不再试正解
  /* ★ 2026-10-17：改用**整棵变化树**（p.tree）而不是主变化数组（p.answer）。
     差别就在"多条正确分支"：只读主变化时，第二条正解会被当成走偏 → 退回引擎；
     现在只要用户这一手在树上，就顺着这一支往下应。 */
  let cur = p.tree;
  if (!cur) return null;                               // 老数据 / 没有树
  for (let i = 0; i < state.moves.length; i++) {
    const m = state.moves[i];
    let next = null;
    for (const c of cur.children) {
      if (!c.move) continue;
      if (!!c.move.pass !== !!m.pass) continue;
      if (!m.pass && (c.move.x !== m.x || c.move.y !== m.y)) continue;
      next = c; break;
    }
    if (!next) return null;                            // 有一手不在树上 → 走偏
    cur = next;
  }
  /* 对手这一手 = 当前节点的**第一个**孩子（主变体优先；同一节点多分支时，其余是别的选择） */
  let nx = null;
  for (const c of cur.children) if (c.move) { nx = c.move; break; }
  if (!nx) return null;                                // 正解走完了
  /* 颜色必须真是"轮到的那一方"（SGF 的 PL 偶尔和首手颜色不一致，别硬来） */
  if (nx.color !== state.toMove) return null;
  /* 这一点得真空着（正解手顺与摆子对不上时会发生，比如题集被人改过摆子） */
  if (!nx.pass && boardAt(state.moves.length)[idx(nx.x, nx.y)]) return null;
  const fr = frameRect();
  if (fr && !nx.pass && (nx.x < fr.x0 || nx.x > fr.x1 || nx.y < fr.y0 || nx.y > fr.y1)) return null;
  return nx;
}

/* 「这个局面还需要 KATAGO 应手吗」——**不含 defendBusy 判断**。
   ⚠️ 为什么要拆出来：重试前要问的就是这句话，而那一刻 defendBusy 一定是 true
      （正是我自己占着的），直接用 needDefendMove() 会永远得到 false →
      **那个"最多试 3 次"的重试循环从来没重试过**（2026-10-14 查出来的死代码）。 */
function stillNeedDefend() {
  const t = state.tsumego;
  if (!(settings.mode === 'tsumego' && !!t && t.phase === 'solve')) return false;
  /* ★ 2026-10-17：「按正解」与「KATAGO」都要**对手**应手，只有「我下两边」不用。
     所以这里判 !== 'both'，不再只认 'ai'。 */
  if (t.defend === 'both') return false;
  if (t.showAnswer) return false;          // ★ 正在展示参考答案 → 不许接在答案后面继续走
  if (state.noGame || state.result) return false;
  if (state.viewAt !== state.moves.length || isMyTurn()) return false;
  /* ★★ 「按正解」这一档**不依赖引擎**（2026-10-17）：正解就写在题集里，引擎没就绪
     也照样能练（以前这条链一律要求 engineReady）。只有走偏 / 没正解时才会真的用到引擎。
     KATAGO 那一档照旧：引擎没就绪就不排应手。 */
  if (t.defend === 'solution' && solutionReply()) return true;
  return engineReady;
}

function needDefendMove() {
  return stillNeedDefend() && !defendBusy;
}

function scheduleDefendMove(delay) {
  clearTimeout(defendTimer);
  defendTimer = setTimeout(maybeDefendMove, delay === undefined ? 200 : delay);
}

async function maybeDefendMove() {
  /* ★ 上一次应手还在飞（占着标志）→ **再排一次**，不能静默丢掉（2026-10-14 实测的坑）。
     为什么必须这样：这个定时器是"需要 KATAGO 应手"这件事的**唯一入口**
     （落子 / 切角色 / syncUI 都只调 scheduleDefendMove）——在这里 return，
     就再也没人叫它了。症状是："轮到 KATAGO，它却一直不动"，
     而 defendNote 还停在上一句（比如"局面已变，这手作废"），看着完全像另一个问题。
     实测就是这么踩的：旧的应手请求还挂着，新的需求被丢掉 → 卡住。
     重排是零成本的（scheduleDefendMove 自带 clearTimeout 去抖）。 */
  if (defendBusy) { dlog('占着标志 → 稍后再排'); scheduleDefendMove(300); return; }
  if (!needDefendMove()) return;
  const t = state.tsumego;

  /* ★★ 对手 = 按正解 → 照正解应一手，**不叫引擎**（2026-10-17）。
     这一条比引擎快、且一手不脱先；你走偏了 / 没有正解（手摆的题）→ solutionReply()
     返回 null，于是继续走下面那条引擎路径 —— 等于**自动退回 KATAGO**。 */
  if (t.defend === 'solution') {
    const nx = solutionReply();
    if (nx) {
      const myTok2 = ++defendToken;
      const mySeq2 = defendSeq;
      const myLen2 = state.moves.length;
      defendBusy = true;
      state.thinking = true;
      draw();
      await new Promise(r => setTimeout(r, 260));   // 稍等一拍，别像凭空蹦出来
      try {
        if (defendToken !== myTok2) return;
        if (defendSeq !== mySeq2 || state.moves.length !== myLen2) {
          t.defendNote = '局面已变，这手作废';
          dlog('正解作废：代 ' + mySeq2 + '→' + defendSeq + ' 手数 ' + myLen2 + '→' + state.moves.length);
          return;
        }
        if (!stillNeedDefend()) return;
        if (nx.pass) {
          t.defendNote = '按正解 · 停一手';
          state.moves.push({ color: state.toMove, pass: true });
          state.toMove = state.toMove === 'b' ? 'w' : 'b';
          state.viewAt = state.moves.length;
          return;
        }
        t.defendNote = '按正解 · ' + toGTP(nx.x, nx.y);
        dlog('正解落子 ' + t.defendNote);
        const okSol = tryPlay(nx.x, nx.y, true);
        /* 极罕见：正解这一手在这个局面里落不下去（打劫/自填眼…）。
           别一声不吭地卡住 —— 记下局面代（本局面不再试正解），并立刻改排一次引擎应手。 */
        if (!okSol) {
          solutionFailSeq = defendSeq;
          t.defendNote = '正解这一手落不下去 → 改用 KATAGO';
          dlog('正解落子被拒');
          scheduleDefendMove(60);
        }
      } finally {
        if (defendToken === myTok2) {
          defendBusy = false;
          state.thinking = false;
          syncTsumegoUI();
          draw();
          /* 和引擎那条路径一样补排一次分析（理由见下面 finally 那段注释） */
          if (tsOn() && tsPhase() === 'solve' && !needDefendMove()) scheduleAnalysis(150, true);
        }
      }
      return;
    }
    t.defendNote = '没有正解可依（走偏了 / 手摆的题）→ 改用 KATAGO';
    solutionFallbacks += 1;
    dlog('正解缺位 → 交给引擎');
  }

  const myTok = ++defendToken;
  const mySeq = defendSeq;          // ★ 记下"我是替哪个局面算的"
  defendBusy = true;
  state.thinking = true;
  draw();
  dlog('起：手数' + state.moves.length + ' 代' + mySeq);
  try {
    /* 最多试 3 次。为什么要重试：引擎**一次只算一个请求**，
       别的请求（比如刚触发的那次分析）可能正好把它掐掉 —— 那不是错，重发一次就好。
       ⚠️ 这里**不能静默失败**：第一版把失败吞在一个空 catch 里，
          端到端测试只看到「AI 一声不吭」，查不出为什么。所以把原因记进 t.defendNote，
          界面和测试都读得到。 */
    for (let tryN = 0; tryN < 3; tryN++) {
      /* ★ 发请求前记下局面的"指纹"：手数 + 看的是第几手。
         回来时对不上 → 这一手属于已经不存在了的局面，整手丢弃（见 defendSeq 的注释）。 */
      const mySeqNow = defendSeq;
      const myLen = state.moves.length;
      const req = Object.assign({
        initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
        moves: state.moves.map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
        rules: (RULES[settings.rules] || RULES.chinese).kata,
        komi: settings.komi,
        size: N,
        maxVisits: Math.max(200, settings.visits),
      }, tsAnalyzeExtras());

      const res = await window.api.analyze(req);
      dlog('回应：ok=' + (res && !res.error && !res.cancelled)
        + ' cancelled=' + !!(res && res.cancelled) + ' err=' + ((res && res.error) || '—'));
      /* 局面被重置过 / 手数变了（重来、重摆、悔棋）→ 丢弃，什么都不落 */
      if (defendSeq !== mySeqNow || defendSeq !== mySeq || state.moves.length !== myLen) {
        t.defendNote = '局面已变，这手作废';
        dlog('作废：代 ' + mySeq + '→' + defendSeq + ' 手数 ' + myLen + '→' + state.moves.length);
        return;
      }
      if (res && !res.error && !res.cancelled) {
        /* ★ 兜底：万一引擎给的应手落在框外，就当它没给（2026-10-12）。
           正常情况不会发生 —— 请求里带了 allowMoves，引擎只会在框内找点（实测过：
           PV 都留在框内、连 pass 都不给）。但 allowMoves 是引擎侧的约定，
           客户端不核实的话，一旦哪天它失效，画面就会"AI 跑到框外应一手"，
           而且这时 tryPlay 的人也挡在框内 —— 看起来像 bug 但不报错。
           这里过滤一遍，取**框内的第一个候选**；框内一个都没有才认输。 */
        const fr = frameRect();
        let infos = res.moves || [];
        if (fr) {
          const inside = infos.filter(m => {
            const s = String(m.move || '');
            if (!s || s.toLowerCase() === 'pass') return true;   // 停一手照收
            const p = fromGTP(s);
            return !!p && p.x >= fr.x0 && p.x <= fr.x1 && p.y >= fr.y0 && p.y <= fr.y1;
          });
          if (!inside.length) { t.defendNote = '引擎给的应手全在框外（已丢弃）'; return; }
          infos = inside;
        }
        /* ★ 方案 3（兜底，2026-10-17）：候选里只留贴题的（离棋子 ≤ TS_BAND 路）。
           正常是空操作（请求里的 allowMoves 已经把搜索限在带内）；万一 allowMoves 失效、
           或者带太窄退回整框，这一层挡住"引擎跑到远处大场"。一个不剩就保留原列表。 */
        const localMoves = filterLocalMoves(infos, TS_BAND);
        if (localMoves.length) infos = localMoves;
        const top = infos.find(m => m.order === 0) || infos[0];
        if (!top) { t.defendNote = '引擎没给候选点'; return; }
        const mv = String(top.move || '');
        if (!mv || mv.toLowerCase() === 'pass') {
          t.defendNote = '对方停一手';
          state.moves.push({ color: state.toMove, pass: true });
          state.toMove = state.toMove === 'b' ? 'w' : 'b';
          state.viewAt = state.moves.length;
          return;
        }
        const pt = fromGTP(mv);
        if (!pt) { t.defendNote = '应手坐标读不出来：' + mv; return; }
        t.defendNote = '应了 ' + mv;
        dlog('落子 ' + mv);
        tryPlay(pt.x, pt.y, true);
        return;
      }
      t.defendNote = (res && res.error) ? res.error : '被掐断，重试中';
      /* 重试之前再看一眼：这期间局面变了（用户悔棋 / 又落了一手）就不用再应了。
         ⚠️ 用 stillNeedDefend()，**不能用 needDefendMove()**（见那边的注释）。 */
      if (!stillNeedDefend()) { dlog('退出重试：局面不需要应手了（第 ' + tryN + ' 次）'); return; }
      dlog('重试第 ' + (tryN + 1) + ' 次');
      await new Promise(r => setTimeout(r, 350));
    }
  } catch (e) {
    t.defendNote = '异常：' + ((e && e.message) || e);
    dlog('异常：' + ((e && e.message) || e));
  } finally {
    /* ⚠️ 只有**最新**那一次负责放开标志（见 defendToken 的注释） */
    if (defendToken === myTok) {
      defendBusy = false;
      state.thinking = false;
      syncTsumegoUI();
      draw();
      /* ★ 应手结束后补排一次分析（2026-10-12）。
         为什么要补：`runAnalysis` 在门口就有"轮到 KATAGO 就让路"的守卫 ——
         应手期间它直接 return，**不会**自己再排下一次。正常流程里 KATAGO 落子后
         syncUI 会把分析接着排起来；但当这一手被上面的校验丢弃时（局面已重置）
         就没人接手了 → 表现是"重来之后推荐点一直是空的"。
         补这一下是零成本的（scheduleAnalysis 自带去抖），换来这条路径能自愈。 */
      if (tsOn() && tsPhase() === 'solve' && !needDefendMove()) scheduleAnalysis(150, true);
    }
  }
}

/* ---------- 练习卡上的「题集」行（唯一出口，和 syncTsumegoUI 一起调） ---------- */
function syncPsetUI() {
  const s = tsSet();
  const btn = $('btn-pset');
  if (btn) {
    const nm = s ? s.name.replace(/\.sgf$/i, '') : '未打开';
    btn.textContent = nm;                       // 长了由 CSS 截断（title 里有全名）
    btn.classList.toggle('has-set', !!s);
    btn.title = s
      ? '当前题集：' + nm + '（共 ' + s.list.length + ' 题）—— 点这里可以换一份、导入新的、改名 / 删除'
      : '还没有打开题集 —— 点这里导入一份 SGF 题集（或打开已存的）';
  }
  const pos = $('pset-pos');
  if (pos) {
    pos.textContent = (s && s.list.length) ? (s.idx + 1) + '/' + s.list.length : '—';
    pos.title = s ? ('第 ' + (s.idx + 1) + ' 题 / 共 ' + s.list.length + ' 题') : '还没打开题集';
  }
  const prev = $('btn-ts-prev'), next = $('btn-ts-next');
  if (prev) prev.disabled = !s || !s.list.length || s.idx <= 0;
  if (next) next.disabled = !s || !s.list.length || s.idx >= s.list.length - 1;
}

/* ---------- 习题题集面板（导入 / 打开 / 改名 / 删除） ----------
   结构照抄棋谱库那个弹窗，不另发明一套。
   ★ 题数（一份题集里有几道题）在这里现算 —— 读一遍文件、数顶层树。
     为什么不由主进程给：**"怎么把 SGF 切成一道道的题"只允许有一处实现**
     （parseProblemSet/splitSgfGames）。两处各写一遍，迟早分叉。
     题集一般只有几份，全读一遍也就几十 KB~几 MB，够便宜。 */
async function refreshPuzzles() {
  const ul = $('puzlist');
  if (!ul) return;
  const all = (await window.api.puzzles.list()) || [];
  ul.textContent = '';
  const cnt = $('puz-count');
  if (cnt) cnt.textContent = all.length ? '共 ' + all.length + ' 份' : '';
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有题集 —— 点下面的「导入题集…」挑一份 SGF（一份里可以有好几百道题）';
    ul.appendChild(li);
    return;
  }
  for (const it of all) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'rec-info';
    const nm = document.createElement('span');
    nm.className = 'rec-name';
    nm.textContent = it.name.replace(/\.sgf$/i, '');
    nm.title = it.name;
    info.appendChild(nm);
    const meta = document.createElement('span');
    meta.className = 'rec-meta';
    meta.textContent = Math.max(1, Math.round(it.size / 1024)) + ' KB · ' + fmtRecTime(it.mtime);
    li.append(info, meta);

    /* 题数：读一遍文件数顶层树。读不出来（文件被删/没权限）就标一下，不静默。 */
    let games = 0, readErr = '';
    try {
      const r = await window.api.puzzles.read(it.name);
      if (r && r.text) games = splitSgfGames(r.text).length;
      else readErr = (r && r.error) || '读不出来';
    } catch (e) { readErr = String((e && e.message) || e); }
    meta.textContent = (readErr ? '（' + readErr + '）' : games + ' 题')
      + ' · ' + Math.max(1, Math.round(it.size / 1024)) + ' KB · ' + fmtRecTime(it.mtime);

    const isCur = !!(tsSet() && tsSet().name === it.name);
    const mk = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      if (cls) b.classList.add(cls);
      return b;
    };
    const openBtn = mk(isCur ? '正在练' : '打开',
      isCur ? '这道题集正在练 —— 点一下回到它（不动当前进度）'
        : '打开这份题集（接着上次练到的那一题，可以用 ‹ › 翻题）',
      async () => {
        PUZ_MASK.classList.remove('open');
        await openPuzzleSet(it.name);
      });
    if (isCur) openBtn.classList.add('primary');
    li.append(openBtn,
      mk('改名', '给题集换个名字（只改文件名）', () => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = it.name.replace(/\.sgf$/i, '');
        inp.placeholder = '题集名字…';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const no = document.createElement('button');
        no.textContent = '取消';
        const commit = async () => {
          const nv = (inp.value || '').trim();
          if (!nv) { refreshPuzzles(); return; }
          const r = await window.api.puzzles.rename(it.name, nv);
          if (r && r.error) flash('改名失败：' + r.error);
          else {
            flash('题集已改名为「' + String((r && r.name) || nv).replace(/\.sgf$/i, '') + '」');
            /* 进度是**按名字**记的 → 改名了得把那条记录跟着搬，否则下次打开会从第 1 题开始 */
            if (r && r.name) psetProgRename(it.name, r.name);
            /* 正在练的就是这份 → 把内存里那份的名字也跟着改（否则卡片上还是老名字） */
            if (tsSet() && tsSet().name === it.name && r && r.name) {
              tsSet().name = r.name;
              if (state.tsumego) state.tsumego.source = r.name + ' · 第 ' + (tsSet().idx + 1) + ' 题';
              syncTsumegoUI();
            }
          }
          refreshPuzzles();
        };
        ok.onclick = commit;
        no.onclick = () => refreshPuzzles();
        inp.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') refreshPuzzles();
        };
        li.textContent = '';
        li.append(inp, ok, no);
        inp.focus(); inp.select();
      }),
      /* 删除：和棋谱库同一套（就地变「确认删除？」，3 秒后自动还原；进系统回收站） */
      mk('删除', '移到系统回收站（可以恢复）', function () {
        if (this.dataset.armed !== '1') {
          this.dataset.armed = '1';
          this.textContent = '确认删除？';
          setTimeout(() => { if (this.isConnected) { this.dataset.armed = ''; this.textContent = '删除'; } }, 3000);
          return;
        }
        window.api.puzzles.remove(it.name).then(r => {
          if (r && r.error) flash('删除失败：' + r.error);
          else {
            flash('已删除题集「' + it.name.replace(/\.sgf$/i, '') + '」（在系统回收站里）');
            /* 进度也一起清掉（题集没了，留着那条记录只会在回收站恢复后又"悄悄生效"） */
            psetProgDrop(it.name);
            /* 正在练的就是这份 → 把题集清掉（盘上那题留着，别让人看着名字还在） */
            if (tsSet() && tsSet().name === it.name) {
              state.tsumegoSet = null;
              syncTsumegoUI();
            }
          }
          refreshPuzzles();
        });
      }));
    /* ★★ 这一行是必须的 —— 我第一版**漏了它**：li 造好了、按钮也挂上了，
       但从来没挂到 ul 上。症状是"面板打开、列表全空、**不报任何错**"，
       查了四轮诊断才看出来（复刻一遍函数体就能发现：循环跑完了、children 还是 0）。
       教训：这种"内容造好了但没上屏"的漏挂，静态检查和测试的**空断言**都抓不住，
       所以下面每条 UI 断言都要求"看到具体的东西"（列表里有名字 / 有题数）才算过。 */
    ul.appendChild(li);
  }
}

function openPuzzles() {
  PUZ_MASK.classList.add('open');
  refreshPuzzles();
  window.api.puzzles.dir().then(d => { const el = $('puz-dir'); if (el) el.textContent = d || ''; });
}

/* ---------- 练习卡的界面同步（唯一入口，避免各处漏改） ---------- */
function syncTsumegoUI() {
  const card = $('ts-card');
  if (!card) return;
  const on = tsOn() && !!state.tsumego;
  card.hidden = !on;
  /* 框架 / 框距的显示（只是把 settings 的值画到控件上；改值走 syncFrameUI/applyFrameChange）。
     放在 on 判断**之前**：卡片藏起来时也把显示拉齐，下次一露面就是对的。 */
  syncFrameUI();
  /* 先手（黑先/白先）同理 —— 常驻行，也放在 on 之前拉齐。 */
  syncFirstUI();
  /* ★ 判定结论走**棋盘上方那条结果条**（见 renderVerdict）。它是卡片之外的元素，
     所以这一句放在 on 判断**之前** —— 卡片被藏起来时（切走模式）结果条也得跟着收掉。 */
  renderVerdict();
  if (!on) return;

  const t = state.tsumego;
  const setup = t.phase === 'setup';
  /* 卡上**不写**「摆题中 / 解题中」了（2026-10-14 用户要求：省掉这行）。
     阶段其实一眼看得出来 —— 摆题阶段是「开始解题 / 清空」，解题阶段是「重来 / 重摆 / 提示 / 判定」。
     真要判阶段，读 state.tsumego.phase（端到端测试就是这么断言的）。 */
  $('ts-setup-group').hidden = !setup;
  $('ts-solve-group').hidden = setup;

  /* ★★ 卡片高度**任何时刻不变**（2026-10-14 用户要求）—— 三条一起才成立：
     ① 常驻的行不随阶段/状态显隐：KATAGO 执哪方**置灰代替藏起来**；
     ② 每行 min-height 统一（.ts-row），"交替摆棋"藏掉颜色按钮后行高不变；
     ③ 卡上不再有会变长变短的文字。
     改动这三样里的任何一个，都要重跑 dev/_cdp_tsumego.mjs 的"卡片高度不随阶段变"断言。
     （2026-10-17：「目标 净杀」那一格随判定/提示一起删了 —— 常驻行现在只剩「先手」。） */

  /* KATAGO 执哪一方：显示值两个控件（面板 + 练习卡）一起拉齐，说明文字也跟着。 */
  syncTkaicolorUI();
  /* ★ 只有「我下两边」时 KATAGO 执谁没意义（2026-10-17：原来判 === 'ai'，
     「按正解」那一档接手后也得跟着改，否则 KATAGO 那行会被无端置灰）。 */
  setTkaicolorEnabled(t.defend !== 'both');
  /* 「按正解」这一档：没有正解时置灰（手摆的题 / 题集里没写主变化） */
  const solBtn = $('seg-tsdefend') && $('seg-tsdefend').querySelector('button[data-v="solution"]');
  if (solBtn) {
    const pb = tsSetProblem();
    const hasAns = !!(pb && pb.answer && pb.answer.length >= 2);
    solBtn.disabled = !hasAns;
    solBtn.title = hasAns
      ? '对手照题集自带的正解应对（共 ' + pb.answer.length + ' 手）：一手不脱先；你走偏了会自动改用 KATAGO'
      : '这道题没有正解（手摆的题 / 题集里没写主变化）→ 这一档实际会把对手交给 KATAGO';
  }
  /* 题集行（常驻）：题集名 / 第几题 / ‹ › 能不能按 */
  syncPsetUI();

  /* ★ 「正解」按钮的状态**两个阶段都拉齐**（2026-10-14 实测踩到）。
     原来这段只写在解题分支里 → 摆题阶段按钮留着上一次的状态（可能还是可点的），
     点下去**既不提示也不报错**（disabled 的按钮点击直接无效），
     而判据只看到"手数没变"，于是**判据假绿**。
     它虽然在摆题阶段藏在解题组里、肉眼看不见，但"看不见的状态"更该拉齐 ——
     不然读它的人和测试拿到的都是旧值。 */
  syncAnswerBtn();

  if (setup) {
    const alt = settings.tmode === 'alt';
    setSeg('seg-tscolor', t.placeTool);
    $('seg-tscolor').hidden = alt;        // 交替摆棋不需要选颜色
    /* ★ 交替摆棋时黑/白按钮是藏起来的 —— 那"下一子轮到谁"就只剩这一处能说。
       所以它不做成说明段落，而是挤在「落子」这一行的行内小字（不占额外高度）。 */
    const altTxt = $('ts-alt-next');
    altTxt.hidden = !alt;
    if (alt) altTxt.textContent = '下一子 ' + (t.nextColor === 'b' ? '黑' : '白');
  } else {
    setSeg('seg-tsdefend', t.defend);
  }
}

/* 「正解」按钮的可用状态 + 高亮 + 悬停说明。
   ★ 单独一个出口、由 syncTsumegoUI **两个阶段都调**（原因见那里的注释）。 */
function syncAnswerBtn() {
  const ab = $('btn-ts-answer');
  if (!ab) return;
  const t = state.tsumego;
  const p = tsSetProblem();
  const has = !!(p && p.answer.length);
  ab.disabled = !has;
  ab.classList.toggle('on', !!(t && t.showAnswer));
  ab.title = !has
    ? '手摆的题没有参考答案 —— 正解来自导入的 SGF 题集'
    : (t && t.showAnswer
      ? '收起参考答案（回到初始局面）'
      : '参考答案：把这道题的正解顺序摆出来（' + p.answer.length + ' 手）。再按一次收起；摆出来之后用 ← → 可以逐步回看。');
}

/* KATAGO 执黑/执白的两个按钮：**「我下两边」时置灰，而不是把整行藏起来**（2026-10-14）。
   为什么改：藏起来会让练习卡高度跳一下（用户要求"任何时刻不变"）。
   置灰表达的是同一件事（KATAGO 不上场、这一项此刻无效），而且位置一直留着、不会让人找不着。 */
function setTkaicolorEnabled(on) {
  const seg = $('seg-tsaicolor');
  if (!seg) return;
  for (const b of seg.querySelectorAll('button')) b.disabled = !on;
  seg.title = on
    ? 'KATAGO 执黑还是执白。默认它执「先手」的对方 —— 也就是你来解题（黑先的题你走黑）。想练防守（让它先动手、你来守），就把它改成先手那一方。'
    : '「我下两边」时 KATAGO 不上场，这一项暂时无效（切回「应对 = KATAGO」就能改）。';
}

/* ---------------- 引擎分析 ---------------- */

/*单次分析的目标搜索量。
   ★ 2026-10-04 从 1600 降到 500 —— 这是「推荐点要实时出现」的关键。
     问题不在我们的显示逻辑，而在**引擎一次只能算一个请求**：
     旧局面的分析要跑满 1600 visits（约 2~3 秒）才轮到新局面，
     所以落子后推荐点要等 3 秒多才更新（实测 3275ms / 3156ms 两次）。
     中途报告机制本来是好的（引擎每 0.25 秒推一次），但被这个时长拖住了。
     实测对比（三个局面各跑 3 次，见 _diag_visits.js）：
       500 visits：0.4 秒，布局/中盘的首选点与前 4 候选**和 1600 完全一致**；
                  只有复杂中盘的首选点会在两三个好点之间跳（前 4 候选集合仍相同）
       1600 visits：0.7 秒，胜率波动更小（0.2% vs 0.7%）
     → 慢一倍换来的精度提升很小，而响应速度是**能直接感觉到的**，所以选 500。
   ★ 2026-10-04 后续：用户要求「做成可调」，所以这个常量只当**默认值**用，
     实际取值在 settings.visits（「新对局」面板 → 计算深度，见 VISIT_OPTS）。 */
const ANALYZE_VISITS = 500;
/* 搜索量低于此值时先不显示候选点。
   ★ 2026-10-04 从 150 降到 20 —— 用户对照 KaTrain 指出：
     「计算中不是棋盘上啥都不显示，而是会显示推荐选点，选点圈里还显示搜索次数，
       就算搜的不多，也先在棋盘上显示出来」。
     我们本来也是边搜边刷的（引擎每 0.25 秒推一次中途报告 → applyAnalysis），
     但 150 这道门槛把开头 1~2 秒整个挡住了 → 棋盘空白。
     降到 20 后，落子约 0.1 秒就有第一批点可画，观感变成「实时出现、数字往上走」。
     只保留一个极低门槛，是为了滤掉 visits=0/1 那种纯噪声（点的排序会乱跳）。 */
const HINT_MIN_VISITS = 20;

/* 渲染端等一次分析请求回来最多等多久（毫秒）——见 runAnalysisOnce 里的 Promise.race。
   取值理由：
     · 正常一次分析 0.4~1.5 秒（500 visits，实测中位 472ms）；
     · 引擎切到一个全新局面重建搜索树最慢约 1~3 秒；
     · 就算「计算深度」调到最大档（用户能选到的上限）也远在 25 秒内。
   25 秒是「不可能有这么慢的正常请求」的界线 —— 超过它就不是慢，是那条路断了。
   ⚠️ 别调太小：调成 5 秒会在深档位下把正常请求误判成超时，反而让分析一直在重排。 */
const ANALYZE_TIMEOUT_MS = 25000;

/* ★ 分析链路的轻量埋点（2026-10-07 新增）。
   为什么要它：用户报「AI 落子后马上悔棋，选点/形势有时卡住不显示」，
   但标准时序在测试环境里跑十轮都不卡 —— 说明是**竞态**，光看界面复现不了。
   有这组计数就能在卡住的那一刻回答"它到底卡在哪一步"：
     start    = 进入一轮分析循环
     okCount  = 这一轮里成功算完几次局面
     failEarly= runAnalysis 开头的提前 return（分别是 scoreBusy / reviewBusy / 引擎没就绪 / busy）
     failOnce = runAnalysisOnce 返回 false（出错 / 被取消 / 超时）
     breakAt  = 循环为什么退出（guard 用尽 / 换局 / 数子 / 复盘 / 引擎掉了 / 算失败）
     skipHuge = 队列里那些「at 已经大于手数」被跳过的次数
   只读写几个数字，不改任何行为（Ctrl+Shift+D 会把它打出来）。 */
const anaDiag = {
  start: 0, okCount: 0, failEarly: { score: 0, review: 0, notReady: 0, busy: 0 },
  failOnce: 0, breakAt: {}, skipHuge: 0, lastFailWhy: '', lastAt: 0,
  note(why) { this.breakAt[why] = (this.breakAt[why] || 0) + 1; this.lastFailWhy = why; this.lastAt = Date.now(); },
};

/* ★ 分析链路曾经有过一个"把关键决定写进文件"的日志（v0.1.17 加的），
   用来定位「推荐点偶尔不出来」那个偶发问题 —— **问题解决后就撤掉了**（v0.1.18）。
   撤掉的理由（用户提的）：它太占地方 —— 实测玩 20 秒就写 63.8 KB，约 11 MB/小时，
   而且是**同步写盘**（每次 appendFileSync 都阻塞主进程）。
   本软件要尽量轻，不做"像手机 APP 那样一直产生垃圾文件"的事。

   ⚠️ 以后万一再需要它：别恢复成"常开写文件"，改成
     · 只在用户按 Ctrl+Shift+D 时**把它打到状态栏**（那已经是现成的自检），或者
     · 加个显式开关，默认关。
   下面是保留的空函数（调用点先留着，方便将来一行切换；不发 IPC、不写盘，零成本）。 */
function alog(msg) { /* 已撤：见上面的说明 */ }

/* 连续超时计数（成功一次就归零）。超时后要主动重排一次，但不能无限重排 ——
   引擎真挂了的时候，无限重排会变成每 25 秒一次的无效空转，日志和界面都在刷。 */
let anaTimeouts = 0;
/* 「anaBusy 是什么时候置上的」——给顶栏那个「刷新」按钮判断"是真卡了还是正在算"。
   置上时间超过 REFRESH_STUCK_MS 就一定不是正常请求（正常一次 0.4~1.5 秒）。 */
let anaBusySince = 0;
const REFRESH_STUCK_MS = 12000;

const toGTP = (x, y) => GTP_COLS[x] + (N - y);

function fromGTP(s) {
  const m = /^([A-Ta-t])(\d{1,2})$/.exec(String(s).trim());
  if (!m) return null;
  const x = GTP_COLS.indexOf(m[1].toUpperCase());
  if (x < 0 || x >= N) return null;
  const y = N - parseInt(m[2], 10);
  if (y < 0 || y >= N) return null;
  return { x, y };
}

/* 第 n 手之后轮谁走。
   判据平常是「有没有摆子」—— 让子局 / 明清座子局都是白先（让子本身就是补偿）。
   ★★ 但**习题练习不能用这个判据**（2026-10-12 端到端测试抓到的真 bug）：
     题的初局也是用 initialStones 摆出来的（state.setup 非空），
     可"这道题该谁先走"是用户明确设的 settings.tfirst，跟摆了几颗子毫无关系。
     照旧判据走的话，**黑先的题会被算成白先** → isMyTurn() 为假 →
     连自己的落子都会被"只能下自己那方"那条守卫挡掉（实测就是这个连锁）。
     → 习题模式下先手一律取 settings.tfirst。 */
function sideToMove(n) {
  const first = tsOn()
    ? (settings.tfirst === 'w' ? 'w' : 'b')
    : (state.setup.length ? 'w' : 'b');
  return (n % 2 === 0) ? first : (first === 'b' ? 'w' : 'b');
}

let engineReady = false;       // 分析引擎（strong 权重）：胜率 / 候选点 / 走势曲线
let engineReadyPlay = false;   // 对弈引擎（human 权重）：AI 落子 + 真实段位档位
let coachReady = false;        // ★ LoGos 讲解模型（2026-10-05 新增）
let engineNote = '';
let coachNote = '';            // ★ 讲解模型自己的错误（它坏了不该算「引擎异常」——不装也能下棋）
/* ★ 三个引擎各自的原始状态：'off' 未加载 / 'loading' / 'ready' / 'paused' / 'error'
   顶栏那两个状态灯直接照它画。
   为什么单独存一份：引擎从「开机自动加载」改成「手动加载」了 ——
   「未加载」是**正常状态**、不是故障，界面必须能区分「没加载」和「挂了」。 */
let engStates = { analyze: 'off', play: 'off', coach: 'off' };
/* 在「设置」里改完路径 → 引擎正在按新配置重启（状态栏常驻提示，就绪后自动清掉）。
   ⚠️ 必须在 syncUI 之前声明：syncUI 会读它，而 syncUI 在启动时就会被调用（TDZ 会炸）。 */
let engineReloading = false;
let anaTimer = null;
/* 屏幕上这批结果（胜率条 / 候选点 / 形势雾）是「第几手之后」的局面算出来的。
   -1 = 还没有。与 state.viewAt 不等 → 说明当前看的这个局面还没分析上屏。 */
let shownAt = -1;

/* 待补算的手数队列（只为补 history —— 胜率走势曲线与手数列表的「涨跌」都靠它）。
   ★★ 为什么必须有这个队列（2026-10-04 用户报「手数列表里胜率涨跌有时候不显示，
      还得我点一下才有；是不是还没来得及分析完就下一手了」——正是如此）：
      旧逻辑是「只算当前局面 + 200ms 防抖」，而**防抖会把还没轮到算的那个局面直接丢掉**：
      人机对弈时用户落子后轮到 AI，AI（human 模型、400 visits）经常在 200ms 内就回了手，
      下一个 syncUI 的 clearTimeout 一来，就把「用户刚下那一手之后的局面」的定时器清掉 ——
      那个局面从此再没有任何一次分析 → history[n] 缺一格 → 第 n 手的涨跌永远算不出来。
      用户「点一下那一手」（gotoView → 重新分析）才把它补上，现象完全对得上。
   改法：入队在**防抖之前**（只要这个局面还没算过就先记下来），当前局面算完再按顺序补上，
   一个都不漏 —— 也就是用户要的「分析引擎独立于当前手数，到了下几手也要把前面的算好」。 */
let anaQueue = [];
let anaForceCur = false;   // 当前局面是否要强制重算（改了计算深度 / 数子之后刷新画面）

/* 补账队列的长度上限（2026-10-06 晚新增）。
   为什么要限：补账和历史曲线用的是**同一个引擎**（选点优先，见 runAnalysis 的循环顺序），
   队列无限长的话，用户连点几十手之后引擎会长时间忙于补旧账 ——
   实测**不会**拖慢选点（选点永远排在前面，且新请求会掐掉正在跑的补账：
   有欠账时选点延迟中位 377ms，无欠账 470ms，见 _cdp_priority.mjs），
   但曲线要很久才补齐、而且引擎没有空闲。
   取 40：正常一局连点几十手也补得完；真到 40 以上说明用户在极快地连点，
   那种节奏下"最近 40 手的涨跌还准"就够了，更早的等下一次落子慢慢补。 */
const ANA_QUEUE_MAX = 40;

function scheduleAnalysis(delay, force) {
  /* ★ 未开局：**一次分析都不发**（用户要求「胜率条五五开不动」）。
     这是「不动」的根子 —— 数字由 syncUI 画成中性，而且没有请求来覆盖它。
     注意要放在入队**之前**：否则会在队列里留一条永远没人处理的欠账。 */
  if (state.noGame) { alog('schedule 未开局 → 不发'); return; }
  const at = state.viewAt;
  const why = [];
  if (force) { anaForceCur = true; why.push('force'); }
  /* 入队（去重）。试下（草稿）里的局面不记 —— 那些手等会儿会被整体丢掉，算了也是白算。 */
  const draftSkip = (state.draft && at > state.draft.from);
  if (draftSkip) why.push('草稿内跳过入队');
  else if (typeof state.history[at] === 'number') why.push('history已有→不入队');
  else if (anaQueue.indexOf(at) >= 0) why.push('队列已有');
  if (!draftSkip
    && typeof state.history[at] !== 'number'
    && anaQueue.indexOf(at) < 0) {
    anaQueue.push(at);
    /* ★ 超长就丢掉最旧的那几条（见 ANA_QUEUE_MAX）。丢的是「最久以前那一手」，
       它多半已经不在用户视线里；当前局面和最近几手永远留着。 */
    if (anaQueue.length > ANA_QUEUE_MAX) anaQueue.splice(0, anaQueue.length - ANA_QUEUE_MAX);
  }
  clearTimeout(anaTimer);
  /* ★ 这里**不要**加「取消正在跑的分析」。试过（2026-10-04）：
     取消确实能让旧请求停下（搜索量不再增长），但**总耗时不降**（1026ms vs 1032ms）——
     因为瓶颈是「引擎切换到一个新局面的第一批结果本身要约 0.8 秒」（要重建搜索树）。
     既然没有收益，就不留这个异步竞态（cancel 晚一步到主进程会误杀刚发出的新请求）。 */
  anaTimer = setTimeout(runAnalysis, delay === undefined ? 200 : delay);
  /* ★ 关键节点记一行：这一笔排了没有、为什么没排、当前各处状态。
     卡住之后回看这一段，就能知道"那一刻到底有没有人动手"。 */
  alog('schedule at=' + at + ' delay=' + (delay === undefined ? 200 : delay)
    + ' 入队=' + (why.some(w => w.indexOf('→') >= 0 || w === '队列已有') ? '否(' + why.join(',') + ')' : '是')
    + ' q=[' + anaQueue.join(',') + '] shownAt=' + shownAt + ' candAt=' + state.candAt
    + ' busy=' + anaBusy + ' force=' + anaForceCur + ' hist[' + at + ']=' + (typeof state.history[at] === 'number' ? '有' : '无'));
  /* ★ 顺手挂一次「卡住自愈」检查：只在「算过但没上屏」时才会真的排定时器 */
  scheduleStallRecovery();
}

/* 换了棋谱 / 开了新局 → 旧的欠账和「已上屏」标记全部作废 */
function resetAnalysisState() {
  anaQueue = [];
  shownAt = -1;
  clearTimeout(anaTimer);
  clearTimeout(anaStallTimer); anaStallTimer = null;
  anaStallWatched = -1; anaStallTries = 0;
  gameGen++;        // ★ 换局 / 换棋谱：作废在飞的那次分析（见 gameGen 的注释）
}

/* ★★ 自愈网：「算过但没上屏」的状态卡住时，自己再算一次（2026-10-07 新增）。
   治的是什么：`shownAt`（算过）与 `candAt`（真上屏了）**不一致**时，
   `runAnalysis` 会以为当前局面已算过而跳过它、`scheduleAnalysis` 又会因
   `history[at]` 有值而去重 —— 两头都不动手，那个局面就永远停在「计算中… N」上。
   （根因已在 `runAnalysisOnce` 修掉：只有 `applyAnalysis` 真上屏才记 shownAt。
     这里再兜一道，万一还有别的路径造成同样不一致，它能自己纠正，
     用户不用靠"再落一手"把它撞好。）

   为什么用**一次性定时器**而不是常驻轮询：只在"看起来卡了"的时候才排一次，
   自限、不空转。 */
let anaStallTimer = null;
let anaStallWatched = -1;       // 正在自愈哪个手数（-1 = 没有）
let anaStallTries = 0;          // 这一手已经自愈过几次
const ANA_STALL_MAX_TRIES = 20; // 上限（防死循环）；每次间隔 6 秒，20 次 ≈ 2 分钟
function scheduleStallRecovery() {
  const cur = state.viewAt;
  if (state.noGame || cur <= 0) return;
  if (state.viewAt !== state.moves.length) return;   // 回看历史时不算卡（那时本来不画选点）
  if (shownAt !== cur || state.candAt === cur) {
    /* 没卡（要么还没算、要么已上屏）→ 清掉这一手的计数，下次卡住能从头再来 */
    if (anaStallWatched === cur) { anaStallWatched = -1; anaStallTries = 0; }
    return;
  }
  if (anaStallWatched !== cur) { anaStallWatched = cur; anaStallTries = 0; }
  /* ★★ 反复尝试，不是"只试一次"（2026-10-07 踩的坑）。
     第一版写的是 `if (anaStallWatched === cur) return;` —— 想避免重复排定时器，
     结果**卡住之后这个值一直等于 cur**，于是之后每次 scheduleAnalysis 都在这里 return，
     自愈定时器**再也不会排**：第一次没救回来就永久卡住。
     用户实测就是这个现象（「过了很久也没修好，没用自己修」）。
     正解：卡住期间**每 6 秒重试一次**，直到好为止（有次数上限防死循环）。 */
  if (anaStallTries >= ANA_STALL_MAX_TRIES) return;
  if (anaStallTimer) return;                     // 已经有一个在等着了
  anaStallWatched = cur;
  anaStallTries++;
  anaStallTimer = setTimeout(() => {
    anaStallTimer = null;
    if (state.viewAt !== cur || state.candAt === cur) { anaStallWatched = -1; anaStallTries = 0; return; }   // 期间自己好了
    alog('★ 自愈第 ' + anaStallTries + ' 次：检测到「算过但没上屏」（shownAt=' + shownAt
      + ' candAt=' + state.candAt + ' viewAt=' + cur + '）→ 强制重算');
    console.warn('[分析] 自愈第 ' + anaStallTries + ' 次：重算第 ' + cur + ' 手');
    anaDiag.note('自愈：算过但没上屏');
    anaForceCur = true;
    scheduleAnalysis(0, true);
    /* ★★ 关键：**自己续排下一次**（2026-10-07 踩的坑）。
       不能指望用户再操作一次来触发 scheduleAnalysis —— 卡住的时候他往往正盯着屏幕等，
       **不会再点任何东西**，那样自愈就只试了一次、失败一次就再也不动。
       （第一版就是这么错的：写成"同一手数只排一次"，结果卡住后永远不再排。） */
    anaStallWatched = -1;          // 让下一次判断重新走一遍
    scheduleStallRecovery();       // 若仍然卡着，6 秒后再来一次
  }, 6000);
}

/* ★★ 悔棋 / 停一手 / 任何「局面变短」的操作之后必须调用（2026-10-06 实测定位）。
 *
 * 症状：悔棋后 KataGo 的分析**彻底停住**（搜索量不涨、胜率条不再更新）。
 * 实测数据（_cdp_undo.mjs）：落 10 手后悔棋 3 次 →
 *     moves=7，但队列 q=[5,6,7,8,9,10]（**8/9/10 已是��存在的局面**），
 *     history 的有效项数涨到 11（**比手数还多**），visits 恒定在 515 不动。
 *
 * 两个根因（缺一不可）：
 *   ① **队列没截断** —— 里面留着比当前手数大的 at。runAnalysisOnce(8) 会去算
 *      `state.moves.slice(0, 8)`，可moves 只有 7 —— 请求发出去算的是第 7 手，
 *      回来却按「第 8 手」写进 history（rememberEval(at) 用的是传入的 at）。
 *      结果：**脏数据灌进 history/leads**，而且这些永远算不完的欠账
 *      把 anaBusy 一直占着（busy 卡在 true）→ 真正的当前局面再也排不上队。
 *   ② **history / leads 没截断** —— 已撤销的那些手的走势数据留在数组里。
 *      走势曲线会画出不存在的「第 8、9、10 手」，点进手数列表也能看到幽灵数据。
 *
 * 只做① 不做 ② 的话，曲线仍然是错的；反过来 ① 会让分析继续卡死。
 */
function truncateAnalysisTo(len) {
  /* 队列里超过新手数的一律丢掉（它们代表的局面已经不存在了）。
     注意是「过滤」不是「清空」—— 当前局面那一项还要留着，它是对的。 */
  anaQueue = anaQueue.filter(at => at <= len);
  /* history / leads 截断到 len+1 个元素（索引 at 表示「第 at 手之后」，
     所以合法索引是 0..len）。多出来的直接砍掉。 */
  if (state.history.length > len + 1) state.history.length = len + 1;
  if (state.leads.length > len + 1) state.leads.length = len + 1;
  /* ★ histVisits（每格的精度）必须跟着一起截 —— 它是 history 的伴随数组，
     错位一格就等于拿别的手的精度去判断这一格要不要改写（2026-10-06 晚新增）。 */
  if (state.histVisits.length > len + 1) state.histVisits.length = len + 1;
  /* ★ 逐手分析快照也跟着截（2026-10-18）：悔棋后那些手已经不存在了，
     留着就会被「解说词」卡当成"这一手的分析"显示出来（张冠李戴）。 */
  for (const key in state.anaAt) {
    if (+key > len) delete state.anaAt[key];
  }
  /* candAt / ownAt 也别指着不存在的局面，否则候选点和形势雾会被当成过期的画淡。 */
  if (state.candAt > len) state.candAt = -1;
  if (state.ownAt > len) { state.ownership = null; state.ownAt = -1; }
  /* ★★★ `shownAt` 必须与 `candAt` **同进同退**（2026-10-07 日志定位到的真根因）。
     它们是"同一批结果"的一对记号：
       candAt = 这批候选点是第几手算的（画盘用）
       shownAt = 屏幕上这批结果算的是第几手（要不要重算用，判据 shownAt !== cur）
     ⚠️ 原来这里只写了 `if (shownAt > len) shownAt = -1;` —— 只管了"大于新长度"这一种情况。
        而悔棋**退到某一手**时会出现：candAt（假设 6）> len（2）→ 被清成 -1；
        但 shownAt 恰好**等于** 2（≤ len）→ 原样留着。
        于是"这批选点废了"与"这个局面显示过了"同时成立 —— 死结：
          · runAnalysis 判 `shownAt !== cur` 为假 → 跳过当前局面，不重算
          · scheduleAnalysis 又因 `history[cur]` 有值 → 不入队
        两头都不动手 → **那个局面永远不再分析**，界面就是
        「计算中… N 定住不动、推荐点永远不出来」。
        实测证据：调试实例的《分析链路.log》里出现
          「run 认为已算过但 candAt=-1 ≠ viewAt=2」+ 前后都是 busy=false/force=false/hist[2]=有。
     所以规矩是：**candAt 若失效，shownAt 一起失效**（要废一起废）。 */
  if (state.candAt === -1) shownAt = -1;
  else if (shownAt > len) shownAt = -1;
  /* 曲线 / 手数列表不用在这里刷 —— 调用方紧接着就 syncUI()，那里会重画。
     在这里刷等于每悔棋一次多两次全量重绘。 */
}

/* ★★ 落子 / 停一手后，把「该手号」上留着的旧讲解清掉（2026-10-06 审查发现）。
   为什么必须清：讲解是**按手号**存的（`state.coach.explain[at]`，at = 第几手），
   而悔棋不会动这些数据 —— 于是「悔棋 → 换一手重下」之后，
   新落的第 k 手会去查 `explain[k]`，拿到的是**上一手（旧那手）的讲解**：
     · 框里写着旧手的坐标和理由，盘上却是另一手；
     · 做「全盘讲解」时它被当成「已讲过」跳过（`if (!state.coach.explain[at])`）；
     · `saveCoachFile` 会把这份错内容写进 `<棋谱名>.coach.json` —— **之后永远不再重讲**。
   手号是唯一的失效依据（我们没存局面指纹），所以在**写入的同一处**把它清掉最稳：
   `tryPlay` / 停一手 / AI 停一手 三个落子点都调它。 */
function clearCoachAt(at) {
  const ex = state.coach && state.coach.explain;
  if (ex && at && ex[at]) delete ex[at];
}

/* ★ 单飞（同一时刻只允许一次分析在飞）—— 2026-10-04 实测定位出的 bug：
   原来每次落子都发一个分析请求，而 main.js 里**每个新请求都会 `terminateId` 掐掉前一个**
   （见 main.js 的 analyze()）。落子快过分析时，引擎陷进「启停风暴」：
   实测连续落子（间隔 1 秒）12 手 → ownership 卡在旧局面**一动不动**，
   停止落子后还要等约 **20 秒**才追上（落后 11 手）。用户报的就是「形势变着变着就停下来了」。
   改法：任何时刻最多一个请求在飞；没轮上的局面进 anaQueue，跑完接着补。
   效果：不会雪崩，且一定会收敛到最新局面，欠下的历史也会补齐。 */
let anaBusy = false;      // 是否已有一次分析在跑
let anaPoke = false;      // 跑的过程中又被调度过 → 跑完再看一眼

/* ★ 「棋局代次」：换局 / 换棋谱时 +1。**凡是「发请求 → 等结果 → 写状态」的地方都要用它**，
   回来时对不上就整体丢弃 —— 否则属于上一局的结果会落到这一局上。
   为什么必须有它（2026-10-04 实测踩到）：换局时旧请求还在飞，回来时判断条件可能"恰好"成立 ——
     · 分析：`at === state.viewAt`（旧局第 0 手 vs 新局 viewAt=0）
     · AI 落子：`state.moves.length === expectLen`（两边都是空盘，都是 0）
     · 数子 / 复盘：压根没有局面校验，直接写 state.result / state.review
   现象分别是「未开局状态下走势图还挂着数据」「重开一局后 AI 往空盘上落一手」
   「新局上冒出上一局的胜负」。
   （同一局内换局面的情况由 `at !== state.viewAt` 那条管着，两者互补。） */
let gameGen = 0;
let anaReqGen = -1;       // 当前在飞的那个**分析**请求属于哪一代（onProgress 用）

async function runAnalysis() {
  anaDiag.start++;
  /* ★ 数子期间**不发分析请求**：否则新分析会在 main.js 里 terminateId 掐掉数子查询，
     数子就会拿到半成品或直接失败（用户报过「点完数子按钮好像没发生什么」）。
     数子跑完会主动补一次分析，见 runScore 的 finally。 */
  if (scoreBusy) { anaDiag.failEarly.score++; anaDiag.note('数子中提前return'); alog('run 数子中 → 不发'); return; }
  /* ★ 复盘同理：复盘是一次「整盘逐手」的长请求，被分析掐掉就白跑了（可能要等两分钟）。
     复盘结束后会主动刷一次界面，见 runReview。 */
  if (reviewBusy) { anaDiag.failEarly.review++; anaDiag.note('复盘/讲解中提前return'); alog('run 复盘/讲解中 → 不发'); return; }
  /* ★★ 习题练习的「KATAGO 应手」**也走同一个分析引擎**（题的正解要求"对方最强应对"，
     所以不能改用段位引擎）→ 它和分析请求是**竞争关系**：
     main.js 的 analyze() 会给新请求带上 terminateId，**后发的会掐掉前一个**。
     于是分析循环不停发请求 → 防守请求每次都被掐掉 → 对方永远不应子。
     （2026-10-12 端到端测试实测到的就是这个：手数停在 1，AI 一声不吭。）
     数子 / 复盘那两条守卫是同一个道理，这里照办：
     **轮到防守方时把引擎让给它**，防守落子后会 syncUI → 分析自然接着排。 */
  if (needDefendMove() || defendBusy) { anaDiag.note('习题防守中提前return'); return; }
  if (!engineReady) { anaDiag.failEarly.notReady++; anaDiag.note('引擎未就绪提前return'); alog('run 引擎未就绪 → 不发'); return; }
  if (anaBusy) { anaPoke = true; anaDiag.failEarly.busy++; alog('run 已有请求在飞 → 只登记 poke'); return; }
  anaBusy = true;
  anaBusySince = Date.now();                     // ★ 给「刷新」按钮判断卡死用
  const gen = gameGen;                            // ★ 这一轮属于哪一代
  alog('run 开始 代=' + gen + ' q=[' + anaQueue.join(',') + '] viewAt=' + state.viewAt
    + ' shownAt=' + shownAt + ' candAt=' + state.candAt + ' force=' + anaForceCur);
  try {
    /* 上限只是防止意外死循环（正常一轮只会跑十几次）。 */
    for (let guard = 0; guard < 500; guard++) {
      if (scoreBusy || reviewBusy || defendBusy || needDefendMove() || !engineReady) { anaDiag.note('数子/复盘/防守/引擎掉了 中断循环'); alog('run 循环中断：数子/复盘/防守/引擎掉了'); break; }
      if (gen !== gameGen) { anaDiag.note('换局中断循环'); alog('run 循环中断：换局/换棋谱（代 ' + gen + '→' + gameGen + '）'); break; }   // ★ 换局 / 换棋谱了：剩下的欠账全部作废

      /* ① 先算**当前看着的局面** —— 胜率条 / 候选点 / 形势雾要它上屏（最高优先）。 */
      const cur = state.viewAt;
      if (shownAt !== cur || anaForceCur) {
        const ok = await runAnalysisOnce(cur);
        if (ok) { anaDiag.okCount++; anaForceCur = false; }
        else { anaDiag.failOnce++; anaDiag.note('runAnalysisOnce 返回 false'); alog('run 当前局面 at=' + cur + ' 这一趟没成功 → 退出循环'); break; }
        continue;
      }
      /* ★ 走到这里就说明「认为当前局面已算过」—— 这是最可疑的一条路，
         因为如果 candAt 却没跟上，那这个局面就再也不会被重算。
         记一行，卡住时一眼能看出来。 */
      if (state.candAt !== cur) {
        alog('★ run 认为已算过但 candAt=' + state.candAt + ' ≠ viewAt=' + cur
          + '（跳过当前局面，去补欠账；若此处反复出现就是卡住的源头）');
      }

      /* ② 再补欠账：把队列里「还没有 history」的手数从旧到新算出来（只写 history，不动画面）。 */
      const at = anaQueue.shift();
      if (at === undefined) break;               // 没有欠账了
      /* ★★ 越界欠账直接丢（2026-10-06 实测定位到的坑）。
         悔棋后队列里会残留比当前手数大的 at（那些局面已经不存在了）。
         若不拦：runAnalysisOnce(8) 会去算 `moves.slice(0, 8)` —— moves 只有 7 手，
         引擎算的其实是第 7 手，回来却按「第 8 手」写进 history[8]，
         **JS 数组会因此扩容**（实测 7 手的 history 长度涨到 11）。
         这些幽灵数据让 anaBusy 长期占着（busy 卡在 true），
         真正的当前局面再也排不上队 → **用户看到的现象就是「悔棋后分析停住了」**。 */
      if (at > state.moves.length) { anaDiag.skipHuge++; continue; }
      if (typeof state.history[at] === 'number') continue;   // 已经补上了（比如刚作为当前局面算过）
      if (at === cur) continue;                  // 当前局面刚算过
      await runAnalysisOnce(at);
    }
  } finally {
    anaBusy = false;
    /* 跑的过程中又被调度过 → 再来一轮（比如补账期间用户又落了一手） */
    if (anaPoke) { anaPoke = false; scheduleAnalysis(0); }
  }
}

/* 分析第 at 手之后的局面。
   · at === state.viewAt：结果上屏（胜率条 / 候选点 / 形势雾）。
   · at ≠ state.viewAt：只把这一手的胜率写进 history（补历史欠账），**绝不碰画面**
     —— 画面代表「当前局面」，不能被别的局面的结果污染。
   返回 true 表示这次请求有结果（可以继续下一件事）；false = 没就绪 / 出错 / 被取消。 */
async function runAnalysisOnce(at) {
  if (!(window.api && window.api.analyze)) return false;
  if (!engineReady) {
    if (!state.noGame) $('eval-wr').textContent = 'AI 准备中';
    return false;
  }
  if (typeof at !== 'number') at = state.viewAt;
  const gen = gameGen;          // ★ 记下这一请求属于哪一代（换局后就作废）
  anaReqGen = gen;             // onProgress 的中间报告也按它过滤

  const req = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: state.moves.slice(0, at)
      .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
  };

  /* ★ 局面变了**不要清空**候选点 —— 清空会造成 3~4 秒的空窗（用户实测报过：
     AI 落子后推荐点整块消失，像坏了一样）。旧点由 draw() 按 candAt 识别为「过期」并淡化，
     新结果一到就整体替换。 */

  /* 只发一次查询：引擎每 0.25 秒推一次中间报告（onProgress），
     胜率与候选点会随搜索量自然收敛 —— 这才是真正的「先粗后精」，
     且不会出现两段式那种「先显示一批点、再整批换掉」的闪动。

     ★★ 渲染端超时兜底（2026-10-06 晚新增）。
     为什么必须自己再兜一层：主进程那边虽然有 90 秒超时，但**渲染端这一侧
     同样有"回不来"的路**（IPC 通道异常、页面被挂起、主进程那条 promise 因为
     任何原因没 settle）。一旦那一次 await 永不返回，`anaBusy` 就永远占着 ——
     后果不是"这一手没算"，而是**整个分析链路停摆**：
     选点不再刷新、胜率条冻住、棋盘上方那行「计算中… N」定在一个数字上不动，
     点悔棋、回看、落子都不管用，只能重启软件。这正是用户报的现象。
     加这一层之后，最坏情况是「这一手晚 25 秒」，而不是整个软件卡死。 */
  let res;
  try {
    res = await Promise.race([
      window.api.analyze(Object.assign({
        maxVisits: settings.visits || ANALYZE_VISITS,   // ★ 每次请求现读 —— 所以改档位是**热切换**
        includeOwnership: state.showTerritory,   // 形势雾的数据（不增加搜索量）
      }, req, /* ★ 习题练习：先手方(initialPlayer) + 框架约束(allowMoves)。
                     放在最后 = 不能被 req 覆盖掉（漏了这两个，题就做不严谨：
                     引擎会自己猜先手，还会推荐框架外的脱先点）。 */
        tsAnalyzeExtras())),
      new Promise(r => setTimeout(() => r({ error: '分析请求超时（渲染端 25 秒没有响应）' }), ANALYZE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    res = { error: String((e && e.message) || e) };
  }

  /* ★ 这一趟期间**换过局 / 换过棋谱** → 这次结果整体作废（一个字段都不写）。
     放在所有分支之前：连「记 history」都不做，那些手已经不属于现在这盘棋了。 */
  if (gen !== gameGen) { alog('once at=' + at + ' 作废：期间换过局（代 ' + gen + '→' + gameGen + '）'); return false; }

  /* ★ 被 cancel 掐掉的结果是**搜索中途的半成品**（visits 很少、胜率还没收敛）——
     绝不能上屏，否则胜率条会瞬间跳到一个极端值、过几秒又弹回来
     （用户实测报过这个现象；根因是 runScore 里的 window.api.cancel()）。 */
  if (res && res.cancelled) {
    /* ★★ 自愈（2026-10-07 新增）：如果被掐掉的正是**当前局面**那一趟，
        那么"重算当前局面"这个意图必须留着、而且要**主动重排一次**。
        为什么：`runAnalysis` 拿到 false 就 break，`anaBusy` 随即放开；
        而 anaForceCur 虽然还是 true，但**没有任何东西会再触发一次 schedule** ——
        如果这一刻正好没有落子/回看这类操作，分析就永远停在那儿
        （表现就是用户报的「选点 / 形势突然卡住不显示」，而且不会自己好）。
        典型触发：数子（runScore 里会 cancel）与悔棋/落子挤在一起的时候。 */
    if (at === state.viewAt) {
      anaForceCur = true;
      if (!anaTimer) anaTimer = setTimeout(runAnalysis, 120);
    }
    alog('once at=' + at + ' 被取消（cancelled）→ 重排；viewAt=' + state.viewAt);
    return false;
  }
  if (!res || res.error) {
    const timedOut = !!(res && res.error && res.error.indexOf('超时') >= 0);
    if (timedOut) {
      /* ★ 超时 = 请求回不来了。**必须主动重排一次**，否则 anaForceCur 会一直挂着、
         而 anaBusy 已经放开 —— 没人再触发的话分析就永远停在这儿（就是"卡死"）。
         限流：连续 3 次仍不回来就不再重排，明确报错并让用户看到该怎么办。 */
      anaTimeouts += 1;
      if (anaTimeouts <= 3) {
        console.warn('[分析] 第 ' + anaTimeouts + ' 次请求超时，重排一次');
        setTimeout(() => scheduleAnalysis(0, true), 200);
      } else {
        engineNote = '分析引擎连续无响应 —— 顶栏「KataGo」里卸载后重新加载';
        console.error('[分析] 连续 ' + anaTimeouts + ' 次超时，停止重排');
        flash(engineNote);
      }
    }
    if (at === state.viewAt) {
      $('eval-wr').textContent = timedOut ? '分析超时' : '分析失败';
      $('eval-wr-w').textContent = '';
      /* ★ 有引擎级错误（比如**权重与引擎版本不匹配**）时优先显示它 ——
         那一句是 main.js 从引擎 stderr 里捞出来的原话转写，用户照着就能解决。
         显示在这里（右侧胜率卡）是因为它**任何局面下都看得见**，
         而棋盘中央那条提示只在「未开局」时才有（见 syncUI 里的 gate-tip）。 */
      $('eval-lead').textContent = engineNote || (res && res.error ? res.error : '');
      $('eval-lead-w').textContent = '';
    }
    alog('once at=' + at + ' 失败返回 false：' + ((res && res.error) || '未知')
      + '（引擎就绪=' + engineReady + ' viewAt=' + state.viewAt + '）');
    return false;
  }
  anaTimeouts = 0;                 // 有结果回来了 → 计数归零

  /* 补历史欠账（at ≠ 当前局面）：只记这一手的胜率，画面别动。 */
  if (at !== state.viewAt) {
    if (((res.root && res.root.visits) || 0) >= HINT_MIN_VISITS) {
      /* ★ 带上这次的搜索量（第四个参数）—— 门槛靠它判断「够不够准」，见 rememberEval */
      rememberEval(at, blackWinFrom(res, at), blackLeadFrom(res, at), (res.root && res.root.visits) || 0);
    }
    return true;
  }

  /* 当前局面：上屏（applyAnalysis 里也会顺手记下这一手的胜率）。
     ★★ 2026-10-07 修的**真 bug**：原来这里无条件写 `shownAt = at`，
        可 `applyAnalysis` 内部有提前 return（搜索量不够 / 报文与当前局面不符时直接返回）。
        那样一来：**候选点没画上去，却被标记成"这个局面已经显示过了"** ——
        而 `runAnalysis` 的判据是 `shownAt !== cur`，于是这个局面**永远不再重算**。
        用户看到的就是「棋盘上方那行『计算中… N』定住不动、推荐点永远不出现」。
        （实测证据：用户按 Ctrl+Shift+D 读出来的自检是
          「看第2手·选点: 还没算过·搜索量: 200·请求: 空闲·空跑0」——
          搜索量 200 说明请求发出去过、也回过进度，但 candAt 仍是 -1，
          队列空、没有请求失败 → 只可能是"被当成已显示、于是不再算"。）
        所以现在只认 `applyAnalysis` 真上屏了才记 shownAt。 */
  if (applyAnalysis(res, at)) { shownAt = at; alog('once at=' + at + ' ✓ 上屏成功 candAt=' + state.candAt + ' 候选点=' + state.candidates.length + ' visits=' + ((res.root && res.root.visits) || 0)); }
  else { alog('★ once at=' + at + ' 未上屏（applyAnalysis 返回 false）→ shownAt 不记，下轮会重算；visits=' + ((res.root && res.root.visits) || 0) + ' viewAt=' + state.viewAt); }
  draw();
  /* ★ 分析回来了 → 右下角「解说词」卡要跟着刷新（2026-10-18）。
     原来这里只 draw()（画布），而那块文字只在 syncUI 里刷新 ——
     于是「这一手还在算…」会一直挂着，直到下次任意操作才变成数字。 */
  renderCommentBox();
  return true;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角再上屏 */
/* 记下「第 at 手落下后的黑方胜率」—— 胜率走势曲线与手数列表的「涨跌」都靠它。
   试下（草稿）里的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。

   ★ 为什么单独抽出来（2026-10-04）：人机对弈时用户落子后立刻轮到 AI，
     那一手**等不到属于自己的分析**（见 syncUI 里的调度 + runAnalysisOnce 的作废分支），
     所以要能在「结果已作废」的路径上也把这一手的胜率留下来。

   ★★ 搜索量门槛（2026-10-06 晚新增，治「数字自己跳」）：
     这个函数是全盘**唯一**写 history 的地方，而它会被每一次分析结果调用 ——
     包括引擎每 0.25 秒推一次的**中间报告**（那时搜索量才 150 左右，胜率还没收敛）。
     原来是无条件覆盖，于是同一手被写十几遍、数字跟着乱跳。

     实测（_cdp_jump.mjs，连落 6 手后逐步回看）：
       at=1 被写 6 次，访问量 151/298/463/515/515/515，胜率极差 0.62%
       at=4 被写 4 次，访问量 152/312/471/514，          胜率极差 1.63%
       at=5 被写 5 次，访问量 168/340/515/515/515，      胜率极差 1.69%
       at=6 被写 14 次（含悔棋重下），                   胜率极差 **8.06%**
         → 27.7% → 19.7% → 32.9%，正是用户说的「原本算亏的，再点一次就不亏了」。
       列表里的涨跌是 (history[i] − history[i−1])×100，所以极差还会被放大。

     现在的规矩（两道，缺一不可）：
       ① **粗算只许记账、不许覆盖**：搜索量不到目标值（底栏「计算深度」）的 90% 时，
          只在这一格**本来是空的**时候写进去（先给个暂行值）；已经记过的一律不动。
       ② **精算才许改写，且不许倒退**：达到 90% 才允许覆盖已有记录，而且不能比已有记录更低。

     ⚠️ 曾经写成「新值是旧值的 1.25 倍就允许覆盖」—— 实测那是**形同虚设**
        （_cdp_gate.mjs）：中间报告的访问量是 122 → 294 → 489 → 515 逐级涨的，
        每一级都比上一级高 2.4 倍，于是每一级都通过了 1.25 倍那道门，数字照跳不误。
        「逐级放宽」对逐级增长的报告序列没有任何拦截力 —— 必须用**目标值的绝对比例**当门槛。
     ⚠️ 别改成「永不覆盖」：早期算的那几手会永远停在粗算值上，回看也不会变准。 */
function rememberEval(at, blackWin, blackLead, visits) {
  if (!(at >= 0)) return;
  if (state.draft && at > state.draft.from) return;
  /* ★★ 越界拒收（2026-10-06）。这是 history / leads 的**唯一写入口**，
     所以在这里拦一次就够 —— 上面 runAnalysis 里的过滤是第二道防线（少一次无效请求）。
     为什么必须拦：JS 的 `arr[99] = v` 会**把数组扩容到 100**，
     于是「7 手棋」的 history 长度变成 11（实测），
     走势曲线会画出根本不存在的第 8、9、10 手，手数列表里也有幽灵数据。
     场景：悔棋后队列里残留了已撤销手数的欠账，那次请求回来就写越界了。 */
  if (at > state.moves.length) return;

  const v = (typeof visits === 'number' && visits > 0) ? visits : 0;
  const target = settings.visits || ANALYZE_VISITS;        // 底栏「计算深度」
  const SETTLED = target * 0.9;                            // 「够准」的搜索量门槛
  if (typeof state.history[at] === 'number') {             // 这一格已经有值了
    const old = state.histVisits[at] || 0;
    if (v < SETTLED) return;              // ① 粗算不许覆盖
    if (v < old) return;                  // ② 不许倒退（用更少的搜索量改写）
  }
  if (typeof blackWin === 'number') state.history[at] = blackWin;
  if (typeof blackLead === 'number') state.leads[at] = blackLead;
  state.histVisits[at] = v;                                // 记住这一格的「精度」
  renderCurve();
  renderMoveList();          // 列表里的「这一手涨跌」也要跟着刷新
}

/* 这一手的胜率「算准了没有」——手数列表用它决定显示数字还是「…」。
   为什么要问这个（2026-10-06 晚）：引擎每 0.25 秒推一次中间报告，刚落子那 0.3 秒
   只有 130 左右的搜索量，胜率离收敛值差得远（实测同一手 122 → 515 之间差了 3%）。
   如果这时就把数字摆出来，用户会看到它过一会儿自己变一个值 —— 那正是他报的
   「下完显示一个数字，过会儿再看又不是这个数」。
   改成：没算准就显示「…」，算准了才出数字。数字一旦出现就不会再变。 */
function evalSettled(at) {
  const target = settings.visits || ANALYZE_VISITS;
  return (state.histVisits[at] || 0) >= target * 0.9;
}

/* 引擎给的是「轮到走棋那一方」的胜率 —— 统一换算成黑方视角（at 只用于兜底判断该谁走） */
function blackWinFrom(p, at) {
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? p.root.winrate : 1 - p.root.winrate;
}

/* 同上，换算「黑方领先目数」（正 = 黑优）—— 走势图「目差」纵轴用 */
function blackLeadFrom(p, at) {
  const root = p && p.root;
  if (!root || typeof root.scoreLead !== 'number') return undefined;
  const cp = String(root.currentPlayer || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);
  return side === 'b' ? root.scoreLead : -root.scoreLead;
}

/* p = 分析结果；at = 这是「第几手之后」的局面。
   ★ 只对**当前看着的局面**调用（at === state.viewAt）—— 补历史欠账的结果不许走这里。
   ★★ 返回值（2026-10-07 新增）：**真把东西画上屏了**才返回 true。
     调用方（runAnalysisOnce）用它决定要不要把这一手记成「已显示」（shownAt）——
     以前无条件记，于是"没画上屏也算显示过"，那个局面就再也不重算了。
     ⚠️ 两个"没上屏"的情况都要返回 false：
        ① 报文跟当前局面不符（at ≠ viewAt，比如请求期间用户又落了一子 / AI 应了一手）；
        ② 搜索量还太少（< HINT_MIN_VISITS），候选点先不更新。 */
function applyAnalysis(p, at) {
  if (!p || !p.root) return false;
  if (typeof at !== 'number') at = state.viewAt;

  /* 视角：以引擎返回的 currentPlayer 为准（权威）。
     引擎（RapaceGo/engine.cfg 里 reportAnalysisWinratesAs = SIDETOMOVE）返回的
     winrate / scoreLead / moveInfos[].winrate 全部是「**轮到走棋那一方**」的视角 ——
     已用极端贴目的对照实验验证过（轮白走时 scoreLead<0 表示白方落后）。
     所以这里只做一次「轮走方 → 黑方」的换算，不能再多转一次。 */
  const cp = String((p.root && p.root.currentPlayer) || '').toUpperCase();
  const side = cp === 'B' ? 'b' : cp === 'W' ? 'w' : sideToMove(at);

  const blackWin = side === 'b' ? p.root.winrate : 1 - p.root.winrate;
  const whiteWin = 1 - blackWin;
  const lead = side === 'b' ? p.root.scoreLead : -p.root.scoreLead;   // 正 = 黑领先

  /* ★★ 先存这个局面的**分析快照**，再决定要不要刷界面（2026-10-18）。
     快照是**按 at 存的**（报文描述的就是第 at 手那个局面），所以哪怕界面已经走到
     下一手、这份报文不能拿去画候选点了，它本身仍然是对的、该留下来 ——
     「解说词」卡回看那一手时要靠它。原来的顺序是先 `return false`，
     自动对弈（每手间隔短）时前一手的数据整批丢掉，那一手就永远显示"还在算"。
     ⚠️ win / lead 一律换算成**黑方视角**（纪律 11：引擎原值是"轮走方视角"，
        轮到白走时符号会反）。 */
  {
    const toBlack = v => (typeof v === 'number' ? (side === 'b' ? v : -v) : v);
    const ms = (p.moves || []).map(m => ({
      gtp: m.move,
      prior: m.prior,
      order: m.order,
      win: toBlack(m.winrate),
      lead: toBlack(m.scoreLead),
      pv: Array.isArray(m.pv) ? m.pv.slice(0, 8) : [],
    }));
    /* 「推荐最佳选点」按**胜率**排（引擎的 moveInfos 是按访问量排的，不是按胜率） */
    let best = null;
    for (const m of ms) if (typeof m.win === 'number' && (!best || m.win > best.win)) best = m;
    state.anaAt[at] = { at, side, blackWin, lead, visits: (p.root && p.root.visits) || 0, moves: ms, best };
  }

  /* ① 报文与当前局面不符：这不是"当前局面的结果"，一个界面字段都不该写。
     为什么必须挡：请求在飞的时候用户落子 / AI 应手，回来的报文属于**上一个**局面；
     照它画候选点就会把别的局面的点画到当前棋盘上。 */
  if (at !== state.viewAt) return false;

  $('bar-black').style.width = (blackWin * 100).toFixed(1) + '%';      // 条：左段黑、右段白
  $('eval-wr').textContent = '黑 ' + (blackWin * 100).toFixed(1) + '%';
  $('eval-wr-w').textContent = '白 ' + (whiteWin * 100).toFixed(1) + '%';
  /* 目数也两端各给一份：黑方 +9.3 表示黑领先 9.3 目，白方就是 −9.3（落后） */
  const signed = v => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(1);
  $('eval-lead').textContent = signed(lead) + ' 目';
  $('eval-lead-w').textContent = signed(-lead) + ' 目';

  /* 存一份给「AI 要不要认输」判断用（它需要知道自己落后多少） */
  state.lastEval = { blackWin, lead };

  /* 形势（ownership）—— 放在 HINT_MIN_VISITS 那道门槛**之前**：
     雾是「渐变收敛」的，早一点显示出来观感更好（看不清就淡一点，不该从无到有地跳）

     ⚠️ ★ ownership 是「**相对当前走棋方**」的，不是固定黑方！实测（同一局面换谁走）：
        轮到白 → 白那侧 +0.998 / 黑那侧 −0.998
        轮到黑 → 黑那侧 +0.997 / 白那侧 −0.999
        跟 winrate / scoreLead 同一套视角规则，必须一起换算，否则整盘雾会反色。 */
  if (p.ownership && p.ownership.length === N * N && state.showTerritory) {
    const cpBlack = String((p.root && p.root.currentPlayer) || '').toUpperCase() === 'B';
    state.ownership = cpBlack ? p.ownership : p.ownership.map(v => -v);   // 统一存成「黑方占优为正」
    state.ownAt = at;
  }

  /* 候选点
     - 数字 = **轮到走棋那一方的胜率**（"我下这里，我能有多少胜率"）—— 直接取引擎原值。
       执白的人看到的就是白方胜率；若换算成黑方胜率，他会把自己 0.7% 读成 99%，会误导判断。
     - 排序 = 按「轮走方胜率」降序。引擎的 moveInfos 是按访问次数排的，**不是按胜率**；
       若换成黑方视角再降序，轮白走时就会把白棋最差的手排到第一。
     - 再滤掉搜索量太少的点（胜率方差极大、经常虚高）。
     - 搜索量还小时（< HINT_MIN_VISITS）先不动，保留上一批（此时各点排序会乱跳）。 */
  const totalV = (p.root && p.root.visits) || 0;
  /* 「计算中… 320」要显示它 —— 放在门槛**之前**，这样搜索量还很低时也能看到它在涨 */
  state.rootVisits = totalV;
  /* ② 极低搜索量（<20）时数据纯噪声，候选点先不更新 → **没上屏，返回 false**。
     这一步很要紧：只有它返回 false，调用方才会把这一手记成"还没显示"、
     下一轮重新算（否则这个局面永远停在"计算中…"上）。 */
  if (totalV < HINT_MIN_VISITS) return false;

  /* 记下「第几手时黑方胜率多少」——胜率走势曲线与手数列表都靠它。
     试下（草稿）里下的手**不记**：那些手等会儿会被整体丢掉，写进曲线就是脏数据。
     ★ 第四个参数 = 这次结果的搜索量（totalV），门槛用它判断「够不够准」。 */
  rememberEval(at, blackWin, lead, totalV);

  /* 候选点的过滤门槛 —— ★ 2026-10-04 实测（_cdp_cand.mjs，连续落 8 手，共 39 次采样）：
     引擎**每次都返回 8 个候选**，但原来那道「按总搜索量 1.5%」的比例门槛，
     在「搜索高度集中」的局面（500 步几乎全给了唯一好手）会把 7 个次要点全滤掉、
     只剩 1 个 —— 实测约 40% 的手都这样，正是用户报的「很多时候只显示一个选点」。
     现在：可信的（visits ≥ 总搜索量 1%）优先；不足 3 个时放宽补足，别只给一个。
     visits ≥ 2 是硬下限 —— 一次都没被回访的点基本是神经网络的先验噪声，胜率不可信。 */
  const strongV = Math.max(3, totalV * 0.01);
  const usable = (p.moves || [])
    .map(m => {
      const pt = fromGTP(m.move);
      if (!pt) return null;
      const win = m.winrate;                   // 引擎原值 = 轮走方视角
      /* pv = 这一手之后的预计变化（主进程只透传前 8 手）。悬停「变化图」用它。
         ⚠️ 引擎给的 pv **包含这一手本身**（pv[0] 就是 m.move），所以画的时候要跳过第一个。 */
      return { x: pt.x, y: pt.y, win, visits: m.visits, label: (win * 100).toFixed(1), pv: m.pv || null };
    })
    .filter(c => c && c.visits >= 2);
  let pick = usable.filter(c => c.visits >= strongV);
  if (pick.length < 3) pick = usable;          // 可信点太少 → 放宽（宁可多给几个参考）
  state.candidates = pick.sort((a, b) => b.win - a.win).slice(0, 4);
  state.candAt = at;                           // 记下这批点是第几手的（draw 用它判断过期没）
  return true;                                 // ★ 真上屏了 → 调用方可以记 shownAt
}

/* ---------------- AI 对弈 ---------------- */

/* ★ 对手棋力 = KataGo 人类棋风模型的「真实段位档位」（humanSLProfile）
 *
 * 为什么换掉原来那套：
 *   旧版靠「降 visits + 随机挑点」来降低水平 —— 那些数值是我估的、**从未校准**，
 *   标着「业余 3 段」并不等于真业余 3 段（用户实测就发现"不匹配会输得很惨"）。
 *   现在用权重自带的真实档位：**选什么段位，就真的按那个水平下**。
 *   实测（同一局面，300 visits）：rank_9d 首选 C3 / rank_1d 首选 C3 /
 *   rank_10k 首选 Q3 / rank_20k 首选 Q3 —— 连"对局面强弱的自我认知"都不同。
 *
 * ⚠️ 两个前提（别忘）：
 *   ① 只有 **human 权重**（b18c384nbt-humanv0）认这个档位，strong 权重会报
 *      `Unknown human SL network profile` → 所以对弈必须走独立的 play 引擎。
 *   ② 档位可**逐请求覆盖**（`overrideSettings.humanSLProfile`），不必为每个段位重启引擎。
 *
 * ★ 文案的准确边界（2026-10-04 对着官方文档重写过一次，别再凭印象编）：
 *   · `rank_*` / `preaz_*` 这一批（20 级 ~ 9 段）是**一把连续的业余段位尺子**，
 *     **不是职业段位表** —— 官方原文只有 "Imitate human players of the given rank"，
 *     **没公布对标哪个体系**；最高档 9d 的位置是「业余顶尖 / 接近职业边缘」，
 *     **不是职业九段**。（之前我按常识写了「职业顶尖」之类，那是没依据的，已删。）
 *   · 明确标着职业的只有 `proyear_*`（官方用词："pro and strong insei"）。
 *   · 高段之间几乎分不出来：实测同一局面 rank_7d / 8d / 9d 的首选点相同。
 *   · 「约业余 X 段」是圈内通行换算、**不是官方数据**，各地差异还很大 ——
 *     所以那个「约」字别去掉。
 * visits 不决定档位（档位由网络本身决定），给固定值就行。
 */

/* 下拉分组。2026-10-04 用户要求：现代段位**不要再切块** ——
   原来分「职业/强业余」「业余高段」「业余级位」「入门」四块，
   可这条 20 级~9 段本来就是连续的，切块反而误导（"5 段"被归进"职业"那一块，
   其实它是业余）。现在合成一块，名字直接写明「非职业」。 */
const RANK_GROUPS = [
  '现代段位（非职业）',                          // 0 — rank_* 29 档
  '前AI时代段位（非职业）',                      // 1 — preaz_*
  '职业棋风 · 按年份（1800–2023）',              // 2 — proyear_*
];

/* [档位值, 显示名, 分组下标, 一句话水平说明]
   ★ 说明是「圈内粗略换算 + 典型特征」，**不是官方标定** —— 官方没有换算表。
   「约业余 X 段」指网络平台的段位体系（野狐/弈城那种 1d~9d），
   和「中国业余段位制」（1~5 段靠比赛升、6 段省级冠军、7 段全国冠军、8 段荣誉）
   只是大体对应，各地含金量差别很大。 */
const RANK_ROWS = [
  ['rank_9d', '9 段', 0, '业余顶尖 · 接近职业边缘'],
  ['rank_8d', '8 段', 0, '强业余 · 省级冠军那个层次'],
  ['rank_7d', '7 段', 0, '业余 6 段上下'],
  ['rank_6d', '6 段', 0, '业余 5 段偏强'],
  ['rank_5d', '5 段', 0, '约业余 5 段'],
  ['rank_4d', '4 段', 0, '约业余 4 段'],
  ['rank_3d', '3 段', 0, '约业余 3 段 · 布局定式熟练'],
  ['rank_2d', '2 段', 0, '约业余 2 段 · 会攻杀，偶尔漏算'],
  ['rank_1d', '1 段', 0, '约业余 1 段 · 刚入段'],
  ['rank_1k', '1 级', 0, '冲段水平 · 比业余 1 段略差'],
  ['rank_2k', '2 级', 0, '级位上游 · 定式基本会，官子还糙'],
  ['rank_3k', '3 级', 0, '级位上游 · 中盘能打，容易上头'],
  ['rank_4k', '4 级', 0, '级位中游 · 会算局部死活'],
  ['rank_5k', '5 级', 0, '级位中游 · 全局观还在建立'],
  ['rank_6k', '6 级', 0, '级位中下 · 常下出无理手'],
  ['rank_7k', '7 级', 0, '级位下游 · 死活容易看错'],
  ['rank_8k', '8 级', 0, '级位下游 · 会被简单骗着骗到'],
  ['rank_9k', '9 级', 0, '入门偏上 · 知道该先占角'],
  ['rank_10k', '10 级', 0, '入门 · 知道基本下法，布局随缘'],
  ['rank_11k', '11 级', 0, '初学 · 常常不知道该下哪'],
  ['rank_12k', '12 级', 0, '初学 · 只会连络和逃跑'],
  ['rank_13k', '13 级', 0, '初学 · 吃子看得见，算气常错'],
  ['rank_14k', '14 级', 0, '刚会算气 · 一块棋常被白吃'],
  ['rank_15k', '15 级', 0, '刚会算气 · 不太顾全局'],
  ['rank_16k', '16 级', 0, '新手 · 会下，但常自填眼'],
  ['rank_17k', '17 级', 0, '新手 · 分不清先后手'],
  ['rank_18k', '18 级', 0, '新手 · 刚懂规则'],
  ['rank_19k', '19 级', 0, '新手 · 刚懂规则，下得较慢'],
  ['rank_20k', '20 级', 0, '刚学 · 只会连子和吃子'],
];

/* ★ 三套档位都是 **KataGo 引擎内置**的 humanSLProfile 系列 —— 我们只是接线，
     一行「棋力算法」都没有自己写（下面那些人话说明是照段位含义写的，不是算出来的）：
       ① rank_*    现代开局风格的段位（主表，29 档，默认用这套，**业余段位标尺**）
       ② preaz_*   2016 年 AlphaZero 之前那种开局风格（**同一把尺子**，只是开局旧）
       ③ proyear_* 按年份模仿**职业**棋手 / 强院生（1800~2023，**每年一档**；
                   实测越界（1799 / 2024）引擎只报 error，不会崩）
     ⚠️ 三点官方说明（实测查证，别当它们不存在）：
        · 措辞是「**模仿**（imitate）」而非「等同」，官方也没公布对标哪个段位体系；
        · 只有 proyear_* 明确是职业，rank_/preaz_ 都是业余段位标尺（见上面的注释）；
        · **搜索量给多了会比标称段位强** —— 搜索会解掉该段位解不出的战术。
          想让它真的「像那个段位」，要打开「拟人落子」（按该段位人类的概率抽样）。 */
const RANK_ROWS_ALL = RANK_ROWS.slice();
for (const [v, label, , note] of RANK_ROWS) {
  RANK_ROWS_ALL.push(['preaz_' + v.slice(5), label, 1, note]);
}
for (let y = 2023; y >= 1800; y--) {
  RANK_ROWS_ALL.push(['proyear_' + y, y + ' 年', 2, '模仿 ' + y + ' 年前后的职业棋手 / 强院生']);
}
const RANKS = RANK_ROWS_ALL.map(([v, label, gi, note]) =>
  ({ v, label, group: RANK_GROUPS[gi], note }));
const RANK_MAP = new Map(RANKS.map(r => [r.v, r]));

/* AI 每手搜索量。档位由网络决定，visits 只影响这手算得稳不稳 —— 给个够用的固定值。
   （别再用 visits 当难度旋钮：那样既费时间又不准，低段位照样能算得比标称强。） */
const AI_VISITS = 400;

let aiBusy = false;
let aiRetry = 0;         // AI 这一手没落成时的重试计数（防止局面被打断后停摆）
let aiTimer = null;

function isMyTurn() {
  /* 试下时两边都能下 → 一直算「轮到我」，这样推荐点照常显示（正在探索，正需要它） */
  if (state.draft) return true;
  /* ★ 双方都由 KATAGO 走：你一手都不下（tryPlay 里那道检查会挡住人手落子） */
  if (state.autoBoth) return false;
  return sideToMove(state.viewAt) === state.myColor;
}

function needAIMove() {
  return settings.mode === 'play'
    && !state.noGame            // ★ 未开局：AI 也不落子（否则执白时一启动它就自己下起来了）
    && !state.draft              // ★ 试下（草稿）时 AI 不自动落子 —— 是你在摆，不是在下棋
    && !state.result             // ★ 本局已结束（数子出结果 / 认输）→ 不再落子
    /* ★★ 双方各停一手（连续两个 pass）= 终局（2026-10-18 用户报的 bug）：
       自我对弈时 AI 会接着往下 pass —— 一手接一手，盘上出现一串「停一手」，
       而数子请求还没回来（700ms）、`state.result` 还是空的，于是它继续下。
       这里直接掐住：连续两 pass 就**一手都不再下**，把局面交给数子。
       （2026-10-18 之前只靠 `!state.result`，慢了半拍就会出现 3 个、4 个连着的 pass。） */
    && !isTerminal()
    && engineReadyPlay           // ★ 是「对弈引擎」就绪，不是分析引擎
    && !aiBusy
    && state.viewAt === state.moves.length
    /* ★ 2026-10-18：双方都自动时，**两个颜色轮到时都要落子**（不看 isMyTurn），
       只受人按的「暂停」约束。 */
    && (state.autoBoth ? !state.autoPaused : !isMyTurn());
}

function scheduleAIMove(delay) {
  clearTimeout(aiTimer);
  /* 自我对弈时放慢一点 —— 一手接一手地闪，看不清棋是怎么下的；
     顺带留点时间给**分析引擎**把这一手之前那个局面算完（「解说词」卡的目损/PV 要用）。 */
  const d = delay === undefined ? (state.autoBoth ? 600 : 120) : delay;
  aiTimer = setTimeout(maybeAIMove, d);
}

/* 从结果里挑一手。
   ★ 现在水平由「档位」决定（human 模型带 profile），这里**不用再随机降级** ——
   直接取它的首选，那本来就是该段位最可能下的一手。
   只留一点点变化（前二里偶尔换一个），免得同一局面每次都一模一样。 */
const AI_ALT_CHANCE = 0.15;
function pickAIMove(res) {
  const infos = res.moves || [];
  if (!infos.length) return null;

  /* 引擎首选是 pass（该收束了）→ 直接 pass。官方配方里也是这么处理的。 */
  const first = infos.find(m => m.order === 0) || infos[0];
  if (first && String(first.move).toLowerCase() === 'pass') return 'pass';

  /* ---- 拟人落子：按人类概率抽样 ---- */
  if (settings.humanLike) {
    const picked = pickByHumanPolicy(res, infos);
    if (picked) return picked;
    /* 万一拿不到 policy，退回下面的取首选（总比不落子强） */
  }

  /* ---- 默认：取首选（前二里偶尔换一个，免得同一局面每次都一模一样） ---- */
  const top = infos.slice(0, 2);                 // 引擎已按 order 排，第 0 个就是首选
  const i = (top.length > 1 && Math.random() < AI_ALT_CHANCE) ? 1 : 0;
  const mv = top[i].move;
  if (!mv) return null;
  if (String(mv).toLowerCase() === 'pass') return 'pass';
  return fromGTP(mv);
}

/* 按人类概率挑一手（拟人落子专用）。权重 = humanPrior × exp(utility / 0.5)。
   · humanPrior：优先用 policy 数组里该点的概率 —— 实测它就是**人类先验**
     （同一局面同一档位，方式2 的 policy 与方式1 的 humanPolicy 数值完全一致）；
     拿不到 policy 就退回引擎给的 prior。
   · exp(utility / 0.5)：**保护项**，官方原话是「跟着 humanPrior 走，但某手一旦开始亏
     超过 0.5 utility（约 25% 胜率）就平滑压低它的概率」—— 这就是"不会连着下烂棋"的原因。
     参数缺失时 exp(0)=1，退化成纯按人类概率抽（官方配方 A）。
   实测这条分布下：9 段只有 7 个非零点、20 级有 26 个，段位越高越集中。 */
function pickByHumanPolicy(res, infos) {
  const pol = res.policy;
  const hasPol = Array.isArray(pol) && pol.length === N * N + 1;   // 最后一个元素是 pass 的概率
  const bag = [];
  for (const m of infos) {
    const pt = fromGTP(m.move);                  // pass / 非法坐标会返回 null，自动被滤掉
    if (!pt) continue;
    const hp = hasPol ? Math.max(0, pol[pt.y * N + pt.x]) : Math.max(0, m.prior || 0);
    if (!(hp > 0)) continue;                     // 人类压根不会下的点，不进袋子
    const u = (typeof m.utility === 'number') ? m.utility : 0;
    bag.push({ pt, w: hp * Math.exp(u / 0.5) });
  }
  if (!bag.length) return null;

  let total = 0;
  for (const x of bag) total += x.w;
  if (!(total > 0)) return null;

  let r = Math.random() * total;
  for (const x of bag) { r -= x.w; if (r <= 0) return x.pt; }
  return bag[bag.length - 1].pt;
}

async function maybeAIMove() {
  if (!needAIMove()) return;
  aiBusy = true;
  state.thinking = true;                 // 思考中：不显示落子预览方块
  draw();

  let retry = false;
  try {
    /* AI 认输判断：落后太多就投子。放在发请求之前 —— 没必要为一个已输的局面再算一遍。
       ★ 自我对弈时**不认输**（2026-10-18）：两边都是 AI，一方领先 20 目就投子，
         那这局就永远看不到后半盘了 —— 用户要的是看它自己下完。 */
    if (!state.autoBoth && aiWantsResign()) {
      const aiSide = state.myColor === 'b' ? 'w' : 'b';
      doResign(aiSide, 'ai');
      flash('KATAGO 认输 · ' + (aiSide === 'w' ? '黑' : '白') + '方胜');
      syncUI();
      return;
    }
    const req = {
      initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
      moves: state.moves.slice(0, state.viewAt)
        .map(m => [m.color === 'b' ? 'B' : 'W', m.pass ? 'pass' : toGTP(m.x, m.y)]),
      rules: (RULES[settings.rules] || RULES.chinese).kata,
      komi: settings.komi,
      size: N,
      maxVisits: AI_VISITS,
      profile: settings.level,
      /* 拟人落子要用 policy（人类先验）来抽样。⚠️ includePolicy 是**外层字段**
         —— 官方文档明确：除了它和 maxVisits，其余参数都必须放 overrideSettings，否则无效。 */
      includePolicy: settings.humanLike,
    };
    const expectLen = state.moves.length;
    const gen = gameGen;                      // ★ 这一手属于哪一局
    /* ★ 走「对弈引擎」（human 权重）—— 分析引擎不参与落子，
       否则两条请求会在同一个进程里互相 terminate。 */
    const res = await window.api.playMove(req);

    /* ★ 换了局（新对局 / 打开棋谱）→ 这手整体作废。
       光看手数不够：两边都是空盘时 `state.moves.length` 都是 0，下面的检查会"恰好通过"，
       于是 AI 把**上一局**算出的那一手落到了新盘上（重开一局时能实际看到）。 */
    if (gen !== gameGen) {
      /* ★★ 但作废之后**必须给新局重排一次**（2026-10-06 审查发现）。
         原来这里直接 return，`retry` 仍是 false，finally 里那句
         `if (retry && needAIMove())` 就不会排 —— 而新局启动时的 syncUI()
         也会因为此刻 `aiBusy` 还是 true 而跳过（needAIMove 要求 !aiBusy）。
         结果：新局若轮到 AI 走，**AI 不动、用户也动不了**（不是他的回合），
         界面看着像卡死，要等下一次任意 UI 刷新（引擎状态变化、提示条到点）才自己好。
         ★ 不计入 aiRetry —— 这不是"失败"，只是局面换了，不该占用重试额度。
         ★ 用 0 延迟：这个定时器会排在本次 finally 之后跑，那时 aiBusy 已经放开了。 */
      scheduleAIMove(0);
      return;
    }
    /* 期间局面被改动了（悔棋 / 回看 / 切模式后手动落子）→ 这手作废 */
    if (state.moves.length !== expectLen || state.viewAt !== state.moves.length) { retry = true; return; }
    if (!res || res.error) {
      /* ★ 也走重试（下面的 finally 里那套 aiRetry 上限 3 次）。
         原来这里直接 return → 引擎偶尔超时/出错一次，AI 就停在那儿不动了，
         要等「引擎状态变化」才有下一个触发点 —— 用户只能自己动一下（审查发现）。 */
      retry = true;
      flash('AI 这一步没算出来（' + ((res && res.error) || '未知') + '），重试中…');
      return;
    }

    const pick = pickAIMove(res);
    if (pick === 'pass') {
      aiRetry = 0;
      state.moves.push({ pass: true, color: sideToMove(state.moves.length) });
      noteTreeMove();
      clearCoachAt(state.moves.length);    // 该手号上的旧讲解作废
      state.viewAt = state.moves.length;
      syncUI();
    } else if (pick) {
      aiRetry = 0;
      tryPlay(pick.x, pick.y, true);
    } else {
      retry = true;
      flash('AI 没找到可下的点');
    }
  } finally {
    aiBusy = false;
    state.thinking = false;
    draw();

    /* ★ 关键：这一手没落成（局面中途变了 / 引擎没给点），但仍然轮到 AI —— 必须重新安排，
       否则就停摆了：用户下不了（不是他的回合），AI 也不动。
       （2026-10-03 用户实测：人机对弈 → 摆棋 → 再切回人机对弈，AI 就不下了） */
    if (retry && needAIMove()) {
      if (aiRetry < 3) { aiRetry += 1; scheduleAIMove(500); }
      else { aiRetry = 0; flash('AI 连续几次没能落子，请检查引擎是否正常'); }
    }
    /* ★★ 双方都由 KATAGO 走：这一手落成后**又轮到对方**，必须在这里再排一次
       （2026-10-18，实测 bug）。平时这条路是"人落子 → syncUI（那时 aiBusy 已放开）→ 排 AI"，
       但自我对弈里触发下一手的是 **AI 自己**，而那一刻 `aiBusy` 还是 true →
       `needAIMove()` 为假 → syncUI 排不出来 → **下完一手就停住**
       （探针实测：手数停在 1，之后 80 秒一动不动，而 needAIMove 一直是 true）。 */
    else if (state.autoBoth && !state.autoPaused && needAIMove()) {
      scheduleAIMove();
    }
  }
}


if (window.api) {
  /* 从状态里取某个引擎的字段。
     ⚠️ 主进程为兼容旧字段，把「分析引擎」的 ok/ready/error 平铺到了顶层 ——
     这里优先读 s.analyze / s.play，读不到才退回顶层。 */
  const readEngineState = (s, key) => {
    if (!s) return { ready: false, error: '' };
    const sub = s[key];
    if (sub) return { ready: !!sub.ready, error: sub.error || '' };
    /* 兼容旧版主进程：顶层平铺的那套字段属于「分析引擎」。只对 analyze 回退 ——
       新引擎（coach）**不能**跟着回退，否则会被误判成就绪。 */
    if (key === 'analyze') return { ready: !!s.ready, error: s.error || '' };
    return { ready: false, error: '' };
  };

  const applyEngineStatus = s => {
    const a = readEngineState(s, 'analyze'), p = readEngineState(s, 'play'),
      c = readEngineState(s, 'coach');
    engineReady = !!a.ready;
    engineReadyPlay = !!p.ready;
    coachReady = !!c.ready;
    /* ★ 记下分析权重的文件名（2026-10-21）：复盘速度是**跟权重绑**的
       （同机 b18c384 139 v/s、b40c768 31.9 v/s，差 4 倍），换权重后
       旧的「秒/手」必须失效，否则剩余时间又变成假的。 */
    analyzeModelName = (s && s.analyze && s.analyze.model) || analyzeModelName;
    /* ★ 只有 KataGo 的故障才算「引擎异常」—— 讲解模型没配/没加载不该影响下棋。 */
    engineNote = a.error || p.error || '';
    coachNote = (s && s.coach && s.coach.error) || '';
    /* 三个引擎的原始状态（画状态灯用）；主进程没给 state 就按 ready/error 推断 */
    const stOf = (sub, r) => (sub && sub.state) || (r.ready ? 'ready' : (r.error ? 'error' : 'off'));
    engStates = {
      analyze: stOf(s && s.analyze, a),
      play:    stOf(s && s.play, p),
      coach:   stOf(s && s.coach, c),
    };
    renderEngines();
    /* 任一引擎刚就绪都刷一次：
       分析引擎就绪 → 立刻算当前局面；对弈引擎就绪 → 轮到 AI 就让它落子。 */
    syncUI();
    checkEngineReloaded();      // 「设置」里改完路径的重启 → 两个都就绪才算重启完成
  };

  /* ---------- 顶栏引擎状态灯（2026-10-05 新增） ----------
     引擎改成手动加载后，用户需要一眼看到「谁在跑 / 谁没跑 / 谁挂了」。
     点一下弹出操作菜单（加载 / 暂停 / 恢复 / 卸载），菜单内容按当前状态现生成。 */
  /* 一盏灯 = 一组进程：
       katago = 分析引擎 + 对弈引擎（**两个**进程，合在一起管 —— 对用户来说就是「KataGo」）
       coach  = LoGos 一个进程
     灯的状态取这一组的「合成状态」，取更"要紧"的那个。 */
  const ENG_KEYS = { katago: ['analyze', 'play'], coach: ['coach'] };
  const ENG_META = {
    katago: { on: 'KataGo', tip: '算胜率、目差、推荐点、形势、复盘，也负责 AI 落子' },
    coach:  { on: 'LoGos（讲解模型）', tip: '用大白话讲棋（分析讲解 / 推荐落点讲解 / 全盘讲解）' },
  };
  const ENG_STATE_TXT = { off: '未加载', loading: '加载中…', ready: '就绪', paused: '已暂停', error: '出错', partial: '部分就绪' };

  function engStateOf(key) {
    const list = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    if (list.includes('error')) return 'error';
    if (list.includes('loading')) return 'loading';
    if (list.every(s => s === 'off')) return 'off';
    /* ★ 暂停必须排在「就绪」前面：否则「分析已暂停 + 对弈没加载」会走到下面的兜底、
       显示成绿灯「就绪」—— 而这时候点「数子」根本不会算（2026-10-05 审查发现）。 */
    if (list.includes('paused')) return 'paused';
    if (list.every(s => s === 'ready')) return 'ready';
    return 'partial';      // 起了几个、还有没起的
  }
  let engMenuKey = null;

  function renderEngines() {
    for (const el of document.querySelectorAll('.engines .eng')) {
      const k = el.dataset.key;
      const st = engStateOf(k);
      el.dataset.state = st;
      const meta = ENG_META[k];
      el.title = meta.on + ' —— ' + ENG_STATE_TXT[st] + '\n' + meta.tip + '\n（点一下看能做什么）';
    }
    /* 菜单开着时状态变了（比如「加载中」变成「就绪」）→ 菜单内容跟着刷新 */
    if (engMenuKey) {
      const el = document.querySelector('.engines .eng[data-key="' + engMenuKey + '"]');
      if (el) openEngineMenu(engMenuKey, el, true);
    }
  }

  function closeEngineMenu() {
    $('engmenu').hidden = true;
    engMenuKey = null;
  }

  function openEngineMenu(key, anchorEl, keepOpen) {
    if (!keepOpen && engMenuKey === key) { closeEngineMenu(); return; }
    const meta = ENG_META[key];
    /* ★ 菜单项按**每个子引擎**的实际情况出，而不是看聚合出来的那一个状态：
       KataGo 是「分析 + 对弈」两个进程，可能出现「分析起来了、对弈没起」。
       原来的写法在这种组合下既不给「加载」也不给「暂停/卸载」，
       用户想把缺的那个补起来却没有入口（2026-10-05 审查发现）。 */
    const subs = (ENG_KEYS[key] || []).map(k => engStates[k] || 'off');
    const anyOff = subs.some(s => s === 'off' || s === 'error');
    const anyReady = subs.some(s => s === 'ready');
    const anyPaused = subs.some(s => s === 'paused');
    const anyLoading = subs.some(s => s === 'loading');

    const rows = [];
    if (anyLoading) rows.push({ act: null, label: '正在加载…请稍候' });
    if (anyOff) rows.push({ act: 'load', label: '加载（第一次约十几秒）' });
    /* 暂停只对「分析引擎」有意义 —— 它局面一变就自动分析。
       对弈引擎是被动的（只在你落子后才动），LoGos 更被动，都没有「暂停」这回事。 */
    if (anyReady && key === 'katago') rows.push({ act: 'pause', label: '暂停分析（不自动算棋）' });
    if (anyPaused) rows.push({ act: 'resume', label: '恢复分析' });
    if (anyReady || anyPaused) rows.push({ act: 'unload', label: '腾出显存（卸载）' });
    if (!rows.length) rows.push({ act: null, label: '（没有可执行的操作）' });

    const st = engStateOf(key);
    const menu = $('engmenu');
    menu.textContent = '';
    const head = document.createElement('div');
    head.className = 'mhead';
    head.textContent = meta.on + ' · ' + ENG_STATE_TXT[st];
    menu.appendChild(head);
    for (const r of rows) {
      const b = document.createElement('button');
      b.textContent = r.label;
      if (!r.act) { b.disabled = true; b.style.color = 'var(--text-dim)'; b.style.cursor = 'default'; }
      else b.onclick = () => { closeEngineMenu(); doEngineAct(key, r.act); };
      menu.appendChild(b);
    }
    menu.hidden = false;
    /* 定位：贴在按钮正下方；右边超出窗口就往回收一点 */
    const r = anchorEl.getBoundingClientRect();
    const w = menu.offsetWidth || 170;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    engMenuKey = key;
  }

  async function doEngineAct(key, act) {
    const list = ENG_KEYS[key] || [key];
    let err = '';
    for (const k of list) {
      /* 「暂停 / 恢复」只对分析引擎做 —— 对弈引擎是被动的，暂停它没有含义。 */
      if ((act === 'pause' || act === 'resume') && k !== 'analyze') continue;
      const f = window.api.engine && window.api.engine[act];
      if (typeof f !== 'function') { err = '这个操作不可用'; break; }
      const r = await f(k);
      if (r && r.error) err = r.error;
    }
    if (err) { flash(err); return; }
    if (act === 'load') flash(ENG_META[key].on + ' 正在加载，好了会自己变绿');
    if (act === 'unload') flash(ENG_META[key].on + ' 已卸载');
  }

  /* ★ 引擎没加载时，点需要它的功能 → 提示 + 把操作菜单直接弹到眼前
     （2026-10-05 用户拍板的 A 方案：不静默、也不偷偷自己加载）。
     返回 true = 已经处理了，调用方直接 return 就行。 */
  function needEngine(key, what) {
    const ready = key === 'coach' ? coachReady : (key === 'play' ? engineReadyPlay : engineReady);
    if (ready) return false;
    const group = key === 'coach' ? 'coach' : 'katago';
    const nm = ENG_META[group].on;
    const st = engStateOf(group);
    if (st === 'loading') { flash(nm + ' 正在加载，稍等一下……'); return true; }
    flash(nm + ' 还没加载' + (what ? '，' + what + '得先有它' : '') + ' —— 点下面「加载」');
    const el = document.querySelector('.engines .eng[data-key="' + group + '"]');
    if (el) openEngineMenu(group, el, true);       // 把菜单弹出来，省得再去找
    return true;
  }
  window.needEngine = needEngine;

  for (const el of document.querySelectorAll('.engines .eng')) {
    el.onclick = e => { e.stopPropagation(); openEngineMenu(el.dataset.key, el); };
  }
  document.addEventListener('click', e => {
    if ($('engmenu').hidden) return;
    if (e.target.closest('#engmenu') || e.target.closest('.engines')) return;
    closeEngineMenu();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeEngineMenu(); });

  window.api.engineStatus().then(applyEngineStatus);

  /* ---------- 顶栏「刷新」按钮（2026-10-06 晚新增，用户要求） ----------
     用途：出现「推荐点不显示 / 棋盘上方『计算中… N』定住不动」时的**急救键**。
     为什么必须有它（而不是只靠自动恢复）：分析链路上有两条"等引擎回话"的路
     （主进程 90 秒、渲染端 25 秒），但都可能因为别的原因没兜住；
     一旦那一次 await 永不返回，`anaBusy` 就永远占着 → 整个分析链路停摆，
     用户能做的只有重启软件。有了它，用户自己点一下就放开、重排、并顺手救引擎。

     三步，顺序不能反：
       ① **放开前端卡住的闸门**（anaBusy / anaPoke / 超时计数），并把「待重算」意图留着；
       ② **问一遍引擎真实状态**；灯是 error / 显示就绪但引擎其实不可用 → 卸载再加载（真重启）；
       ③ **重排一次分析** —— 引擎若在重启，等它就绪后 onStatus → syncUI 会自己再排。
     ★ 不是"卡了才做"：没卡的时候点它也有用（相当于刷新状态 + 重排一次当前局面），
       所以按钮不做任何"你不需要点"的拦截，点了就有反馈。 */
  const btnRefresh = $('btn-engine-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = async e => {
      e.stopPropagation();
      if (btnRefresh.dataset.busy === '1') return;          // 防连点
      btnRefresh.dataset.busy = '1';
      const wasStuck = anaBusy && anaBusySince && (Date.now() - anaBusySince > REFRESH_STUCK_MS);
      const waited = anaBusySince ? Math.round((Date.now() - anaBusySince) / 1000) : 0;

      /* ① 放开闸门 */
      anaBusy = false;
      anaPoke = false;
      anaTimeouts = 0;
      anaBusySince = 0;
      anaForceCur = true;        // 逼它把当前局面重算一遍（选点/胜率重新上屏）
      /* ★ 欠账也一起清掉（2026-10-06 晚，实测 _cdp_refresh.mjs）。
         原来只清了闸门、留着队列，于是状态栏写着「清了 N 条待补账」而队列其实还在
         —— 文案和事实不符，而且那份队列可能正是"卡住"的残留（里面混着已撤销手数）。
         清掉它，让分析从当前局面干净地重来一遍；欠的历史会由后续落子重新入队。 */
      const pending = anaQueue.length;
      anaQueue = [];

      let note = '已刷新';
      if (wasStuck) note += '（原来卡了 ' + waited + ' 秒）';
      if (pending) note += '（清了 ' + pending + ' 条待补账）';

      try {
        /* ② 引擎状态：先自己查一遍（别信界面上可能已经过期的灯） */
        let s = null;
        try { s = await window.api.engineStatus(); } catch (err) { s = null; }
        applyEngineStatus(s);
        const a = readEngineState(s, 'analyze');

        /* 灯说就绪、但分析请求其实回不来（engineNote 有内容）→ 真重启一次。
           ⚠️ 只在**已经出过错**或**状态灯是 error** 时重启 ——
              不能看见"就绪"就重启（那会把正常使用的引擎白白断掉十几秒）。 */
        const broken = !!(s && s.analyze && (s.analyze.state === 'error' || a.error));
        if (broken) {
          note += ' · 引擎不正常，正在重启';
          flash(note);
          await window.api.engine.unload('katago').catch(() => { });
          /* 等进程真正退干净再拉 —— launch() 开头是 `if (e.proc) return`，
             退不干净就拉不起来（这个坑在 main.js 里踩过）。 */
          await new Promise(r => setTimeout(r, 1500));
          const r = await window.api.engine.load('katago').catch(() => null);
          note += (r && r.error) ? ('（重启失败：' + r.error + '）') : '（十几秒后变绿）';
        }
      } catch (err) {
        note += ' · 刷新时出错：' + ((err && err.message) || err);
      }

      /* ③ 重排分析 + 让 AI 如果该走就走（顺序无所谓，两者各自有闸门） */
      scheduleAnalysis(0, true);
      if (needAIMove()) scheduleAIMove(0);
      draw();
      flash(note);
      setTimeout(() => { btnRefresh.dataset.busy = '0'; }, 400);
    };
  }
  /* 版本号填到「帮助」面板上 —— 用户判断「要不要更新」的唯一依据（包名不带版本号）。 */
  window.api.appVersion().then(v => { const el = $('help-ver'); if (el) el.textContent = 'v' + v; }).catch(() => { });
  window.api.onStatus(applyEngineStatus);
  /* 边算边刷（引擎每 0.25 秒推一次中途报告）。
     ★ 必须过滤掉「不是当前局面」的报告：补历史欠账的请求也会推中途报告（它成了主进程
       眼里的「最近一次查询」），不过滤就会把**别的局面**的候选点/胜率画到当前棋盘上。
       p.turn = 这条报告是「第几手之后」的局面（= 当时请求的 analyzeTurns）。 */
  window.api.onProgress(p => {
    /* ★ 换局 / 换棋谱之后，旧请求的中间报告一律不要（anaReqGen 还停在上一代）——
       否则它们会往刚清空的界面上写数据。 */
    if (anaReqGen !== gameGen) return;
    /* ★★ 只认分析引擎的报告（2026-10-06 审查发现）。
       对弈引擎（AI 思考时）用的也是同一个通道，但它是人类棋风权重 + 你选的段位档，
       数字和分析引擎不一样；而它那次请求的手数恰好等于当前手数，
       下面那条「手数过滤」拦不住它 —— 结果 AI 每走一步胜率条就闪一下、
       还会污染走势曲线和 state.lastEval。主进程现在也会带 `engine` 且只推分析引擎的，
       这里再挡一道（两边都拦，任一侧改动都不会漏）。 */
    if (!p || p.engine !== 'analyze') return;
    if (typeof p.turn === 'number' && p.turn !== state.viewAt) return;
    applyAnalysis(p, state.viewAt);
    draw();
    renderCommentBox();      // 中间报告也在刷新「这一手的分析」那块文字（见 runAnalysisOnce 里的注释）
  });
}

/* ---------------- 落子音效 ---------------- */

/* 素材取自九宫争鼎开发包（game/assets/audio/go_stone_*.wav，44.1k/16bit/单声道，0.08–0.20 秒）
   5 个变体随机播（且不与上一手重复），避免听腻。

   ★★ 2026-10-06 重写（用户报「有时候声音特别小、几乎听不见」）。三个原因，一起修：

   ① **同一个元素被连续重播**：原来只有 5 个 Audio 元素全局轮流用，播之前先
      `a.currentTime = 0` —— 而如果那个元素**还在播**，这就等于对正在播放的元素做 seek，
      Chromium 会把声音掐断、或从中间接上，听起来就是「变轻了」甚至没声。
      改法：每种音效预备 3 个副本（共 15 个元素，启动时全部预载），
      播放时优先挑**没在播的那个** —— 不再去动正在播的元素。
   ② **起播撞上重绘**：落子后紧接着要重画整张盘（形势雾是 N×N 逐点画，很吃主线程）。
      在重绘**之前**起播的话，音频管线刚建好就被主线程占住，
      两个只有 0.08/0.09 秒的短音效会被啃掉开头 —— 这也是「有时候」的来源。
      改法：由调用方把起播挪到重绘之后（见 tryPlay 里的 setTimeout）。
   ③ **整体偏轻**：实测 5 个音效的 RMS 是 8.4%~11.3%，旧代码又统一压到 volume 0.5。
      现在按实测 RMS 归一、基准提到 0.85（数值见 SOUND_GAIN）。 */
const SOUND_FILES = ['go_stone_0.wav', 'go_stone_1.wav', 'go_stone_2.wav', 'go_stone_3.wav', 'go_stone_4.wav'];
/* 每个音效的音量：按实测 RMS 归一（基准 0.85 = RMS 11.3% 的那个）。
   实测值 RMS%：0→8.4  1→11.3  2→10.9  3→9.4  4→10.9
   0 和 3 比基准轻，补到 1.0 封顶（真值 1.14 / 1.02，封顶后仍比其余略轻一点，可接受）。 */
const SOUND_GAIN = [1.0, 0.85, 0.88, 1.0, 0.88];
const SOUND_COPIES = 3;                 // 每种 3 个副本 → 连点也不会撞上正在播的
const SOUND_POOL = [];
SOUND_FILES.forEach((f, i) => {
  for (let k = 0; k < SOUND_COPIES; k++) {
    const a = new Audio('../assets/audio/' + f);
    a.volume = SOUND_GAIN[i] === undefined ? 0.85 : SOUND_GAIN[i];
    a.preload = 'auto';
    SOUND_POOL.push({ el: a, file: i });
  }
});
let lastSoundFile = -1;

function playStoneSound() {
  if (!state.soundOn || !SOUND_POOL.length) return;
  /* 优先挑「没在播」的副本；极端连点导致全在播时，才退而用全部（概率极低） */
  const free = SOUND_POOL.filter(x => x.el.paused || x.el.ended);
  let pool = free.length ? free : SOUND_POOL;
  /* 别和上一手用同一个音效（同一个文件听着会腻） */
  const other = pool.filter(x => x.file !== lastSoundFile);
  if (other.length) pool = other;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastSoundFile = pick.file;
  try { pick.el.currentTime = 0; pick.el.play().catch(() => { }); } catch (e) { /* 出声失败不打断对局 */ }
}

/* ---------------- 对局计时 ---------------- */

/* 档位按**真实赛事**定（2026 现役）：
   围甲 / 三星杯 / 烂柯杯 = 每方 2 小时 + 5×60 秒读秒；
   应氏杯 / LG 杯 / 梦百合杯 = 每方 3 小时（LG 是 5×40 秒读秒）。
   注意围棋用「读秒」（每次 N 秒、共 M 次，用完再超时才判负），
   不是国际象棋那种每手加时 —— 只有超快棋那档用「每手加时」。 */
const CLOCK_PRESETS = {
  none:  { label: '不限时' },
  blitz: { label: '超快棋',   main: 300,   add: 5 },
  rapid: { label: '快棋',     main: 1800,  byo: 30, byoN: 3 },
  slow:  { label: '慢棋',     main: 3600,  byo: 60, byoN: 5 },
  pro:   { label: '职业赛',   main: 7200,  byo: 60, byoN: 5 },
  world: { label: '世界大赛', main: 10800, byo: 60, byoN: 5 },
};

/* 双方名字：人机对弈 → 人 PLAYER / AI KATAGO；摆棋（等于本地双人）→ PLAYER1 / PLAYER2 */
/* 没设过名字时的默认叫法（按模式区分） */
function defaultName(color) {
  if (settings.mode === 'free') return color === 'b' ? 'PLAYER1' : 'PLAYER2';
  /* ★ 习题练习：一方是你、另一方是 KATAGO（谁执哪一方看 settings.taicolor）。
     ⚠️ **不能落到下面那条 `color === state.myColor`** —— 「我下两边」时两边都是你在走，
        写成 PLAYER / KATAGO 会读成"KATAGO 在执一方"，是误导。 */
  if (settings.mode === 'tsumego') {
    if (state.tsumego && state.tsumego.defend === 'both') return color === 'b' ? '黑（你）' : '白（你）';
    return color === tsAIColor() ? 'KATAGO' : '你';
  }
  /* ★ 双方都由 KATAGO 走：两边都叫 KATAGO（2026-10-18） */
  if (state.autoBoth) return 'KATAGO';
  return color === state.myColor ? 'PLAYER' : 'KATAGO';
}

/* 右侧显示的名字：用户改过的 / 棋谱带来的 优先，都没有才回落到默认。
   ★ 名字**和计时无关** —— 不计时也要显示、也要能改（原来它俩绑在一起：
     `renderClocks()` 一开头就是 `if (!c.on) return`，不限时那两行名字压根不会被更新）。 */
function clockName(color) {
  return (state.names && state.names[color]) || defaultName(color);
}

/* 把名字画到右侧两栏（读秒标记只在计时时叠加）。
   唯一改 cid-* 文本的地方 —— 正在改名（里面挂了 input）时跳过，别把用户正在打的字覆盖掉。 */
function renderNames() {
  const c = state.clock;
  for (const col of ['b', 'w']) {
    const el = $('cid-' + col);
    if (!el || el.querySelector('input')) continue;
    const name = clockName(col);
    let txt = name;
    if (c && c.on) {
      const d = clockDisplay(col);
      if (d.phase === 'byo') txt = name + ' · 读秒' + Math.max(0, d.n);
    }
    el.textContent = txt;
  }
}

/* 点名字就地改名（回车 / 失焦确认，Esc 取消）—— 像棋谱库的「备注」那样。
   改完立刻生效：右侧显示、导出棋谱写进 PB/PW 都用它。 */
function bindClockName(color) {
  const el = $('cid-' + color);
  if (!el) return;
  el.title = '点一下可以改这个名字（导出棋谱时会写进棋谱的双方名）';
  el.classList.add('editable');
  el.onclick = () => {
    if (el.querySelector('input')) return;
    const old = el.textContent;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 24;
    inp.value = (state.names && state.names[color]) || '';
    inp.placeholder = defaultName(color);
    let closed = false;
    const done = ok => {
      if (closed) return;
      closed = true;
      const v = ok ? inp.value.trim().slice(0, 24) : null;
      if (ok) {
        state.names[color] = v;
        /* ★ 必须把输入框**从 DOM 里摘掉**：renderNames 见到 el 里挂着 input 会跳过
           （免得覆盖用户正在打的字）—— 不摘掉的话名字栏会一直是空白。
           （实测踩过：state.names 明明存进去了，界面上却是空的。） */
        el.textContent = '';
        syncUI();                     // syncUI → renderNames 把新名字画上去
      } else {
        el.textContent = old;
      }
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { done(false); }
      e.stopPropagation();            // 别让输入框里的按键触发全局快捷键
    };
    inp.onblur = () => done(true);
    el.textContent = '';
    el.appendChild(inp);
    inp.focus();
    inp.select();
  };
}

function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function clockReset() {
  const P = CLOCK_PRESETS[settings.clock] || CLOCK_PRESETS.none;
  const c = state.clock;
  c.key = settings.clock;
  c.on = !!P.main;
  c.main = P.main || 0;
  c.byo = P.byo || 0;
  c.byoN = P.byoN || 0;
  c.add = P.add || 0;
  c.b = { t: c.main, n: c.byoN };
  c.w = { t: c.main, n: c.byoN };
  c.side = sideToMove(0);                    // 让子 / 座子局是白先
  c.phase = 'main';
  c.since = performance.now();
  c.running = c.on;
  c.expired = null;
  c.paused = false;                          // 新对局一定要解除「试下暂停」
  beepedSec = -1;                            // 读秒报时状态一并复位

  /* ★ 这里**不要**再写 `$('clock-card').hidden = !c.on` ——
     CSS 里 `.clock-card { display: flex }` 的特异性会把 `hidden` 的 display:none 顶掉，
     写了也没用（是个静默失效的写法）。而且**名字栏就住在计时卡里**，
     真的把它藏起来，不限时的时候就看不到双方名字了。
     所以 HTML 上那个 hidden 属性也已经删掉（2026-10-04 代码审查发现）。
     不计时时把时间显示成 --:--（见 renderClocks），别留着上一局的数字。 */
  renderClocks();      // 不计时时它会把时间位换成灰色占位 --:--（见 .ctime.off）
}

/* 落子后结算：扣掉本手用时，换对方 */
function clockSwitch() {
  const c = state.clock;
  if (!c.on || c.expired || c.paused) return;   // 试下（草稿）期间不走表
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    st.t = Math.max(0, st.t - el);
    if (c.add) st.t += c.add;               // 超快棋：每手加时
  }
  /* 读秒阶段不扣总时间 —— 读秒是「每手独立给 N 秒」 */

  c.side = c.side === 'b' ? 'w' : 'b';
  c.phase = c[c.side].t > 0 ? 'main' : 'byo';
  c.since = now;
  beepedSec = -1;             // 换手 → 读秒报时的「响过哪一秒」要重算，否则下一手不响
  renderClocks();
}

/* 悔棋 / 停一手 / 跳转时调用：重置本手起点，不结算（时间不倒退，规则如此） */
function clockTouch() {
  if (state.clock.on) state.clock.since = performance.now();
}

function clockDisplay(color) {
  const c = state.clock;
  const st = c[color];
  const isTurn = (color === c.side) && c.running && !c.expired
    && state.viewAt === state.moves.length;   // 回看历史手时暂停，不给双方扣时间
  const el = isTurn ? Math.max(0, (performance.now() - c.since) / 1000) : 0;
  if (st.t > 0) return { sec: Math.max(0, st.t - el), phase: 'main', n: st.n };
  if (c.byo > 0) return { sec: Math.max(0, c.byo - el), phase: 'byo', n: st.n };
  return { sec: 0, phase: 'main', n: st.n };
}

function renderClocks() {
  const c = state.clock;
  /* 不限时：时间位留一串**灰占位**（--:--，见 .ctime.off）让名字当主角，
     高度也和计时时一致（切换时不会跳）。名字栏是常显的，跟计时无关。 */
  if (!c.on) {
    for (const col of ['b', 'w']) {
      const t = $('ctime-' + col);
      if (t) { t.textContent = '--:--'; t.classList.add('off'); }
    }
    renderNames();
    return;
  }
  for (const col of ['b', 'w']) {
    const t = $('ctime-' + col);
    if (t) t.classList.remove('off');
  }
  [['b', 'clock-b', 'ctime-b'], ['w', 'clock-w', 'ctime-w']].forEach(([col, box, tm]) => {
    const d = clockDisplay(col);
    const bx = $(box);
    bx.classList.toggle('active', col === c.side && !c.expired);
    bx.classList.toggle('byo', d.phase === 'byo' && d.sec > 0);
    bx.classList.toggle('out', c.expired === col);
    $(tm).textContent = fmtClock(d.sec);
  });
  renderNames();      // 名字 + 读秒标记（每 tick 跟着走）
}

/* ★ 超时判负（2026-10-04 用户要求）——
   原来超时只 flash 一句「超时」就完事，棋局还能接着下，计时等于白设。
   统一走 doResign（by='timeout'），结果条会正常弹出。 */
function expireClock(side, reason) {
  const c = state.clock;
  if (c.expired) return;
  c.expired = side;
  c.running = false;
  doResign(side, 'timeout');
  renderClocks();
  flash((side === 'b' ? '黑方' : '白方') + '超时 · 判负（' + reason + '）');
  syncUI();
}

/* 读秒提示音：用 Web Audio **现场合成**一个短促的「滴」——
   不用音频素材（assets 里只有落子声），也不用联网。
   真实对局里裁判在最后 10 秒会一秒一念，这里照着做。 */
let beepCtx = null;
function playBeep() {
  if (!state.soundOn) return;                 // 跟落子音效共用底栏那个开关
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    beepCtx = beepCtx || new AC();
    if (beepCtx.state === 'suspended') beepCtx.resume();
    const t = beepCtx.currentTime;
    const o = beepCtx.createOscillator();
    const g = beepCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(beepCtx.destination);
    o.start(t); o.stop(t + 0.09);
  } catch (e) { /* 出不了声就不出，绝不能影响对局 */ }
}

/* 读秒最后 10 秒：每秒一声。同一秒只响一次（tick 是 250ms 一次，不判重会连响四声）。 */
let beepedSec = -1;
function maybeBeepSecond() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired) { beepedSec = -1; return; }
  const d = clockDisplay(c.side);
  const sec = Math.ceil(d.sec);
  if (d.phase !== 'byo' || sec <= 0 || sec > 10) { beepedSec = -1; return; }
  if (sec === beepedSec) return;
  beepedSec = sec;
  playBeep();
}

function clockTick() {
  const c = state.clock;
  if (!c.on || !c.running || c.expired || c.paused) return;   // 试下（草稿）期间暂停
  const now = performance.now();
  const el = Math.max(0, (now - c.since) / 1000);
  const st = c[c.side];

  if (c.phase === 'main') {
    if (el >= st.t) {
      /* 主时间走完：有读秒就进读秒，**没读秒的直接判负**。
         （原来只写了「有读秒」那一半 —— 万一有 byo = 0 的档位，时间会停在 00:00
           既不进读秒也不判负，一直卡着。） */
      if (c.byo > 0) { st.t = 0; c.phase = 'byo'; c.since = now; }
      else { expireClock(c.side, '主时间用完，本局不读秒'); return; }
    }
  } else if (c.byo > 0) {
    if (el >= c.byo) {
      st.n -= 1;                                                    // 读秒一次用完，扣一次
      if (st.n < 0) { expireClock(c.side, '读秒次数已用尽'); return; }
      c.since = now;                                                // 还有次数 → 重新读一次
    }
  }
  renderClocks();
  maybeBeepSecond();        // 读秒最后 10 秒每秒一响
}

setInterval(clockTick, 250);

/* ---------------- 形势显示（ownership）----------------
   数据源：分析请求里 includeOwnership:true → 顶层 ownership 数组（长度 N*N，-1~+1）。
   **不增加搜索量**（引擎本来就在算），只多传几百个数。

   ★ 颜色按 KaTrain 实机截图定的（不是照抄配置，是**看着它的画面反推的**）：
     - 它的棋盘底色是暖木色，白雾 = **比底色更亮的暖白**，黑雾 = **深褐**（不是纯黑）
     - **几乎铺满整个盘面**：连接近中立的点也有很淡的色调，深浅表示归属强弱
     ⚠️ 别把「第一版整盘全是黑雾」归因到颜色上 —— **真因是符号搞反了**
        （ownership 是相对当前走棋方的，见上面那段），当时白雾被画成了黑雾。
        另有观感问题：硬边方块 + 中立点不画 → 盘面很碎，已由下面的「小贴图放大」解决。 */
/* ===== 形势显示：参数**照抄 KaTrain 的 Theme 默认值**（katrain/gui/theme.py）
   OWNERSHIP_COLORS = {B:[0,0,0.10,0.75], W:[0.92,0.92,1.0,0.80]}
   OWNERSHIP_GAMMA = 1.33 · BLOCKS_THRESHOLD = 0.3 · MARK_SIZE = 0.42 · STONE_MIN_ALPHA = 0.85

   ★★ 一条我判断错了、后来改回来的（用户质疑后重算，别重犯）：
      我一度认为「我们棋盘浅（当时 #f2dfba→#e9d3a8 米黄；**2026-10-04 已按用户拍板调深为
      #dfc48f→#d4b47c「中深」档，白雾色差 64→105**），KaTrain 的白雾(0.92,0.92,1.0)涂上去=没涂」，
      于是擅自把白雾改成淡天蓝。**这个推断是错的** —— 我只看了亮度，漏了色相：
          棋盘底色 B 通道 0.729，白雾 B 通道 1.00，α=0.8 叠加后 B=0.946 → **差 0.22，偏蓝很明显**。
      结论：**白雾照抄 KaTrain 原值，不做任何"适配"**。底色深浅不影响它可见。 */
const TERR_B = [0.0, 0.0, 0.10, 0.75];
const TERR_W = [0.92, 0.92, 1.0, 0.80];   // 照抄 KaTrain，不偏离
const TERR_GAMMA = 1.33;
const TERR_BLOCK_TH = 0.3;
const TERR_BLOCK_MARK = 0.42;
const TERR_STONE_MIN = 0.85;

/* 离屏贴图：做法完全照抄 KaTrain 的 draw_territory_color ——
   把 N×N 个归属值画成一张 **(N+2)×(N+2) 的小贴图**（外圈 alpha=0，让边缘平滑衰减），
   再一次性拉伸铺满棋盘。放大时由浏览器插值 → 得到**连续的雾**。
   ⚠️ 两个关键点，第一版都做错了：
     ① 必须比棋盘多 1 行/列（否则边缘是硬的）；
     ② alpha 直接取 |ownership|，**中立的点要完全透明** —— 我自己加过 A_MIN 铺底，
        结果整盘糊成一片。 */
let terrCv = null, terrCx = null, terrIm = null;

function drawTerritory() {
  const o = state.ownership;
  if (!state.showTerritory || !o || o.length !== N * N) return;

  const blocksMode = state.terrStyle === 'blocks';
  const W = N + 2;

  if (!terrCv) { terrCv = document.createElement('canvas'); terrCx = terrCv.getContext('2d'); }
  if (terrCv.width !== W) {
    terrCv.width = W; terrCv.height = W;
    terrIm = terrCx.createImageData(W, W);
  }
  const d = terrIm.data;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const gx = x - 1, gy = y - 1;
      const i = (y * W + x) * 4;
      if (gx < 0 || gx >= N || gy < 0 || gy >= N) { d[i + 3] = 0; continue; }   // 外圈透明
      const v = o[gy * N + gx];
      let a = Math.min(1, Math.abs(v));
      if (blocksMode) a = a > TERR_BLOCK_TH ? 1 : 0;
      a = Math.pow(a, 1 / TERR_GAMMA);          // Gamma 曲线（KaTrain 有，我第一版漏了）
      if (a <= 0) { d[i + 3] = 0; continue; }
      const col = v > 0 ? TERR_B : TERR_W;
      d[i] = (col[0] * 255) | 0;
      d[i + 1] = (col[1] * 255) | 0;
      d[i + 2] = (col[2] * 255) | 0;
      d[i + 3] = (a * col[3] * 255) | 0;        // 基础 alpha × 归属强度
    }
  }
  terrCx.putImageData(terrIm, 0, 0);

  ctx.save();
  /* blocks = 硬边方块（nearest）；雾 = 平滑插值（linear）—— 与 KaTrain 的 mag_filter 一致 */
  ctx.imageSmoothingEnabled = !blocksMode;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  /* 贴图第 (x+1) 个像素对应交叉点 x → 起点在棋盘左上一格半的地方 */
  const x0 = pad - gap * 1.5;
  ctx.drawImage(terrCv, x0, x0, gap * (N + 2), gap * (N + 2));
  ctx.restore();
}

/* 画形势。画在棋盘线之上、棋子之下（子压在上层不受影响）。
   ⚠️ 这里曾出现「同一个函数定义了两遍」——后定义的会覆盖先定义的，
      导致改了半天不生效。改这类函数后务必 grep 一遍函数名，确认只有一处。 */

/* 棋子上的形势叠加 —— 公式照抄 KaTrain 的 draw_stone：
     这块地归它（player == owner）→ alpha = MIN + (1-MIN)×|ownership|（归属越强越实）
     不是它的地          → alpha = MIN（固定最低，也就是"死子"）
   TERR_STONE_MIN = 0.85 也照抄 KaTrain（我起初用 0.5，太夸张、会让人误以为已经提掉了）。 */
function stoneAlphaAt(x, y, stone) {
  if (!state.showTerritory || state.terrStyle !== 'fog') return 1;
  const o = state.ownership;
  if (!o || o.length !== N * N) return 1;
  const v = o[y * N + x];
  const owner = v > 0 ? 1 : -1;              // 1 = 黑占优 / -1 = 白占优
  /* ★★ 2026-10-06 审查发现：传进来的 `stone` 是**棋盘数组的值**（1=黑、2=白），
     而 owner 是 **±1** 的约定 —— 必须先把 stone 也换成 ±1 再比。
     原来直接写 `stone === owner`：白棋是 2，永远不等于 -1，
     于是**所有白子在形势雾里都被当成死子、一直画成半透明**（黑棋却正常）。
     一直没人报，是因为它看起来像"雾的样式"。 */
  const mine = stone === 1 ? 1 : (stone === 2 ? -1 : 0);
  if (mine === owner) return TERR_STONE_MIN + (1 - TERR_STONE_MIN) * Math.abs(v);
  return TERR_STONE_MIN;
}

/* 变化图（PV）：鼠标在推荐点上停 1 秒 → 把「这一手之后预计会怎么走」画在盘上。
   画成**半透明棋子 + 序号**，压在真棋子之上（它是假设，不是盘面，所以用透明度区分）。
   数据来自引擎给每个候选点的 pv（主进程只透传前 8 手）。 */
function drawPV() {
  const P = state.pv;
  if (!P || !P.list || !P.list.length) return;
  const b = boardAt(state.viewAt);
  const first = sideToMove(state.viewAt);     // pv 第 1 手的落子方（= 现在该谁走）
  const seen = new Set();
  let n = 0;                                   // 画出来的序号（1 开始）
  P.list.forEach((mv, k) => {
    const pt = fromGTP(mv);
    if (!pt) return;                           // pass 或不认识的坐标
    if (k === 0 && pt.x === P.x && pt.y === P.y) return;   // pv[0] 通常就是这个推荐点本身，它已有标记，别重复画
    const key = pt.x + ',' + pt.y;
    if (seen.has(key)) return;
    seen.add(key);
    /* 盘上已有子的点跳过（PV 里提子后重下的情况）—— 盖在真子上反而看不清 */
    if (b[idx(pt.x, pt.y)] !== 0) return;
    const [cx, cy] = pxOf(pt.x, pt.y);
    /* 落子方按 pv 里的位置 k 定（k=0 是该走的一方），不要用 n —— 跳过第一个不影响手顺 */
    const isB = (k % 2 === 0) ? (first === 'b') : (first !== 'b');
    ctx.globalAlpha = 0.66;
    drawStone(cx, cy, isB ? 'b' : 'w');
    ctx.globalAlpha = 1;
    n++;
    ctx.fillStyle = isB ? '#f2f2f2' : '#1b1b1a';
    ctx.font = `bold ${Math.max(8, gap * 0.34).toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), cx, cy + gap * 0.01);
  });
}

/* 变化图「现在该不该画」—— 所有条件集中在这里，draw() 和测试都用它。
   ★ 刻意不要求「那个点还在推荐列表里」：分析每隔几秒出一批新候选，列表会换人，
     若要求它还在列表里，变化图会在你看的时候**闪掉**（实测踩过）。
     局面没变（candAt === viewAt）时，这个变化图依然有效。
   ★ 也刻意**不依赖 mouseleave 事件**：鼠标不在那儿了，条件自然不成立 ——
     只靠事件清理的话，窗口失焦/事件被吞都会留下残影。 */
function pvVisible() {
  const P = state.pv;
  if (!P) return false;
  if (!state.showPV || !state.showHints) return false;
  if (settings.mode === 'play' && !isMyTurn()) return false;      // 和推荐点同一套规则
  if (!hover || hover.x !== P.x || hover.y !== P.y) return false; // 鼠标得还停在那儿
  return state.candAt === state.viewAt;                           // 局面没变（变了就作废）
}

/* 变化图的触发：鼠标停在**推荐点**上满 1 秒才显示。
   为什么要等 1 秒：鼠标扫过棋盘时会一路经过候选点，立刻显示的话屏幕上会一直闪东西。
   （用户 2026-10-04 明确要求「悬停在推荐点上保持 1 秒然后显示后续变化」） */
function updatePV() {
  clearTimeout(pvTimer); pvTimer = null;
  /* 人机对弈时只在轮到我方才显示 —— 和推荐点同一套规则，
     否则你刚落子、AI 还没走，画面上会冒出「对手该怎么下」的变化。 */
  const allowed = state.showPV && (settings.mode !== 'play' || isMyTurn());
  const c = (allowed && hover)
    ? state.candidates.find(k => k.x === hover.x && k.y === hover.y)
    : null;
  if (!c || !c.pv || c.pv.length < 2) {
    if (state.pv) { state.pv = null; draw(); }
    return;
  }
  if (state.pv && state.pv.x === c.x && state.pv.y === c.y) return;   // 已经在显示这个点了
  state.pv = null;                                                    // 换点了：先收掉旧的
  pvTimer = setTimeout(() => {
    state.pv = { x: c.x, y: c.y, list: c.pv };
    draw();
  }, 1000);
}

/* ---------------- 胜率走势 / 手数列表 ---------------- */

/* 走势曲线有两种纵轴（用户 2026-10-04 拍板「两种都给，加切换」）：
     · win  = 黑方胜率（0~100%），50% 那条虚线是「均势」
     · lead = 黑方领先目数（正 = 黑优），0 那条线是「均势」
   ★ 视角固定为**黑方** —— 引擎给的原始值是「轮到走棋那一方」的，
     照它画每落一手曲线就要上下翻一次，没法看；统一成黑方才连得成一条线。
   ★ 两种都**按本局实际范围自适应量程**：否则一盘势均力敌的棋，曲线会全挤在
     均势线附近，看不出"这一手亏了多少"（实测九个点只占屏幕高度的 5%）。
   ★ 量程自适应之后**必须把范围标出来**（右上角那行）—— 否则会被误读成
     "每盘都这么激烈"：一盘一路碾压的棋铺满之后看着也很刺激，
     但右上角会老老实实写着"全程 85% ~ 96%"。 */
/* 当前走势图画的是哪条线 —— 有分支的棋谱里必须标出来（2026-10-22）。
   为什么：两条分支常常共享大前半盘，曲线形状本来就很像；再叠上"切分支后
   曲线没变"的错觉，用户会以为切了没反应。写一句「共 N 条分支的报告 /
   这条分支还没复盘」，比任何解释都直接。 */
function curveLineInfo() {
  const doc = state.reviewDoc;
  const keys = (doc && doc.lines) ? Object.keys(doc.lines) : [];
  if (!keys.length) return null;
  const cur = lineKeyOfMoves(state.moves);
  return { n: keys.length, has: !!doc.lines[cur] };
}
function syncCurveLineLabel() {
  const el = $('curve-line');
  if (!el) return;
  const inf = curveLineInfo();
  /* 文字要**短**（卡片只有 268px 宽，还得给右边「胜率/目差」留位置）：
     完整含义放 title 里。 */
  el.textContent = (!inf || (inf.n < 2 && inf.has)) ? ''
    : (inf.has ? '· ' + inf.n + ' 条分支' : '· 未复盘');
  el.title = !inf ? ''
    : (inf.has
      ? '这份棋谱已有 ' + inf.n + ' 条分支的报告，走势图画的是你当前站的这条线'
      : '当前这条分支还没复盘 —— 换回有报告的分支，或点「AI 复盘」算这一条');
}

function renderCurve() {
  const cv = $('curve');
  syncCurveLineLabel();
  const w = cv.clientWidth || 268, h = cv.clientHeight || 76;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const isLead = state.curveMode === 'lead';
  const src = isLead ? state.leads : state.history;
  const pT = 14, pB = 14, pL = 30, pR = 5;     // 上下各留一行：左上角写模式、右上角写量程
  const W = Math.max(1, w - pL - pR), H = Math.max(1, h - pT - pB);

  /* 左上角：这图画的是哪条轴（**视角是黑方**，必须写出来） */
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(isLead ? '黑方领先（目）' : '黑方胜率', 2, 1);

  const sg = v => (v > 0 ? '+' : (v < 0 ? '\u2212' : '')) + Math.abs(v).toFixed(1);

  /* 有数据的手数范围 —— 没数据的地方不占宽度 */
  const idx = Object.keys(src).map(Number)
    .filter(i => typeof src[i] === 'number').sort((a, b) => a - b);

  if (!idx.length) {
    c.fillStyle = 'rgba(0,0,0,.26)';
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const inf = curveLineInfo();
    c.fillText((isLead && Object.keys(state.history).length)
      ? '没有目差数据 · 重新复盘一次就有了'
      : (state.noGame ? '还没有对局'
        : ((inf && !inf.has) ? '这条分支还没复盘'
          : '逐手走一遍就会画出来')), w / 2, pT + H / 2);
    return;
  }

  /* 量程 = 本局实际范围 + 12% 余量；跨度太小时撑到最小跨度，
     免得一两个点的正常抖动被放大成"剧烈起伏"（胜率最小 22 个百分点、目差最小 6 目）。 */
  const vals = idx.map(i => src[i]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const minSpan = isLead ? 6 : 0.22;
  if (mx - mn < minSpan) { const m0 = (mx + mn) / 2; mn = m0 - minSpan / 2; mx = m0 + minSpan / 2; }
  const pad = (mx - mn) * 0.12;
  let lo = mn - pad, hi = mx + pad;
  if (!isLead) { lo = Math.max(0, lo); hi = Math.min(1, hi); }   // 胜率不越出 0~100%

  const i0 = idx[0], i1 = idx[idx.length - 1];
  const X = i => pL + (i1 <= i0 ? W / 2 : W * ((i - i0) / (i1 - i0)));
  const Y = v => pT + H - H * ((v - lo) / (hi - lo));
  const MID = isLead ? 0 : 0.5;                                   // 「均势」线

  /* 右上角：本局量程（自适应之后必须标出来，否则会被误读） */
  c.fillStyle = 'rgba(0,0,0,.38)';
  c.textAlign = 'right'; c.textBaseline = 'top';
  c.fillText(isLead
    ? (sg(lo) + ' ~ ' + sg(hi) + ' 目')
    : (Math.round(lo * 100) + '% ~ ' + Math.round(hi * 100) + '%'), w - 2, 1);

  /* 均势线（胜率 50% / 目差 0）+ 左侧标注 */
  if (MID >= lo && MID <= hi) {
    const ym = Y(MID);
    c.strokeStyle = 'rgba(0,0,0,.14)';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(pL, ym); c.lineTo(pL + W, ym); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(0,0,0,.32)';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('均势', 2, ym);
  }

  const pts = idx.map(i => [i, src[i]]);

  /* 面积 + 折线 */
  c.beginPath();
  pts.forEach(([i, v], k) => { const x = X(i), y = Y(v); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
  c.strokeStyle = '#2f6f5e';
  c.lineWidth = 1.6;
  c.stroke();
  c.lineTo(X(pts[pts.length - 1][0]), pT + H);
  c.lineTo(X(pts[0][0]), pT + H);
  c.closePath();
  c.fillStyle = 'rgba(47,111,94,.13)';
  c.fill();

  /* 单点也画个圆点，否则看不出有数据 */
  if (pts.length === 1) {
    c.beginPath(); c.arc(X(pts[0][0]), Y(pts[0][1]), 2.4, 0, 7);
    c.fillStyle = '#2f6f5e'; c.fill();
  }

  /* 复盘的失误点：标在曲线上，一眼看出哪几手掉得多（≥1.5 目）。
     两种模式标的**是同一手**，只是纵轴值换成当前模式的那条数据。 */
  if (state.review) {
    for (let t = 0; t < state.review.losses.length; t++) {
      const v = state.review.losses[t];
      if (typeof v !== 'number' || v < 1.5) continue;
      const i = t + 1;                                   // 第 t+1 手
      if (i < i0 || i > i1) continue;
      const hv = src[i];
      if (typeof hv !== 'number') continue;
      c.beginPath();
      c.arc(X(i), Y(hv), v >= 6 ? 3.4 : 2.4, 0, 7);
      c.fillStyle = v >= 12 ? '#8e1b0f' : (v >= 6 ? '#c0392b' : '#e08a2e');
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 1;
      c.stroke();
    }
  }

  /* 当前看的那一手 */
  if (state.viewAt >= i0 && state.viewAt <= i1) {
    c.strokeStyle = 'rgba(198,64,44,.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(X(state.viewAt), pT); c.lineTo(X(state.viewAt), pT + H); c.stroke();
  }

  /* 底部标**手数**刻度 */
  c.fillStyle = 'rgba(0,0,0,.5)';
  c.font = '9px "Microsoft YaHei", sans-serif';
  c.textBaseline = 'top';
  const ticks = (i0 === i1) ? [i0] : [i0, Math.round((i0 + i1) / 2), i1];
  ticks.forEach((v, k) => {
    c.textAlign = k === 0 ? 'left' : (k === ticks.length - 1 ? 'right' : 'center');
    c.fillText(String(v) + '手', X(v), pT + H + 3);
  });
}

let lastScrolledAt = -1;      // 列表上次自动滚到的手数（免得边算边刷时反复把用户拽回来）

/* 某一手的「涨跌 / 目损」那一格。i = **当前手顺**里的下标（0 起）。
   树里不在当前线上的手没有评价数据 → 调用方传 onLine=0，不给这一格。
   ★ leftPx：树是绝对定位的，这一格要摆在**整棵树右边**（不是跟着圆圈走）——
     跟着圆圈走会正好压在下一列的圆圈上（同一手的另一条分支）。 */
function moveLossHtml(i, m, leftPx) {
  const at = ' style="left:' + leftPx + 'px"';
  /* ★ 2026-10-23：`state.review` 有可能**没有 losses** —— 复盘文件里那条线只有 turns、
     没有 report（写到一半被打断 / 手改过的文件）。原来这里直接 `state.review.losses[i]`
     会抛 TypeError，整个手数列表就渲染不出来（测试撞出来的）。 */
  const rvLoss = (state.review && state.review.losses) ? state.review.losses[i] : null;
  if (typeof rvLoss === 'number') {
    const lv = lossLevel(rvLoss);
    const t = '这一手亏 ' + rvLoss.toFixed(1) + ' 目' + (lv ? '（' + lv.label + '）' : '');
    return rvLoss < 0.05
      ? '<span class="dl rv-ok"' + at + ' title="' + t + '">0</span>'
      : '<span class="dl ' + (lv ? 'rv-' + lv.cls : '') + '"' + at + ' title="' + t + '">−' + rvLoss.toFixed(1) + '</span>';
  }
  /* 这一手让「下棋方」的胜率变化了多少（黑方胜率下降 = 白棋走得好）
     ★ 必须等这一手**算准了**才显示数字（evalSettled）。
       否则刚落子那 0.3 秒的粗算值会先摆出来，过一会儿又变成收敛值 ——
       用户看到的就是「数字自己跳」。没算准就先显示「…」。 */
  const h = state.history[i + 1], prev = state.history[i];
  if (typeof h === 'number' && typeof prev === 'number' && evalSettled(i + 1)) {
    const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
    if (Math.abs(d) >= 0.05) {
      return `<span class="dl ${d < 0 ? 'bad' : ''}"${at}>${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
    }
    return '';
  }
  if (typeof h === 'number' && !evalSettled(i + 1)) {
    return '<span class="dl calc"' + at + ' title="这一手还在算，算准了才显示涨跌">…</span>';
  }
  return '';
}

/* 树最多画多少个节点 —— 有些职业棋谱挂了几百个变化图，全画出来又慢又没法看。 */
const MOVE_ROWS_LIMIT = 800;

/* ★ 手数卡 = **圆圈 + 折线** 的分支树（2026-10-18 第三次改版，按用户手绘的样式）：
   · 每一手画成一个**黑白棋子圆圈**，圈内是第几手；**不显示坐标**（悬停 title 里给）；
   · 同一手位置的不同走法**往右挪一列**，从分枝点用**折线**接过去（竖 → 横 → 竖），
     就是用户画的那张图：主变化一直往下走，分叉往右边伸出去再往下；
   · **点圆圈** = 跳到那一手（不在当前线上就整条线切过去）。

   布局：row = 第几手（同一手的不同分支落在同一行），col = 第几列。
   ★ 列**只增不减**（每条分支独占一列）→ 同一列上的圆圈必然属于同一条线，
     竖线才能一笔画到底，不会出现"一条线穿过别的分支"那种错线。
   ★ 用"绝对定位的圆圈 + 一层 SVG 折线"，而不是嵌套列表：嵌套列表只能靠
     border-left + 缩进画竖线，**画不出从分枝点折出去的横线**（第一版就是这样）。 */

const MV_DOT = 22;     // 圆圈直径
const MV_ROW = 27;     // 每一手占的竖直间距（圆圈 22 + 空隙 5 —— 用户要求"相邻圆圈不要那么空"）
const MV_COL = 28;     // 每往右一列的水平间距
const MV_PAD_X = 7;    // 左上留白
const MV_PAD_Y = 6;

function renderMoveList() {
  const ul = $('movelist');

  if (!state.moves.length && !state.varRoot) {
    ul.innerHTML = '<li class="empty">还没有落子</li>';
    ul.style.height = '';
    return;
  }

  const curPath = state.varRoot ? varPath() : [];
  const nodes = [];        // 顺序 = data-r
  /* ★ 列分配（2026-10-19 第三版）三条规则：
     ① 新分支取**最靠左的空列** —— 不然主线中盘再分叉会跳到第 3、第 4 列（第一版用 nextCol++）；
     ② 「空」= `colEnd[c] + 1 < row`：同一列上一段结束之后**至少空一行**才复用 ——
        否则上下两条互不相干的分支会贴着排在同一列，看着像同一条线（第二版踩过）；
     ③ 主链（i=0 那个孩子）照例跟父节点同列，但**落下去之前要查这一格是不是被别的分支占了**：
        你自己那条分支往后长的时候，很可能正好长到下面那条老分支头上（用户 2026-10-19 报的
        「上面分支继续走会和下面的重叠」）。这时把**下面那条分支整体往右挪** ——
        长的是"你正在下的这条线"，挪它会半路拐弯；挪下面那条只是折线长一点。 */
  const colEnd = [];                    // colEnd[c] = 第 c 列被占用到的最后一行
  const allocCol = (minCol, row) => {
    for (let c = minCol; ; c++) if ((colEnd[c] || 0) + 1 < row) return c;
  };
  const useCol = (col, row) => { if ((colEnd[col] || 0) < row) colEnd[col] = row; };

  /* 占位网格 + 分组：同一棵子树算一组，挪的时候整组一起挪 */
  const grid = new Map();               // "行,列" → 节点
  const grpList = [];                   // grp → [节点]
  const keyOf = (r, c) => r + ',' + c;
  const cellsOf = g => grpList[g] || [];
  const rebuildColEnd = () => {
    colEnd.length = 0;
    for (const nd of nodes) useCol(nd.col, nd.row);
  };
  /* 撞位处理（2026-10-19 用户定）：**动新的、不动老的** ——
     新长出来的分支和已有分支撞上时，把**自己这条分支整组往右挪**，已有分支原地不动。
     整组一起挪是为了让这条分支保持笔直：只挪撞上的那一格，线会半路拐个弯，
     看着像又分叉了一次。返回挪好之后这一手该落的列。 */
  const arrangeRight = (row, col, selfGrp) => {
    if (!grid.has(keyOf(row, col))) return col;          // 没撞上 → 原样
    if (!selfGrp) return allocCol(col + 1, row);         // 主线（0 组）不整组挪，兜底往右一格
    for (let d = 1; d <= 40; d++) {                      // 40 是兜底，别在极端盘面上死循环
      if (grid.has(keyOf(row, col + d))) continue;       // 目标格得空着
      let ok = true;
      for (const nd of cellsOf(selfGrp)) {
        const o = grid.get(keyOf(nd.row, nd.col + d));
        if (o && o.grp !== selfGrp) { ok = false; break; }
      }
      if (!ok) continue;
      for (const nd of cellsOf(selfGrp)) grid.delete(keyOf(nd.row, nd.col));
      for (const nd of cellsOf(selfGrp)) { nd.col += d; grid.set(keyOf(nd.row, nd.col), nd); }
      rebuildColEnd();
      return col + d;
    }
    return col;
  };
  let cut = 0, grpSeq = 0;

  const add = (m, n, col, onLine, path, parent, grp) => {
    if (nodes.length >= MOVE_ROWS_LIMIT) { cut++; return null; }
    const nd = {
      m, n, col, row: n, onLine, path, parent, grp,
      draft: onLine > 0 && state.draft && onLine > state.draft.from,
    };
    nodes.push(nd);
    if (typeof grp === 'number') {
      (grpList[grp] = grpList[grp] || []).push(nd);
      grid.set(keyOf(n, col), nd);
    }
    return nd;
  };

  if (!state.varRoot) {
    /* 没有变化树（自己下的一局 / 手摆的题）：就是一列 */
    let prev = null;
    for (let i = 0; i < state.moves.length; i++) {
      prev = add(state.moves[i], i + 1, 0, i + 1, null, prev);
      if (!prev) break;
    }
  } else {
    let tailDone = false;
    /* 子树高度（这一手下面最多还有几行）—— 分配列时要**按整棵子树**占位，见 grow 里那句。 */
    const hCache = new Map();
    const hOf = nd => {
      if (!nd) return 0;
      if (hCache.has(nd)) return hCache.get(nd);
      let best = 0;
      for (const c of nd.children || []) if (c.move) best = Math.max(best, hOf(c));
      const h = best + 1;
      hCache.set(nd, h);
      return h;
    };
    /* ★★ 分支的列**先按"行号从深到浅"排好**（2026-10-19 用户手绘那张图）：
       深的分支贴近主线（列小），浅的分支被挤到右边。
       例：第 4 手后分出两条 → 占 1、2 列；第 2 手后分出的那条（它一直长到第 6 行）→ 第 3 列。
       为什么不能"边 DFS 边分配"：DFS 是浅的先分，第 2 手那个分支会先抢到第 1 列 ——
       用户的图正好相反。父节点的列还不知道就先跳过，下一轮再排（最多按层级跑几轮）。 */
    const parentOf = new Map();
    const colAt = new Map();               // 分支起始节点 → 列
    {
      const starts = [];
      const walk = (nd, row) => {
        const kids = (nd.children || []).filter(c => c.move);
        for (let i = 0; i < kids.length; i++) {
          parentOf.set(kids[i], nd);
          if (i > 0) starts.push({ nd: kids[i], row });
          walk(kids[i], row + 1);
        }
      };
      walk(state.varRoot, 1);
      /* 某个节点现在能不能定出列：顺着 children[0] 一路往上，碰到已分配的分支就取它，走到根 = 0 */
      const colOf = nd => {
        let cur = nd, guard = 0;
        while (cur && cur !== state.varRoot && guard++ < 20000) {
          if (colAt.has(cur)) return colAt.get(cur);
          const p = parentOf.get(cur);
          if (!p) return null;
          const sibs = (p.children || []).filter(c => c.move);
          if (sibs[0] !== cur) return null;      // 它自己就是没分配的分支
          cur = p;
        }
        return 0;
      };
      starts.sort((a, b) => b.row - a.row);      // 深的先排
      let pending = starts;
      for (let pass = 0; pass < 40 && pending.length; pass++) {
        const next = [];
        for (const it of pending) {
          const p = parentOf.get(it.nd);
          const pc = (p === state.varRoot) ? 0 : colOf(p);
          if (pc === null) { next.push(it); continue; }
          const col = allocCol(pc + 1, it.row);
          colAt.set(it.nd, col);
          useCol(col, it.row + hOf(it.nd) - 1);
        }
        if (next.length === pending.length) { pending = next; break; }   // 没进展
        pending = next;
      }
      /* 兜底：嵌套太深、父节点一直定不下来的，按从深到浅各取一列 */
      for (const it of pending) {
        const col = allocCol(1, it.row);
        colAt.set(it.nd, col);
        useCol(col, it.row + hOf(it.nd) - 1);
      }
    }

    const grow = (parent, kids, n, path, grp) => {
      if (!kids.length) return;
      /* ★ 两步走（2026-10-19 第二次修，别改回去）：
         ① **先**给这一组兄弟占列 —— 同一手的几条走法必须**横着挨在一起**（0,1,2…），
            所以先按顺序各取一个空列、并记下"这一列占到了第 n 行"；
         ② 再逐个往下长。等到主线深处（比如第 9 手）又要分叉时，第 1 列虽然在第 6 行
            被某条短分支占过，但那一列**到第 6 行就结束了** → 仍然可以复用。
         只做①（先父后子）会让深层分叉抢走兄弟的列，只做②（纯 DFS）会让兄弟被挤到
         更右边 —— 两个顺序都试过，必须是"①先占、②再长"。 */
      const cols = [], grps = [];
      for (let i = 0; i < kids.length; i++) {
        let col, g;
        if (i === 0) {
          col = parent ? parent.col : 0;
          g = parent ? parent.grp : 0;
          /* 主链往下长，可能长到下面那条老分支的头上 → 把自己这条分支整组往右让 */
          if (parent) col = arrangeRight(n, col, g);
        } else {
          /* 分支的列用上面排好的；万一没排上（极端嵌套）就退回现算 */
          col = colAt.has(kids[i]) ? colAt.get(kids[i])
            : allocCol((parent ? parent.col : -1) + 1, n);
          g = ++grpSeq;
        }
        cols.push(col); grps.push(g);
        /* ★ 占位要**按整棵子树的高度**留够（2026-10-19）。新分支现在可能只有一两手，
           但用户随时会往下接着走；只占第一行的话，下面那条分支会被排进同一列，
           两条就上下贴在一起（用户画的那张图就是这个）。 */
        useCol(col, n + hOf(kids[i]) - 1);
      }
      for (let i = 0; i < kids.length; i++) {
        const p = path.concat([kids[i]]);
        const nd = add(kids[i].move, n, cols[i], curPath[n - 1] === kids[i] ? n : 0, p, parent, grps[i]);
        if (!nd) continue;
        /* 走到"当前这条线的最后一手" → 把用户在这份棋谱上**续下**的手接在后面。
           ★ 树上这个位置若还有别的走法（你下了一手 SGF 里没有的棋），
             那本身就是一条新变化 → 另起一列，跟别的分支一样折出去，不能压在原列上。 */
        if (!tailDone && p.length === curPath.length) {
          tailDone = true;
          /* ★ 只有**真的还有续下的手**才排这一段（2026-10-19 修）：原来不管有没有，
             都会先 `useCol(tcol, ...)` 白占一列 —— 于是同一棵树在切换主线/分支时列会整跳一格。 */
          if (state.moves.length > curPath.length) {
            let tcol = kids[i].children.some(c => c.move) ? allocCol(nd.col + 1, n + 1) : nd.col;
            let prev = nd;
            for (let k = curPath.length; k < state.moves.length; k++) {
              tcol = arrangeRight(k + 1, tcol, nd.grp);   // 续下的手同样可能撞到别的分支
              prev = add(state.moves[k], k + 1, tcol, k + 1, null, prev, nd.grp);
              if (!prev) break;
            }
            useCol(tcol, state.moves.length);      // 这一段续下的手把这一列占到底
          }
        }
        grow(nd, kids[i].children.filter(c => c.move), n + 1, p, grps[i]);
      }
    };
    grow(null, state.varRoot.children.filter(c => c.move), 1, [], 0);
    /* 树上一条线都没匹配上（比如刚清空手顺）：续下的手直接排第一列 */
    if (!tailDone && state.moves.length) {
      let prev = null;
      for (let i = 0; i < state.moves.length; i++) {
        prev = add(state.moves[i], i + 1, 0, i + 1, null, prev);
        if (!prev) break;
      }
    }
  }

  if (!nodes.length) {
    ul.innerHTML = '<li class="empty">还没有落子</li>';
    ul.style.height = '';
    return;
  }

  let maxCol = 0, maxRow = 0;
  for (const nd of nodes) {
    nd.x = MV_PAD_X + nd.col * MV_COL;
    nd.y = MV_PAD_Y + (nd.row - 1) * MV_ROW;
    if (nd.col > maxCol) maxCol = nd.col;
    if (nd.row > maxRow) maxRow = nd.row;
  }
  /* 「涨跌 / 目损」那一格统一摆在**整棵树的右边**：跟着圆圈走会正好压在
     下一列的圆圈上（同一手的另一条分支就在那一列）。 */
  const treeRight = MV_PAD_X + maxCol * MV_COL + MV_DOT;
  const badgeX = treeRight + 8;
  const h = maxRow * MV_ROW + MV_PAD_Y;

  /* 折线：同一列 → 一笔竖线；换了列 → 竖-横-竖（横线走在两行之间） */
  let paths = '';
  for (const nd of nodes) {
    const p = nd.parent;
    if (!p) continue;
    const px = p.x + MV_DOT / 2, py = p.y + MV_DOT;
    const cx = nd.x + MV_DOT / 2, cy = nd.y;
    const cls = nd.onLine ? ' class="on"' : '';
    if (nd.col === p.col) {
      paths += '<path' + cls + ' d="M' + px + ' ' + py + 'L' + cx + ' ' + cy + '"/>';
    } else {
      const mid = Math.round((py + cy) / 2);
      paths += '<path' + cls + ' d="M' + px + ' ' + py + 'L' + px + ' ' + mid
        + 'L' + cx + ' ' + mid + 'L' + cx + ' ' + cy + '"/>';
    }
  }

  let html = '';
  for (let k = 0; k < nodes.length; k++) {
    const nd = nodes[k];
    const m = nd.m;
    const coord = m.pass ? '停一手' : GTP_COLS[m.x] + (N - m.y);
    const bLeft = badgeX - nd.x;
    html += '<li class="mv' + (nd.onLine ? ' on' : '')
      + (nd.onLine > 0 && state.viewAt === nd.onLine ? ' cur' : '')
      + (nd.draft ? ' draft' : '') + '" data-r="' + k + '" data-n="' + nd.n + '"'
      + ' style="left:' + nd.x + 'px;top:' + nd.y + 'px"'
      + ' title="第 ' + nd.n + ' 手 · ' + (m.color === 'b' ? '黑' : '白') + ' ' + coord + '">'
      + '<span class="dot ' + (m.color === 'b' ? 'b' : 'w') + (nd.n >= 100 ? ' d3' : '') + '">'
      + nd.n + '</span>'
      + (nd.draft ? '<span class="dft" style="left:' + bLeft + 'px">草</span>' : '')
      + (nd.onLine > 0 ? moveLossHtml(nd.onLine - 1, m, bLeft + (nd.draft ? 17 : 0)) : '')
      + '</li>';
  }
  if (cut) {
    html += '<li class="empty" style="position:absolute;left:6px;top:' + h
      + 'px">（还有 ' + cut + ' 个分支没画出来 —— 太多了）</li>';
  }

  ul.innerHTML = html;
  /* 折线层：用 div 包一次再取 svg，保证按 SVG 命名空间创建（直接给 div.innerHTML 也行，
     但显式写 xmlns 更稳）。它**不是 li**，所以不影响任何按 li 数条目的判据。 */
  const holder = document.createElement('div');
  holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="tree-lines" width="'
    + Math.max(treeRight + 4, 40) + '" height="' + (h + 4) + '">' + paths + '</svg>';
  ul.insertBefore(holder.firstChild, ul.firstChild);
  ul.style.height = h + 'px';

  ul.querySelectorAll('li[data-r]').forEach(li => {
    const nd = nodes[+li.dataset.r];
    li.onclick = () => gotoTreeRow(nd);
    /* 右键 → 删除这一手及以后（2026-10-19 用户要求）。只在有变化树时给菜单：
       一局自己下到底、没有分支的时候没有"分支"可删，菜单也就没意义。 */
    li.oncontextmenu = e => {
      if (!state.varRoot || !nd || !nd.path) return;
      e.preventDefault();
      openMoveMenu(e.clientX, e.clientY, nd);
    };
  });

  /* 当前那一手滚进可视区（只在「看的那手」变化时滚，免得边算边刷时反复把用户拽回来） */
  const cur = ul.querySelector('li.cur');
  if (cur && lastScrolledAt !== state.viewAt) {
    cur.scrollIntoView({ block: 'nearest' });
    lastScrolledAt = state.viewAt;
  }
}

/* ---------------- 手数卡的右键菜单：删除分支（2026-10-19） ----------------
   用户要求：右键点某一手 → 菜单「删除」→ 把**这一点和它以下的所有手**一起删掉。
   删的是"这一手 + 它的整棵子树"；它的**兄弟分支不受影响**（那才是"删分支"的意思）。 */
let mvMenuAt = null;

function openMoveMenu(x, y, nd) {
  const m = $('mv-menu');
  if (!m) return;
  mvMenuAt = nd;
  const node = nd.path[nd.path.length - 1];
  const kids = (node.children || []).filter(c => c.move).length;
  const del = $('mv-del');
  /* 菜单文字就两个字（2026-10-19 用户要求精简）；删几手放在悬停提示里 */
  del.textContent = '删除';
  del.title = '删掉第 ' + nd.n + ' 手及以后（共 ' + countSubtree(node) + ' 手）'
    + (kids ? '，包括它下面的 ' + kids + ' 条分支' : '');
  m.hidden = false;
  /* 贴边时往里收一点，别跑出窗口 */
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}

function closeMoveMenu() {
  const m = $('mv-menu');
  if (m) m.hidden = true;
  mvMenuAt = null;
}

/* 这一手 + 它以下一共多少手 */
function countSubtree(nd) {
  let n = 1;
  for (const c of nd.children || []) if (c.move) n += countSubtree(c);
  return n;
}

/* 真正删：从树里摘掉这一手（连带整棵子树）。
   ★ 如果删的是**当前这条线**上的手 → 线退到它的父节点（前面那些手留着），
     并整条重建局面（applyVariationLine 会清掉分析 / 结果，再重新算）。
     删的要是别的分支 → 当前这盘棋一点没动，只少了一条变体。 */
function deleteMoveSubtree(nd) {
  if (!nd || !nd.path || !nd.path.length || !state.varRoot) return;
  const target = nd.path[nd.path.length - 1];
  const parent = nd.path.length >= 2 ? nd.path[nd.path.length - 2] : state.varRoot;
  const i = parent.children.indexOf(target);
  if (i < 0) return;
  const killed = countSubtree(target);
  parent.children.splice(i, 1);
  if (nd.onLine > 0) {
    applyVariationLine(nd.path.slice(0, nd.path.length - 1), nd.onLine - 1);
    flash('已删除第 ' + nd.n + ' 手及以后（共 ' + killed + ' 手）—— 现在停在它之前');
  } else {
    syncUI();
    flash('已删除那条分支（共 ' + killed + ' 手），当前这盘棋没动');
  }
}

$('mv-del').onclick = () => {
  const nd = mvMenuAt;
  closeMoveMenu();
  if (nd) deleteMoveSubtree(nd);
};
/* 点别处 / 按 Esc / 滚动手数卡 → 收起菜单 */
document.addEventListener('click', e => {
  const m = $('mv-menu');
  if (m && !m.hidden && !m.contains(e.target)) closeMoveMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMoveMenu(); });
window.addEventListener('resize', closeMoveMenu);

/* 点树上的某一行：在当前这条线上 → 只是跳过去看；不在当前线 → 换成它那条线再看那一手。 */
function gotoTreeRow(r) {
  if (!r) return;
  if (r.onLine) { gotoView(r.onLine); return; }
  const line = r.path.slice();
  let nd = r.path[r.path.length - 1];
  for (;;) {
    const nx = nd.children.find(c => c.move);
    if (!nx) break;
    line.push(nx); nd = nx;
  }
  const ci = applyVariationLine(line, r.path.length);
  flash('已换分支 · ' + state.moves.length + ' 手' + (state.review ? '（有复盘）' : '（这条线没复盘）')
    + (ci && ci.mine ? ' · 讲解也换线了'
      : (ci && ci.others ? ' · 讲解没讲过（另有 ' + ci.others + ' 条）' : '')));
}

/* ---------------- 棋谱变体：换线（2026-10-17） ----------------
   数据模型很克制：`state.moves` 仍然是**当前这一条线**（分析 / 复盘 / 数子 / 导出全都只认它），
   `state.varRoot` 只是那份棋谱的整棵树，用来① 在手数列表标出分支点 ② 换线。
   换线 = 把 moves 整条重建成"另一个兄弟变体 + 它的主变化"，而不是维护一份"当前路径"状态
   （少一份状态就少一处不一致）。 */

/* ---------------- 对弈中「回看落子」= 开一条新分支（2026-10-19） ----------------
   数据模型没变：`state.moves` 仍是**当前这条线**，树只是额外记着"别的走法"。
   原来 `state.varRoot` 只有打开棋谱时才有；现在自己下的棋也能有 —— 第一次在历史局面
   上落子时，先把当前这条线整条落进树里（ensureTree），此后每落一手就挂一个孩子
   （noteTreeMove）。于是手数卡会画成分支树、导出也带着分支。 */

/* 两个手顺是不是同一点（颜色 + 坐标；都是 pass 也算同一个） */
function sameMove(a, b) {
  if (!a || !b) return false;
  if (!!a.pass !== !!b.pass) return false;
  if (a.pass) return true;
  return a.x === b.x && a.y === b.y;
}

/* 手里没有树 → 按**当前这条线**建一棵（线性的）。已有树就原样返回。 */
function ensureTree() {
  if (state.varRoot) return state.varRoot;
  const root = { props: [], at: -1, end: -1, move: null, comment: '', children: [] };
  let cur = root;
  for (const m of state.moves) {
    const nd = {
      props: [], at: -1, end: -1, comment: '',
      move: { color: m.color, x: m.x, y: m.y, pass: !!m.pass },
      children: [],
    };
    cur.children.push(nd);
    cur = nd;
  }
  state.varRoot = root;
  return root;
}

/* 把第 at 手（0 = 还没落子）**之后**的 mv 挂进树。已经有一模一样的孩子就复用。
   ★ 2026-10-19 用户要求：新分支挂在**右边**（push 到最后）—— 原来的走法留在主线那一列，
     新下出来的一条算变体。所以这里不再区分 front。 */
function attachTreeMove(at, mv) {
  if (!mv) return null;
  const root = ensureTree();
  let nd = root;
  for (let i = 0; i < at; i++) {
    const m = state.moves[i];
    const nx = nd.children.find(c => c.move && sameMove(c.move, m));
    if (!nx) return null;                 // 树和手顺对不上（不该发生）→ 宁可不挂，别写歪
    nd = nx;
  }
  let kid = nd.children.find(c => c.move && sameMove(c.move, mv));
  if (!kid) {
    kid = {
      props: [], at: -1, end: -1, comment: '',
      move: { color: mv.color, x: mv.x, y: mv.y, pass: !!mv.pass },
      children: [],
    };
    nd.children.push(kid);
  }
  return kid;
}

/* 落完一手后调一下：树存在时把它挂上去（没有树就不用管，建树时会整条重建） */
function noteTreeMove() {
  if (!state.varRoot || !state.moves.length) return;
  attachTreeMove(state.moves.length - 1, state.moves[state.moves.length - 1]);
}

/* 回看中要落子 / 停一手 → 把手顺截到当前看着的那一手，后面的手留在树上当分支。
   返回 true 表示"这是一次新开分支"。习题练习与试下不掺和（各有各的规则）。 */
function cutForBranch() {
  if (state.viewAt === state.moves.length) return false;
  const at = state.viewAt;
  ensureTree();
  /* ★ 截断之前先把**这一条线**的分析快照留档（2026-10-22）：这一手之后的局面
     马上要被删掉，但它们属于原来那条线 —— 导出时那条分支的分析还要用。 */
  archiveAnaLine();
  state.moves = state.moves.slice(0, at);
  truncateAnalysisTo(at);                 // 后面那些手的分析 / 走势 / 快照都作废
  state.toMove = sideToMove(at);
  state.koPoint = koFromBoard(boardAt(at), state.moves);
  state.viewAt = at;
  state.result = null;
  state.pv = null;
  /* ★ 截断之后这条线就变了：复盘数据要么按新线取（正好有），要么清掉。
     不清的话，第 at 手那一格的目损还挂着**原来那一手**的值（差值算的是"走完这手之后"）。 */
  syncReviewForLine();
  flash('在第 ' + at + ' 手处新开一条分支 —— 后面的手留在「手数」卡的树里');
  return true;
}

/* 当前手顺在树上对应的节点（下标 = 手数-1）。用户自己接着下的手不在树上 → 截到那里为止。 */
function varPath() {
  const root = state.varRoot;
  if (!root) return [];
  const path = [];
  let nd = root;
  for (let i = 0; i < state.moves.length; i++) {
    const m = state.moves[i];
    let next = null;
    for (const c of nd.children) {
      if (!c.move) continue;
      if (!!c.move.pass !== !!m.pass) continue;
      if (!m.pass && (c.move.x !== m.x || c.move.y !== m.y)) continue;
      next = c; break;
    }
    if (!next) break;
    path.push(next);
    nd = next;
  }
  return path;
}

/* 第 n 手（1 起）是不是分支点。是 → { node, sibs, k }（k = 当前在兄弟里的序号）。 */
function varAt(n) {
  if (!state.varRoot || n < 1) return null;
  const path = varPath();
  const nd = path[n - 1];
  if (!nd) return null;
  const parent = n >= 2 ? path[n - 2] : state.varRoot;
  const sibs = parent.children.filter(c => c.move);
  if (sibs.length < 2) return null;
  const k = sibs.indexOf(nd);
  return k < 0 ? null : { node: nd, sibs, k };
}

/* Alt+←/→：在**当前看着的这一手**所在的兄弟变体之间循环切换。 */
function switchVariation(dir) {
  if (!state.varRoot) { flash('这份棋谱没有分支（分支来自 SGF 里的变体）'); return; }
  const n = state.viewAt;
  if (n < 1) { flash('先跳到某一手 —— 分支是从那一手分出来的'); return; }
  const at = varAt(n);
  if (!at) {
    flash('这一手没有别的分支'
      + (state.varRoot ? '（有分支的手，手数列表里带「变」标记）' : ''));
    return;
  }
  const target = at.sibs[(at.k + dir + at.sibs.length) % at.sibs.length];
  const path = varPath();
  const line = path.slice(0, n - 1).concat([target]);
  let nd = target;
  for (;;) {                                   // 顺着这条变体的主变化走到头
    const nx = nd.children.find(c => c.move);
    if (!nx) break;
    line.push(nx); nd = nx;
  }
  const ci = applyVariationLine(line, n);
  flash('已换分支 · ' + state.moves.length + ' 手（第 ' + n + ' 手 ' + at.sibs.length + ' 个）'
    + (state.review ? ' · 有复盘' : ' · 这条线没复盘')
    + (ci && ci.mine ? ' · 讲解也换线了'
      : (ci && ci.others ? ' · 讲解没讲过（另有 ' + ci.others + ' 条）' : '')));
}

/* 用一条节点链替换当前手顺。分析数据整批作废 —— 换了条线，旧的胜率/目差不是这个局面的。 */
function applyVariationLine(line, at) {
  /* ★★ 2026-10-23：换线前后要把「讲解」按线存 / 取。
     原来只按手号存 → 切到另一条分支，第 30 手还是上一条线的文字，
     而且「全盘讲解」会把它当"已讲过"跳过（分支根本讲不了）。 */
  const oldCoachKey = coachLineKey();
  const oldCoachN = state.moves.length;
  /* ★★ 换线之前：把**正要离开的这条线**的分析快照留一份档（2026-10-22）。
     导出棋谱时要求「所有分支的 AI 分析都存下来」—— 数据只活在 anaAt 里，
     而它马上要被截断/清空，不在这儿留一手就永久丢了。 */
  archiveAnaLine();
  state.moves = line.map(x => ({
    color: x.move.color, x: x.move.x, y: x.move.y, pass: !!x.move.pass,
  }));
  leaveCoachLine(oldCoachKey, oldCoachN);
  /* 解说词跟着这条线重建：comments[0] = 开局前，comments[i] = 第 i 手 */
  const cm = [(state.sgfComments && state.sgfComments[0]) || ''];
  line.forEach((x, i) => { if (x.comment) cm[i + 1] = x.comment; });
  state.sgfComments = cm;
  state.toMove = sideToMove(state.moves.length);
  state.koPoint = koFromBoard(boardAt(state.moves.length), state.moves);
  rebuildCapAt();
  state.viewAt = Math.max(0, Math.min(state.moves.length, at));
  state.candidates = []; state.candAt = -1;
  state.ownership = null; state.ownAt = -1;
  state.history = []; state.leads = []; state.histVisits = [];
  /* ★★ 2026-10-22：逐手分析快照（`state.anaAt`）也要跟着换线处理。
     它是「第 at 手之后那个局面」的分析 —— 换线之后，**共享前缀**（位置 0..at-1）
     还是同一个局面，数据有效；但 `at` 之后那些快照属于**上一条线**，
     留着会被「解说词」卡当成这一手的分析显示，导出时还会被写进那条**别的**分支的
     解说词（`curLineAnaAt()` 按线合并快照，混了就是串线）—— 于是那一手混进别的分支的胜率/目差。
     所以：只截到共享前缀，别整批清空（前缀那几十手是白算的吗？不是，位置完全一样）。 */
  for (const k in state.anaAt) {
    if (+k > at - 1) delete state.anaAt[k];
  }
  state.review = null;
  /* ★ 2026-10-22：换线之后**按这条线**重新挑复盘（同一份 json 里按线存着）。
     这条线算过 → 目损/走势/报告立刻跟着换；没算过 → 清空（不拿上一条线的数字充数）。 */
  const hasReview = syncReviewForLine();
  state.pv = null;
  state.result = null;
  state.draft = null;
  /* ★ 讲解换成这条线的（有就显示，没有就退回按手数看的框，并作废渲染缓存） */
  const coachInfo = enterCoachLine();
  syncUI();
  scheduleAnalysis(0, true);
  /* 这条线没复盘、而这份棋谱别的分支有 → 问一句「要不要现在算」（2026-10-22 用户要求）。
     ★ 放在最后：先把局面/走势/目损都换过来，弹窗才说得清"哪条线没算"。 */
  if (!hasReview) scheduleAskReviewLine();
  return coachInfo;
}

/* ---------------- 解说词框（棋谱自带的 C[]，2026-10-06 用户要求） ----------------
   参照 MultiGo 的那个框：显示**当前看着的这一手**在棋谱文件里写的解说。
   数据来自 parseSGF 交出来的 comments（**只取主分支** —— 我们不做分支树，用户定的）。
   编辑：直接改棋谱文件里那一个 C[]（见 patchSGFComment），第一次覆盖前会留 .bak。 */

/* 「第几题 / 共几题」的提示文字（2026-10-06）。
   ★ 放在**顶栏状态行**里，不做成浮层 —— 实测棋盘四周只有 3px（上方）/
     34px（左右）的空隙，任何浮层都会盖住棋盘；而顶栏本来就写着「第 N 手」，
     题号跟它是同一类信息，凑在一起最自然，还不占额外地方。

   一份题集会把多道题串在一个 SGF 里，用 `zz` 标记分界（实测抽样 3000 份里 2.97% 的文件有，
   全库 21433 份里 538 份）。我们**只显示位置，不做切换**：
   「跳到第 3 题」是另一个功能（要改手数范围、改引擎请求、改历史），
   做一半只会让人以为能点、点了没反应。 */
function quizPos() {
  const seps = state.quizTips || [];
  if (seps.length < 1) return null;
  const at = state.viewAt;
  let n = 1;
  for (const s of seps) if (at >= s) n++;          /* 分界那一手就归下一题（>= 不是 >） */
  return { n, total: seps.length + 1 };
}
/* 顶栏里用的一段文字；不是题集就返回空串 */
function quizTxt() {
  if (state.noGame) return '';
  const q = quizPos();
  if (!q || q.total < 2) return '';
  /* ★ 2026-10-24：顶栏只有一行 —— 题号写成「第 3/347 题」省下 30 多 px。 */
  return ` · ${q.total === 2 ? '第 ' + q.n + ' 题（共 2 题）' : '第 ' + q.n + '/' + q.total + ' 题'}`;
}

/* ---------------- 逐手分析明细（2026-10-18 用户要求） ----------------

   人机对弈 / 双人摆棋时，右侧「解说词」卡显示**这一手的引擎分析**：
     手数 118: W L14 / 分数 / 胜率 / 目数损失 / 推荐最佳选点 + PV / 直觉选点排名
   数据全部来自 applyAnalysis 存下的 state.anaAt（第 at 手之前 + 之后各一份快照）。

   ★ 三处口径必须说清（都是这个项目踩过的坑）：
     ① 快照里的 win / lead 是**黑方视角**，本函数只在"走子方视角"时才乘 sgn；
     ② 目数损失 = 最佳选点的期望目差 − 实际走完的目差（同一个走子方视角相减）；
     ③ 「直觉选点」= 神经网络**先验**（moveInfos[].prior），不是搜索结论 ——
        引擎只汇报前若干个候选，prior 是在**这些候选之间**归一化的，所以
        "87%" 表示"在这几个候选里占 87%"，不是"全盘 87%"。 */

/* PV 的写法：第一手带颜色字母，后面只写坐标（颜色交替）—— 例：WJ13 L14 J14 O17 */
function pvText(pv, side) {
  if (!Array.isArray(pv) || !pv.length) return '';
  const firstIsBlack = side === 'b';
  return pv.map((g, i) => {
    if (g === 'pass') return i === 0 ? (firstIsBlack ? 'B' : 'W') + 'pass' : 'pass';
    const isBlack = (i % 2 === 0) ? firstIsBlack : !firstIsBlack;
    return i === 0 ? (isBlack ? 'B' : 'W') + g : g;
  }).join(' ');
}

/* 领先方 + 目数，例：白+10.8 / 黑+1.5（参数是**黑方视角**的目差） */
function leadText(lead) {
  return (lead >= 0 ? '黑+' : '白+') + Math.abs(lead).toFixed(1);
}

/* 第 k 手那一块的文字。k = 手数（1 起）。 */
function moveAnalysisText(k) {
  return moveAnalysisTextAt(state.moves, state.anaAt, k);
}

/* 同上，但**数据来源可以指定**（2026-10-22）：
   导出带分支的棋谱时要按「那一条分支自己的手顺 + 自己的分析快照」写 C[]，
   不能再读 state.moves / state.anaAt —— 它们只代表当前这条线（这就是「导出后只有最后
   那条分支有解说词」的根因）。
   moves = [{color,x,y,pass}]；at = {位置: 快照}（快照形状见 applyAnalysis）。 */
function moveAnalysisTextAt(moves, at, k) {
  const mv = (moves || [])[k - 1];
  if (!mv) return '';
  const post = (at || {})[k] || null;         // 走完这一手之后的局面
  const pre = (at || {})[k - 1] || null;      // 走这一手之前的局面（推荐点/直觉/损失都看它）
  const mover = mv.color;                     // 'b' / 'w'
  const sgn = mover === 'b' ? 1 : -1;         // 黑方视角 → 走子方视角
  const L = [];

  L.push('手数 ' + k + ': ' + (mover === 'b' ? 'B' : 'W') + ' '
    + (mv.pass ? 'pass' : toGTP(mv.x, mv.y)));

  /* 分数 / 胜率：走完这一手之后的局面（引擎还没回来就写"还在算"） */
  if (post) {
    L.push('分数: ' + leadText(post.lead));
    const w = post.lead >= 0 ? post.blackWin : 1 - post.blackWin;
    L.push('胜率: ' + (post.lead >= 0 ? '黑' : '白') + ' ' + (w * 100).toFixed(1) + '%');
  } else {
    L.push('分数: （这一手还在算…）');
    L.push('胜率: （这一手还在算…）');
  }

  if (!pre || !pre.best) {
    L.push('目数损失: （这一手之前没有分析）');
    L.push('推荐最佳选点: （这一手之前没有分析）');
    return L.join('\n');
  }

  /* 目数损失：最佳选点的期望目差 − 实际走完的目差（同一视角相减，负数归零） */
  if (post) {
    const bestLead = pre.best.lead * sgn;
    const actualLead = post.lead * sgn;
    const loss = Math.max(0, bestLead - actualLead);
    L.push('目数损失: ' + loss.toFixed(1));
  } else {
    L.push('目数损失: （这一手还在算…）');
  }

  L.push('推荐最佳选点 ' + pre.best.gtp + ' (' + leadText(pre.best.lead) + ')');
  const pv = pvText(pre.best.pv, pre.side);
  if (pv) L.push('PV: ' + pv);

  /* 直觉选点 = 先验（prior）排名。只在候选之间比较 —— 见函数顶上第 ③ 条 */
  const byPrior = pre.moves
    .filter(m => typeof m.prior === 'number' && m.prior > 0)
    .sort((a, b) => b.prior - a.prior);
  if (byPrior.length) {
    const gtp = mv.pass ? 'pass' : toGTP(mv.x, mv.y);
    const hit = byPrior.findIndex(m => m.gtp === gtp);
    L.push(hit >= 0
      ? '直觉选点下该手棋是 #' + (hit + 1) + ' (' + (byPrior[hit].prior * 100).toFixed(2) + '%)'
      : '直觉选点下该手棋不在候选里');
    L.push('最佳直觉选点是 ' + byPrior[0].gtp + ' (' + (byPrior[0].prior * 100).toFixed(1) + '%)');
  }
  return L.join('\n');
}

function renderCommentBox() {
  const box = $('cbox');
  if (!box) return;
  /* 正在编辑时**不要**覆盖用户的输入 —— syncUI 会频繁调用本函数 */
  if (box.querySelector('textarea')) return;

  const at = state.viewAt;

  /* ★ 2026-10-18 用户要求：人机对弈 / 双人摆棋时，这个框改成显示**这一手的分析明细**
     （分数 / 胜率 / 目数损失 / 推荐选点 + PV / 直觉选点排名）。
     打谱（fromRecord）仍显示棋谱自带的解说词；习题练习不掺和（那里看棋盘就够）。 */
  const anaMode = !state.noGame && !state.fromRecord && !tsOn()
    && (settings.mode === 'play' || settings.mode === 'free');
  if (anaMode) {
    const eb = $('cbox-edit');
    eb.disabled = true;
    eb.title = '这里是引擎逐手分析，不能编辑（解说词只在打开棋谱时可改）';
    $('cbox-at').textContent = at === 0 ? '（引擎分析）' : '（第 ' + at + ' 手 · 引擎分析）';
    box.classList.add('ana');
    const ph2 = document.createElement('div');
    ph2.className = 'ph';
    if (at === 0) {
      ph2.textContent = '下第一手之后，这里逐手显示引擎分析：分数 / 胜率 / 目数损失 / 推荐选点与 PV / 直觉选点排名。';
      box.replaceChildren(ph2);
      return;
    }
    const t0 = moveAnalysisText(at);
    if (t0) { box.textContent = t0; return; }
    ph2.textContent = engineReady
      ? '这一手还没有分析数据。'
      : '先把顶栏的「KataGo」灯点开 —— 这里逐手显示引擎分析（分数 / 胜率 / 目损 / 推荐选点）。';
    box.replaceChildren(ph2);
    return;
  }
  box.classList.remove('ana');

  const list = state.sgfComments || [];
  /* ★ 棋谱说明（根节点那段文字）：在「开局前」这一档显示。
     它不属于任何一手 —— 实测抽样 300 份真实棋谱里 116 份（38%）有这段。
     以前它和「第 0 手」共用 comments[0] 这个键，被后面那一手覆盖掉 → 整段读不出来。 */
  const rootTxt = at === 0 ? String(state.rootComment || '') : '';
  const txt = rootTxt || (list[at] || '');
  const canEdit = !!state.fromRecord && !!state.recName;
  const btn = $('cbox-edit');
  btn.disabled = !canEdit;
  btn.title = canEdit
    ? (rootTxt ? '改这段棋谱说明（存回这份棋谱文件；第一次改会先留一份 .bak 备份）'
               : '改这一手的解说词（存回这份棋谱文件；第一次改会先留一份 .bak 备份）')
    : (rootTxt ? '只有「打开棋谱」时才能改棋谱说明' : '只有「打开棋谱」时才能改解说词');
  $('cbox-at').textContent = state.noGame ? '（棋谱自带）'
    : (at === 0 ? (rootTxt ? '（开局前 · 棋谱说明）' : '（开局前）') : '（第 ' + at + ' 手）');

  if (txt) { box.textContent = txt; return; }
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = state.noGame
    ? '打开一份棋谱后，这里显示棋谱里自带的解说词。'
    : (canEdit ? '这一手没有解说词 —— 点「编辑」可以补上。' : '这一手没有解说词。');
  box.replaceChildren(ph);
}

/* 点「编辑」→ 就地变成输入框（保存/取消） */
/* 退出解说词编辑态。
   ★ 这个函数是 2026-10-06 补的：原来「取消」按钮直接调 renderCommentBox()，
     而 renderCommentBox 开头有一句「正在编辑（框里有 textarea）就别动它」
     —— 于是取消时 textarea 还在框里，第一行就 return，**永远退不出去**。
     翻手也救不了（syncUI 走的同一个函数）。用户报「点编辑后退不出去」，实测确认：
     连点、翻手都不行；而保存失败那条路会保留输入，本意是让人改完再存，
     结果也因为退不出去而变成卡死。

     所以「退出」必须有自己的一条路：**先把 textarea 拆掉，再让 render 重画**。 */
function exitCommentEdit() {
  const box = $('cbox');
  if (!box) return;
  const ta = box.querySelector('textarea');
  if (ta) box.removeChild(ta);
  const bar = box.querySelector('button');      // 保存/取消那一行
  if (bar && bar.parentElement === box) box.removeChild(bar.parentElement);
}

function editComment() {
  const box = $('cbox');
  const at = state.viewAt;
  if (box.querySelector('textarea')) return;
  if (!state.fromRecord || !state.recName) { flash('只有打开棋谱时才能改解说词'); return; }

  /* ★ 「开局前」这一档：如果这份棋谱有根节点说明，那这里改的就是**棋谱说明**
     （它不属于任何一手，onclick 里会走 patchSGFComment(text, -1, …)）。 */
  const isRoot = at === 0 && !!String(state.rootComment || '').trim();

  const ta = document.createElement('textarea');
  /* ★ 显示给用户的这份也统一成 CRLF 口径，跟磁盘上的文件一致 ——
     以前这里是 `list[at]` 原样（文件里的 CRLF），而保存时 textarea 已经把它
     规范成 LF 了，改一次就把文件里那处 CRLF 变成 LF。 */
  ta.value = nlForSGF(isRoot ? state.rootComment : ((state.sgfComments || [])[at] || ''));
  ta.placeholder = isRoot
    ? '写点这段棋谱的说明…（例如出处、这是第几图、谁整理的；留空 + 保存 = 删掉这段）'
    : '写点这一手的解说…（留空 + 保存 = 删掉这一手的解说词）';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex:none';
  const ok = document.createElement('button');
  ok.textContent = '保存'; ok.className = 'primary'; ok.style.height = '24px';
  const no = document.createElement('button');
  no.textContent = '取消'; no.style.height = '24px';
  bar.append(ok, no);
  box.replaceChildren(ta, bar);
  ta.focus();
  /* ★ Esc = 取消（用户习惯，也多一条出路）。
     注意必须 preventDefault + stopPropagation：全局那个 keydown 监听器里
     有一条「弹窗开着就一律不响应」，但解说词框不是弹窗，事件会穿过去 ——
     不拦住的话按 Esc 还会顺手把别的东西关了。 */
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    exitCommentEdit();
    renderCommentBox();
  });

  no.onclick = () => { exitCommentEdit(); renderCommentBox(); };
  ok.onclick = async () => {
    ok.disabled = true;
    const r = await saveComment(at, ta.value.trim(), isRoot);
    if (r && r.error) {
      /* ★ 保存失败时**不能**把用户输入清掉（他还要改），
         但也不能把他锁死在编辑态里 —— 那正是原来的 bug。
         所以这里给个「放弃修改」的出路：换掉按钮含义、让他能直接走出去。 */
      flash('保存失败：' + r.error + '（改完再点「保存」，或点「放弃修改」离开）');
      no.textContent = '放弃修改';
      ok.disabled = false;
      return;
    }
    exitCommentEdit();
    flash((isRoot ? '棋谱说明' : '解说词') + '已存回棋谱'
      + (isRoot ? '' : '（第 ' + at + ' 手）') + ((r && r.note) ? r.note : ''));
    renderCommentBox();
  };
}

/* 把这一手（或根节点说明）的解说词写回棋谱文件 */
async function saveComment(at, text, isRoot) {
  const rd = await window.api.records.read(state.recName);
  if (!rd || rd.error) return { error: (rd && rd.error) || '读不到这份棋谱' };
  const patched = patchSGFComment(rd.text, isRoot ? -1 : at, text);
  if (patched.error) return { error: patched.error };
  const w = await window.api.records.save(state.recName, patched.text);
  if (w && w.error) return { error: w.error };
  if (isRoot) {
    /* 磁盘上写的是 CRLF 口径（见 nlForSGF），内存里这份也保持一致 */
    state.rootComment = text ? nlForSGF(text) : '';
  } else {
    if (!state.sgfComments) state.sgfComments = [];
    /* 存进内存的这份也用 CRLF 口径，跟磁盘上的保持一致 */
    if (text) state.sgfComments[at] = nlForSGF(text); else delete state.sgfComments[at];
  }
  /* ★ 如实回报两件用户该知道的事（2026-10-06）：
       ① 文件原本是 GBK 还是 UTF-8 —— 我们按原编码写回的，不改用户文件的口径；
       ② GBK 里没有的字（比如 emoji）会被写成 '?'，必须告诉用户，否则他
          以为存进去了、换个软件打开发现少字却不知道是谁弄丢的。 */
  let note = '';
  if (w && w.enc === 'gbk') {
    note = '（按原文件的 GBK 编码存回）';
    if (w.missing && w.missing.length) {
      note += ' · ★ 有 ' + w.missing.length + ' 个字符 GBK 装不下，已写成 ?：' +
        [...new Set(w.missing)].slice(0, 6).join('');
    }
  }
  return { ok: true, note };
}

$('cbox-edit').onclick = editComment;



/* 用 e.code 判断，不用 e.key —— 中文输入法下字母键的 key 会变（本项目踩过同源的坑）。
   焦点在输入控件里时一律不拦截，免得选难度时按空格出意外。 */
window.addEventListener('keydown', e => {
  /* ★★ Ctrl+Shift+D：分析链路自检 —— 必须放在下面那道 `if (e.ctrlKey)` **之前**！
     2026-10-07 踩到：原来把它写在下面的 `switch (e.code)` 里（还特意写在裸 `case 'KeyD'`
     试下**前面**），但忘了 Ctrl 组合在更上面就被拦下了：
         if (e.ctrlKey || e.metaKey) { if (KeyZ) 悔棋; return; }   ← 这里就 return 了
     于是那个 case 是**死代码**，用户在卡住时按 Ctrl+Shift+D 一点反应都没有
     （而他正是最需要这个自检的时候）。教训：**判断快捷键能不能到达，要看整条
     早期 return 链，不能只看 switch 内部的顺序。**
     ⚠️ 这个判断要放在「输入框里不拦截」那道检查**之前** ——
        用户很可能正点着「计算深度」之类的控件，那时焦点就在输入控件上。 */
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    const cur = state.viewAt, n = state.moves.length;
    /* ★ 2026-10-24：自检串原来有 60~80 字（一句就能顶满顶栏一行）。
       现在**两分流**：状态栏只留三件事（局面 / 选点 / 引擎），完整那一串打到
       调试台（DevTools Console）—— 要查细节就看控制台，别让顶栏替它撑宽。 */
    const diag = '分析自检·局面: ' + n + '手·看第' + cur + '手'
      + '·选点: ' + (state.candAt < 0 ? '还没算过' : ('第' + state.candAt + '手算的, 差' + (cur - state.candAt)))
      + '·搜索量: ' + state.rootVisits
      + '·请求: ' + (anaBusy ? '在跑' : '空闲')
      + (anaQueue.length ? ('·欠账' + anaQueue.length + '手') : '')
      + (anaForceCur ? '·待重算' : '')
      + (state.noGame ? '·未开局' : '')
      + (scoreBusy ? '·数子中' : '')
      + (reviewBusy ? '·复盘/讲解中' : '')
      + '·引擎: ' + (engineReady ? '就绪' : (engStates.analyze === 'loading' ? '加载中' : '未就绪'))
      + (anaTimeouts ? ('·超时' + anaTimeouts + '次') : '')
      + '·链路: 轮' + anaDiag.start + '/成功' + anaDiag.okCount + '/空跑' + anaDiag.failOnce
      + (anaDiag.lastFailWhy ? ('·最近中断=' + anaDiag.lastFailWhy) : '');
    console.log('[分析自检]', diag);
    flash('自检 ' + n + '手/看' + cur + ' · 选点' + (state.candAt < 0 ? '没算' : state.candAt)
      + ' · 搜' + state.rootVisits
      + (anaBusy ? ' · 在跑' : '') + (anaQueue.length ? ' · 欠' + anaQueue.length : '')
      + (anaTimeouts ? ' · 超时' + anaTimeouts : '')
      + ' · 引擎' + (engineReady ? '就绪' : (engStates.analyze === 'loading' ? '加载中' : '未就绪'))
      + ' · 详见控制台');
    return;
  }

  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;

  /* ★ 有弹窗开着（帮助 / 设置 / 复盘 / 棋谱库 / 新对局）→ 全局快捷键一律不响应。
     否则按键会「穿过」弹窗打到背后的棋局上：看着在看帮助，按个空格就把棋停了、
     按 T 推荐点就没了（用户明确说过「弹窗外的背景不该还能点」，键盘同理）。
     注意判断的是 `.open` —— 遮罩本身是常驻 DOM，不加 .open 时是不可见的。 */
  if (document.querySelector('.modal-mask.open')) return;

  /* ★ Alt+←/→：棋谱变体的兄弟切换（2026-10-17）。
     位置很关键：必须在**输入框/弹窗两道检查之后**（上面那两处已经 return），
     又在 `if (e.ctrlKey || e.metaKey)` 之前 —— 否则带修饰键的按键会被那条分支吃掉。 */
  if (e.altKey && !e.ctrlKey && !e.metaKey
      && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    switchVariation(e.code === 'ArrowRight' ? 1 : -1);
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); $('btn-undo').click(); }
    return;
  }
  /* 开关类快捷键统一带一句提示（这些键容易误触，而「东西突然没了」的第一嫌疑就是它）。
     键位（2026-10-04 用户指定）：T 推荐点 · Z 坐标 · M 手数 · Y 音效 · X 形势 · N 拟人落子 · D 试下。
     ⚠️ 改键位时**记得同步 index.html 里各开关名字后面的括号**，以及 title 提示。 */
  switch (e.code) {
    case 'ArrowLeft':  e.preventDefault(); $('btn-prev').click(); break;
    case 'ArrowRight': e.preventDefault(); $('btn-next').click(); break;
    case 'Home':       e.preventDefault(); $('btn-first').click(); break;
    case 'End':        e.preventDefault(); $('btn-last').click(); break;
    case 'Space':      e.preventDefault(); $('btn-pass').click(); break;
    case 'KeyT': {
      const c = $('chk-show'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示推荐点' : '已隐藏推荐点（再按 T 恢复）');
      break;
    }
    case 'KeyZ': {
      const c = $('chk-coords'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示棋盘坐标' : '已隐藏棋盘坐标（再按 Z 恢复）');
      break;
    }
    case 'KeyM': {
      const c = $('chk-nums'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示手数' : '已隐藏手数（再按 M 恢复）');
      break;
    }
    case 'KeyB': {
      const c = $('chk-pv'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '变化图：开 · 把鼠标停在推荐点上停一下' : '变化图：关');
      break;
    }
    case 'KeyY': {
      const c = $('chk-sound'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '音效：开' : '音效：关（再按 Y 恢复）');
      break;
    }
    case 'KeyX': {
      const c = $('chk-terr'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '已显示形势（' + (state.terrStyle === 'fog' ? '雾' : '方块') + '）' : '已隐藏形势（再按 X 恢复）');
      break;
    }
    case 'KeyN': {
      const c = $('chk-human'); c.checked = !c.checked; c.onchange({ target: c });
      flash(c.checked ? '拟人落子：开 · 按该段位人类的概率挑手' : '拟人落子：关 · 取最优手');
      break;
    }
    case 'KeyD':       e.preventDefault(); $('btn-draft').click(); break;   // 试下（打草稿）
  }
});

/* ---------------- 设置：KataGo 程序与权重 ----------------
   ★ 路径存在软件目录的 settings.json 里（主进程读写）；改完点「保存并重启引擎」，
     两个引擎会用新路径重新预热（约 10~20 秒），期间状态栏显示「引擎重启中…」。 */

const SET_MASK = $('settings');
/* 设置面板里的五项路径。前三个是 KataGo（**必需**：下棋/分析全靠它），
   后两个是 LoGos 讲解模型（**可选**：不配就没讲解功能，别的照常用）。 */
const SET_KEYS = ['katago', 'analyzeWeight', 'playWeight', 'coachServer', 'coachWeight', 'recordsDir'];
const SET_LABEL = { katago: 'KataGo 程序', analyzeWeight: '分析权重', playWeight: '对弈权重' };
let setCfg = null;                  // 面板里正在编辑的三条路径（还没保存）

function setMsg(text, bad) {
  const el = $('set-msg');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

/* 每行右侧的「✓ 已找到 / ★ 找不到」—— 路径一变就刷（不用保存也能看） */
async function refreshSettingsMarks() {
  const r = await window.api.settings.check(setCfg);
  for (const k of SET_KEYS) {
    const el = $('mark-' + k);
    const ok = !!(r && r[k]);
    el.classList.toggle('ok', ok);
    el.classList.toggle('bad', !ok);
    /* 棋谱库是**目录**，文案和「文件」那几项不一样：
       留空 = 用默认（程序目录\records，完全正常，不是「找不到」）。 */
    if (k === 'recordsDir') {
      const custom = !!(setCfg && setCfg.recordsDir && setCfg.recordsDir.trim());
      el.textContent = !custom ? '默认位置' : (ok ? '✓ 可用' : '★ 用不了');
      continue;
    }
    el.textContent = ok ? '✓ 已找到' : '★ 找不到';
  }
}

/* ★ 引擎兼容性自检（2026-10-07 新增）。
   把「引擎自报的后端」和「屏幕这块显卡」并排显示；对不上就把那句建议标红。
   为什么不做成**自动**弹窗：正常用户看到弹窗只会慌。放在设置面板里、给个「检查」按钮，
   需要的人自然会点。而且引擎没配好时也只是"信息"，不是错误。
   ⚠️ 探测会真的跑一次 katago.exe（约 0.1 秒），所以只在用户点「检查」时做，
     不在打开设置时自动跑 —— 免得每次开设置都去启动一个进程。 */
function renderEngineCheck(r) {
  const el = $('eng-check');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (!r || !r.backend) { el.textContent = '检查失败：拿不到引擎信息'; el.classList.add('bad'); return; }
  const be = r.backend, gpu = r.gpu || {};
  if (!be.ok) {
    /* 引擎文件不在/跑不起来 —— 这时「找不到文件」才是用户要听的那句话 */
    el.textContent = be.why || '读不到引擎信息';
    el.classList.add('bad');
    return;
  }
  const gpuTxt = gpu.name ? (gpu.name + (gpu.brand ? '（' + gpu.brand.toUpperCase() + '）' : '')) : '认不出显卡';
  const parts = [
    '下棋/分析：' + (be.name || be.raw) + (be.version ? '（v' + be.version + '）' : ''),
    '显卡：' + gpuTxt,
  ];
  /* ★ AI 讲解是**另一套**引擎、另一套显卡构建，所以单独报一行
     （2026-10-08 加：原来只查 KataGo —— A 卡用户按提示换完 KataGo 之后，
       LoGos 还是 N 卡那套、照样用不了，而软件一句话都不说。那是最让人困惑的情况。） */
  const la = r.llama || null;
  if (la) {
    parts.push('AI 讲解：' + (la.ok
      ? (la.device + (la.vramMB ? '（可用 ' + la.vramMB + ' MB）' : ''))
      : '用不了'));
  }

  const bad = [];
  if (r.warn) bad.push(r.warn);
  if (la && !la.ok) {
    bad.push('「AI 讲解」引擎用不了（' + (la.why || '认不出显卡') + '）。不影响下棋与分析；'
      + '想用讲解就去项目 Release 下载【通用版】包 —— 里面的讲解引擎什么显卡都能跑。');
  }
  if (bad.length) {
    el.textContent = parts.join('　·　') + '　——　' + bad.join('　');
    el.classList.add('bad');
  } else {
    el.textContent = parts.join('　·　') + '　——　✓ 都能配上';
    el.classList.add('ok');
  }
}

const btnEngCheck = $('btn-eng-check');
if (btnEngCheck) {
  btnEngCheck.onclick = async () => {
    const el = $('eng-check');
    const old = btnEngCheck.textContent;
    btnEngCheck.disabled = true;
    btnEngCheck.textContent = '检查中…';
    if (el) { el.classList.remove('ok', 'bad'); el.textContent = '正在读引擎后端…'; }
    let r = null;
    try { r = await window.api.engineCheck(); } catch (e) { r = null; }
    renderEngineCheck(r);
    btnEngCheck.disabled = false;
    btnEngCheck.textContent = old;
  };
}

function fillSettingsInputs() {
  for (const k of SET_KEYS) $('set-' + k).value = (setCfg && setCfg[k]) || '';
}

/* 把「最近用过的权重」灌进输入框的 datalist（2026-10-04 用户要求：权重多套并存、
   记住上次用的）。选项来自 settings.json 的 recent —— 每次保存都会把当前路径记进去。
   点输入框就能从下拉里挑回某一套，不用再翻一遍文件对话框。 */
function fillRecentWeights(recent) {
  const r = recent || {};
  for (const k of ['analyzeWeight', 'playWeight', 'coachWeight']) {
    const dl = $('recent-' + k);
    if (!dl) continue;
    dl.textContent = '';
    for (const p of (r[k] || [])) {
      const o = document.createElement('option');
      o.value = p;
      dl.appendChild(o);
    }
  }
}

/* ==================== 关于与更新（2026-10-08 用户要求）====================
   三件事：显示当前版本号 / 点一下查是否最新 / 一个按钮打开浏览器去下载页。

   ★★ 本软件**除了这里，任何地方都不出网**（审计过）：
        · KataGo、llama-server 都是本机子进程，不联网；
        · 软件自己跟 LoGos 说话走的是 127.0.0.1 的本地 HTTP（loops back，不出网卡）；
        · 引擎配置里出现的那些 https:// 全是**注释**（KataGo 自带的文档链接），不是请求。
      只有「检查更新」这一个按钮会发一次请求到 GitHub —— 而且**只在你点它的时候发**，
      不自动、不后台、不上报任何东西。 */
const REPO_PAGE = 'https://github.com/Rapace7/RapaceGo/releases/latest';

function appVerText(txt, cls) {
  const el = $('app-version');
  if (!el) return;
  el.classList.remove('ok', 'bad');
  if (cls) el.classList.add(cls);
  el.textContent = txt;
}

/* 打开设置面板时读一次版本号（本地读，不发请求） */
async function loadAppVersion() {
  try {
    const i = await window.api.app.info();
    appVerText('v' + i.version);
  } catch (e) { appVerText('（读不到版本号）'); }
}

const btnCheckUpdate = $('btn-check-update');
if (btnCheckUpdate) {
  btnCheckUpdate.onclick = async () => {
    const old = btnCheckUpdate.textContent;
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = '检查中…';
    appVerText('正在问 GitHub…');
    let r = null;
    try { r = await window.api.app.checkUpdate(); } catch (e) { r = null; }
    if (!r || r.ok !== true) {
      /* ★ 检查失败**只说实话** —— 绝不显示"已是最新"。（网络被挡 / GitHub 抽风都可能） */
      appVerText('检查失败：' + ((r && r.error) || '连不上 GitHub'), 'bad');
    } else if (r.uncertain) {
      appVerText('当前 v' + r.current + '，最新 ' + r.latest + '（你的版本号格式特殊，自己看一眼）');
    } else if (r.upToDate) {
      appVerText('已是最新（v' + r.current + '）', 'ok');
    } else {
      appVerText('有新版本 v' + r.latest + '（你在用 v' + r.current + '）—— 点右边「去下载页」', 'bad');
    }
    btnCheckUpdate.disabled = false;
    btnCheckUpdate.textContent = old;
  };
}

const btnOpenDownload = $('btn-open-download');
if (btnOpenDownload) {
  btnOpenDownload.onclick = async () => {
    /* 不依赖"检查"是否成功 —— 这个按钮任何时候都能用（网络被挡时用户照样能手动去下） */
    let r = null;
    try { r = await window.api.app.openDownload(); } catch (e) { r = null; }
    if (!r || r.ok !== true) flash('打不开浏览器：' + ((r && r.error) || '系统拒绝了') + ' —— 可以手动访问 ' + REPO_PAGE);
  };
}

async function openSettings() {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.config) || {});
  fillSettingsInputs();
  fillRecentWeights(info && info.recent);
  setMsg('');
  /* 自检结果**不跨次沿用**：上次那份可能是改路径之前读的，留着会误导。
     清成提示语，要看的自己点「检查」——反正那次探测只花 0.1 秒。 */
  const ec = $('eng-check');
  if (ec) { ec.classList.remove('ok', 'bad'); ec.textContent = '点「检查」看结果'; }
  /* 版本号是本地读的（不发请求）；更新状态**不跨次沿用** —— 和自检一个道理：
     上次查出来"有新版本"，用户可能已经下过新版了，留着会误导。 */
  loadAppVersion();
  SET_MASK.classList.add('open');
  await refreshSettingsMarks();
}

$('btn-settings').onclick = openSettings;
$('set-cancel').onclick = () => SET_MASK.classList.remove('open');
SET_MASK.addEventListener('click', e => { if (e.target === SET_MASK) SET_MASK.classList.remove('open'); });

/* 手打 / 粘贴进来的路径也要能检测：改完失焦就刷一次标记 */
for (const k of SET_KEYS) {
  $('set-' + k).onchange = () => {
    setCfg[k] = $('set-' + k).value.trim();
    refreshSettingsMarks();
  };
}

/* 「选择…」→ 系统文件选择框（主进程弹，我们只拿回路径） */
for (const k of SET_KEYS) {
  $('pick-' + k).onclick = async () => {
    const r = await window.api.settings.choose(k);
    if (!r || r.canceled) return;
    setCfg[k] = r.path;
    $('set-' + k).value = r.path;
    let extra = '';
    /* 选了 katago.exe → 主进程已顺手在同目录找过权重，这里自动填上 */
    if (r.suggest) {
      const hit = [];
      for (const kk of ['analyzeWeight', 'playWeight']) {
        if (r.suggest[kk]) {
          setCfg[kk] = r.suggest[kk];
          $('set-' + kk).value = r.suggest[kk];
          hit.push(SET_LABEL[kk]);
        }
      }
      if (hit.length) extra = '已在同目录找到权重并自动填上：' + hit.join('、') + '。';
    }
    setMsg(extra);
    await refreshSettingsMarks();
  };
}

$('set-default').onclick = async () => {
  const info = await window.api.settings.get();
  setCfg = Object.assign({}, (info && info.defaults) || {});
  fillSettingsInputs();
  setMsg('已填回默认路径（还没保存）。');
  await refreshSettingsMarks();
};

/* 棋谱库那一项旁边的「用默认」（只有改到别处时才有意义） */
$('reset-recordsDir').onclick = () => {
  setCfg.recordsDir = '';
  $('set-recordsDir').value = '';
  setMsg('已改回默认（程序目录\\records），点「保存并重启引擎」才生效。');
  refreshSettingsMarks();
};

$('set-shortcut').onclick = async () => {
  const r = await window.api.makeShortcut();
  if (r && r.ok) setMsg('桌面快捷方式已创建：' + r.path);
  else setMsg('创建快捷方式失败：' + ((r && r.error) || '未知'), true);
};

$('set-save').onclick = async () => {
  for (const k of SET_KEYS) setCfg[k] = $('set-' + k).value.trim();
  const btn = $('set-save');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  let r;
  try { r = await window.api.settings.save(setCfg); }
  catch (e) { r = { error: String(e) }; }
  btn.disabled = false;
  btn.textContent = old;

  if (!r || r.error) { setMsg((r && r.error) || '保存失败', true); return; }

  setCfg = Object.assign({}, r.config);
  fillSettingsInputs();
  fillRecentWeights(r.config && r.config.recent);   // 保存成功 → 下拉里多了刚用的这一套
  await refreshSettingsMarks();
  SET_MASK.classList.remove('open');
  /* 引擎是**异步**重启的（停 → 拉起 → 预热）；好了没有要看 engine:status 事件 */
  engineReloading = true;
  /* ★ 这次改棋谱库位置的话，如实报一下搬了几份过去（老位置的不删）。 */
  const mv = r.moved;
  if (mv && (mv.copied || mv.failed)) {
    flash('设置已保存 · 引擎重启中… 棋谱复制了 ' + mv.copied + ' 份'
      + (mv.skipped ? '（' + mv.skipped + ' 份同名没覆盖）' : ''));
  } else {
    flash('设置已保存 · 引擎正在按新路径重启…');
  }
};

/* 重启完成 → 提示一句。由 applyEngineStatus 调用（那两个引擎的都绪状态在那儿更新）。 */
function checkEngineReloaded() {
  if (!engineReloading) return;
  if (engineReady && engineReadyPlay) {
    engineReloading = false;
    flash('引擎已按新配置重启完成');
  } else if (engineNote) {
    engineReloading = false;      // 起不来就别一直挂着「重启中」，状态栏已显示「引擎异常」
  }
}

/* ---------------- 帮助 ----------------
   面板内容全是静态 HTML（写在 index.html 的 #help 里），这里只管开关。
   想改帮助文字 → 直接改 index.html；**改功能或快捷键时记得顺手同步**，
   别让帮助里写的和软件实际做的不一样。 */
const HELP_MASK = $('help');
$('btn-help').onclick = () => {
  HELP_MASK.classList.add('open');
  /* ★ 每次打开都从头看（2026-10-08）——
     上次翻到一半的位置留着，会让人以为帮助"打开就是最后一节"。
     ★ 滚动归零直接做（瞬时、不依赖任何测量）；各节位置等到**下一帧**
       —— 弹窗出现动画走完、布局稳定了 —— 再量并缓存（见 measureHelpSections 的注释）。 */
  const body = document.querySelector('.help-body');
  if (body) body.scrollTop = 0;
  helpHighlight('help-first');
  requestAnimationFrame(() => { helpOffsets = measureHelpSections(); });
};
$('help-close').onclick = () => HELP_MASK.classList.remove('open');
HELP_MASK.addEventListener('click', e => { if (e.target === HELP_MASK) HELP_MASK.classList.remove('open'); });

/* ---------- 帮助顶部的直达目录（2026-10-08 用户要求）----------
   用户原话：「软件内的帮助要有顶部列出的直达按钮，直接拉到对应位置，方便快速查询」。

   ★ 为什么不用浏览器原生的 `#id` 锚点跳转：
     帮助正文的滚动容器是 **`.help-body`**（它自己 `overflow-y:auto`），不是根文档 ——
     `#id` 锚点在这里不生效。所以位置得自己算：
       目标相对滚动容器的偏移 = 目标.rect.top − 容器.rect.top ＋ 容器已滚过的距离
     再自己赋 `scrollTop`。CSS 里配了 `scroll-margin-top: 44px` 给吸顶目录让位，
     所以这里不用再手动减目录高度。

   ★ 顺带做**当前小节高亮**：目录吸在顶上，翻到哪一节一眼就知道自己在哪、
     还剩哪些没看 —— 这才是"方便快速查询"。（用 rAF 节流，滚动不卡。） */
const HELP_SECTIONS = ['help-first', 'help-parts', 'help-feat', 'help-rules', 'help-keys', 'help-data'];

/* 平滑滚动：自己用 rAF 做，**不用 CSS 的 scroll-behavior:smooth**。
   为什么不能用 CSS 那个（2026-10-08 实测踩到）：
     它会让每一次 `scrollTop` 赋值都变成动画，于是"先归零、再量绝对位置"的算法失效 ——
     赋值后立刻量，量到的还是动画中途的值（实测设了 0、读到 72），跳转位置就全错。
   自己写还有个好处："打开帮助时归零"可以瞬时完成，而"点目录跳转"才用动画。 */
function animateScrollTop(el, to, ms) {
  const from = el.scrollTop;
  const dist = to - from;
  if (!dist) return;
  /* 环境不支持 rAF（或无头调试窗口）→ 直接跳，别留个半路的位置 */
  if (typeof requestAnimationFrame !== 'function') { el.scrollTop = to; return; }
  const t0 = performance.now();
  const dur = ms || 260;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic：快进慢出
    el.scrollTop = from + dist * e;
    if (p < 1) requestAnimationFrame(step);
    else el.scrollTop = to;                           // 收尾对齐，免得差几像素
  };
  requestAnimationFrame(step);
}

/* 各小节相对"滚动内容顶部"的偏移量。
   ★★ 为什么要缓存（2026-10-08 踩了两次才想通）：
     · 弹窗关闭时是 `display:none` → 里面所有元素的 rect 全是 0；
     · 弹窗刚打开时还在做出现动画 → 量出来会偏（实测"打开后跳第一节"停在 72px 而不是 0）。
     两次都是同一个病：**在布局不稳定的时候量位置**。
     所以改成：**只在弹窗稳定显示后量一次、存起来**（打开时的下一帧量），
     之后所有跳转都用这份缓存 —— 不再依赖任何实时 rect。 */
let helpOffsets = null;

function measureHelpSections() {
  const body = document.querySelector('.help-body');
  if (!body) return null;
  const keep = body.scrollTop;
  body.scrollTop = 0;                                  // 量之前先归零，量完还原
  const br = body.getBoundingClientRect();
  const out = {};
  for (const id of HELP_SECTIONS) {
    const el = document.getElementById(id);
    out[id] = el ? Math.round(el.getBoundingClientRect().top - br.top) : 0;
  }
  body.scrollTop = keep;
  return out;
}

function helpScrollTo(id, smooth) {
  const body = document.querySelector('.help-body');
  if (!body) return;
  if (!helpOffsets) helpOffsets = measureHelpSections();
  if (!helpOffsets) return;
  const top = Math.max(0, (helpOffsets[id] || 0) - 44);   // 44 = 吸顶目录让出的高度
  if (smooth === false) body.scrollTop = top;
  else animateScrollTop(body, top, 260);
  helpHighlight(id);
}

function helpHighlight(id) {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.help === id));
}

/* 滚到哪一节就高亮哪个。
   ★ 判据：**找最后一节「相对内容顶部的偏移 ≤ 当前滚动位置 + 一点余量」**。
     第一版我写成"看谁已经越过容器顶部"（rect 相减），在**顶部**时那一节是"第一次使用"
     和"主要功能"同时满足条件、取到后面那个 —— 所以滚到最上面反而高亮"主要功能"。
     用绝对偏移量比就没这个歧义：滚到 0 时只有第一节满足。 */
(() => {
  const body = document.querySelector('.help-body');
  const nav = $('help-nav');
  if (!body || !nav) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = body.scrollTop + 60;
    let cur = HELP_SECTIONS[0];
    for (const id of HELP_SECTIONS) {
      const el = document.getElementById(id);
      if (!el) continue;
      /* 同样用"先归零再量"会闪，所以这里用 offsetTop 一类的稳定量：
         el 相对 .help-body 内容顶部的距离 = rect.top − body.rect.top + body.scrollTop */
      const off = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      if (off <= y) cur = id;
    }
    helpHighlight(cur);
  };
  body.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  });
})();

/* 点目录里的按钮 → 跳过去（阻止默认，免得地址栏跑出 `#help-xxx` 的尾巴） */
(() => {
  const nav = $('help-nav');
  if (!nav) return;
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      helpScrollTo(a.dataset.help || (a.getAttribute('href') || '').replace('#', ''), true);
    });
  });
})();

/* ---------------- 启动 ---------------- */

window.addEventListener('resize', resize);
bindClockName('b');        // 右侧双方名字：点一下就能改（导出棋谱时写进 PB/PW）
bindClockName('w');
fillLevelSelects();        // ★ 段位下拉要先生成 —— applyNewGame → syncUI 会读它
refreshLevelNote();
fillVisitSelect();         // 搜索量下拉（「计算深度」）
/* ★ 启动时**不直接开局**（用户要求）：把界面摆成「未开局」的中性状态 ——
   棋盘点不动、胜率条五五开且不发分析、对局信息四项全「未定」，
   棋盘中央一个大胶囊按钮引导去新建对局。 */

/* ==================== 讲解（LoGos，2026-10-05 新增） ====================

   两个框、两条功能，共用同一套「问 LoGos」的机制：

   · 分析讲解 —— 点评**当前显示的那一手**
   · 选点讲解 —— 讲「这一手该走哪、为什么」

   ★★ 一条铁律：**点位由 KataGo 定，LoGos 只负责讲道理。**
      实测（同一天的探索记录）：让 LoGos 直接点评已下的一手，它
        ① 对明显差的一手照样编得出「很有战略意义」；
        ② 会跑题（讲起别的区域，不提你问的那手）；
        ③ 甚至把坐标说错（传 A1，它讲成 A13）。
      但反过来——给它一个**本来就合理的点**（KataGo 的候选点就是），
      它讲得又快又好：每点约 4 秒、约 120 字、术语也像样。
      所以：「好坏」永远由 KataGo 的目损说，「为什么」才交给 LoGos。

   两条共同的规矩（用户定）：
     · 单次不超过 200 字，局面简单时几十字
     · 再点一次 = 清掉旧的、重新生成
     · 内容只在对局期间保留；开新局 / 换棋谱就清空
*/

/* ---------- 空状态只留一句「点哪儿」 ----------
   ★ 2026-10-24 用户要求：原来那两大段常驻说明（「点评当前显示的这一手…」「点由 KataGo 定 ·
     讲解由 LoGos 写…打谱时用不了」）**整段删掉** —— 卡片本来就窄，正文还没出来先占满一屏，
     而且那些话现在都写进了按钮的 tooltip 和软件内帮助里。这里只留一句指路。 */
const COACH_EMPTY_EXPLAIN = '点下面「讲解这手」，听听这一手怎么样。';
const COACH_EMPTY_PICK = '点下面「推荐落点讲解」，让 LoGos 讲讲 KataGo 算出的这几个点为什么这么下。';

/* LoGos 的 system prompt（照官方格式写，它认这个） */
const COACH_SYS = '你是一位专业的围棋棋手。在给出的棋局中，"X"表示黑棋，"O"表示白棋。'
  + '棋盘的大小为19x19，每个落子的坐标是一个字母加上一个数字的形式。'
  + '字母为A-T(跳过I)，对应于棋盘上从左到右。数字为1-19，对应于棋盘上从下到上。\n';

/* ★ 停词 —— 掐掉「开始逐手推演变化图」的那一句。
   实测：不截断时它一口气吐 623 token 的长篇推演；截断后只剩 55 token / 1.8 秒，
   留下的正好是「结论 + 几条理由」= 用户要的那种讲解。
   ⚠️ 别加太宽的词（「其他」「另一个」「如果选择」都试过）——它们会出现在正常句子里，
      一命中就把讲解拦腰砍断（实测有一次只剩 60 字、末尾还是个破折号）。 */
const COACH_STOP = ['选项', '此外', '可能的变化', '的变化是', '变化推演', '变化如下',
  '其他选择', '另一个选择', '接下来黑棋', '接下来白棋'];

let coachSeq = 0;              // 请求序号：被新的取代就丢弃（这就是「覆盖」）

/* ---------- 拼输入 ---------- */

/* 着法序列：1.X-Q16  2.O-R4 ……（和官方训练数据同一个格式） */
function coachMoveList(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    out.push((i + 1) + '.' + (m.color === 'b' ? 'X' : 'O') + '-'
      + (m.pass ? 'pass' : toGTP(m.x, m.y)));
  }
  return out.join('  ');
}

/* 棋盘矩阵 [[...]]：1=黑 -1=白 0=空。
   ⚠️ 第 0 行是**最上面**那一行 —— 这个朝向是拿官方训练数据逐字节核对过的
      （官方的 3.X-D4 落在 matrix[15][3]，正是本函数算出来的位置）。
   注意 RapaceGo 的 y=0 也在最上面（toGTP 写的是 N-y），所以这里是正序，不用翻。 */
function coachMatrix(board) {
  const rows = [];
  for (let y = 0; y < N; y++) {
    const row = new Array(N);
    for (let x = 0; x < N; x++) {
      const v = board[idx(x, y)];
      row[x] = v === 1 ? 1 : (v === 2 ? -1 : 0);
    }
    rows.push('[' + row.join(',') + ']');
  }
  return '[' + rows.join(',') + ']';
}

/* 一条「指定点讲解」的完整输入。
   ★ 末尾那句「预填」是整套里最关键的一招：它训练时的模板就是「先长篇推理、
     再给结论」，直接命令它「讲短点」完全无效（实测给它 150 字的限制，
     它照样吐 623 token）。但**替它写好开头**，它就会顺着往下写 ——
     于是直接从结论开始，不再罗列一堆候选点。

   ★★ 预填必须用**条件句**（「如果白棋下在C3，」），不能用断言句（「白棋下在C3」）——
      实测断言句会让它把**还没落子**的候选点当成既成事实来讲
      （「白棋在C3的应对是非常标准的」），读起来像在讲已经发生的事，是逻辑错误。
      条件句输出的自然就是「如果……那么……」，逻辑对，内容也不减。
      （加"这是建议、还没落子"之类的约束词它**根本不理**——7B 的指令遵循就这么弱。） */
function coachPrompt(moves, board, color, point, onset) {
  return COACH_SYS + '\n'
    + '以下是当前的对局记录：\n\n' + coachMoveList(moves)
    + '\n\n\n当前盘面情况为:' + coachMatrix(board)
    + '\n其中1表示黑棋，-1表示白棋，0表示空位。\n'
    + '<reasoning>\n如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，'
    /* ★★ 2026-10-08：「分析讲解」用的是**已经下出来的那一手**，要讲的是
       「这一手之后会怎样」，不是「该下在哪」。原来的 prompt 只有前半句，
       模型于是顺着「这手好不好 / 该下哪」去讲，用户实测抱怨：
       「这分析讲解应该是如果下在这里会怎样啊，而不只是应该下在哪里」。
       这里补一句强制要求，**只在传了 onset 时加**（推荐落点讲解不传，保持原样）。 */
    + (onset ? ('\n（这一手已经下出来了' + onset + '。请**先直接说这一手之后会发生什么**：'
      + '它碰到了哪些棋子、切断了什么、自己多了或少了气、对方接下来最可能的应手是什么；'
      + '然后再讲这样下划不划算。不要重复上面的胜率数字，也不要说「应该下在别处」。）') : '');
}

/* 清掉它偶尔带出来的标签和结论框 */
function cleanCoachText(s) {
  return String(s || '')
    .replace(/<\/?reasoning>/gi, '')
    .replace(/<\/?answer>/gi, '')
    .replace(/\\boxed\{[^}]*\}/g, '')
    /* ★ 推演变化图的残渣：像「5.X-R17」「78.O-J13」「X-D4」这种记谱 ——
       这是 LoGos 训练数据里的写法（X=黑 O=白，前面数字是第几手，后面是坐标），
       但它混在讲解里用户根本看不懂（用户原话：「一个字母加-接一个坐标的是啥意思？」），
       而且我们要的是讲解、不是变化图（变化图由 KataGo 的推荐点负责）——一律清掉。 */
    .replace(/\d+\.\s*[XO]-[A-T]\d{1,2}/g, ' ')
    .replace(/[XO]-[A-T]\d{1,2}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    /* 结尾只剩半个标点（「——」「，」「、」）说明这句被截断了 —— 磨掉，
       别让人看着像话没说完。 */
    .replace(/[，,、：:；;]+$/, '')
    .replace(/[—–-]+$/, '')
    .trim();
}

/* 它讲到后面总想「列候选 / 推演变化」，被停词截断后会剩半句话 ——
   这里做三件事，只留「结论 + 理由」：
     ① 砍掉「开始分析下一步」的尾巴（实测这些词一出现，后面就是推演）
     ② 砍掉「开始罗列第二/第三个方案」的尾巴 —— 用户要的是**这一个点**的讲解，
        候选清单本来就由 KataGo 给、写在标题上了，不需要它再列一遍
     ③ 最后砍到最后一个完整句子，别让人看着像话没说完（实测尾巴长这样：
        「……非常符合棋理。现在轮到白棋第6手，我需要考虑几个可能的选择：」） */
function trimCoachTail(t) {
  let s = String(t || '');
  const m1 = s.search(/(我需要|现在轮到|可能的选择|接下来我|下面我|让我想想|让我思考|让我分析)/);
  if (m1 > 0) s = s.slice(0, m1);
  /* ★ 只把**真的是分点**的词当分点（2026-10-06 审查发现）：
     原来 `第二|第三` 是裸词，而围棋讲解里「第二线」「第三路」「第二个角」都是常用说法 ——
     一出现就把后面整段砍掉，句子只剩半截（而且看起来像模型自己写坏了，很难发现是这里砍的）。
     现在给这两个词加条件：后面**不能**接 线/路/手/个/种/局/盘/阶。
     `其次/再次/另外/另一种` 几乎只能是分点，保持原样。 */
  const m2 = s.search(/(其次|再次|另外|另一种|另一个思路|或者考虑|也可以考虑|第二(?!线|路|手|个|种|局|盘|阶)|第三(?!线|路|手|个|种|局|盘|阶))/);
  if (m2 > 8) s = s.slice(0, m2);
  s = s.trim();
  const last = Math.max(s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'));
  if (last > 0 && last < s.length - 1) s = s.slice(0, last + 1);
  return s.trim();
}

/* 预填是条件句「如果白棋下在C3，」，模型接着写「那么黑棋很可能……」——
   渲染时把预填那半句拼回去，读起来才是一句完整的话。

   ★ 2026-10-08：多了一种开头 `head`（给「分析讲解」用）——
     那种场景下问的是**实际下出来的那一手**，所以要写成「这一手 X（...）下出来，」
     而不是「如果下在 X，」。不传 head 时保持老行为（推荐落点讲解走这条）。 */
function fixCoachHead(t, point, color, head) {
  const pre = head || ('如果' + (color === 'b' ? '黑棋' : '白棋') + '下在' + point + '，');
  return pre + String(t || '');
}

/* 一段最终要上屏的讲解：清洗 → 去尾 → 补开头 */
function coachTextReady(raw, point, color, head) {
  return fixCoachHead(trimCoachTail(cleanCoachText(raw)), point, color, head);
}

/* 这段讲解"能不能用"？——不行就重试一次（两次里挑可用的）。
   ★ 判据：**第一句得说完整**（前 60 字里要有句号/问号/叹号），且不能太短。
   实测它有两个失手方式：① 只吐半句就停（「如果黑棋下在R16，」）
   ② 整段都是变化图推演、一句完整的话都没有
      （批量讲解里见过 61 个字全是「…下在X，Y下在Z，…那么」）。 */
function coachUsable(t) {
  const s = String(t || '');
  return s.length >= 40 && /[。！？]/.test(s.slice(0, 60));
}

/* ---------- 打字机：让讲解「按字出来」 ----------
   用户反馈：直接把流式片段贴上去是「隔好多才出一段」——因为网络会把几个 token
   攒成一块再给。所以这里不贴片段，而是记住**累计文本**，自己按固定速度一个字
   一个字往外放；新出现的字带淡入（由淡转实）。
   速度定得比模型快（80 字/秒 vs 模型约 30），所以永远追得上，不会越等越久。 */
function makeTyper(el) {
  let target = '';
  let shown = 0;          // 已经「放」到第几个字
  let painted = 0;        // 已经画进 DOM 的第几个字
  let raf = 0;
  let lastTs = 0;
  let wantFinish = false;
  const CPS = 80;

  function put(s) {
    s = String(s == null ? '' : s);
    /* 新文本不是旧文本的延长 → 内容被改写了（清洗/替换），重来一遍 */
    if (!s.startsWith(target.slice(0, Math.min(target.length, s.length)))) {
      target = s; shown = 0; painted = 0; el.textContent = '';
    } else {
      target = s;
    }
    /* ⚠️ 必须夹住 shown：清洗会把结尾的半个标点磨掉，target 可能比已经放出去的字**还短**——
       不夹的话 paint() 会越界去读 target[painted]，画出空字。 */
    if (shown > target.length) shown = target.length;
    if (painted > target.length) painted = target.length;
  }

  function paint() {
    const n = Math.floor(shown);
    while (painted < n) {
      const sp = document.createElement('span');   // 每个字一个 span —— 带淡入动画
      sp.className = 'just';
      sp.textContent = target[painted];
      el.appendChild(sp);
      painted += 1;
    }
  }

  function solidify() {                            // 定稿：整段变成普通文本（顺手清掉那一堆 span）
    el.textContent = target;
    painted = target.length;
  }

  function tick(ts) {
    raf = 0;
    const dt = lastTs ? Math.min(150, ts - lastTs) : 16;
    lastTs = ts;
    if (shown < target.length) {
      shown = Math.min(target.length, shown + CPS * dt / 1000);
      paint();
      raf = requestAnimationFrame(tick);
    } else if (wantFinish) {
      solidify();
    }
  }

  function ensure() {
    if (!raf && shown < target.length) { lastTs = 0; raf = requestAnimationFrame(tick); }
  }

  return {
    setTarget(t) { put(t); ensure(); },
    finish(finalText) {
      if (typeof finalText === 'string') put(finalText);
      wantFinish = true;
      if (shown >= target.length) solidify();      // 已经放完了 → 直接定稿
      else ensure();                               // 还差几个字 → 让它放完，放完时自动定稿
    },
  };
}

/* 讲解的流式渲染：主进程每收到一小段就推一次（带 id）——
   这里按 id 找到对应的打字机，把**累计文本**喂给它。 */
const coachTypers = new Map();
if (window.api && window.api.coach && window.api.coach.onProgress) {
  window.api.coach.onProgress(d => {
    const t = coachTypers.get(d.id);
    if (t) t.setTarget(cleanCoachText(d.full));
  });
}

/* ★ 坐标校验：实测它偶尔会把坐标写歪（传 A1，它写「白棋下在A13位置」）。
   规则：只看**最前面那十几个字**里的第一个坐标 —— 那里若出现坐标，
   就必须是我们给的那个点，否则整段作废。开头没提坐标就通过。
   ⚠️ 不能全文搜：它顺口说一句「和 C3 呼应」是很正常的，全文搜会误伤 ——
      第一版就是那么写的，实测 4 段里误杀了 3 段（只因为正文里提了别的子）。 */
function coordOk(text, point) {
  const head = String(text || '').slice(0, 18).toUpperCase();
  const m = head.match(/[A-HJ-T]\d{1,2}/);
  if (!m) return true;                       // 开头没提坐标 → 通过
  return m[0] === point.toUpperCase();
}

/* 问一次 LoGos。回来的序号对不上就说明已被新请求取代 → 丢弃（「覆盖」就是这么做出来的）。
   传了 typer 就把它登记到 id 上 —— 流式片段会喂给这个打字机（见上面的 onProgress）。 */
async function coachAsk(prompt, maxTokens, typer) {
  const id = ++coachSeq;
  if (typer) coachTypers.set(id, typer);
  try {
    const r = await window.api.coach.explain({
      id: id,
      prompt: prompt,
      maxTokens: maxTokens || 320,
      temperature: 0.3,
      stop: COACH_STOP,
    });
    if (id !== coachSeq) return null;
    return r;
  } finally {
    coachTypers.delete(id);
  }
}

/* ---------- 小工具 ---------- */
function mkEl(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  d.textContent = text == null ? '' : text;
  return d;
}
function resetCoachBtn(which) {
  /* ★ 全盘讲解期间不许点亮 —— 那两个按钮这时是灰的（防止插队抢通道），
     被这里的 finally 点亮就白挡了（2026-10-05 审查发现）。 */
  if (state.coach.batch) return;
  const b = $(which === 'explain' ? 'btn-explain' : 'btn-pick');
  if (!b) return;
  b.disabled = false;
  b.textContent = which === 'explain' ? '讲解这手' : '推荐落点讲解';
}

/* 换页 / 重新生成时把讲解区滚回顶。
   ★ 2026-10-24 三个按钮共用一块正文区之后，不再需要「滚到某一段」——
     露出来的永远只有一页，新内容就该从第一行开始读。 */
function coachScrollTop() {
  const sc = $('coach-scroll');
  if (sc) sc.scrollTop = 0;
}

/* ---------- 按**当前手数**刷新两个框 ----------
   切换手数、讲解完成、开新局 —— 都走这里。
   ★ 为什么必须按手数取内容：用户报过两个 bug ——
     ① 讲完第 2 手点回第 1 手，框里还挂着第 2 手的讲解（和眼前这一手对不上）；
     ② 讲完第 6 手再点回第 2 手，第 2 手的讲解直接没了。
     现在每手各存一份，切到哪手显示哪份，没有就写「这一手还没有讲解」。 */
let coachRenderedAt = -999;
/* #pick-body 里此刻挂着的是**哪一手**的打字机（-1 = 没挂）。
   ★ 2026-10-24 晚：推荐落点改成「按当前局面显示」之后，切手数会把 #pick-body 清空重画，
     那条打字机就脱开了文档（还在跑，但画在没人看的地方）。靠这个标记区分
     「正在这一手往上画（别动 DOM）」和「切回来时这一手还在后台跑（显示等待提示）」。 */
let pickLiveAt = -1;
function pickPositionKey(at) {
  return JSON.stringify([N, settings.rules, settings.komi, state.setup, state.moves.slice(0, at)]);
}
/* 取「第 at 手那个局面」对应的推荐落点讲解；没讲过返回 null。
   ★★ 2026-10-24 晚 用户报障：讲完某一手，往前/往后看到别的手，「推荐落点讲解」那段
     内容纹丝不动 —— 因为渲染时读的是 `state.coach.pick`（**最后生成的那一份**），
     而不是当前局面那一份。现在一律按**局面键**取：切到哪一手看哪一手，没讲过就是空状态。
     正在生成的那一份（pickPending）也认同一个键，别的手在跑时不冒充当前局面。 */
function pickRecAt(at) {
  const key = pickPositionKey(at);
  const pend = state.coach.pickPending;
  if (pend && pend.positionKey === key) return pend;
  const hit = state.coach.picks[key];
  if (hit) return hit;
  /* 兼容老路径：有几处只往 state.coach.pick 里放、不写 picks */
  return (state.coach.pick && state.coach.pick.positionKey === key) ? state.coach.pick : null;
}
function renderPickContext() {
  const rec = pickRecAt(state.viewAt);
  const el = $('pick-context');
  el.hidden = !rec;
  el.classList.remove('is-stale');       // 现在永远讲的都是**眼前这个局面**，没有「已变化」这回事
  el.textContent = rec
    ? '第 ' + rec.at + ' 手后 · ' + (rec.side === 'b' ? '黑方' : '白方') + ' · '
      + (rec === state.coach.pickPending ? '正在生成讲解快照' : '讲解快照')
      + (rec.srcNote || '')
    : '';
}
/* ---------- 「全盘」视图：整盘每一手的讲解连成一页 ----------
   ★ 2026-10-22 用户报障：「LoGos 全盘讲解的结果，只是分析了当前手，而不是全盘」。
     查下来**数据是全的**（.coach.json 里 16 手都有），问题在**没有地方能一次看完**：
     那个框永远只显示 `state.coach.explain[viewAt]`，于是跑完几分钟，
     用户看到的还是最后那一手的一段话，自然读成「只讲了一步」。
   这个视图：① 跑完自动切过来 ② 标题旁「看全盘」随时能回来 ③ 点其中一手跳过去。
   高亮只改 class、不重建 DOM —— 否则每换一手阅读位置就被弹回顶上。 */
let coachAllSig = '';
let coachAllCur = -1;             // 上一次高亮在第几手（syncUI 每次都调，没变就别扫一遍 DOM）
function renderCoachAll(force) {
  const box = $('explain-body');
  if (!box) return;
  const n = state.moves.length;
  const keys = [];
  for (let i = 1; i <= n; i++) {
    const rec = state.coach.explain[i];
    if (rec && rec.body) keys.push(i);
  }
  const sig = n + '|' + keys.join(',');
  if (force || sig !== coachAllSig) {
    box.classList.add('all-list');
    box.textContent = '';
    const sc = $('coach-scroll');
    if (sc) sc.scrollTop = 0;        // 摊成全盘 → 从第一手开始读（别停在上半/下半段原来的位置）

    const otherLines = coachOtherLines().length;
    box.appendChild(mkEl('div', 'src', keys.length
      ? ('整盘 ' + n + ' 手 · 逐手讲了 ' + keys.length + ' 手'
        + (keys.length < n ? '（其余的手选到那一手、再点「讲解这手」补）' : ''))
      : (otherLines
        ? ('这条分支还没讲过（另外 ' + otherLines + ' 条分支有讲解）—— 点下面「全盘讲解」，它只补这一条')
        : ('整盘 ' + n + ' 手，还没有逐手讲解 —— 点下面「全盘讲解」一次讲完'))));
    for (const i of keys) {
      const rec = state.coach.explain[i];
      const row = mkEl('div', 'all-row');
      row.dataset.at = String(i);
      row.title = '点一下跳到第 ' + i + ' 手';
      row.appendChild(mkEl('div', 'pnt', rec.head));
      if (rec.verdict) row.appendChild(mkEl('div', rec.ok ? 'ph vok' : 'ph', rec.verdict));
      if (rec.lead) row.appendChild(mkEl('div', 'ph', rec.lead));
      row.appendChild(mkEl('div', 'all-body', rec.body));
      box.appendChild(row);
    }
    coachAllSig = sig;
    coachAllCur = -1;
  }
  if (coachAllCur !== state.viewAt) {
    coachAllCur = state.viewAt;
    const rows = box.querySelectorAll('.all-row');
    for (const el of rows) el.classList.toggle('cur', +el.dataset.at === state.viewAt);
  }
}

function renderCoachPanels(force) {
  renderPickContext(); // 生成期间也更新上下文，不重绘打字机正文
  const at = state.viewAt;

  /* ★★ 2026-10-24 用户要求：三个按钮**共用这一块正文区**，点哪个显示哪个 ——
     所以这里只让**当前那一页**露出来（另一页 hidden），标题也跟着换。
     不换标题的话，「推荐落点讲解」的正文顶上写着「分析讲解」，读起来像放错了地方。 */
  const view = state.coach.view === 'pick' ? 'pick' : 'explain';
  const exBody = $('explain-body'), pkSec = $('pick-sec');
  if (exBody) exBody.hidden = (view === 'pick');
  if (pkSec) pkSec.hidden = (view !== 'pick');
  const titleEl = $('coach-title');
  if (titleEl) {
    titleEl.textContent = view === 'pick'
      ? '推荐落点讲解' : (state.coach.allView ? '全盘讲解' : '分析讲解');
  }

  /* 「看全盘」入口：有逐手讲解、或者是从棋谱库打开的棋谱时露出来。
     视图开着时它变成「返回」（回到按手数看的那个框）。
     ★ 推荐落点那一页不显示它（那一页只讲「这一刻该走哪」，没有逐手列表）。 */
  const allLink = $('btn-all');
  if (allLink) {
    allLink.hidden = view === 'pick' || !(Object.keys(state.coach.explain).length
      || (state.fromRecord && state.recName));
    allLink.textContent = state.coach.allView ? '返回' : '看全盘';
  }
  /* ★ 2026-10-22 用户报障：整盘讲解跑完，右边只有当前那一手 → 加了这个「全盘」视图。
     它**不跟手数走**（换手数只是挪高亮），所以先于下面那条「同一手就跳过」的短路返回。
     ★ 2026-10-24：只在「分析讲解」那一页生效（推荐落点那一页有自己的正文，别抢）。 */
  if (view !== 'pick' && state.coach.allView) { renderCoachAll(force); return; }

  if (!force && at === coachRenderedAt
      && state.coach.busy.explain !== at && state.coach.busy.pick !== at) return;
  coachRenderedAt = at;

  /* 正在生成的那一手已经不是当前这一手了 → 掐断（用户切走了，
     别再往已经离开屏幕的元素上画）。
     ⚠️ 只对**分析讲解**做 —— 它跟手数走，切走了就该停；
        选点讲解不跟手数走（就是一份留在那儿的快照），切手数不打断它。 */
  if (state.coach.busy.explain >= 0 && state.coach.busy.explain !== at) {
    coachSeq++; state.coach.busy.explain = -1; resetCoachBtn('explain');
  }

  /* 分析讲解 */
  if (state.coach.busy.explain !== at) {
    const box = $('explain-body');
    if (box) {
      const rec = state.coach.explain[at];
      box.classList.remove('all-list');
      coachAllSig = '';                 // 下次进「全盘」要重建
      box.textContent = '';
      if (rec) {
        box.appendChild(mkEl('div', 'pnt', rec.head));
        if (rec.verdict) box.appendChild(mkEl('div', rec.ok ? 'ph vok' : 'ph', rec.verdict));
        if (rec.lead) box.appendChild(mkEl('div', 'ph', rec.lead));
        box.appendChild(mkEl('div', '', rec.body));
      } else {
        box.appendChild(mkEl('div', 'ph', at > 0
          ? '这一手还没有讲解 —— 点下面「讲解这手」。'
          : COACH_EMPTY_EXPLAIN));
      }
    }
  }

  /* 选点讲解 —— 按**当前局面**取那一份（★ 2026-10-24 晚 修 bug：原来固定读最后生成的
     那一份，于是回看到别的手时这段内容不动，和眼前局面完全对不上）。
     ★ 只有「正在生成的就是这一手，且打字机还挂在这块 DOM 上」时才别动 DOM；
       其余情况（没讲过 / 讲的是别的局面 / 切走了又切回来）都按当前局面渲染。
       生成中的那一份跑完仍会进 picks 缓存，切回去就能直接看到。 */
  const pickBusy = state.coach.busy.pick;
  if (pickBusy === at && pickLiveAt === at) return;   // 打字机正往上画，别抢 DOM
  const pickBox = $('pick-body');
  if (pickBox) {
    const rec = pickRecAt(at);
    pickLiveAt = -1;                                  // 下面要清空 DOM → 旧打字机就脱开了
    pickBox.textContent = '';
    if (rec && rec.pts && rec.pts.length) {
      rec.pts.forEach(p => {
        pickBox.appendChild(mkEl('div', 'pnt', p.title));
        pickBox.appendChild(mkEl('div', '', p.body));
      });
    } else if (pickBusy === at
        || (state.coach.pickPending && rec === state.coach.pickPending)) {
      /* 切走了又切回来，而这一手还在生成中（打字机已随清空脱开文档）→ 说清状态。
         ⚠️ 必须写成 `pickPending && rec === pickPending`：两边都为 null 时
         `null === null` 也是 true，会把「没讲过」误判成「正在生成」（测试抓到的）。 */
      pickBox.appendChild(mkEl('div', 'ph', '这一手的推荐落点讲解还在生成，稍等…'));
    } else {
      pickBox.appendChild(mkEl('div', 'ph', at > 0
        ? '这一手还没有推荐落点讲解 —— 点下面「推荐落点讲解」。'
        : COACH_EMPTY_PICK));
    }
  }
}

/* 开新局 / 换棋谱时清空（用户要求：讲解只在对局期间保留）。
   注意它是被 applyNewGame / applyRecord 调的 —— 那两个是函数声明、已提升。 */
function clearCoachPanels() {
  coachSeq++;                                   // 作废还在飞的那条
  state.coach.busy = { explain: -1, pick: -1 };
  state.coach.explain = {};
  state.coach.lines = {};                        // 按线存的那份也清（换棋谱/开新局）
  state.coach.curKey = '';
  state.coach.pick = null;
  state.coach.picks = {};                        // 推荐落点的缓存也清（换棋谱就该重讲）
  pickLiveAt = -1;                               // 打字机随 #pick-body 重画一并作废
  state.coach.pickPending = null;
  state.coach.view = 'explain';                  // 换棋谱 → 回到「分析讲解」那一页
  state.coach.allView = false;                   // 换棋谱 → 回到按手数看的那个框
  coachAllSig = '';
  resetCoachBtn('explain');
  resetCoachBtn('pick');
  /* 「全盘讲解」只在**打开棋谱**时出现（用户要求） */
  if ($('btn-batch')) $('btn-batch').hidden = !state.fromRecord;
  if ($('btn-all')) $('btn-all').hidden = true;
  coachRenderedAt = -999;
  renderCoachPanels(true);
}

/* ---------- 选点讲解 ----------
   点位和胜率**全部取自 KataGo 的候选点**（对局中就是棋盘上画的那几个；
   打谱时棋盘上没有实时分析，就借复盘数据、没有复盘才现场算 —— 见 pickCandidatesAt）
   —— 点击时同源；之后棋盘继续实时更新，文字保留点击时的快照。
   LoGos 只负责给每个点补一句「为什么这么下」。

   ★ 2026-10-24 用户两条要求：
     ① 同一个局面讲过一次，再点**直接显示**，不再让 LoGos 重讲（缓存见 state.coach.picks）；
     ② 打谱时也能用（原来这里是「别人的棋，不替人支招」直接挡住）。 */

/* 取「当前局面」的一批候选点。
   ① 先看复盘：同一个局面、同一档搜索量，和「复盘 / 全盘讲解」说的是同一个数；
   ② 没有复盘数据就现场问 KataGo（reviewVisits() = 500，和复盘同一档）。
   返回 { from, visits, list:[{x,y,win,visits}] }；取不到返回 null（已经 flash 说清原因）。 */
async function pickCandidatesAt(at) {
  let src = null;
  try { src = await reviewCandidatesAt(at); } catch (e) { src = null; }
  if (src && src.list && src.list.length) {
    const list = src.list.slice(0, 4).map(x => {
      const pt = fromGTP(x.move);
      return pt ? { x: pt.x, y: pt.y, win: x.winrate, visits: x.visits } : null;
    }).filter(Boolean);
    if (list.length) return { from: 'review', visits: src.visits, list: list };
  }
  if (!engineReady) { needEngine('analyze', '推荐落点讲解'); return null; }
  const before = state.moves.slice(0, at);
  const res = await window.api.analyze({
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    moves: before.map(mv => [mv.color === 'b' ? 'B' : 'W', mv.pass ? 'pass' : toGTP(mv.x, mv.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
    maxVisits: reviewVisits(),
  });
  /* ⚠️ 候选点在 res.moves（主进程从 moveInfos 转出来的），**不在** res.root 里。 */
  const list = ((res && res.moves) || [])
    .filter(x => x && x.move && (x.visits || 0) >= 2)
    .sort((a, b) => b.winrate - a.winrate)
    .slice(0, 4)
    .map(x => {
      const pt = fromGTP(x.move);
      return pt ? { x: pt.x, y: pt.y, win: x.winrate, visits: x.visits } : null;
    }).filter(Boolean);
  if (!list.length) {
    flash('KataGo 没算出推荐点 —— 可能是这个局面已经结束了');
    return null;
  }
  return { from: 'engine', visits: reviewVisits(), list: list };
}

async function runPickExplain(force) {
  if (state.coach.busy.pick >= 0) { flash('正在讲，稍微等一下…'); return; }
  /* ★ 两条讲解共用**一条** LoGos 通道（每次请求会掐掉上一条），
     所以同一时刻只能有一条在跑 —— 否则后点的会静默把先点的打断（审查发现）。 */
  if (state.coach.busy.explain >= 0) { flash('「分析讲解」正在讲 —— 等它讲完再来点推荐点'); return; }
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  if (state.noGame || !state.moves.length) { flash('先落几手，再来问「该走哪」'); return; }

  const at = state.viewAt;                           // ★ 讲的是哪个局面（存下来时要标出来）
  const posKey = pickPositionKey(at);
  /* ★★ 同一个局面讲过一次 → 直接把那份快照摆出来，一个请求都不发。
     Alt 点 = 强制重讲（想换个说法时用）。 */
  const cached = force ? null : (state.coach.picks[posKey]
    || (state.coach.pick && state.coach.pick.positionKey === posKey ? state.coach.pick : null));
  if (cached) {
    state.coach.pick = cached;
    state.coach.view = 'pick';
    coachRenderedAt = -999;
    renderCoachPanels(true);
    coachScrollTop();
    flash('第 ' + cached.at + ' 手后讲过了 —— 直接看（Alt+点可重讲）');
    return;
  }
  if (needEngine('coach', '推荐落点讲解')) return;

  /* 推荐点从哪来：对局中盘上那批就是（同一批，不另算）；打谱 / 还没算到就自己取。 */
  let pts = null;
  let srcInfo = null;
  if (!state.fromRecord && state.candAt === at && state.candidates.length) {
    pts = state.candidates.slice(0, 4);              // 用户要求：不能只给一个
    srcInfo = { from: 'live', visits: state.rootVisits || 0 };
  } else {
    srcInfo = await pickCandidatesAt(at);
    if (!srcInfo) return;
    pts = srcInfo.list;
    /* ★ 打谱：把这一批点画到盘上（正是「显示 → 实时推荐落点」那批虚线圆圈）——
       否则那一页里说的「棋盘上那批圈」在打谱时根本不存在。
       对局中不动 state.candidates：实时分析马上会自己更新，别跟它抢。 */
    if (state.fromRecord) {
      state.candidates = pts.map(c => ({
        x: c.x, y: c.y, win: c.win, visits: c.visits || 0,
        label: (typeof c.win === 'number' ? (c.win * 100).toFixed(1) : ''), pv: null,
      }));
      state.candAt = at;
      setHintsVisible(true);
      draw();
    }
  }
  if (!pts || !pts.length) { flash('KataGo 还没算到这个局面 —— 等推荐点出来再点'); return; }

  setHintsVisible(true);                            // 看推荐讲解时同步显示盘上的点
  const board = boardAt(at);
  const moves = state.moves.slice(0, at);
  const side = sideToMove(at);
  const sideTxt = side === 'b' ? '黑' : '白';

  const body = $('pick-body');
  state.coach.view = 'pick';            // ★ 切到「推荐落点讲解」那一页（三个按钮共用一块正文区）
  state.coach.allView = false;          // 那一页没有逐手列表这个说法
  /* ★ busy 必须先置上再调 renderCoachPanels —— 否则它会以为「没在生成」，
     把刚写进去的正文按空状态重画一遍（然后打字机往一个已清空的节点里画）。 */
  state.coach.busy.pick = at;
  pickLiveAt = at;                       // 这一手的打字机挂上 #pick-body 了（切手数会清掉）
  body.textContent = '';
  coachRenderedAt = -999;
  renderCoachPanels(true);              // 先把这一页切出来（否则写在 hidden 的容器里，看不见）
  coachScrollTop();
  const btn = $('btn-pick');
  /* ★ 2026-10-24：原来正文第一行那句「点由 KataGo 定 · 讲解由 LoGos 写 · …」按用户要求删了。
     「这批数字是从复盘借的还是现场算的」改由上面那行状态小字（#pick-context）交代。 */
  const srcNote = (srcInfo && srcInfo.from === 'review')
    ? (' · 数字用的是复盘数据（每手 ' + srcInfo.visits + ' 次）') : '';
  const snapshot = { at, side, positionKey: pickPositionKey(at), gen: gameGen, srcNote: srcNote };
  state.coach.pickPending = snapshot;
  renderPickContext();
  btn.disabled = true;
  btn.textContent = '讲解中…';
  const collected = [];                              // 讲完的点（存起来，切手数也还在）
  try {
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i];
      const pt = toGTP(c.x, c.y);

      /* 先把这一点的标题放上去（内容随后填）—— 让人立刻看到「有几个点、都在讲」 */
      const wrap = document.createElement('div');
      const h = document.createElement('span');
      h.className = 'pnt';
      /* 标题里明写「推荐」二字 —— 和棋盘上那几个虚线圆圈是同一批点，
         但不能让人误以为已经落子了（正文里是「如果下在这里…」）。
         ★ 老复盘文件可能没存候选点胜率（瘦身那版）→ 没有就写「胜率 —」，别写出 NaN%。 */
      h.textContent = '推荐 ' + (i + 1) + ' · ' + pt
        + '（胜率 ' + (typeof c.win === 'number' ? (c.win * 100).toFixed(1) + '%' : '—') + '）';
      const p = document.createElement('div');
      wrap.appendChild(h);
      wrap.appendChild(p);
      body.appendChild(wrap);
      const typer = makeTyper(p);       // 每个点一个打字机（各写各的）

      const prompt = coachPrompt(moves, board, side, pt);
      let r = await coachAsk(prompt, 320, typer);
      if (!r) break;                                   // 被新请求取代了 → 收工
      let txt = coachTextReady(r.text, pt, side);
      /* 坐标对不上（它讲的是别的点）→ 重来一次；再不行就**照原样给** ——
         内容本身一般还是有用的，给个空白反而更糟（实测约四次里出错一次）。 */
      if (!r.error && !coordOk(trimCoachTail(cleanCoachText(r.text)), pt)) {
        const r2 = await coachAsk(prompt, 320, typer);
        if (!r2) break;
        /* ★ 复检必须用**没补前缀**的文本（2026-10-06 审查发现）：
           `coachTextReady` 会在开头补上「如果白棋下在<pt>，」，而 coordOk 抓的是
           前 18 字里第一个「字母+数字」—— 抓到的**永远是我们自己补的那个正确坐标**，
           于是这次复检恒为真（等于没检查）：第二次哪怕讲错了点，也照样被采用。
           第一次的复检用的是 cleanCoachText（没补头）所以是对的 —— 这里跟上它。 */
        const clean2 = trimCoachTail(cleanCoachText(r2.text));
        const t2 = coachTextReady(r2.text, pt, side);
        if (coordOk(clean2, pt)) txt = t2;
      }
      const finalTxt = r.error
        ? ('（讲不出来：' + r.error + '）')
        : (txt || '（这段没讲出东西，再点一次试试）');
      typer.finish(finalTxt);
      collected.push({ title: h.textContent, body: finalTxt });
    }
  } finally {
    /* ★ 只清「自己那一手」的标记：可能用户已经切到别的手、并在那里起了新的一段，
       无条件清会把新那段的标记抹掉（审查发现）。 */
    if (state.coach.busy.pick === at) state.coach.busy.pick = -1;
    if (pickLiveAt === at) pickLiveAt = -1;
    if (state.coach.pickPending === snapshot) state.coach.pickPending = null;
    resetCoachBtn('pick');
  }
  /* 几个点都讲完了才存（中途被切走/掐断就不存，免得留下半份）。
     ★ 存成**一份快照**、不按手数存 —— 用户要求：切手数时「显示刚才讲解的就行」。
     ★ 2026-10-24：同时按**局面**记进缓存（picks）—— 同一个局面再点就是直接显示，
       不再让 LoGos 重讲一遍。 */
  if (snapshot.gen === gameGen && collected.length === pts.length) {
    const snap = { ...snapshot, pts: collected };
    state.coach.pick = snap;
    state.coach.picks[snap.positionKey] = snap;
  }
  renderCoachPanels(true);
}

/* ---------- 分析讲解 ----------
   点评「当前显示的那一手」，拆成两半（见文件头的铁律）：
     · 好不好 → KataGo 的目损 / 胜率涨跌（客观，不会瞎夸）
     · 为什么 → LoGos 讲「这一手**之前**的局面，AI 当时想下哪」 */
function handVerdict(at, m) {
  /* 口径就用「这一手让**下棋方**的胜率变化了多少」——
     和手数列表里那个「涨跌」完全一致，用户看着不会打架。
     （复盘的目损虽然更准，但那是另一套数，混着用反而让人对不上。） */
  const h = state.history[at], prev = state.history[at - 1];
  if (typeof h === 'number' && typeof prev === 'number') {
    const d = (h - prev) * 100 * (m.color === 'b' ? 1 : -1);
    if (Math.abs(d) < 0.05) return { txt: '几乎不亏不赚', loss: 0 };
    return d > 0
      ? { txt: '赚了 ' + d.toFixed(1) + '% 胜率', loss: 0 }
      : { txt: '亏了 ' + Math.abs(d).toFixed(1) + '% 胜率', loss: -d };
  }
  return null;
}

/* 「讲解这手」的候选点：**先看复盘数据**（2026-10-23 用户要求）。
   ★ 为什么能直接用：`turns[at-1]` 就是「第 at 手落下之前」那个局面 —— 和现场 analyze
     问的是同一个问题，候选点/胜率都是 KataGo 对这一手的判断。
   ★ 为什么该直接用：复盘的搜索量（默认 500，老文件是当时那一档）和「全盘讲解」完全相同，
     两处给出的「AI 当时想下 D8（47.2%）」才是同一个数；现场另算一次会出现两个说法。
   ★ 借的条件（缺一不可）：
       · 环境核心一致（权重 / 贴目 / 规则 / 棋盘 / 摆子 —— 同 reviewEnvCore）；
       · 不是 `source:'live'`（对弈时边下边算的，每手 3~507 次，还要重新算）；
       · 这条线**覆盖到第 at-1 手**（`sharedPrefixLen >= at-1` → 那个局面一模一样）；
       · 该回合真有候选点。
     找不到就返回 null，调用方现场问引擎。 */
async function reviewCandidatesAt(at) {
  const idx = at - 1;
  if (idx < 0) return null;
  if (!state.recName && !(state.reviewDoc && state.reviewDoc.lines)) return null;   // 对局中且没复盘文件
  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
  };
  const coreSig = reviewEnvCore(base, analyzeModelName);
  const myList = lineGtpOf(state.moves);
  let doc = state.reviewDoc;
  if (!doc || !doc.lines) {
    const gen = gameGen;
    try { doc = await loadReviewDoc(state.recName, state.moves); } catch (e) { doc = null; }
    if (gen !== gameGen) return null;
    if (doc && doc.lines) state.reviewDoc = doc;
  }
  if (!doc || !doc.lines) return null;
  let best = null;
  for (const k of Object.keys(doc.lines)) {
    const L = doc.lines[k];
    if (!L || L.source === 'live' || !L.turns) continue;
    if (!L.env || envCoreOf(L.env) !== coreSig) continue;
    const t = L.turns[idx];
    if (!t || !Array.isArray(t.moves) || !t.moves.length) continue;
    /* 第 idx 手之前的局面必须和本线完全一样（共享前缀够长） */
    if (sharedPrefixLen(L.moves || [], myList) < idx) continue;
    const vs = (typeof L.visits === 'number' && L.visits > 0) ? L.visits : 0;
    if (!vs) continue;
    const same = vs === reviewVisits();
    /* 同一档搜索量优先；否则取搜索量大的那份（精度高），别再拿 100 次的当 500 次用 */
    if (!best || (same && !best.same) || (same === best.same && vs > best.vs)) {
      best = { turn: t, vs: vs, same: same };
    }
  }
  if (!best) return null;
  const list = (best.turn.moves || []).filter(x => x && x.move)
    .sort((a, b) => (b.winrate || 0) - (a.winrate || 0));
  if (!list.length) return null;
  return { list: list, visits: best.vs, from: 'review' };
}

async function runAnalysisExplain(force) {
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完，或点进度条旁边的「停止」'); return; }
  /* 两条讲解共用一条 LoGos 通道 → 同一时刻只允许一条（见 runPickExplain 的注释）。 */
  if (state.coach.busy.pick >= 0) { flash('「推荐落点讲解」正在讲 —— 等它讲完再来'); return; }
  if (state.coach.busy.explain >= 0) { flash('上一段讲解还在生成，稍等…'); return; }
  const at = state.viewAt;
  if (at <= 0) { flash('先用底栏的回看跳到某一手，再来讲'); return; }
  const m = state.moves[at - 1];
  const sideTxt = m.color === 'b' ? '黑' : '白';
  const pt = m.pass ? '停一手' : toGTP(m.x, m.y);

  /* ★★ 2026-10-24 用户要求：这一手讲过了 → **直接把存下来的那段摆出来**，一个请求都不发。
     原来的规矩是「再点一次 = 清掉旧的、重新生成」，那会白花几秒、还每次都换一个说法。
     想重讲就按住 Alt 点（force）。缓存判断要放在 needEngine 之前 —— 没加载 LoGos
     也该能翻看已经存下来的讲解。 */
  const cached = force ? null : state.coach.explain[at];
  if (cached) {
    state.coach.allView = false;           // 只看这一手（别停在「全盘」那一页）
    state.coach.view = 'explain';
    coachAllSig = '';
    coachRenderedAt = -999;
    renderCoachPanels(true);
    coachScrollTop();
    flash('第 ' + at + ' 手讲过了 —— 直接看（Alt+点可重讲）');
    return;
  }
  if (needEngine('coach', '分析讲解')) return;

  const body = $('explain-body');
  state.coach.view = 'explain';            // ★ 三个按钮共用一块正文区 → 切回「分析讲解」这一页
  state.coach.allView = false;             // 单讲一手 → 从「全盘」视图退出来（否则正文写进去马上被覆盖）
  coachAllSig = '';
  body.classList.remove('all-list');
  body.textContent = '';
  coachScrollTop();
  const head = document.createElement('div');
  head.className = 'pnt';
  head.textContent = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt + (state.viewAt === state.moves.length ? '' : '（回看中）');
  const verdict = document.createElement('div');
  verdict.className = 'ph';
  verdict.textContent = '看看这手怎么样…';
  const why = document.createElement('div');
  body.appendChild(head);
  body.appendChild(verdict);
  body.appendChild(why);

  const btn = $('btn-explain');
  btn.disabled = true;
  btn.textContent = '讲解中…';
  state.coach.busy.explain = at;
  /* ★ busy 置上之后再刷新一次：把「推荐落点」那一页切回「分析讲解」，
     而 busy === at 会让 renderCoachPanels 不动刚摆好的正文（打字机正往那儿画）。 */
  coachRenderedAt = -999;
  renderCoachPanels(true);
  coachScrollTop();
  let saved = null;                        // 完整生成成功才存（中途被打断就不存）
  try {
    /* ① 客观评价 —— 只有 KataGo 说了算 */
    const v = handVerdict(at, m);
    const verdictTxt = v ? v.txt : '（KataGo 还没算到这一手 —— 先让它把这一带算一遍）';
    verdict.textContent = verdictTxt;
    if (v && v.loss <= 0.05) verdict.className = 'vok';

    /* ② 候选点：**先看复盘数据**（2026-10-23 用户要求）——
       有就直接用（同一个局面、同一档搜索量，和「全盘讲解」说的是同一个数），
       没有才现场问 KataGo。省一次引擎计算，也避免两处各说一个数。 */
    const before = state.moves.slice(0, at - 1);
    let src = await reviewCandidatesAt(at);
    if (!src) {
      /* 复盘里没有这个局面 → 现场算。搜索量按**复盘默认那一档**（500），
         和复盘/全盘讲解统一（原来这里是 settings.visits 的一半 = 250，同一个位置两套精度）。 */
      if (!engineReady) {
        why.textContent = '（想听「为什么」，得先把 KataGo 加载起来 —— 它要先算一下当时的局面）';
        return;
      }
      const res = await window.api.analyze({
        initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
        moves: before.map(mv => [mv.color === 'b' ? 'B' : 'W', mv.pass ? 'pass' : toGTP(mv.x, mv.y)]),
        rules: (RULES[settings.rules] || RULES.chinese).kata,
        komi: settings.komi,
        size: N,
        maxVisits: reviewVisits(),
      });
      /* ⚠️ 候选点在 res.moves（主进程从引擎的 moveInfos 转出来的），
         **不在** res.root 里 —— res.root 只是 rootInfo（winrate/scoreLead/visits）。 */
      const list = ((res && res.moves) || [])
        .filter(x => x && x.move && (x.visits || 0) >= 2)
        .sort((a, b) => b.winrate - a.winrate);
      src = { list: list, visits: reviewVisits(), from: 'engine' };
    }
    const list = src.list || [];
    const best = list[0];

    if (!best) {
      why.textContent = '（KataGo 没算出候选点，可能是这个局面已经结束了）';
      return;
    }
    const same = (best.move || '').toUpperCase() === pt.toUpperCase();
    const lead = document.createElement('div');
    lead.className = 'ph';
    /* 「当时」两个字不能省 —— 这个胜率是**这一手之前**那个局面的，
       跟上面胜率条（当前局面）不是一个数，不写清楚会让人对不上。
       ★ 2026-10-08 改：下错了的时候**要把"你实际下了哪"也写出来** ——
         原来只写「AI 当时更倾向 D8」，用户会以为下面那段讲的是 D8（而它确实讲错了，见下方注释）。
         现在先交代 AI 想下哪、再交代实际下在哪，下面那段讲的**永远是实际这一手**。
       ★ 2026-10-23：老复盘文件没存候选点胜率（瘦身那版丢了）→ 没有就不写百分比，别写出 NaN。 */
    const wrTxt = (typeof best.winrate === 'number')
      ? ('，' + sideTxt + '棋当时胜率 ' + (best.winrate * 100).toFixed(1) + '%')
      : '';
    const srcTxt = src.from === 'review'
      ? ('（数字用的是复盘数据 · 每手 ' + src.visits + ' 次搜索）')
      : ('（现场算的 · 每手 ' + src.visits + ' 次搜索）');
    const leadTxt = same
      ? ('AI 当时想下的也是这里（' + best.move + wrTxt + '）。下面讲这一手：' + srcTxt)
      : ('AI 当时想下的是 ' + best.move + wrTxt + '；实际下的是 ' + pt
        + '。下面讲实际这一手：' + srcTxt);
    lead.textContent = leadTxt;
    body.insertBefore(lead, why);

    const typer = makeTyper(why);
    /* ★★ 讲的是**实际下的那一手（pt）**，不是 AI 推荐的那一手 —— 2026-10-08 修 bug。
       原来这里无论哪种情况都传 `best.move`（AI 想下的点），于是「分析讲解」实际输出的是
       「如果下在 AI 推荐点会怎样」，而用户问的是「我这一手怎么样」。
       用户实测撞到：自己第 83 手亏 0.1%，讲解却整段在讲 AI 想下的 D8 —— 风马牛不相及。
       现在两种情况都讲**实际这一手**：
         · 下对了（same）→ 讲解就是这一手（与 AI 首选重合，等于讲首选）
         · 下错了        → 讲这一手的后果，AI 倾向的那个点在前面作一句对照
       prompt 也改了（coachPrompt 的 onset 参数）：**必须先交代这一手的直接后果**，
       而不是只讲"该下哪"。开头也从「如果下在 X，」改成「这一手 X 下出来，」。 */
    const onset = same
      ? ('，和 AI 的首选是同一个点')
      : ('，不过 AI 当时更倾向 ' + best.move + '（' + sideTxt + '棋当时胜率 '
        + (best.winrate * 100).toFixed(1) + '%）');
    /* 讲解正文的开头 —— 用「这一手 X 下出来，」而不是「如果下在 X，」，
       因为这里讲的是**既成事实**（用户问"我这手怎么样"），不是假设。 */
    const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，';
    const ask = () => coachAsk(coachPrompt(before, boardAt(at - 1), m.color, pt, onset), 320, typer);
    let r = await ask();
    if (!r) return;
    /* ★ 被取消时 main.js 会把**已收到的半截文本**带 `aborted: true` 回来
       （unload 引擎、或这条请求被后一条取代时会走到）。这时：不重试、不入库 ——
       半截文本有可能「够长 + 前 60 字有句号」而被当成完整讲解存进
       `.coach.json`，之后永不重讲（2026-10-06 审查发现：aborted 这个标记一直没人看）。 */
    if (r.aborted) { typer.finish('（已取消）'); return; }
    let txt = coachTextReady(r.text, pt, m.color, explainHead);
    /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
    if (!r.error && !coachUsable(txt)) {
      const r2 = await ask();
      if (r2 && !r2.error) {
        const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
        if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
      }
    }
    const finalTxt = r.error ? ('（讲不出来：' + r.error + '）')
      : (txt || '（这段没讲出东西，再点一次试试）');
    typer.finish(finalTxt);
    if (!r.error && txt) {
      saved = {
        head: head.textContent, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
        lead: leadTxt, body: finalTxt,
      };
    }
  } finally {
    /* 同上：只清自己那一手（用户可能已切手数并在那儿起了新的一段）。 */
    if (state.coach.busy.explain === at) state.coach.busy.explain = -1;
    resetCoachBtn('explain');
  }
  /* ★ 存到「第 at 手」名下 —— 切到别手再切回来还能看到（用户报的问题②）。
     分析讲解**按手数存**（它点评的就是第 at 手本身），和选点讲解的存法不一样。 */
  if (saved) {
    state.coach.explain[at] = saved;
    renderCoachPanels(true);
    /* ★ 2026-10-23：单条讲完也落盘。原来只有「全盘讲解」才写 .coach.json ——
       用户单独讲了几手，关掉软件就没了，下次还得让 LoGos 再讲一遍（用户报障）。 */
    saveCoachFile();
  }
}

/* ==================== 全盘讲解（2026-10-05 用户要求）====================
   打开棋谱后，一次把整盘逐手讲完，结果**存进这份棋谱旁边**
   （<棋谱名>.coach.json，见 main.js 的 coachPath）——
   下次打开这份棋谱直接就能看，不用重跑。

   分两段（进度条上会看出在哪一段）：
     ① KataGo 把整盘逐手算一遍 —— 借「复盘」那条通路，**而且优先复用复盘数据**：
        这份棋谱复盘过就直接用（一个请求都不发），只缺一部分就只补那几个回合。
        ★ 为什么非要它：LoGos 讲的是「AI 当时想下哪、为什么」，
          那个点必须由 KataGo 定 —— 让 LoGos 自己选点，实测会把角上一路
          （T19 / A1）说成好棋，那是硬错。
     ② LoGos 逐手讲 —— 每手一次请求，约 2~4 秒。

   ★ 已经讲过的手**跳过**：所以点「停止」之后再来一次，是接着往下讲，不从头。
   ★ 跑完自动切到「全盘」视图（标题旁「看全盘」）—— 整盘每一手的讲解连成一页。
   ★ 不用打字机：那是给「盯着它一个字一个字写」用的；这里要跑几分钟，
     用户早切到别的手去看别的了。 */
let batchStop = false;

/* 进度条：on=false 收起；否则按 done/total 画，txt 不传就显「3 / 20」 */
function setBatchBar(on, done, total, txt) {
  const bar = $('batch-bar');
  if (!bar) return;
  bar.hidden = !on;
  if (!on) return;
  $('batch-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('batch-txt').textContent = txt || (done + ' / ' + total);
}

/* ---------- 讲解按线存（2026-10-23 用户报障：有分支的棋谱） ----------
   原来 `explain` 只认手号：切到另一条分支，第 30 手拿到的还是上一条线第 30 手的文字，
   而且「全盘讲解」的 `todo` 一看 `explain[at]` 有值就当"已讲过"跳过 —— 分支等于讲不了。
   现在：
     · 线指纹和复盘共用 `lineKeyOfList(lineGtpOf(moves))`（手顺哈希 + 手数）；
     · 内存 `state.coach.lines[<key>] = { n, list }`，磁盘 `.coach.json` 的 `lines` 同形；
     · `state.coach.explain` 是**当前这条线**那个 list 的引用（不是副本）——
       所有老代码照旧写 `explain[at]`，落盘时自动归到这条线。 */
function coachLineKey() { return lineKeyOfList(lineGtpOf(state.moves)); }

function coachLineOf(key, n) {
  const k = key || coachLineKey();
  let rec = state.coach.lines[k];
  if (!rec) {
    rec = { n: (typeof n === 'number' ? n : state.moves.length), list: {} };
    state.coach.lines[k] = rec;
  }
  return rec;
}

/* 把 explain 的值序列化成「按手数排好的数组」（下标 = 手数，0 位空着） */
function coachLineList(rec) {
  const n = Math.max(0, rec && typeof rec.n === 'number' ? rec.n : 0);
  const list = [];
  for (let i = 0; i <= n; i++) list.push((rec && rec.list && rec.list[i]) || null);
  return list;
}

/* 这条线之外，还有几条线是有讲解的（用来在界面上说清楚「讲解存在别的分支上」） */
function coachOtherLines(key) {
  const k = key || coachLineKey();
  return Object.keys(state.coach.lines).filter(x => x !== k
    && Object.keys((state.coach.lines[x] || {}).list || {}).length);
}

/* 换线**之前**调：把正要离开的那条线的手数记准（分支长短不一样） */
function leaveCoachLine(key, n) {
  if (!key) return;
  const rec = state.coach.lines[key];
  if (rec && typeof n === 'number') rec.n = n;
}

/* 换线**之后**调：把 explain 重新指到新那条线上，并顺手作废渲染缓存 */
function enterCoachLine() {
  const k = coachLineKey();
  const rec = coachLineOf(k, state.moves.length);
  rec.n = state.moves.length;
  state.coach.explain = rec.list;
  state.coach.curKey = k;
  coachAllSig = '';
  coachRenderedAt = -999;
  const mine = Object.keys(rec.list).length;
  if (!mine) state.coach.allView = false;      // 这条线没讲解 → 退回「按手数看」的框
  return { mine: mine, others: coachOtherLines(k).length };
}

/* 把内存里的逐手讲解落盘（<棋谱名>.coach.json）。
   v2 = 按线存：{ v:2, n, lineKey, list, lines:{ <线指纹>: { n, list } } }
   ★ list 仍然写当前这条线（老版本只认 list，读回来至少不会全丢）；lines 才是全量。
   ★ v2 之前写过带 summary 字段的 v2（整盘总评，已删）—— 读的时候忽略即可。 */
function saveCoachFile() {
  if (!state.recName) return Promise.resolve(null);
  const curKey = coachLineKey();
  const cur = coachLineOf(curKey, state.moves.length);
  /* explain 可能是被整体换过的（读盘 / 清空），确保它和这条线的记录是**同一个对象** */
  if (cur.list !== state.coach.explain) cur.list = state.coach.explain;
  cur.n = state.moves.length;
  const lines = {};
  for (const k of Object.keys(state.coach.lines)) {
    const rec = state.coach.lines[k];
    const list = coachLineList(rec);
    if (list.some(x => x && x.body)) lines[k] = { n: rec.n, list: list };   // 空线不写
  }
  const list = coachLineList(cur);
  const json = JSON.stringify({
    v: 2, n: state.moves.length, lineKey: curKey, list: list, lines: lines,
  });
  try {
    return Promise.resolve(window.api.records.saveCoach(state.recName, json)).catch(() => null);
  } catch (e) { return Promise.resolve(null); }
}

/* 打开棋谱时把存下来的讲解读回来（用户要求：结果跟棋谱一起保存，下次打开还在）
   ★ v2 按线读：当前这条线有就摊开；没有但**别的分支**有 → 明说（不是文件丢了）；
     同一份棋谱里切分支时由 applyVariationLine → enterCoachLine 直接换，不用重读文件。 */
async function loadCoachForRecord(name) {
  if (!name) return;
  const gen = gameGen;
  /* ★ 读盘前记下"文件对应哪条线"：await 期间用户可能切了分支（v1 的 list 属于主分支） */
  const startKey = coachLineKey();
  let r = null;
  try { r = await window.api.records.readCoach(name); } catch (e) { return; }
  if (!r || !r.text || gen !== gameGen) return;      // 读盘期间换了棋谱 → 丢掉
  let data = null;
  try { data = JSON.parse(r.text); } catch (e) { return; }
  const toBox = list => {
    const box = {};
    const arr = Array.isArray(list) ? list : [];
    for (let at = 1; at < arr.length; at++) {
      const it = arr[at];
      if (it && it.body) box[at] = it;
    }
    return box;
  };
  const lines = {};
  let v1Elsewhere = false;
  if (data && data.lines && typeof data.lines === 'object') {
    for (const k of Object.keys(data.lines)) {
      const rec = data.lines[k] || {};
      const box = toBox(rec.list);
      if (Object.keys(box).length) {
        lines[k] = { n: (typeof rec.n === 'number' ? rec.n : state.moves.length), list: box };
      }
    }
  } else {
    /* v1（没有分支支持时写的）：整份只有一个 list → 归给读盘时那条线 */
    const box = toBox(data && data.list);
    if (Object.keys(box).length) {
      lines[startKey] = {
        n: (data && typeof data.n === 'number') ? data.n : state.moves.length, list: box,
      };
      /* 读盘期间用户切走了分支 → 这份老文件属于**主分支**，别当成"文件是空的" */
      if (coachLineKey() !== startKey) v1Elsewhere = true;
    }
  }
  /* ★ 读盘是异步的：这期间用户可能已经切了分支、甚至讲了一手（写进 state.coach.lines）。
     那些**新写的**不能被文件内容盖掉 → 合并（文件打底，内存里非空的覆盖它）。 */
  for (const k of Object.keys(state.coach.lines)) {
    const cur = state.coach.lines[k];
    if (cur && Object.keys(cur.list || {}).length) lines[k] = cur;
  }
  state.coach.lines = lines;
  const nowKey = coachLineKey();
  const mine = lines[nowKey];
  state.coach.explain = mine ? mine.list : {};
  state.coach.curKey = nowKey;
  const howMany = Object.keys(state.coach.explain).length;
  const others = coachOtherLines(nowKey).length;
  coachRenderedAt = -999;
  coachAllSig = '';
  /* ★ 2026-10-23 用户报障：棋谱库里明明标着「带讲解」，打开却什么都看不到、还得让 LoGos 重讲。
     两个原因都在这：
     ① 文件存在但这条线一条正文都没有（讲到一半被打断 / 讲解存在别的分支上）→ 原来静默 return，
        用户只能看见空的框；现在明说，并告诉他点哪儿能重讲；
     ② 读回来了却只显示**当前那一手**（右边那个框永远只跟手数走）→ 用户以为「不是全盘讲解」。
        所以打开就直接摊成「全盘」那一页 —— 你要的就是打开就能读到结果。 */
  if (!howMany) {
    state.coach.allView = false;
    state.coach.view = 'explain';
    if (v1Elsewhere) {
      flash('讲解存在主线上（你现在在别的分支）—— Alt+←/→ 切回主线就能看');
    } else if (others) {
      flash('讲解在别的分支上（这条线没讲）—— Alt+←/→ 切到带「变」的分支');
    } else {
      flash('讲解文件是空的（上次没讲完）—— 点「全盘讲解」重讲');
    }
    renderCoachPanels(true);
    return;
  }
  state.coach.allView = true;          // ★ 打开就摊开：直接看到整盘，不用再点「看全盘」
  state.coach.view = 'explain';        // 那一页就是「分析讲解」页的全盘形态
  renderCoachPanels(true);
  flash('带逐手讲解（' + howMany + ' 手' + (others ? ' · 另有 ' + others + ' 条也讲过' : '')
    + '）—— 已摊成「全盘」，点一行跳过去');
}

/* ---------- 整盘的逐回合数据（「全盘讲解」用）----------
   ★★ 和「AI 复盘」本来就是**同一件事**：同 review 接口、同 reviewVisits()、同 analyzeTurns，
     连复盘的 `turns` 都正是「第 t 手落下之前那个局面」的 root + 候选点。所以规矩是：
       ① 当前这条线已经复盘过（环境签名一致）→ 一个请求都不发，直接用；
       ② 只覆盖一部分（别的分支的共享前缀 / 复盘后又下了几手）→ 只补算缺的那几个回合；
       ③ 一手都没有 → 照旧整盘算一遍。
     ★ 「下棋时边下边算」那份 live 数据**不当数据源**：每手搜索量 3~507 参差，
       胜率/目损前后不可比（reviewLineJob 里同一条规矩）。
   ★ 2026-10-23 从 runBatchCoach 里抽成独立函数（原本是一段内联代码）。
   返回 { ok, turns, reused, computed, incomplete }：
     turns[i] = 第 i 手落下之前那个局面（i = 0..n），没算到的回合是 null。
   进度画在「全盘讲解」那条进度条上；调用方负责 coach.batch / 按钮状态。 */
async function coachTurnsForLine(gen) {
  const n = state.moves.length;
  const base = {
    initialStones: state.setup.map(s => [s.color === 'b' ? 'B' : 'W', toGTP(s.x, s.y)]),
    rules: (RULES[settings.rules] || RULES.chinese).kata,
    komi: settings.komi,
    size: N,
    maxVisits: reviewVisits(),
  };
  const coreSig = reviewEnvCore(base, analyzeModelName);
  const myList = lineGtpOf(state.moves);
  let doc = state.reviewDoc;
  if (!doc || !doc.lines) {                 // 打开棋谱时是异步读的，可能还没到
    try { doc = await loadReviewDoc(state.recName, state.moves); } catch (e) { doc = null; }
    if (doc && doc.lines) state.reviewDoc = doc;   // 装进仓库：报告按钮/目损也能用上
  }
  if (gen !== gameGen) return { ok: false };

  /* ---------- ① 挑一档搜索量：和当前设置一致的报告优先，否则用覆盖最长的那份 ----------
     ★★ 2026-10-23 用户报障的根因就在这一步（原来根本没这一步，只有「env 必须完全相等」）：
     老复盘文件是每手 100 次，现在的默认是 500 次 → env 不等 → 整盘一个回合都借不到 → 白算一遍。
     现在：环境（权重/贴目/规则/棋盘/摆子）一致就允许借，**整盘统一用那份复盘的搜索量**
     （否则 100 次和 500 次的数据混在一盘里，目损互相不可比）。 */
  let useVisits = base.maxVisits;
  let borrowedVisits = 0;
  if (doc && doc.lines) {
    let best = null;
    for (const k of Object.keys(doc.lines)) {
      const L2 = doc.lines[k];
      if (!L2 || L2.source === 'live' || !L2.turns) continue;   // live：搜索量参差，不当数据源
      if (!L2.env || envCoreOf(L2.env) !== coreSig) continue;   // 换了权重/规则/棋盘 → 真的不能借
      const cov = sharedPrefixLen(L2.moves || [], myList);
      if (cov < 1) continue;
      const vs = (typeof L2.visits === 'number' && L2.visits > 0) ? L2.visits : 0;
      if (!vs) continue;
      const same = vs === base.maxVisits;
      const better = !best
        || (same && !best.same)
        || (same === best.same && (cov > best.cov
             || (cov === best.cov && vs > best.vs)));
      if (better) best = { vs, cov, same };
    }
    if (best) {
      useVisits = best.vs;
      if (best.vs !== base.maxVisits) borrowedVisits = best.vs;
    }
  }
  base.maxVisits = useVisits;               // ★ 补算也按这一档，整盘精度统一
  const envSig = reviewEnvSig(base, analyzeModelName);

  const have = {};
  let reused = 0;
  const seed = line => {
    if (!line || !line.turns) return;
    if (line.source === 'live') return;                 // 搜索量不统一 → 不复用
    if (line.env && line.env !== envSig) return;        // envSig 已经统一到 useVisits 那一档
    const L = sharedPrefixLen(line.moves || [], myList);
    for (let tt = 0; tt <= L; tt++) {
      const v = line.turns[tt];
      if (!v || have[tt]) continue;
      const c = Object.assign({}, v);
      /* 共享前缀的最后一回合，后面那一手正是分叉的那一手 ——
         必须换成**这条线自己的**手，否则「与 AI 首选一致」会串线。 */
      if (tt === L && L < myList.length) c.actualMove = myList[tt] ? myList[tt].slice(1) : null;
      have[tt] = c;
      reused++;
    }
  };
  for (const k of Object.keys((doc && doc.lines) || {})) seed(doc.lines[k]);
  const missing = [];
  for (let tt = 0; tt <= n; tt++) if (!have[tt]) missing.push(tt);

  let computed = false, incomplete = false;
  if (missing.length) {
    if (needEngine('analyze', '整盘讲解')) return { ok: false };
    reviewBusy = true;                    // 占着引擎：别让自动分析来抢
    setBatchBar(true, 0, n, !reused
      ? '正在让 KataGo 把整盘算一遍…'
      : ('已经有 ' + reused + ' 个回合的复盘数据（每手 ' + useVisits + ' 次），只补算剩下的 '
        + missing.length + ' 个…'));
    const req = Object.assign({}, base, {
      moves: myList.map(g => [g[0] === 'W' ? 'W' : 'B', String(g).slice(1)]),
      analyzeTurns: missing,
    });
    let res = null;
    try { res = await window.api.review(req); } catch (e) { res = { error: String(e) }; }
    reviewBusy = false;
    if (gen !== gameGen) return { ok: false };
    computed = true;
    /* ★ 整盘**超时**时 main.js 会带 `incomplete: true` 交回「已经算到的那些回合」，
       这种情况只能用算到的部分，而且要如实说明。 */
    incomplete = !!(res && res.incomplete);
    /* ★ 两种回包形状都收（同 reviewLineJob）：`{turns:[…]}` 是逐回合收集模式，
       单个 payload 是只有一个回合时主进程回的形状 —— 只认前一种会静默漏手。 */
    const back = (res && res.turns) ? res.turns
      : ((res && typeof res.turn === 'number') ? [res] : []);
    for (const it of back) if (it && typeof it.turn === 'number') have[it.turn] = it;
    if (!Object.keys(have).length) {
      return { ok: false, flash: '整盘分析失败：' + ((res && res.error) || '引擎没给出结果') };
    }
    if (res && res.error) {
      flash('引擎报错（' + res.error + '）—— 先用已经拿到的那部分');
    }
  }

  const turns = Array.from({ length: n + 1 }, (_, i) => have[i] || null);
  const haveN = turns.filter(Boolean).length;
  if (haveN < 2) {
    return { ok: false, flash: '整盘分析失败：' + (haveN ? '只拿到 ' + haveN + ' 个回合' : '引擎没给出结果') };
  }
  /* 顺手把胜率走势填满（引擎给的是「轮到谁走」视角，seriesFromTurns 已换算成黑方视角）——
     这样手数列表的「涨跌」和走势图也一起活了，讲的胜率能跟它们对上。 */
  const series = seriesFromTurns(turns);
  state.history = series.history;
  state.leads = series.leads;
  /* ★ 精度标记按**实际那一回合的 visits** 填（借来的 100 次不能标成 500 次 —— 界面会撒谎） */
  state.histVisits = turns.map(t => (t && t.root && typeof t.root.visits === 'number')
    ? t.root.visits : useVisits);
  /* ★★ 2026-10-23：算出来的东西别扔 —— 这条线还没有正式复盘（或只有边下边算的 live 数据）时，
     把这次整盘算的落成一份正式复盘。下次点「全盘讲解」「复盘报告」都不用再算第二遍。 */
  let saved = false;
  if (computed && !incomplete && haveN === n + 1) {
    saved = await saveReviewFromTurns(state.recName, myList, n, envSig, useVisits, turns, doc);
  }
  renderMoveList();
  renderCurve();
  return { ok: true, turns, reused, computed, incomplete,
           visits: useVisits, borrowed: borrowedVisits, saved };
}

/* 把「全盘讲解」阶段①算出来的整盘存成正式复盘（v3 文档里这条线一项）。
   ★ 只在**这条线还没有正式复盘**时写（老的是 source==='review' 且有 turns 就跳过）——
     绝不覆盖用户自己算过的那份。live 那类（边下边算攒的、没有 turns）会被换成这份更准的。
   返回是否写了文件。 */
async function saveReviewFromTurns(name, myList, n, envSig, visits, turns, doc) {
  if (!name || !Array.isArray(turns) || turns.length !== n + 1) return false;
  const myKey = lineKeyOfList(myList);
  const d = (doc && doc.lines) ? doc : emptyReviewDoc(name);
  const old = d.lines[myKey];
  if (old && old.source === 'review' && old.turns) return false;
  try {
    const rep = buildReview(n, turns);
    rep.name = String(name).replace(/\.sgf$/i, '');
    rep.file = name;
    rep.visits = visits;
    const series = seriesFromTurns(turns);
    rep.history = series.history.slice();
    rep.leads = series.leads.slice();
    rep.partial = null;
    rep.lineKey = myKey;
    rep.lineN = n;
    const map = {};
    for (let i = 0; i < turns.length; i++) if (turns[i]) map[i] = turns[i];
    d.lines[myKey] = {
      key: myKey, moves: myList, n, env: envSig, sig: envSig + '|' + myKey,
      visits, source: 'review',
      report: rep, history: series.history.slice(), leads: series.leads.slice(),
      turns: slimTurns(map),
    };
    d.name = d.name || String(name).replace(/\.sgf$/i, '');
    d.updated = Date.now();
    await window.api.records.saveReview(name, JSON.stringify(d));
    state.reviewDoc = d;                  // 装回仓库：「复盘报告」按钮 / 目损立刻能用
    if (typeof refreshRecords === 'function') refreshRecords();
    return true;
  } catch (e) { return false; }
}

async function runBatchCoach() {
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 想停就点进度条右边的「停止」'); return; }
  /* ★ 反过来也要挡（2026-10-06 审查发现）：单条讲解（分析讲解 / 选点讲解）正在跑时，
     直接点「全盘讲解」会把在跑的那条**静默掐掉** —— 两条共用 coachSeq 通道，
     原来只有「批量挡单条」这一半（批量期间按钮被 disabled），反向漏了。 */
  if (state.coach.busy.explain >= 0 || state.coach.busy.pick >= 0) {
    flash('正在讲别的 —— 等它讲完再点全盘讲解');
    return;
  }
  if (!state.fromRecord || !state.recName) { flash('先打开一份棋谱，再来做全盘讲解'); return; }
  /* ★ KataGo 的检查**挪到阶段①里**去了（2026-10-22）：这一盘要是已经复盘过，
     阶段①一个请求都不发、根本用不到 analyze 引擎 —— 这时还拦着说「先加载 KataGo」
     没有道理（用户实测：明明有复盘报告，还让他等引擎、还重算了一遍）。
     ★ LoGos 的检查也挪到「确实还有手要讲」之后（2026-10-24）：
       整盘都讲过了就只是把结果摊开给你看，不需要 LoGos。 */
  const n = state.moves.length;
  if (!n) { flash('这份棋谱里没有手顺，讲不了'); return; }

  const gen = gameGen;
  /* ★★ 2026-10-23：讲解按线存 —— 整场只往**开始时这条线**写。
     中途切分支就停（见循环里的 coachLineKey 判定），否则两条线的手会混进同一份记录。 */
  const runKey = coachLineKey();
  const runRec = coachLineOf(runKey, n);
  if (runRec.list !== state.coach.explain) runRec.list = state.coach.explain;
  const box = state.coach.explain;

  /* ★★ 2026-10-24 用户要求：**讲过的直接显示**。
     整盘每一手都已经有讲解（单条讲过 / 上次全盘讲过 / 打开棋谱时读回来的）——
     那就连 KataGo 都不用碰，直接把「全盘」那一页摊开。 */
  let allDone = true;
  for (let at = 1; at <= n; at++) if (!box[at]) { allDone = false; break; }
  if (allDone) {
    state.coach.view = 'explain';
    state.coach.allView = true;
    coachRenderedAt = -999;
    renderCoachPanels(true);
    coachScrollTop();
    flash('这条分支已经全讲过（' + n + ' 手）—— 已摊成全盘，没让 LoGos 重讲');
    return;
  }
  if (needEngine('coach', '全盘讲解')) return;

  state.coach.batch = { done: 0, total: n };
  batchStop = false;
  state.coach.view = 'explain';         // 三个按钮共用一块正文区 → 进度写在这一页
  state.coach.allView = false;          // 跑的时候逐手看进度，跑完再摊成全盘
  $('btn-batch').disabled = true;
  $('btn-explain').disabled = true;      // 批量期间不许插队（会和批量抢 coachSeq）
  $('btn-pick').disabled = true;
  setBatchBar(true, 0, n, '正在核对复盘数据…');
  try {
    /* ---------- ① KataGo：整盘逐手 —— **能复用复盘就复用**（细节见 coachTurnsForLine） ---------- */
    const got = await coachTurnsForLine(gen);
    if (!got.ok) { if (got.flash) flash(got.flash); return; }
    if (gen !== gameGen) return;         // 期间换了棋谱 → 整体作废（finally 会收拾界面）
    const turns = got.turns;
    if (got.incomplete) {
      flash('KataGo 整盘没算完（超时）—— 只讲算到的部分，再点一次接着讲');
    } else if (!got.computed) {
      /* 一个请求都没发：这一盘已经复盘过（搜索量可能和当前设置不同，见 coachTurnsForLine ①） */
      flash('这盘复盘过（每手 ' + got.visits + ' 次）—— 直接用复盘数据讲，没重算');
    } else if (got.reused) {
      flash('借了已有 ' + got.reused + ' 个回合的复盘数据（每手 ' + got.visits
        + ' 次），只补算剩下几个');
    } else {
      flash('没有可用的复盘数据 —— KataGo 整盘算了一遍'
        + (got.saved ? '，顺手存成了复盘' : ''));
    }

    /* ---------- ② LoGos：逐手讲（讲过的跳过，所以能接着上次继续） ---------- */
    const todo = [];
    for (let at = 1; at <= n; at++) if (!box[at] && turns[at - 1]) todo.push(at);
    if (!todo.length) {
      /* 全讲过了 → 直接把整盘摊开给他看（原来只 flash 一句「已经全部讲过」，
         用户看不到东西，以为没讲）。★ 2026-10-24：这就是「讲过的直接显示」——
         一个 LoGos 请求都不发，只把页切过去。 */
      state.coach.view = 'explain';
      state.coach.allView = true;
      coachRenderedAt = -999;
      renderCoachPanels(true);
      flash('这条分支已经全讲过（' + n + ' 手）—— 已摊成全盘');
      return;
    }

    let k = 0;
    let lineChanged = false;
    for (let i = 0; i < todo.length; i++) {
      if (batchStop || gen !== gameGen) break;
      /* ★ 换到别的分支了：立刻收工。不能接着讲 —— 现在的 moves 已经是另一条线的手顺，
         `turns` 却是原来那条线的，混着写会把两条分支的讲解搅在一起。 */
      if (coachLineKey() !== runKey) { lineChanged = true; break; }
      const at = todo[i];
      const m = state.moves[at - 1];
      const pt = m.pass ? '停一手' : toGTP(m.x, m.y);
      const sideTxt = m.color === 'b' ? '黑' : '白';
      const headTxt = '第 ' + at + ' 手 · ' + sideTxt + ' ' + pt;

      const info = turns[at - 1] || {};
      const list = (info.moves || []).filter(x => x && x.move)
        .sort((a, b) => b.winrate - a.winrate);
      const best = list[0];
      const v = handVerdict(at, m);
      const verdictTxt = v ? v.txt : '（KataGo 没算出这一手的数据）';
      let leadTxt = '', body = '';
      if (!best) {
        leadTxt = '（这一手之前的局面没算出候选点）';
      } else {
        /* 「当时」两个字不能省 —— 这是**这一手之前**那个局面的胜率。
           ★ 2026-10-08 与「分析讲解」同步修：这里原来也把 `best.move`（AI 想下的点）
             传给了 LoGos，于是整盘讲解讲的都是"AI 该下哪"，而不是**实际下的这一手**会怎样。
           ★ 2026-10-22：复用老的复盘文件时可能没有候选点胜率（旧版瘦身没存）——
             那就不报数字，别写出 NaN%。 */
        const same = String(best.move).toUpperCase() === pt.toUpperCase();
        const wrTxt = (typeof best.winrate === 'number')
          ? ('，' + sideTxt + '棋当时胜率 ' + (best.winrate * 100).toFixed(1) + '%') : '';
        leadTxt = same
          ? ('AI 当时想下的也是这里（' + best.move + wrTxt + '）。下面讲这一手：')
          : ('AI 当时想下的是 ' + best.move + wrTxt + '；实际下的是 ' + pt + '。下面讲实际这一手：');
        const before = state.moves.slice(0, at - 1);
        const onset = same
          ? '，和 AI 的首选是同一个点'
          : ('，不过 AI 当时更倾向 ' + best.move + (wrTxt ? ('（' + sideTxt + '棋当时胜率 '
            + (best.winrate * 100).toFixed(1) + '%）') : ''));
        const explainHead = '这一手 ' + pt + '（' + sideTxt + '棋第 ' + at + ' 手）下出来，';
        const ask = () => coachAsk(coachPrompt(before, boardAt(at - 1), m.color, pt, onset), 320);
        let r = await ask();
        if (!r) break;                          // 被别的请求取代 → 收工
        /* ★ 用户点了「停止」（或换棋谱）→ main.js 把半截文本带 `aborted: true` 回来。
           这时**这一手不要**：既不该重试（停了还在讲、还要再等几秒），
           也不该入库 —— 半截文本可能「够长 + 有句号」而被当完整讲解存进 .coach.json，
           之后永不重讲。收工前把 batchStop 置上，下面那句提示也会说「已停」。
           （2026-10-06 审查发现：aborted 这个标记一直没人看。） */
        if (r.aborted) { batchStop = true; break; }
        let txt = coachTextReady(r.text, pt, m.color, explainHead);
        /* 太短 / 第一句没说完 → 重来一次；两次里挑能用的（都好就取长的）。 */
        if (!r.error && !coachUsable(txt)) {
          const r2 = await ask();
          if (r2 && !r2.error) {
            const t2 = coachTextReady(r2.text, pt, m.color, explainHead);
            if (coachUsable(t2) || t2.length > txt.length) { txt = t2; r = r2; }
          }
        }
        body = r.error ? ('（讲不出来：' + r.error + '）') : txt;
      }
      if (body) {
        box[at] = {
          head: headTxt, verdict: verdictTxt, ok: !!(v && v.loss <= 0.05),
          lead: leadTxt, body: body,
        };
      }
      k++;
      setBatchBar(true, k, todo.length, '讲第 ' + at + ' 手 · ' + k + '/' + todo.length);
      /* 讲的正好是眼下这一手 → 顺手把它显示出来（不然用户得等整盘跑完才看得到） */
      if (at === state.viewAt) { coachRenderedAt = -999; renderCoachPanels(true); }
      if (k % 8 === 0) saveCoachFile();     // 每 8 手落一次盘：中途关软件不至于全丢
    }
    /* ★ 只有还停在原来那份棋谱上才写盘 —— 否则会把「刚才切过去的那份棋谱」的
       讲解覆盖成空（那些讲解属于**原来那份**，键存在 box 里）。 */
    if (gen !== gameGen) {
      flash('换棋谱了 —— 全盘讲解已停（这次讲完的 ' + k + ' 手没存）');
    } else if (lineChanged) {
      /* 中途换了分支：已经讲的那几手**存回原来那条线**（box 是它的引用），
         但不摊开 —— 眼前这条分支还没讲，摊开会是一页空的。 */
      await saveCoachFile();
      state.coach.allView = false;
      coachRenderedAt = -999;
      renderCoachPanels(true);
      flash('切分支了 · 全盘讲解已停：刚讲的 ' + k + ' 手存回原线，回去再点接着讲');
    } else {
      await saveCoachFile();
      /* ★ 跑完就摊成全盘（2026-10-22 用户报障：等了几分钟，右边只显示当前那一手，
         看着像「只分析了当前手」）—— 一页读完才知道整盘都讲了。 */
      state.coach.allView = true;
      coachRenderedAt = -999;
      renderCoachPanels(true);
      flash(batchStop
        ? ('已停下 —— 讲完 ' + k + ' 手；再点「全盘讲解」接着往下讲')
        : ('全盘讲解完成：讲了 ' + k + ' 手（整盘共 ' + n + ' 手）—— 已摊成全盘'));
    }
  } finally {
    reviewBusy = false;
    state.coach.batch = null;
    $('btn-batch').disabled = false;
    $('btn-explain').disabled = false;
    $('btn-pick').disabled = false;
    setBatchBar(false);
    coachRenderedAt = -999;
    renderCoachPanels(true);
  }
}

/* KataGo 在算整盘时，把进度画到我们自己的进度条上（阶段①）。
   ★ 上面那条全局订阅会调 showReviewProgress（弹复盘窗）—— 批量分析不该弹它，
     所以那边加了 `!state.coach.batch` 的条件。 */
window.api.onReviewProgress(d => {
  if (state.coach.batch && d) {
    setBatchBar(true, d.done, d.total, 'KataGo 算整盘 ' + d.done + '/' + d.total);
  }
});

/* ---------- 绑定 ----------
   ★ 2026-10-24：按住 Alt 点 = 强制重讲（平时点已经讲过的那一手/局面，
     只把存下来的内容摆出来，不再问 LoGos）。 */
$('btn-explain').onclick = e => runAnalysisExplain(!!(e && e.altKey));
$('btn-pick').onclick = e => runPickExplain(!!(e && e.altKey));
/* 全盘讲解：只在**打开棋谱**时出现（clearCoachPanels 管显隐） */
$('btn-batch').onclick = () => runBatchCoach();
$('batch-stop').onclick = () => {
  batchStop = true;
  window.api.coach.cancel();          // 掐掉正在写的那一手
  setBatchBar(true, 0, 1, '正在停…');
};
/* 标题旁的「看全盘 / 返回」——在「按手数看」和「整盘一页」之间切 */
$('btn-all').onclick = () => {
  if (state.coach.batch) { flash('全盘讲解正在跑 —— 等它跑完再切'); return; }
  state.coach.view = 'explain';        // 它属于「分析讲解」那一页
  state.coach.allView = !state.coach.allView;
  coachRenderedAt = -999;
  coachAllSig = '';                    // 两种视图的 DOM 结构不同 → 必须重建
  renderCoachPanels(true);
  coachScrollTop();
};
/* 全盘视图里点某一行 → 跳到那一手（视图不关：方便一路往下点着读） */
$('explain-body').addEventListener('click', e => {
  if (!state.coach.allView || state.coach.view === 'pick') return;
  const row = e.target && e.target.closest ? e.target.closest('.all-row') : null;
  if (!row) return;
  const at = +row.dataset.at;
  if (at > 0) gotoView(at);
});
/* ★ 启动初始化放在**最后**：applyNewGame 内部会调 clearCoachPanels()，
   它要用上面那些模块里的东西 —— 放前面会踩 const 的暂时性死区（TDZ）。 */
applyNewGame(true);
