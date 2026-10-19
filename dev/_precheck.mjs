/* CDP 测试脚本预检器
   ★ 为什么要「先求值再检查」：直接把原始文本丢给 new Function() 是不够的 ——
     模板字符串里的反斜杠转义会在**求值时**被吃掉。
     例：源码里写 /RE\[/ → 模板串求值后变成 /RE[/ → 正则语法错误，
         而 new Function(原始文本) 却完全正常 —— 这类错误只有真正求值才抓得到。
   ★ 失败时把「求值后的代码」落盘（_precheck_fail_*.js）并指出行号 ——
     否则只知道有错、不知道在哪（这里踩过：定位一次要绕三步）。

   检查范围：文件里**所有** `js(\`...\`)` 模板串。
   ⚠️ 别用 /await js\(`([\s\S]*?)`\);/ 这种写法 —— 遇到结尾不是 `\`);` 的调用
      （例如 `JSON.parse(await js(\`...\`))`）会一直匹配到后面某个 `\`);`，
      把多个模板串截成一段，报出莫名其妙的语法错（踩过）。 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

/* ★ 2026-10-07：脚本搬进 dev\ 之后，被检查的测试脚本也都在 dev\ 里 ——
   所以这里扫的是**本脚本所在目录**（原来写死项目根目录，搬完就扫不到任何东西）。 */
const dir = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.mjs') && !x.startsWith('_precheck') && !x.startsWith('_dump'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  /* ---------- ⓪ 先检查**文件本身**的语法（2026-10-14 加的）----------
     ★ 为什么需要这一步：这些脚本的被测代码写在**模板字符串**里，所以正文注释里
       多写一个反引号就会把模板串截断 → 整个文件 `SyntaxError`。
       这种错已经踩过 5 次（每次都是"改完没马上 node --check"）。
       先用 node --check 整体过一遍，把它变成一次就能报出来的错 ——
       而且这一步还能顺带抓别的语法笔误（少个括号之类）。 */
  const chk = spawnSync(process.execPath, ['--check', path.join(dir, f)], { encoding: 'utf8' });
  if (chk.status !== 0) {
    bad++;
    const line = String(chk.stderr || '').split('\n').find(l => /SyntaxError/.test(l)) || '语法错';
    console.log('  ★ ' + f + '  **整个文件**语法就不对（先修这个，多半是模板串被反引号截断）：' + line.trim());
    continue;
  }
  /* ⚠️ 先剥掉块注释再找模板串 —— 否则注释里写一句示例 js(`...`) 也会被当成真代码，
     报出莫名其妙的「Unexpected end of input」（本文件就踩过：注释里举例写了 js(`...`)，body 变成 "..."）。 */
  const srcNC = src.replace(/\/\*[\s\S]*?\*\//g, '');
  /* ★ 2026-10-16 修：结尾不能只认 `) —— `js(HOOK, 15000)` / `js(`...`, 200000)` 这种
     **带超时参数**的调用，反引号后面跟的是 `,` 而不是 `)`，原来那个 /js\(`([\s\S]*?)`\)/g
     匹配不上它，就会一路往后吃、把**后面好几段模板串连同中间代码**截成一段 →
     报出莫名其妙的 "Unexpected token ')'"（实测有 6 个脚本被这样误报：
     _cdp_gate / _cdp_diag3 / _cdp_kodiag / _cdp_recsdir / _cdp_engcheck / _cdp_engcheck3）。
     本文件顶上的注释其实早就点过这个坑（"遇到结尾不是 `);` 的调用会一直匹配到后面某个
     `);`"），只是当时只把写法从 /`);/ 改成 /`)/ —— 没修到位。
     现在：反引号结尾允许后面跟 `)` 或 `,`（并可带空格）。 */
  const all = [...srcNC.matchAll(/js\(`([\s\S]*?)`\s*[,)]/g)];
  if (!all.length) { console.log('  ' + f + '  没有模板串'); continue; }

  let failed = false;
  for (let i = 0; i < all.length; i++) {
    const body = all[i][1];
    const where = all.length > 1 ? ('模板串#' + (i + 1) + ' ') : '';

    /* ① 转义方括号：会被模板串吃掉，改用 indexOf/slice
       ★ 2026-10-16 修：先把「转义的反斜杠」（源码里成对的 \\ ）剥掉再判 ——
         不然 `/RapaceGo[/\\\\]records$/` 这种**正确**写法（字符类里放 / 和反斜杠）
         会被当成"转义方括号"误报（_cdp_recsdir.mjs 就一直挂在这条上）。 */
    if (/\\\[|\\\]/.test(body.replace(/\\\\/g, ''))) {
      bad++; failed = true;
      console.log('  ★ ' + f + '  ' + where + '有转义方括号 —— 会被吃掉，改用 indexOf/slice');
      continue;
    }

    let val;
    try {
      /* ⚠️ 先把 ${...} 插值换成 0 再求值 —— 模板串里用 node 侧的变量拼字符串是正常写法
         （例如 js('... runReview(\`' + NAME + '\`) ...') 写成模板插值时），
         但求值时那个变量在检查器里并不存在，会抛 ReferenceError 造成**误报**。
         它只影响语法检查，替换掉正好。 */
      const forEval = body.replace(/\$\{[^}]*\}/g, '0');
      val = new Function('return `' + forEval + '`;')();       // 第一段：按模板串求值（转义在这被处理）
    } catch (e) {
      bad++; failed = true;
      console.log('  ★ ' + f + '  ' + where + '模板串求值失败：' + e.message);
      continue;
    }
    try {
      /* 用 vm.Script 而不是 new Function —— 它的 SyntaxError.stack 里**带行号**
         （new Function 只给个光秃秃的消息，定位还得手动 node --check 一遍） */
      new vm.Script(val, { filename: 'precheck.js' });
    } catch (e) {
      bad++; failed = true;
      const out = path.join(dir, '_precheck_fail_' + f.replace(/\.mjs$/, '') + '_' + (i + 1) + '.js');
      fs.writeFileSync(out, val, 'utf8');
      console.log('  ★ ' + f + '  ' + where + e.message);
      const st = String(e.stack || '').split('\n');
      if (st.length > 1) console.log('     ' + st[1].trim());
      if (st.length > 2 && /^\s{4}/.test(st[2])) console.log('     ' + st[2].trim().slice(0, 110));
      console.log('     求值后的代码已写到 ' + path.basename(out));
    }
  }
  if (!failed) console.log('  ' + f + '  OK' + (all.length > 1 ? ('（' + all.length + ' 个模板串）') : ''));
}
process.exit(bad ? 1 : 0);
