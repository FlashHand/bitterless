/**
 * 超长粘贴的阈值 —— **main 与渲染端共用同一个数**。
 *
 * 为什么必须共用:main 在 `sendAgentMessage()` 用它决定「这条转文件」,渲染端在
 * `userChain.service.ts` 用它决定「这条不进原话链」。**两处判据必须是同一个数** ——
 * 不一致的后果是静默且严重的:
 *
 *  · 渲染端的阈值更大 ⇒ 一条已经被 main 换成文件引用的消息,仍然会被原话链**原样重新注入**,
 *    于是发送时省下的整份原文在第一次压缩时全部回来,长粘贴转文件形同虚设;
 *  · 渲染端的阈值更小 ⇒ 明明还在正文里的消息被排除出链,用户原话白白丢了逐字保留。
 *
 * 两种都不报错。所以这个数只能有一处定义。
 *
 * 取值推导(20,000 字符 ≈ 5k token ≈ 原话链 12k 预算的 41%)与市面产品对比见
 * `overmind:areas/agent-runtime/chat/long-paste-threshold.html` #4。
 * Ral 2026-09-11 定案:「我认」。
 *
 * 放在 `shared/` 而不是 main:渲染端 import 不到 `src/main/**`,而这个常量按定义要跨进程一致。
 */
export const LONG_PASTE_CHAR_THRESHOLD = 20_000;
