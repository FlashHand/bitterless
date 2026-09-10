import { existsSync, readFileSync } from 'node:fs'
import { legacyAuthFilesFor } from '@maestro-main/llm/piAgentDir.service'
import { describeCredentialIdentity, formatCredentialIdentity } from './authIdentity'

/**
 * 「为什么这个 provider 用不了」的**唯一**文案生成处。
 *
 * 单独成模块而不是留在 `piRuntimeAdapter.ts` 里,是因为它有四条分支,而其中最要紧的一条
 * (「凭据其实在另一个库里」)只能靠**真跑**来钉住 —— 守卫按源码 grep 时,某一支忘了带出处
 * 是抓不到的(实测:第一版守卫就漏了这个变异)。这个文件不碰 Electron,所以守卫可以 headless 跑它。
 *
 * 契约:`docs/issues/codex-login-writes-a-store-the-turn-never-reads.md`。
 */

const readAuthRecord = (file: string): Record<string, unknown> => {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

/**
 * 这句诊断是操作者唯一能看到的线索,所以它必须说**三件**以前说不出的事:
 * **是哪个账号**、**什么时候过期**、以及**凭据是不是在另一个库里**。
 *
 * 起因(`docs/issues/codex-login-writes-a-store-the-turn-never-reads.md`):登录侧一直写
 * `<userData>/cowork/pi/auth.json`,而回合读 `<userData>/.pi/auth.json`,于是这里只会输出
 * 「auth file exists but has no provider credentials」—— 一句**技术上为真、指向完全错误**的话:
 * 它把人推去重新登录,而重新登录写的还是那个没人读的文件,四次尝试四次同样的报错(实测)。
 * 现在同样的情形会直接说出"凭据在那一份里",这才是可执行的信息。
 */
export const describeAuthFile = (authPath: string, providerId: string): string => {
  const elsewhere = (): string => {
    // 退役库里有而这里没有 —— 这正是那个 bug 的现场,必须把两条路径都点出来。
    for (const sibling of legacyAuthFilesFor(authPath)) {
      try {
        if (!existsSync(sibling)) continue
        const credential = readAuthRecord(sibling)[providerId]
        if (!credential) continue
        const identity = formatCredentialIdentity(describeCredentialIdentity(credential))
        return ` A "${providerId}" credential DOES exist in ${sibling}${identity ? ` (${identity})` : ''} — that store is written by the login button but is not the one this turn reads; it is merged forward on the next agent path resolution, so restarting the app usually picks it up.`
      } catch {
        // 一个坏掉的旧库不该把诊断也带下去。
      }
    }
    return ''
  }
  if (!existsSync(authPath)) return `Auth diagnostic: auth file does not exist (${authPath}).${elsewhere()}`
  try {
    const record = readAuthRecord(authPath)
    const providers = Object.keys(record).filter(Boolean)
    if (!providers.length) {
      return `Auth diagnostic: auth file exists but has no provider credentials (${authPath}).${elsewhere()}`
    }
    if (!record[providerId]) {
      return `Auth diagnostic: auth file exists but is missing provider "${providerId}". Found providers: ${providers.join(', ')}.${elsewhere()}`
    }
    // 这一支的凭据**在**这里,却被 SDK 判为未配置 —— 这时"是哪个账号、什么时候过期"就是全部信息量。
    // 提醒:pi 的 `checkProviderAuth` 对 oauth 从不看 `expires`,所以走到这一支时过期通常不是原因;
    // 但把过期时间说出来,至少让"到期了却显示已连接"这件事可被看见。
    const identity = formatCredentialIdentity(describeCredentialIdentity(record[providerId]))
    return `Auth diagnostic: provider "${providerId}" exists in auth file${identity ? ` (${identity})` : ''}, but the SDK did not consider it configured. It may be expired or incomplete.`
  } catch (err) {
    return `Auth diagnostic: auth file exists but could not be parsed (${(err as Error).message}).`
  }
}

