import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 录制来源（`captureStartedBy`）的两个方向 —— 它们是「能不能停这份录制」的唯一判据。
 *
 * 为什么值得一条守卫：搞错的代价**不对称**。
 *  · 漏盖章 ⇒ 录制多活一会儿（多花磁盘，`stop_recording` / Capture 按钮随时能停）；
 *  · 错停   ⇒ **掐掉人正在录的演示，那是不可恢复的**。
 *
 * 而两种错法都**不会让任何编译或测试变红**。cowork 那边的形态是 2026-09-09 被红队抓出来的：
 * 章盖在 `startCapture` 入口时，一次被早退闸放过去的 agent start 会把人正在开的那份录制
 * 改标成 `'agent'`，于是下一次停止把人的演示掐掉。
 */

const root = resolve(import.meta.dirname, '../..');
const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};

const path = 'src/main/maestro/capture/capture.service.ts';
const src = readFileSync(resolve(root, path), 'utf8');

// ① 默认必须是保守值。
ok(
  /private captureStartedBy: CaptureStartedBy = 'operator'/.test(src),
  `${path}: 来源默认必须是 'operator' —— 宁可漏停，不可错停`
);

// ② 盖章点必须**紧贴** `this.capturing = true`，不能在 startCapture 入口。
//    按 index 比次序（而不是比距离）：入口处的早退闸会放过一次什么都没做的 start。
const capturingTrueAt = src.indexOf('this.capturing = true');
const stampAt = src.indexOf('this.captureStartedBy = effectiveStartedBy');
ok(capturingTrueAt > 0, `${path}: 找不到 \`this.capturing = true\` —— 断言失去作用域，先修断言`);
ok(stampAt > 0, `${path}: 找不到盖章点 \`this.captureStartedBy = effectiveStartedBy\``);
ok(
  stampAt > capturingTrueAt && stampAt - capturingTrueAt < 700,
  `${path}: 盖章必须紧贴 \`this.capturing = true\`（真正占住 session 那一处）—— 盖在 startCapture 入口会被早退闸放过去，把人正在开的录制洗成 'agent'`
);

// ③ 「这一段里有过人开的录制 ⇒ 钉死 operator」这条必须在**任何 discard/restart 之前**算出来，
//    否则 `this.capturing` 已经被改掉，判据就读不到了。
const replacingAt = src.indexOf('const replacingOperatorCapture');
const discardAt = src.indexOf('discardActiveCaptureForRestart');
// 断言的是**判据本身**，不只是标识符存在 —— 第一版只查了名字，
// 于是把它改成 `= false` 照样能过（反向验证抓到的）。
ok(
  /const replacingOperatorCapture = this\.capturing && this\.captureStartedBy === 'operator'/.test(src),
  `${path}: \`replacingOperatorCapture\` 必须真的读 \`this.capturing && captureStartedBy === 'operator'\` —— 少了它，"人先开录演示 → 让 agent 干活 → 停 agent" 会掐掉人的录制`
);
ok(
  replacingAt < discardAt,
  `${path}: \`replacingOperatorCapture\` 必须在 \`discardActiveCaptureForRestart\` **之前**算 —— 之后再算时 this.capturing 已经被改掉`
);
ok(
  /replacingOperatorCapture\s*\n?\s*\?\s*'operator'/.test(src),
  `${path}: 替换人开的录制时，来源必须钉死 'operator'`
);

// ④ 停止时必须复位成保守值，否则下一份人开的录制会继承上一份 agent 的章。
const stopAt = src.indexOf('async stopCapture(');
const stopBody = src.slice(stopAt, stopAt + 900);
ok(
  /this\.captureStartedBy = 'operator'/.test(stopBody),
  `${path}: \`stopCapture\` 必须把来源复位成 'operator' —— 不复位的话下一份人开的录制会继承 agent 的章`
);

// ⑤ 只停 agent 开的那一种。
ok(
  /if \(!this\.capturing \|\| this\.captureStartedBy !== 'agent'\) return false/.test(src),
  `${path}: \`stopCaptureIfAgentStarted\` 只许停 'agent' 开的那份`
);

// ⑥ 文件框拦截**只在录制期间**真的开 —— 一直开着人平时也传不了文件。
ok(
  /setFileChooserIntercept\(on && this\.capturing\)/.test(src),
  `${path}: 文件框拦截必须 \`on && this.capturing\` —— 一直开着会把一个 agent 的需要变成整个应用的残疾`
);

if (fail.length) {
  console.error('[check-capture-provenance] FAILED');
  for (const line of fail) console.error('  ✗ ' + line);
  process.exit(1);
}
console.log('[check-capture-provenance] ok');
