# Maestro 的 model-io 证据链是死的 —— `setModelIoRoot()` 一个调用点都没有

**报告人**: Claude(移植 `/view_context_graph` 时发现) · 2026-09-09
**范围**: `src/main/agent/runtime/modelIoLog.ts`、`src/main/agent/maestroAgent.service.ts`(`copySessionIoPath`)、
`docs/features/maestro-slash-commands.md`
**状态**: 待 owner 决定(**本次刻意不改** —— 它属于另一份契约,且两条出路是产品决定)

## 症状

`/copy_session_path`(2026-09-09 加的命令,`maestro-slash-commands.md`)大概**永远**回这一句:

```
This session has no model I/O log yet — send a message first.
```

无论发过多少轮。

## 根因

`modelIoLog` 要宿主在 boot 时指一次落点:

```ts
// src/main/agent/runtime/modelIoLog.ts:34
export const setModelIoRoot = (resolve: () => string): void => { … }
```

而这个函数在整个 `src/` 里**没有任何调用点**(只有它自己的定义)。模块自己也知道会这样,它在没配置时
打的是:

```
[model-io] 落点未配置 —— 本进程不写 agent-io 证据链。宿主应在 boot 时调一次 setModelIoRoot()。
```

于是 `dirForSession()`(`:182`)拿不到活桶、盘上也没有按目录名后缀能找到的目录 ⇒ 返回 `null` ⇒
`copySessionIoPath` 走它那条"明确报没有"的分支(这条分支本身是对的:它刻意不给一个空串让人以为复制成功了)。

**为什么八天没人发现**:那条命令的失败是**一句合理的提示**,不是报错 —— 读起来像"你还没发过消息",
而不是"这台机器根本不写这个日志"。

## 影响面

| 面 | 影响 |
| --- | --- |
| `/copy_session_path` | 事实上不可用(总是回"还没有") |
| `/view_context` 的 `model-io jsonl:` 头 | `renderContextText` 为 `ioLogDir` 留了这一行,但 `copyNextTurnContext` 从来不传它 ⇒ 那行也从不出现。**两个独立缺口指向同一条链** |
| `/view_context_graph` | **不受影响**:契约 #2.5 就是因为这条死链才决定不做 jsonl 页脚 —— 不给一个永远空的字段 |
| 排查能力 | 追"这份上下文对应盘上哪份原文"时,bitterless 没有可交出的路径;cowork 那边这条链是活的 |

## 两条出路(需要 owner 选)

1. **补一次 `setModelIoRoot()`**(推荐,前提是要这条证据链):在 boot 里指到
   `<userData>/model-io`,与 cowork 同形。代价是每轮真的写盘 —— 一个钻探会话可能几十 MB,
   要连带确认那边的 `prune()` 策略在本仓也成立。
2. **撤掉 `/copy_session_path` 与 `ioLogDir` 那一行**:如果不要这条链,就别留一条永远失败的命令
   和一个永远填不上的字段 —— 它们现在读起来像"功能有,只是你还没触发"。

无论选哪条,**都要动 `maestro-slash-commands.md`**:那份契约现在描述的是一个不工作的命令。

## 顺带记的第二条(同一条链的另一头)

`copyNextTurnContext` 的 `buildContextRecord({…})` 从不传 `pending.workspace`,而请求里一直带着
`WorkspaceRef` —— 所以 `/view_context` 的剪贴板导出里 `workspace:` 永远是 `(none)`,即使这个会话
绑了工作区。`/view_context_graph` 这边已经从 `context.workspace.path` 取到了(契约 #2.7)。
修剪贴板那条会**改变已落盘证据的形状**,所以同样先记不改。

## 复现

1. 在 maestro control 里发一轮消息。
2. `/copy_session_path` → 得到"This session has no model I/O log yet"。
3. `grep -rn "setModelIoRoot" src/` → 只有定义,没有调用。
