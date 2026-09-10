# AI-CRMS 退役前的安全契约 —— 留档

`status: 留档,不再是活约束(2026-09-10)`
`retired: AI-CRMS provider 于 2026-09 整条链路退役`
`契约: docs/features/maestro-crms-retirement.md #5.3 · D4 第五条`
`原出处: docs/features/maestro.md(退役前的「Security and errors」段)`

## 这份文档存在的理由

`docs/features/maestro.md` 只描述**现在成立**的契约。AI-CRMS 退役之后,下面这两段约束
在 bl 里没有了对象 —— 既没有那个登录 tab,也没有那个 CLI 凭据信封。

但把它们直接删掉会丢掉一件事:**当年为什么要这么严**。下一个人如果再往 Maestro 里接一条
「远端后端 + 自带登录页 + 落盘凭据」的链路,这两段是他应该先读的东西,而不是重新踩一遍。
所以正文里删,这里留档。

**这份文档不是活约束。** 不要拿它去写守卫,也不要拿它去 review 今天的代码。

## 留档一:AI-CRMS 专用登录 tab 的隔离要求

> - AI-CRMS authentication uses one closable, non-persisted, non-recordable login tab with no preload.
>   Main confines it to the trusted AI-CRMS host and accepts login/logout bindings only from that
>   trusted main frame. Closing, cooling, auth cleanup, and native-window shutdown invalidate pending
>   preparation and detach the auth bridge before detaching its debugger and closing the view.

对应实现(均已删除):`src/main/maestro/auth/authBridge.ts` ·
`maestroBrowserView.service.ts` 的 `addAiCrmsLoginTab` / `preventAiCrmsEscape` /
`detachAuthBridge` / `quiesceAuthBridge` / `prepareAiCrmsTab`。

这段里**仍然活着**的那半句已经留在 `maestro.md` 的固定首 tab 约束里,并且被改写成了不绑
provider 的说法:任何 provider 的登录代码都不得导航或替换固定首 tab。那条是产品约束,
比 crms 活得久,所以留在正文;上面这段是 crms 专属实现的隔离要求,所以留在这里。

## 留档二:Bundled Micromeet CLI 凭据信封

> - Bundled Micromeet CLI credentials use a random local key protected with restrictive filesystem
>   permissions and an authenticated encryption envelope shared by the embedded runtime and bundled
>   CLI. They must not be decryptable from a public constant plus the account email.

对应实现(均已删除):`src/main/maestro/cli/micromeetCli.service.ts` ·
`micromeetCliPath.service.ts` · vendored 的 `packages/micromeet-cli/`。

最后一句(「不得由公开常量 + 账号邮箱推导出来」)是当年一次真实的威胁建模结论。它今天在 bl
里没有对象,但对任何一份**落盘的、由桌面端与外部进程共享的**凭据都仍然成立 —— 下一次遇到
同类需求时按这条起草,不要从零想。

## 盘上残留怎么处理

退役只删 writer,不删数据。已存在的凭据由一段带 sunset 的一次性开机清理负责,
见 [`maestro-crms-residue-cleanup-sunset.md`](maestro-crms-residue-cleanup-sunset.md)。
