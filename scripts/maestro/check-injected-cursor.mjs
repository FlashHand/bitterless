import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 虚拟鼠标覆盖层的注入自包含性（`drive/inject/mouseOverlay.inject.ts`）。
 *
 * 为什么值得一条守卫：这个覆盖层是靠 `String(fn)` 注入进页面的，
 * **它一旦引用了任何模块作用域的东西，页面里就是 ReferenceError —— 覆盖层整个消失，而且一声不响。**
 * 编译不会红、测试不会红、真实点击照旧工作，只有"看得见的光标不动了"这一个现象。
 *
 * cowork 那边真踩过：2026-08-31 起坏，直到 09-09 Ral 报「之前有虚拟的鼠标和彗星鼠标轨迹，
 * 现在没有了」才发现（它那边的触发原因是 `esbuild: { keepNames: true }` 给内部具名函数套了
 * 模块作用域的 `__name` 辅助）。bl 没开 keepNames，所以走 `String(fn)`；
 * 代价就是这条约束得由守卫来守。
 */

const root = resolve(import.meta.dirname, '../..');
const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};

const overlayPath = 'src/main/maestro/drive/inject/mouseOverlay.inject.ts';
const src = readFileSync(resolve(root, overlayPath), 'utf8');

// ① 必须是一个**箭头函数**常量。箭头函数没有名字 —— 就算将来有人打开 keepNames，
//    也不会给它自己套 `__name`（内部具名函数才会，见 ②）。
ok(
  /export const MOUSE_OVERLAY = \(\): void => \{/.test(src),
  `${overlayPath}: 必须导出一个箭头函数 \`MOUSE_OVERLAY\` —— 具名函数在 keepNames 下会被套上模块作用域的 __name`
);

// ② 内部不许有具名函数声明。那正是 cowork 那次静默失效的直接原因。
const namedFns = src.match(/^\s+function\s+[A-Za-z_$]/gm) || [];
ok(
  namedFns.length === 0,
  `${overlayPath}: 内部不许出现具名函数声明（找到 ${namedFns.length} 个）—— keepNames 会给每一个套模块作用域的 __name，注入进页面就是 ReferenceError`
);

// ③ 不许有**值** import。`import type` 会被擦除，值 import 会在页面里变成未定义的引用。
const valueImports = (src.match(/^import\s+(?!type\b)/gm) || []).length;
ok(
  valueImports === 0,
  `${overlayPath}: 不许有值 import（找到 ${valueImports} 条）—— 它在页面里没有模块系统可以解析`
);

// ④ 调用方必须用 `(${MOUSE_OVERLAY})()` 这种字符串化注入，而不是直接调它。
//    直接调等于在 main 进程里跑一段操作 document 的代码 —— 那里没有 document。
const mousePath = 'src/main/maestro/drive/humanMouse.ts';
const mouseSrc = readFileSync(resolve(root, mousePath), 'utf8');
ok(
  /\$\{MOUSE_OVERLAY\}/.test(mouseSrc),
  `${mousePath}: 覆盖层必须以 \`(\${MOUSE_OVERLAY})()\` 字符串化注入 —— 直接调用会在 main 里执行，那里没有 document`
);

// ⑤ 注入失败必须留痕，但**只在 0→1 那一次**。
//    钻探一轮几百次移动，每次都打会把日志淹掉；而这条要说的事只需要说一次。
ok(
  /overlayFailures/.test(mouseSrc) && /overlayFailures === 1/.test(mouseSrc),
  `${mousePath}: 覆盖层注入失败必须留一行（且只在第一次）—— 光标是操作者判断"agent 到底在不在动"的唯一视觉证据，它没了的时候日志里不能是零行`
);

// ⑥ 可见轨迹与真实事件必须用**同一份点**。两套点就等于"看到的"和"页面收到的"是两回事，
//    而那正是这次移植要修的东西。
ok(
  /void this\.paintTrail\(points, path\.delays\)/.test(mouseSrc),
  `${mousePath}: 可见轨迹必须用与 CDP 事件同一份 points/delays`
);

// ⑦ 不许缓存"已注入"标志。页面一导航覆盖层就没了，而钻探本来就是一路点着走的。
ok(
  !/overlayInjected|this\.injected\b/.test(mouseSrc),
  `${mousePath}: 不许缓存"已注入"标志 —— 导航之后覆盖层就没了，缓存会让之后的所有轨迹静默消失`
);

if (fail.length) {
  console.error('[check-injected-cursor] FAILED');
  for (const line of fail) console.error('  ✗ ' + line);
  process.exit(1);
}
console.log('[check-injected-cursor] ok');
