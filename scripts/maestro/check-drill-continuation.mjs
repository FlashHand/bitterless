import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 钻探的**续跑循环** —— 「自动持续」的唯一来源。
 *
 * Ral 2026-09-10:「钻探没法持续自动进行,cowork 是可以的」。当时 bl 的日志里
 * `explore_session` 与「继续钻探」都是 **0 命中** —— agent 只能用通用工具即兴走两步,
 * 讲一句"我进入了 X"就正常结束回合。**一个普通回合在模型停止调工具时就结束了**,
 * 没有任何东西推它继续。cowork 能持续靠的不是模型的毅力,而是宿主每轮**合成一条新 turn**。
 *
 * 这条守卫钉的是那些让循环**静默退化成"跑一轮就停"**的方向 —— 它们都不会让编译变红。
 */

const root = resolve(import.meta.dirname, '../..');
const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};

const path = 'src/main/maestro/sitemap/drillTools.host.ts';
const src = readFileSync(resolve(root, path), 'utf8');
const at = (needle) => src.indexOf(needle);

// ① 循环本体存在，且真的会合成 turn 发回去。
ok(/async continueAfterTurn\(/.test(src), `${path}: 缺 continueAfterTurn —— 那就没有"自动持续"这件事`);
ok(
  /await this\.host\.sendAgentMessage\(\{ sessionId: params\.sessionId, message: msg \}\)/.test(src),
  `${path}: 循环必须把合成的 msg 真的发回 agent —— 只算状态不发消息就是"跑一轮就停"`
);
ok(
  /for \(let i = 0; i < DRILL_MAX_CONTINUATIONS; i\+\+\)/.test(src),
  `${path}: 续跑必须有上限（防空转），而且是这个常量`
);

// ② steering 早退必须在**任何**循环之前。
//    少了它:每次 sendAgentMessage 都秒回 ok:true（回合还占着 busy，消息只是排进队），
//    于是最多 40 条「[继续钻探]」被灌进那个活回合，而出口的 finalize 是无条件的 ——
//    会给一个还在跑的钻探写 sitemap、播 drill-complete。
const mergedAt = at('if (reply.mergedIntoTurn) return reply');
const loopAt = at('for (let i = 0; i < DRILL_MAX_CONTINUATIONS');
ok(mergedAt > 0, `${path}: 缺 \`if (reply.mergedIntoTurn) return reply\` —— 回合内 steering 时续跑的前提不成立`);
ok(mergedAt < loopAt, `${path}: mergedIntoTurn 早退必须在循环之前`);

// ③ 代次闸必须在**循环口**，而不只藏在 continueState 里。
//    它同时挡两件事:这一轮被停了 / 这已经是下一轮了（人停完立刻又开）。
ok(
  /if \(!this\.run\.isRunLive\(runId\) \|\| this\.drillHost\.ensureSession\(\)\.isStopped\)/.test(src),
  `${path}: 循环口必须同时查代次与 isStopped —— isStopped 在没有 TaskHandle 时会读出 false（答错"被停了没"）`
);
const runIdAt = at('const runId = this.run.currentRunId');
ok(runIdAt > 0 && runIdAt < loopAt, `${path}: 必须在进循环**之前**抓一份 runId，之后逐次比对`);

// ④ 零进展刹车 —— 没它就会在同一页上打转到 40 次上限。
ok(
  /after\.discovered <= st\.discovered/.test(src) &&
    /after\.worklistLeft >= st\.worklistLeft/.test(src),
  `${path}: 缺零进展刹车（没发现新模块/没钻完/没访问新页/frontier 没往下走 → 停）`
);

// ⑤ 出口的 finalize 必须过代次闸。它是**无条件**的 ——
//    过期的循环会去给**别人**那一轮写 sitemap、播 drill-complete、清 exploreTask。
const finalizeAt = at("if (this.run.exploreTaskHandle && this.run.isRunLive(runId))");
ok(finalizeAt > 0, `${path}: 出口 finalize 必须同时要求"有任务卡"与"还是这一轮"`);
ok(finalizeAt > loopAt, `${path}: 出口 finalize 必须在循环之后`);

// ⑥ 兜底收尾要留痕，而且**被人停掉的那一轮不算"兜底"**。
//    走同一条播报会写成「本轮由宿主兜底收尾」，读起来像出了故障 —— 而停止已经自己播过一条。
ok(/drill:finalize-incomplete/.test(src), `${path}: 兜底收尾必须留痕，否则"跑崩"与"跑完"在 run journal 里长得一样`);
ok(
  /exitSt\?\.shouldContinue && !this\.drillHost\.exploreSessionOrNull\(\)\?\.isStopped/.test(src),
  `${path}: 被人停掉的一轮不许写成"宿主兜底收尾"`
);

// ⑦ 续跑话术要落日志（分支名 + 全文截断）。
//    它是整个循环里最有影响力的输入 —— 决定 agent 下一步去干什么。不记的话，
//    钻探打转时查不出它当时被告知了什么。
ok(/drill:continue-prompt/.test(src), `${path}: 续跑话术必须落日志（分支名回答"走了哪条路"，全文回答"到底说了什么"）`);

if (fail.length) {
  console.error('[check-drill-continuation] FAILED');
  for (const line of fail) console.error('  ✗ ' + line);
  process.exit(1);
}
console.log('[check-drill-continuation] ok');
