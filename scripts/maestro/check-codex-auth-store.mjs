import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { assert, readMaestro, readProject } from './_harness.mjs'

// Codex 凭据库这条链的守卫(docs/issues/codex-login-writes-a-store-the-turn-never-reads.md)。
//
// 它盯的是一个**只会静默画错、不会报错**的失败:一个 userData 下曾经有两个 pi 凭据库,登录写一个、
// 回合读另一个,中间只有一次性的 copy-if-absent;而 pi 自己会把目标造成 `"{}"` 空壳,于是那次迁移
// 永久失效 —— 界面说登录成功、回合说没登录、重登无效,四次尝试四条一模一样的报错(2026-09-10 实测)。
//
// 五件事必须钉住:
//   ① 一个库 —— 四个消费者的路径由同一个常量派生,谁都不许自己写字面量;
//   ② 空壳不再是死局 —— 逐 provider 的前向合并每次都跑;
//   ③ 目标优先 —— 已有的 provider 绝不被旧库覆盖(旧库里可能是**另一个账号**);
//   ④ 退出登录不被复活 —— clear 连旧库一起清;
//   ⑤ 不跨 edition —— PREVIEW 不该拿到 DEBUG_PROD 的账号(那正是被报上来的抱怨本身)。

const require_ = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const moduleCache = new Map()

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@maestro-main/')) return join(root, 'main', 'maestro', `${specifier.slice('@maestro-main/'.length)}.ts`)
  if (specifier.startsWith('@maestro-shared/')) return join(root, 'shared', 'maestro', `${specifier.slice('@maestro-shared/'.length)}.ts`)
  if (specifier.startsWith('@main/')) return join(root, 'main', `${specifier.slice('@main/'.length)}.ts`)
  if (specifier.startsWith('@shared/')) return join(root, 'shared', `${specifier.slice('@shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  const file = resolveTsModule(specifier, parentDir)
  if (!file) return require_(specifier)
  if (moduleCache.has(file)) return moduleCache.get(file).exports
  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file
  }).outputText
  const wrapped = vm.runInThisContext(`(function(exports, require, module, __filename, __dirname) {\n${output}\n})`, { filename: file })
  wrapped(mod.exports, (child) => loadTsModule(child, dirname(file)), mod, file, dirname(file))
  return mod.exports
}

const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ---------------------------------------------------------------- static · 一个库

const codexPaths = readProject('src/main/codex/codexPaths.ts')
const credentialRuntime = readProject('src/main/codex/codexCredential.runtime.ts')
const credentialService = readProject('src/main/codex/codexCredential.service.ts')
const llmPaths = readMaestro('main/llm/llmPaths.ts')
const piAgentDir = readMaestro('main/llm/piAgentDir.service.ts')
const adapter = readProject('src/main/agent/runtime/piRuntimeAdapter.ts')

// 目录名只有一个来源。**这一条就是那个 bug 的形状**:两处各写一个字面量,读写从此分家。
assert(/PI_DIR_NAME/.test(codexPaths), 'codexPaths must derive the dir from PI_DIR_NAME, not a literal')
const livePathCode = codeOf(codexPaths).split('codexLegacyAuthPath')[0]
assert(!/'\.pi'|"\.pi"/.test(livePathCode), 'codexPaths must not hard-code the .pi literal')
assert(
  !/join\(userDataRoot,\s*'cowork'/.test(livePathCode),
  'the live codex paths must no longer point at <userData>/cowork/pi — that is the store the turn does not read'
)
// 退役位置仍要够得着(合并与清除都要用),但只在那个专门的 accessor 里。
assert(/export const codexLegacyAuthPath/.test(codexPaths), 'the retired store must stay reachable for merge/clear')
// **代理设置不许跟着搬。** 它与 pi 的 settings.json 同名不同 schema,而解析器是精确匹配的;
// 指到 pi 那个文件上会把整条 Codex 鉴权带崩(2026-09-10 实测:界面显示未登录且 Login 起不来)。
assert(
  /export const codexSettingsPath[\s\S]{0,200}LEGACY_MAESTRO_STATE_DIR/.test(codexPaths),
  'the codex proxy settings must keep their own file — sharing pi’s settings.json kills getStatus() and connect()'
)
// 状态与登录必须走会**触发前向合并**的那条路,否则凭据只在退役库里的用户永远看到"未登录"。
for (const runtime of ['src/main/codex/codexCredential.runtime.ts', 'src/main/codex/codexRuntime.runtime.ts']) {
  const source = readProject(runtime)
  assert(/authPath: \(\) => maestroAuthPath\(\)/.test(source), `${runtime} must resolve authPath through maestroAuthPath() so the merge runs`)
}
// 四个消费者:一处改完四处到位 —— 少一个就又出现"各指一个地方"。
for (const consumer of [
  'src/main/codex/codexCredential.runtime.ts',
  'src/main/codex/codexRuntime.runtime.ts',
  'src/main/diagnostics/applicationDiagnostics.service.ts',
  'src/main/modelProvider/modelProvider.runtime.ts'
]) {
  assert(/codexAuthPath/.test(readProject(consumer)), `${consumer} must resolve its auth path through codexPaths`)
}

// ---------------------------------------------------------------- static · 接线

assert(/mergeLegacyAuthOnce\(paths\.authFile\)/.test(llmPaths), 'maestroAuthPath must forward-merge the retired store')
assert(/export const clearMaestroAuthProvider/.test(llmPaths), 'logout needs an authoritative cross-store clear')
assert(/clearLegacyCredential\?\.\(CODEX_PROVIDER\)/.test(credentialService), 'disconnect must clear the retired store too')
assert(/clearLegacyCredential: \(provider\)/.test(credentialRuntime), 'the runtime must bind clearLegacyCredential')
// 诊断文案抽成了独立模块,所以这里只钉"adapter 用的是它"(分支覆盖在下面**真跑**)。
assert(/from '\.\/authDiagnostic'/.test(adapter), 'the adapter must use the single diagnostic module')
// 身份读取器的三条纪律,其中"不返回 token"是安全判据,不能只靠人记住。
const identitySrc = readProject('src/main/agent/runtime/authIdentity.ts')
// 静态判据要精确到**赋值**:第一版写成 `/\.access\s*=/`,结果被 `record.access === 'string'`
// 里那个 `===` 命中,守卫在一份完全正确的文件上假红。真正要禁的是把 token 装进返回值。
assert(!/identity\.(access|refresh|token)\b/.test(codeOf(identitySrc)), 'the identity reader must never carry the token out')

// ---------------------------------------------------------------- runtime

const { mergeAuthProviders, clearAuthProvider, legacyAuthFilesFor } = loadTsModule('@maestro-main/llm/piAgentDir.service')
const { describeCredentialIdentity, formatCredentialIdentity } = loadTsModule('@main/agent/runtime/authIdentity')
const { describeAuthFile } = loadTsModule('@main/agent/runtime/authDiagnostic')

const dir = mkdtempSync(join(tmpdir(), 'bl-codex-auth-'))
try {
  const userData = join(dir, 'Bitterless_PREVIEW')
  const authFile = join(userData, '.pi', 'auth.json')
  const legacyFile = join(userData, 'cowork', 'pi', 'auth.json')
  const write = (file, value) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2))
  }
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
  const cred = (tag) => ({ type: 'oauth', access: `token-${tag}`, refresh: `r-${tag}`, expires: 1, accountId: tag })

  // ⑤ 关系是固定的、而且**只在同一个 userData 里** —— 跨 edition 继承会把别的账号塞进来。
  assert(
    JSON.stringify(legacyAuthFilesFor(authFile)) === JSON.stringify([legacyFile]),
    `the sibling of ${authFile} must be exactly ${legacyFile}, got ${JSON.stringify(legacyAuthFilesFor(authFile))}`
  )
  const otherEdition = join(dir, 'Bitterless_DEBUG_PROD', '.pi', 'auth.json')
  assert(
    !legacyAuthFilesFor(authFile).some((path) => path.includes('Bitterless_DEBUG_PROD')),
    'no cross-edition inheritance — another edition may hold a DIFFERENT account'
  )
  assert(!legacyAuthFilesFor(otherEdition).some((path) => path.includes('Bitterless_PREVIEW')), 'and not the other way round either')

  // ② **那个 bug 本身**:目标是 pi 造出来的 `{}` 空壳,旧库里有凭据 ⇒ 必须补上。
  write(authFile, {})
  write(legacyFile, { 'openai-codex': cred('legacy') })
  const merged = mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) })
  assert(JSON.stringify(merged) === JSON.stringify(['openai-codex']), `an empty shell must be filled from the retired store, got ${JSON.stringify(merged)}`)
  assert(read(authFile)['openai-codex'].accountId === 'legacy', 'the credential must actually land in the file the turn reads')
  // 凭据文件不该被顺手放宽权限。
  assert((statSync(authFile).mode & 0o777) === 0o600, `the merged auth file must stay 0600, got ${(statSync(authFile).mode & 0o777).toString(8)}`)
  // ③ 幂等:第二次什么都不做。
  assert(mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) }).length === 0, 'a second merge must be a no-op')

  // ③ 目标优先:已有的 provider 绝不被旧库覆盖(旧库那份可能是另一个账号、也可能更旧)。
  write(authFile, { 'openai-codex': cred('current') })
  write(legacyFile, { 'openai-codex': cred('legacy') })
  assert(mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) }).length === 0, 'target must win per provider')
  assert(read(authFile)['openai-codex'].accountId === 'current', 'the retired store must never overwrite a live credential')

  // 多 provider:只补缺的那个,别的原样。
  write(authFile, { anthropic: cred('claude') })
  write(legacyFile, { anthropic: cred('old-claude'), 'openai-codex': cred('legacy') })
  const partial = mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) })
  assert(JSON.stringify(partial) === JSON.stringify(['openai-codex']), `only the missing provider may be merged, got ${JSON.stringify(partial)}`)
  assert(read(authFile).anthropic.accountId === 'claude', 'an existing provider must be untouched')

  // ④ 退出登录 → 两个库都清;而且**合并不能把它复活**(cowork 踩过这个坑)。
  write(authFile, { 'openai-codex': cred('current'), anthropic: cred('claude') })
  write(legacyFile, { 'openai-codex': cred('legacy') })
  const cleared = clearAuthProvider({ provider: 'openai-codex', authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) })
  assert(cleared.length === 2, `logout must clear BOTH stores, cleared ${cleared.length}`)
  assert(!('openai-codex' in read(authFile)) && !('openai-codex' in read(legacyFile)), 'the provider must be gone from both')
  assert('anthropic' in read(authFile), 'logout must not touch another provider')
  assert(mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) }).length === 0, 'a logged-out provider must NOT be resurrected by the merge')

  // 坏文件不能挡住任何一半。
  write(authFile, {})
  mkdirSync(dirname(legacyFile), { recursive: true })
  writeFileSync(legacyFile, '{ not json')
  assert(mergeAuthProviders({ authFile, legacyAuthFiles: legacyAuthFilesFor(authFile) }).length === 0, 'a corrupt retired store must degrade, not throw')
  assert(clearAuthProvider({ provider: 'openai-codex', authFile, legacyAuthFiles: [legacyFile] }).length === 0, 'a corrupt store must not block logout')

  // 身份读取:嵌套与扁平两种 claim 形状都要认,过期要看得出来,而且**永不带出 token**。
  const jwt = (payload) => ['h', Buffer.from(JSON.stringify(payload)).toString('base64url'), 's'].join('.')
  const nested = describeCredentialIdentity({
    type: 'oauth',
    access: jwt({ 'https://api.openai.com/profile': { email: 'a@b.com' }, 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }),
    expires: 4_000_000_000_000
  }, 1_000_000_000_000)
  assert(nested.account === 'a@b.com' && nested.plan === 'pro' && nested.expired === false, `nested claims must be read, got ${JSON.stringify(nested)}`)
  const flat = describeCredentialIdentity({ type: 'oauth', access: jwt({ 'https://api.openai.com/profile.email': 'c@d.com' }), expires: 1 }, 1_000_000_000_000)
  assert(flat.account === 'c@d.com' && flat.expired === true, `flat claims + expiry must be read, got ${JSON.stringify(flat)}`)
  // 运行期同一条纪律:给一个能认出来的 token,返回值里一个字节都不许出现它。
  const marked = describeCredentialIdentity({
    type: 'oauth',
    access: jwt({ 'https://api.openai.com/profile': { email: 'e@f.com' } }),
    refresh: 'REFRESH-SECRET-MARKER',
    expires: 4_000_000_000_000
  })
  const dumped = JSON.stringify(marked)
  assert(!dumped.includes('REFRESH-SECRET-MARKER'), 'the identity must not carry the refresh token')
  assert(!dumped.includes('eyJ') && !dumped.includes('.'.repeat(0) + 'h.'), 'the identity must not carry the access token')
  assert(marked.account === 'e@f.com', 'and it must still read the account')
  for (const junk of [null, undefined, 'string', [], { type: 'oauth', access: 'not-a-jwt' }, { type: 'oauth', access: 'h.!!!.s' }]) {
    const out = describeCredentialIdentity(junk)
    assert(out && typeof out === 'object', `a malformed credential must degrade to an object, got ${JSON.stringify(out)}`)
  }
  assert(formatCredentialIdentity({}) === '', 'no readable identity must render as an empty string, not "undefined"')
  assert(/EXPIRED at/.test(formatCredentialIdentity(flat)), 'an expired credential must say so in one line')

  // ---------------- 诊断的四条分支:**逐条真跑**。
  // 最要紧的是"凭据其实在另一个库里"这一句 —— 它是 2026-09-10 那次的全部信息量,而按源码 grep
  // 抓不到"某一支忘了带出处"(第一版守卫就漏了这个变异,所以这里改成真跑)。
  const jwtCred = (email, expires) => ({
    type: 'oauth',
    access: ['h', Buffer.from(JSON.stringify({ 'https://api.openai.com/profile': { email } })).toString('base64url'), 's'].join('.'),
    refresh: 'r',
    expires
  })

  // ① 目标是 `{}` 空壳,旧库有 ⇒ 必须点出旧库那条路径,并带上账号。
  write(authFile, {})
  write(legacyFile, { 'openai-codex': jwtCred('shell@x.com', 4_000_000_000_000) })
  const shellText = describeAuthFile(authFile, 'openai-codex')
  assert(/has no provider credentials/.test(shellText), 'the empty-shell branch must still say what it sees')
  assert(shellText.includes(legacyFile), `the empty-shell diagnostic must name the store that holds the credential:\n${shellText}`)
  assert(/shell@x\.com/.test(shellText), 'and the account inside it')

  // ② 目标有别的 provider、没有这个 ⇒ 同样要点出旧库。
  write(authFile, { anthropic: jwtCred('claude@x.com', 4_000_000_000_000) })
  const missingText = describeAuthFile(authFile, 'openai-codex')
  assert(/is missing provider "openai-codex"/.test(missingText), 'the missing-provider branch must name the provider')
  assert(missingText.includes(legacyFile), `the missing-provider diagnostic must name the retired store:\n${missingText}`)

  // ③ 凭据就在这里 ⇒ 说出账号与过期时间(过期那句是"界面说已连接却跑不了"唯一的线索)。
  write(authFile, { 'openai-codex': jwtCred('live@x.com', 1) })
  const presentText = describeAuthFile(authFile, 'openai-codex')
  assert(/live@x\.com/.test(presentText), `the present-credential diagnostic must name the account:\n${presentText}`)
  assert(/EXPIRED at/.test(presentText), 'and say it expired when it did')
  assert(!presentText.includes(legacyFile), 'and NOT point elsewhere when the credential is right here')

  // ④ 两边都没有 ⇒ 不许凭空声称别处有。
  write(authFile, {})
  write(legacyFile, {})
  const noneText = describeAuthFile(authFile, 'openai-codex')
  assert(!/DOES exist/.test(noneText), `with no credential anywhere the diagnostic must not claim one exists:\n${noneText}`)

  // 文件不存在也要能说出旧库有 —— 全新 edition 首次启动就是这个形状。
  rmSync(authFile, { force: true })
  write(legacyFile, { 'openai-codex': jwtCred('fresh@x.com', 4_000_000_000_000) })
  const absentText = describeAuthFile(authFile, 'openai-codex')
  assert(/does not exist/.test(absentText) && absentText.includes(legacyFile), `a missing target must still point at the retired store:\n${absentText}`)

  // ---------------- 代理设置那条回归:**真跑一次**。
  // 判据不是"路径对不对",而是"指到 pi 的 settings.json 上会发生什么" —— 答案是整条鉴权链一起挂,
  // 而症状(界面显示未登录 + Login 无反应)看起来完全像凭据问题,与真正的原因隔着两层。
  const { CodexProxyService, parseCodexProxySettings } = loadTsModule('@main/codex/codexProxy.service')
  const proxyService = () =>
    new CodexProxyService({
      createDispatcher: () => ({}),
      configureDispatcher: () => undefined,
      logger: { info: () => undefined, error: () => undefined }
    })
  // pi 自己的 settings(compaction / steeringMode)→ 精确匹配的解析器必然拒绝。
  let threw = false
  try {
    parseCodexProxySettings({ compaction: { enabled: true }, steeringMode: 'one-at-a-time' })
  } catch {
    threw = true
  }
  assert(threw, 'pi’s own settings shape must be rejected by the proxy parser — that is why the two files cannot be one')
  // 而"文件不存在"是安全的(ENOENT → not-configured),所以搬到一个 pi 会写的文件上恰好是最坏的选择。
  const piShaped = join(userData, '.pi', 'settings.json')
  write(piShaped, { compaction: { enabled: true }, steeringMode: 'one-at-a-time' })
  let rejected = false
  await proxyService().ensure(piShaped).catch(() => { rejected = true })
  assert(rejected, 'pointing the proxy at pi’s settings.json must reject — the guard exists to keep that from shipping')
  const missing = join(userData, 'cowork', 'pi', 'settings.json')
  rmSync(missing, { force: true })
  let resolvedWhenMissing = true
  await proxyService().ensure(missing).catch(() => { resolvedWhenMissing = false })
  assert(resolvedWhenMissing, 'a MISSING proxy settings file must be safe (ENOENT → not-configured)')

  console.log(`[check-codex-auth-store] ok ${JSON.stringify({ siblings: legacyAuthFilesFor(authFile).length, merged: merged.length, cleared: cleared.length })}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
