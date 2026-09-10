import { join } from 'node:path';
import {
  LEGACY_MAESTRO_STATE_DIR,
  LEGACY_PI_DIR_NAME,
  PI_DIR_NAME
} from '@maestro-main/llm/piAgentDir.service';

/**
 * Codex 子系统的 pi 状态文件 —— **与回合读的那份是同一个文件**。
 *
 * 2026-09-10 之前这里是 `<userData>/cowork/pi/*`,而每个回合读的是 `<userData>/.pi/*`:
 * 登录、退出登录、以及「已连接」指示灯全走前者,回合走后者。后果是登录成功、回合说没登录、重登无效,
 * 而且**永久**如此(pi 的 `AuthStorage` 会把 `.pi/auth.json` 造成 `"{}"` 空壳,一次性迁移从此不再补)。
 * 完整证据链:`docs/issues/codex-login-writes-a-store-the-turn-never-reads.md`。
 *
 * 目录名从 `PI_DIR_NAME` 取,**不写字面量** —— 两处各写一个 `.pi` / `cowork/pi` 正是那个 bug 的形状。
 *
 * **注意:只有 auth 与 models 搬了。** settings 留在退役位置,理由见 `codexSettingsPath` —— 它与 pi 的
 * 同名文件不是一个 schema,搬过去会把整条 Codex 鉴权带崩。
 * 这四个消费者因此一起搬过来:`codexCredential.runtime.ts` · `codexRuntime.runtime.ts` ·
 * `diagnostics/applicationDiagnostics.service.ts` · `modelProvider/modelProvider.runtime.ts`
 * —— 「一个库」的意思就是它们不能各指一个地方。
 */
export const codexAuthPath = (userDataRoot: string): string =>
  join(userDataRoot, PI_DIR_NAME, 'auth.json');

export const codexModelsPath = (userDataRoot: string): string =>
  join(userDataRoot, PI_DIR_NAME, 'models.json');

/**
 * **代理设置留在原位,刻意不跟 auth/models 一起搬。**
 *
 * 它和 pi 的 `settings.json` **同名但不同 schema**,而 `parseCodexProxySettings` 是**精确匹配**的:
 * 文件必须恰好只有 `httpProxy` + `schemaVersion: 1` 两个键,多一个就 `throw settings-schema-invalid`
 * (`codexProxy.service.ts:84-101`)。而 `<userData>/.pi/settings.json` 是 **pi 自己的**文件,里面是
 * `compaction` / `steeringMode` —— 指过去就必然抛。
 *
 * 抛出来的后果远大于"代理没配上":`ensureCodexProxyDispatcher()` 在 `loadPiAuthModule()` 里,一抛就把
 * `getStatus()` 与 `connect()` 一起带走 ⇒ 界面显示「Sign in to Codex to use this model.」而 Login
 * 按下去也起不来。**2026-09-10 我把这条一起搬过去,当场造出了这个回归**(Ral:「打包并更新后 codex
 * 登录状态消失且无法触发登录」)。文件缺失是安全的(ENOENT → not-configured),文件存在但 schema 不对
 * 才是致命的 —— 所以"搬到一个 pi 会写的文件上"恰好是最坏的选择。
 *
 * 想统一的话得先给代理设置一个**专属文件名**(而不是复用 pi 的 `settings.json`),那是独立一条。
 */
export const codexSettingsPath = (userDataRoot: string): string =>
  join(userDataRoot, LEGACY_MAESTRO_STATE_DIR, LEGACY_PI_DIR_NAME, 'settings.json');

/**
 * 退役位置(`<userData>/cowork/pi/*`)—— **只给读取存量与清理用**,不再往这里写。
 *
 * 迁移是 copy 而不是 move,所以老副本原样留在盘上;`maestroAuthPath()` 每次都会把它缺的 provider
 * 前向合并过来,`clearMaestroAuthProvider()` 退出登录时连它一起清。
 */
export const codexLegacyAuthPath = (userDataRoot: string): string =>
  join(userDataRoot, LEGACY_MAESTRO_STATE_DIR, LEGACY_PI_DIR_NAME, 'auth.json');
