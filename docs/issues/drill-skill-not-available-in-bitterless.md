# 「bl 中钻探技能无法使用」—— 它在 bl 里从来没有过

`status: 已定根因;要不要移植等 Ral 定`
`reported: 2026-09-09（Ral：「bl 中钻探技能无法使用检查 root cause」）`

## 根因：不是坏了，是从未实现

两条独立的证据，指向同一个结论。

### ① bl 没有钻探（`explore_session`）这个能力

| 查什么 | 结果 |
|---|---|
| `src/main/sitemap/`（cowork 里 `exploreSession.service.ts` 的家） | **不存在**，且 `git log --all` 对这个路径**零提交** —— 从未有过 |
| agent 暴露的工具里有 explore / drill / sitemap 类的吗 | **没有**。有 `ingest_recording`、`plan_recorded_site_sync`、`apply_recorded_site_sync`、`run_recorded_site_sync_dry_run` —— 都是**摄取/同步**，没有**探索** |
| 全仓 `explore_session` 字符串 | 只有 **1 处**，且是注释：`renderer/maestro/control/src/store/turn.service.ts:775`「任务快照在推进也算回合活着(钻探 explore_session 每步 + 心跳)」 |
| `git log -S "explore_session" --all` | 只命中引入那句注释的提交（`f8d25fa`，2026-08-31，chat panel 从 cowork 移植那次） |

所以那句注释是**跟着 chat panel 一起抄过来的**，它描述的是 cowork 的行为。
bl 里没有任何东西会产生 `explore_session` 任务 —— 注释承诺了一个这里不存在的能力。

**这不是我这次 agent 回迁弄丢的**：回迁只在 `src/main/agent/` 与 `maestro-agent-sdk` 之间搬东西，
而 `src/main/sitemap` 在 bl 的整个历史里都不存在。

### ② bl 的录制型技能库是空的

如果「钻探技能」指的是 bl 自己那套**录制型 skill**（`maestro/skills/skillRegistry.service.ts`：
recipe / 录制 / 打包 / 导入导出），那条路同样走不通 —— 两个 edition 的技能目录都是**空目录**：

```
~/Library/Application Support/Bitterless_DEBUG_PROD/skills/   → 空
~/Library/Application Support/Bitterless_PREVIEW/skills/      → 空
```

没有任何已录制的技能，所以「技能无法使用」在这条路上也是「没有技能可用」。

## 两条要 Ral 定的事

1. **要不要把钻探移植进 bl。** 它在 cowork 那侧是一整套：`exploreSession.service.ts`
   （两千多行）+ `drill.service.ts` + 多 tab 钻探 + 边钻边摄 + 站点地图 + 120 分钟预算 +
   run 文件。而且它**深度绑在 cowork 的浏览器 tab 模型上**（`operationTab` / capture / replay），
   bl 的 maestro 侧是另一套窗口/tab 结构。这不是搬一个文件，是移植一个子系统。
2. **还是应该在 cowork 里用它。** 钻探的作业对象是站点，cowork 就是那个浏览器宿主。
   如果 Ral 真正想要的是「在 bl 里也能钻站」，那要先回答「bl 为什么需要一个浏览器宿主」。

## 顺带修掉的一处不实注释

`turn.service.ts:775` 那句会让读代码的人以为 bl 有钻探。已就地说明它描述的是 cowork 行为
（bl 侧唯一会推进任务快照的是 `ingest_recording` 一类）。

## 取证工具已就位

排这类问题的第一步是「去哪看模型到底收到/回了什么」。为此加了
`/copy_session_path`（见 `docs/features/maestro-slash-commands.md`）：
把本会话的模型 I/O jsonl 目录绝对路径复制到剪贴板，并在会话里回一条留痕。
它**重启后翻旧会话也拿得到路径**，所以对事后取证有用。
