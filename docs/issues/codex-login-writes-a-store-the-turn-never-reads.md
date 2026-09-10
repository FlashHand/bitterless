# Codex 登录写的是一个回合永远不读的凭据库

`status: 已修复(含一次自造回归的修复,2026-09-10)`
`reported: 2026-09-10(Ral,远程机器:「登录 codex 然后报错 … 就算我重新登录，也还是不行」「代理也是配置到位了」)`

## 现象

Maestro control 里发任何一句话,回合当场被拒:

```
OpenAI Codex (ChatGPT) (gpt-5.6-luna) is not ready for this turn.
Not signed in to OpenAI Codex (ChatGPT subscription) for "openai-codex/gpt-5.6-luna". …
Auth diagnostic: auth file exists but has no provider credentials
  (/Users/ral/Library/Application Support/Bitterless_PREVIEW/.pi/auth.json).
```

而**界面说登录成功**(Setting ▸ Model Config / Workbench ▸ Models 显示已连接),**重新登录无效**,
代理也配好了。Ral 的 `/view_context` 导出把这三件事同时钉住了:

- `entries 0` + `[2] history: 0 entries` —— 四次尝试(06:52:55 / 06:58:11 / 06:58:52 / 07:01:02,
  2026-09-10)**一次都没进 pi**,全部在取凭据那一步抛掉;
- 因此那句诊断**不是旧文本**,是今天现做的 ⇒ 那台机器上 `.pi/auth.json` 此刻真的是 `{}`;
- 顺带暴露:四条报错以 assistant 消息身份进了下一轮提示词(见「不在本次范围」)。

## 根因:一个 userData 下有两个 pi 凭据库,登录写的是回合不读的那个

| 角色 | 路径 | 代码 |
| --- | --- | --- |
| **回合读**(每次 turn / 压缩 / 非 codex 就绪判定) | `<userData>/.pi/auth.json` | `piAgentDir.service.ts:13` `PI_DIR_NAME = '.pi'` → `llmPaths.ts:29` `maestroAuthPath()` |
| **登录写**(AI Login)· **退出登录** · **「已连接」指示灯** | `<userData>/cowork/pi/auth.json` | `codexPaths.ts:3` `join(userDataRoot, 'cowork', 'pi', 'auth.json')` → `codexCredential.runtime.ts:16` |

`maestroDataRoot()` 就是 `<userData>/cowork`(`maestroDataRoot.ts:7`),所以 maestro 那边声明的
**「legacy」目录与 codex 子系统的「live」目录是同一个** —— "legacy" 这个词是假的:那个库还在被写。

同一个文件 `maestroLlm.service.ts` 里,读写相隔两百行:第 100 行
`ModelRuntime.create({ authPath: maestroAuthPath() })`(读 `.pi`)· 第 159 行
`codexCredentialService.getStatus()`(读 `cowork/pi`,这就是指示灯)· 第 296 行 `connect()`(写
`cowork/pi`)· 第 400 行 `disconnect()`(清 `cowork/pi`)。

两个库之间**唯一的桥**是一次性的 copy-if-absent:

```ts
// piAgentDir.service.ts:59 —— 注释写着 "Target entries always win"
if (!existsSync(from) || existsSync(to)) continue;
```

### 为什么它会**永久**失效(而不是偶尔)

pi 自己会把那个空壳造出来:

```js
// node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js:28
ensureFileExists() {
    if (!existsSync(this.authPath)) {
        writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
    }
}
```

它由 `AuthStorage` 构造函数触发 ⇒ **只要构造过一次指向 `.pi/auth.json` 的 ModelRuntime,`{}` 就诞生了**。
此后 copy-if-absent 认为"目标已存在",迁移永久不再发生;而登录仍然一路写 `cowork/pi/auth.json`。

于是三个症状全部落地,而且**互相解释**:

1. 界面说登录成功 —— 状态读的是它自己刚写的那份;
2. 回合说没登录 —— 回合读的是那个 `{}`;
3. 重登无效 —— 又把同一个没人读的文件写了一遍。**代理与账号选择都与此无关**
   (网络失败会是另一句文案;`describeAuthFile` 那一支只在解析出零个顶层键时出现,
   `piRuntimeAdapter.ts:483-489`)。

本机(2026-09-10)盘面,五个 edition 都是这个结构:

| edition | 登录侧 `cowork/pi/auth.json` | 回合侧 `.pi/auth.json` |
| --- | --- | --- |
| Bitterless(生产) | r4lwayne1,09-04 过期 | **不存在** ← 下次启动就会踩同一个坑 |
| Bitterless_PREVIEW | r4lwayne1,09-11 有效 | 同一份的副本(09-08 13:55 那次迁移赶在空壳之前) |
| Bitterless_DEBUG_PROD | r4lwayne4,09-10 13:00 过期 | 同一份的副本 |
| Bitterless_DEBUG_DEV | `{}` | `{}` ← 就是本 issue 那个状态 |

## 两个连带真相(同一处代码路径,不能不记)

1. **退出登录退不掉回合用的那份。** `disconnect()` 只清 `this.dependencies.authPath()`
   (= `cowork/pi`,`codexCredential.service.ts:404-424`),`.pi/auth.json` 里的凭据与旧账号原封不动。
2. **「已连接」对一个过期 token 也是真的。** pi 的 `checkProviderAuth` 对 `type:'oauth'` 直接返回
   configured,**从不看 `expires`**(`node_modules/@earendil-works/pi-ai/dist/models.js:222-225`),
   而 `connected` 就是 `hasConfiguredAuth`。所以本机 DEBUG_PROD(今天 13:00 过期)界面照样显示已连接。
   ⇒ 现在的「已连接」只等于"某个文件里有一个 oauth 形状的对象"。

## 上游参考:cowork 早就修过同一个坑

cowork 的 `llmPaths.ts` 里 `coworkAuthPath()` **每次调用**都把旧库的 provider 条目前向合并进来
(`migrateCoworkAuth`,target 逐 provider 优先),注释逐字描述了这个失败:

> A user can be correctly logged in in one store while the current channel's auth.json exists but is
> still "{}"; merge provider entries forward so login survives a dev↔prod / packaging switch.

并且配了 `clearCoworkAuthProvider(provider)`,理由同样写在注释里:不连旧库一起清,前向合并会在下一次
就绪探测时把凭据**复活**,于是 Logout 看起来像没反应。bitterless 两个都没有。

## 修法(三段)

1. **一个库(真修)** —— `codexPaths.ts` 改成指向 `.pi`,dir 名从 `PI_DIR_NAME` 取(单一真源)。
   它有**四个消费者**(`codexCredential.runtime.ts` · `codexRuntime.runtime.ts` ·
   `diagnostics/applicationDiagnostics.service.ts` · `modelProvider/modelProvider.runtime.ts`),
   一处改完四处同时到位 —— 这正是"一个库"的意思。注意 `codexCredentialService` 是
   **maestro LLM + coin resources + coin AI 三个子系统共用的单例**,所以它们会一起搬过去(这是对的:
   一台机器一个 Codex 登录),而存量凭据由第 2 段接住。
   **`codexSettingsPath` 不搬** —— 初稿写的是"一并搬",那句是**错的**,而且照着做当场造出一次回归
   (见「#自造的回归」)。代理设置与 pi 的 `settings.json` **同名不同 schema**,而
   `parseCodexProxySettings` 是精确匹配的(必须恰好 `httpProxy` + `schemaVersion: 1`)。
2. **前向合并 + 退出时连旧库一起清(接住存量)** —— 照 cowork 移植:`.pi/auth.json` 缺某个 provider 而
   旧库有,就补一次(逐 provider,target 优先);`clearAuthProvider` 同时清 target 与旧库。
   逻辑放在 Electron-free 的 `piAgentDir.service.ts` 里(该文件自己的纪律),守卫因此能 headless 跑。
   **与 cowork 刻意不同:不跨 edition 继承。** cowork 会跨 channel 合并("login survives a dev↔prod
   switch");bitterless **只在同一个 userData 里合并**。理由就是本次这台机器:PREVIEW 是 r4lwayne1、
   DEBUG_PROD 是 r4lwayne4,跨 edition 合并会把**另一个账号**塞进一个本来没有凭据的 edition ——
   那正是 Ral 抱怨的"我 bl 登录成了另一个号"。edition 是刻意分开的数据家。
3. **诚实的诊断** —— `describeAuthFile` 要说清三件它现在说不出的事:**是哪个账号**
   (access token 的 `profile.email` / `auth.chatgpt_plan_type`,只解码不校验,永不打印 token 本体)、
   **什么时候过期**(`expires` vs 现在),以及**旧库里有而这里没有**时直接点明两条路径 ——
   而不是笼统一句 "no provider credentials"。
   **不把过期改成硬闸**:pi 会在使用时用 refresh token 续期,把过期直接判成 not-ready 会拦掉本来能用的凭据。
   这一段只负责"说真话"。

## 立刻可用的绕过(给已经卡住的机器)

```bash
D="$HOME/Library/Application Support/Bitterless_PREVIEW"
cp -v "$D/.pi/auth.json" "$D/.pi/auth.json.bak-$(date +%m%d%H%M)" 2>/dev/null
cp -v "$D/cowork/pi/auth.json" "$D/.pi/auth.json"
```

登录侧那份也是空的话,说明连登录都没落盘,再从 codex CLI 的凭据搬(`~/.codex/auth.json` 的
`tokens.access_token/refresh_token/account_id` → pi 形状 `{type:'oauth',access,refresh,expires,accountId}`)。

## 不在本次范围(各自单独记)

- **哪个账号登录着** —— [`codex-connected-account-not-identified.md`](codex-connected-account-not-identified.md)
  (2026-08-20 就已受理未做)。本次第 3 段只在**报错文案**里带出账号;界面上的常驻标签仍归那条。
  次序不能反:标签若读登录侧、回合读回合侧,界面会**自信地报出另一个账号**,比不显示更糟。
- **换账号重新登录** —— 登录走 `shell.openExternal` 到系统浏览器,授权 URL 由 pi 拼、bitterless 手上
  没有 `prompt=` 之类的选择器参数,浏览器会静默复用已有的 ChatGPT 会话。所以"强制换号"目前只能靠
  先 Logout + 在 chatgpt.com 退出登录(或用隐私窗口)。要做成一个按钮,得先确认 OpenAI 授权端点
  是否接受账号选择参数 —— 那是独立的一条。
- **回合被拒的那句话不该进下一轮提示词** —— Ral 的导出里有四份。应当 `promptExcluded`
  (cowork 那边这条纪律已有)。
- `/view_context` 的 `contextWindow ?` 从来不填 —— 与 `maestro-context-graph.md` #2.5 同一类
  (字符 ÷ token 是两个单位)。

## 验收

| 场景 | 期望 |
| --- | --- |
| `.pi/auth.json` 是 `{}` 而旧库有凭据 | 下一次 `maestroAuthPath()` 就补齐,回合能跑 —— **不需要重登** |
| 全新登录 | 凭据落在 `.pi/auth.json`,同一秒回合就能用 |
| Logout | target 与旧库都被清;下一次就绪探测**不复活**它 |
| 生产 edition 首次启动(只有旧库) | 补齐,不再出现 `{}` 永久堵死 |
| 凭据过期 | 诊断说明"是哪个账号、什么时候过期",而不是"没有凭据" |
| 旧库有而 `.pi` 没有(合并被禁用时) | 诊断点明两条路径,而不是笼统一句 |
| 跨 edition | **不**继承 —— PREVIEW 不会拿到 DEBUG_PROD 的账号 |

守卫:`scripts/maestro/check-codex-auth-store.mjs` —— 真跑合并/清除(headless,临时目录),
钉住四个消费者路径一致、`{}` 不再是死局、logout 不被复活、跨 edition 不继承、诊断带账号与过期。

## 落地(2026-09-10)

| 文件 | 改动 |
| --- | --- |
| `src/main/codex/codexPaths.ts` | 三个 live 路径改由 `PI_DIR_NAME` 派生(= 回合读的那个目录);新增 `codexLegacyAuthPath` 让退役位置**只保留可达性**。四个消费者一处到位 |
| `src/main/maestro/llm/piAgentDir.service.ts` | 新增 `mergeAuthProviders`(逐 provider 前向合并,目标优先)· `clearAuthProvider`(target + 旧库一起清)· `legacyAuthFilesFor`(**不跨 edition**)。写回时 `chmod 0600` —— `writeFileSync` 的 `mode` 只在创建时生效,重写一份已存在的 0644 文件不会收紧它(守卫实测到 644) |
| `src/main/maestro/llm/llmPaths.ts` | `maestroAuthPath()` 每进程合并一次;导出 `clearMaestroAuthProvider` / `maestroLegacyAuthFiles` |
| `src/main/codex/codexCredential.service.ts` + `.runtime.ts` | `disconnect()` 走新的可选依赖 `clearLegacyCredential` 连旧库一起清 —— 否则前向合并会在下一次探测时把凭据复活 |
| `src/main/agent/runtime/authIdentity.ts` | **新**。从凭据里读身份(账号 / 套餐 / 过期),嵌套与扁平两种 claim 形状都认,**永不带出 token**,任何一步失败就当读不出来 |
| `src/main/agent/runtime/authDiagnostic.ts` | **新**。`describeAuthFile` 从 adapter 抽出来独立成模块 —— 它有四条分支,而最要紧的那条(「凭据其实在另一个库里」)只能靠**真跑**钉住,按源码 grep 抓不到"某一支忘了带出处"(第一版守卫就漏了这个变异) |
| `scripts/maestro/check-codex-auth-store.mjs` | **新**守卫。**16 个变异全部被捕获** |
| `scripts/maestro/check-maestro.mjs` | 计数 **38 → 42**(真实数量)。38 是 **HEAD 上就已经错的值** —— 别人加守卫没改计数,而当天早先那次 42→43 被 `chore: sync 2026-09-10 09:55` 那个提交盖掉了(共享 worktree) |
| `tests/coin/unit/codexCredential.service.test.ts` | 那条显式的兼容契约测试改名并改期望(见下) |
| `tests/modelProvider/codexProxy.service.test.ts` | settings 路径期望跟着搬 |

### 两处**契约级**改动,单独记

1. **`tests/coin/unit/codexCredential.service.test.ts` 里那条
   「keeps the compatibility auth and model paths under userData/cowork/pi」**(`feat: add coin analysis
   workspace` 加的)钉的是"别把已有用户的凭据文件搬走"。本次**把文件搬了**,但那个保证仍然成立 ——
   换成由前向合并接住,旧库保持可达。所以测试改名为「uses the single pi store the turn reads, and keeps
   the retired path reachable for the merge」,并同时断言新位置与退役位置。**这是刻意的契约变更**,
   理由写在测试的注释里。
2. **`codexCredentialService` 是 maestro LLM + coin resources + coin AI 三个子系统共用的单例**,
   所以它们一起搬到新库(一台机器一个 Codex 登录);存量凭据由前向合并接住。

### 验证

- `check-codex-auth-store` 绿,**16/16 变异被捕获**(旧库覆盖 live 凭据 / 合并被关 / logout 不清旧库 /
  跨 edition 继承 / 权限被放宽 / 登录指回旧库 / `maestroAuthPath` 不再合并 / disconnect 不清旧库 /
  四条诊断分支各自丢掉出处 / 凭空声称别处有 / 扁平 claim 不读 / 过期不报)。
- `check-context-graph` 绿;`check-llm-persistence` / `check-control-link-policy` / `check-chat-composer` 绿。
- `typecheck`(node surface,覆盖 codex / maestro llm / agent runtime / diagnostics / modelProvider):
  **我改的文件零错误**。
- `tests/modelProvider/run-tests.mjs`:**22 tests / 21 pass / 1 fail**,与 `git archive HEAD` 的干净基线
  **逐项一致** —— 那一条失败是预存在的 `Dynamic require of "node:assert"`(esbuild 打包产物),不是本次引入。
- `check-agent-runtime` 红,而它**在 HEAD 的干净树里同样红**。
- `assertMaestroAliasBoundary()` 仍报 4 处违规,全在另一个会话未提交的 OnlyPreview 文件里;umbrella 是
  fail-fast,所以在那 4 处清掉之前 `yarn check:maestro` 跑不到这两条新守卫。
- **未跑 Electron E2E**(房规:不主动跑)。

### 对已经卡住的机器

这份修复只影响**下一个构建**。远程那台现在跑的是打包好的 Preview,所以立刻解锁仍然用上面那条 `cp`;
装上带这个修复的构建之后,**重启即自愈**(前向合并会把旧库那份补进来),不需要重新登录。

## 自造的回归(2026-09-10,同日修复)

Ral:「bl preview 版打包后并更新后 codex 登录状态消失且无法触发登录」—— 界面显示
`Sign in to Codex to use this model.`,Login 按下去也起不来。**这是上面那次修复自己造出来的**,
两个症状同一个根:

**把 `codexSettingsPath` 也搬到了 `.pi/settings.json`。** 而那是 **pi 自己的**文件
(`compaction` / `steeringMode`),不是代理那套 schema;`parseCodexProxySettings`
(`codexProxy.service.ts:84-101`)是**精确匹配** —— 文件必须恰好只有 `httpProxy` +
`schemaVersion: 1` 两个键,多一个就 `throw settings-schema-invalid`。

链条:`ensureCodexProxyDispatcher()` 在 `loadPiAuthModule()` 里 ⇒ 一抛就把 `getStatus()` 与
`connect()` **一起带走** ⇒ 状态读不出来(显示未登录)且登录无法开始。

最难看的一点:**文件缺失是安全的**(ENOENT → `not-configured` → 直接 return),
**文件存在但 schema 不对才致命** —— 所以"搬到一个 pi 会写的文件上"恰好是所有选项里最坏的那个。
改前 PREVIEW 上 `cowork/pi/settings.json` 根本不存在,所以一直走的是安全分支。

修法:`codexSettingsPath` 回到自己的文件(退役目录),并在注释里写明为什么它**不能**跟着 auth/models 走。
要统一的话得先给代理设置一个**专属文件名**,而不是复用 pi 的 `settings.json` —— 那是独立一条。

顺带修掉第二个真缺口:**状态与登录不触发前向合并。** `getStatus()` / `connect()` 原来拿的是裸的
`codexAuthPath()`,而合并挂在 `maestroAuthPath()` 上;两者返回同一个路径,但只有后者会补齐。
状态检查通常**先于**任何 agent 回合发生,所以凭据只在退役库里的用户会一直看到"未登录"。
两个 runtime 的 `authPath` 现在都走 `maestroAuthPath()`。

守卫加了三条,其中一条是**真跑**:把代理指向 pi 形状的 settings 必须 reject、指向缺失文件必须 resolve、
两个 runtime 必须走 `maestroAuthPath()`。**19/19 变异被捕获**(含"把代理设置又搬回 pi 的文件上")。
判据刻意不是"路径写对了没有",而是"指错会发生什么" —— 因为这次的症状(看起来像凭据问题)
与真正的原因隔着两层。
