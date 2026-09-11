import { shell } from 'electron'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import { createServer } from 'node:http'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { CoachSettings } from '@maestro-shared/coach.api'
import type { ConfigApi } from '@maestro-shared/config.api'
import { LLM_COMPRESSION_REMAINING_KEY, LLM_CONFIG_DOMAIN, LLM_TARGET_KEY } from '@maestro-shared/config.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import type { LlmConfig, LlmEffort, LlmProviderState, LlmTarget } from '@maestro-shared/coach.api'
import {
  DEFAULT_COMPRESSION_REMAINING_PERCENT,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_PRESET_MODEL,
  LLM_PRESETS,
  LLM_PROVIDERS,
  applyCompressionPrefs,
  applyResolvedContextWindows,
  firstPresetForProvider,
  modelPresetKey,
  normalizeCompressionRemainingPercent,
  normalizeLlmProvider,
  normalizeLlmTarget,
  normalizeSelectableLlmTarget,
  parseStoredLlmCompressionPrefs,
  parseStoredLlmTarget,
  providerLabel,
  requireSelectableLlmProvider,
  requireSelectableLlmTarget,
  resolveLoginMethod,
  selectableLlmLoginProviders,
  selectableLlmPresets,
  type LlmCompressionPrefs,
  type LlmStoredTarget
} from './llmModels'
import { PiRuntimeAdapter } from '@main/agent/runtime/piRuntimeAdapter'
import { maestroAgentDir, maestroAuthPath, maestroModelsPath } from './llmPaths'
import { syncPiCompactionSettings } from './piCompactionSettings.service'
import { codexCredentialService } from '../../codex/codexCredential.runtime'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

interface PiAuthStorage {
  login: (
    provider: string,
    callbacks: {
      onSelect: () => Promise<string>
      onAuth: (params: { url: string }) => void
      onManualCodeInput: () => Promise<string>
      onDeviceCode: (params: { userCode: string; verificationUri: string }) => void
      onPrompt: () => Promise<string>
      onProgress: (message: string) => void
    }
  ) => Promise<unknown>
  logout: (provider: string) => void
}

interface PiModelRuntime {
  getModel: (provider: string, model: string) => unknown | undefined
  hasConfiguredAuth: (provider: string) => boolean
  login: (
    provider: string,
    type: 'oauth',
    interaction: {
      signal?: AbortSignal
      prompt: (prompt: { type: 'text' | 'secret' | 'select' | 'manual_code'; signal?: AbortSignal }) => Promise<string>
      notify: (event: {
        type: 'info' | 'auth_url' | 'device_code' | 'progress'
        message?: string
        url?: string
        userCode?: string
        verificationUri?: string
      }) => void
    }
  ) => Promise<unknown>
  logout: (provider: string) => Promise<void>
}

interface PiModelRegistry {
  find: (provider: string, model: string) => unknown
  hasConfiguredAuth: (model: unknown) => boolean
  refresh?: () => Promise<void>
}

interface PiLegacyModelRegistryFactory {
  create: (authStorage: PiAuthStorage, modelsPath?: string) => PiModelRegistry
}

interface PiModernModelRegistryFactory {
  new (modelRuntime: PiModelRuntime): PiModelRegistry
}

interface PiAuthModule {
  AuthStorage: { create: (path: string) => PiAuthStorage }
  ModelRuntime?: { create: (options?: { authPath?: string; modelsPath?: string | null }) => Promise<PiModelRuntime> }
  ModelRegistry: PiLegacyModelRegistryFactory | PiModernModelRegistryFactory
}

const loadPiAuthModule = async (): Promise<PiAuthModule> =>
  (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule

const createPiModelRuntime = async (pi: PiAuthModule): Promise<PiModelRuntime | null> =>
  pi.ModelRuntime?.create ? await pi.ModelRuntime.create({ authPath: maestroAuthPath(), modelsPath: maestroModelsPath() }) : null

const createPiModelRegistry = async (pi: PiAuthModule): Promise<{ modelRuntime?: PiModelRuntime; modelRegistry: PiModelRegistry }> => {
  const modelRuntime = await createPiModelRuntime(pi)
  if (modelRuntime) {
    const modelRegistry = new (pi.ModelRegistry as PiModernModelRegistryFactory)(modelRuntime)
    await modelRegistry.refresh?.()
    return { modelRuntime, modelRegistry }
  }
  const auth = pi.AuthStorage.create(maestroAuthPath())
  return {
    modelRegistry: (pi.ModelRegistry as PiLegacyModelRegistryFactory).create(auth, maestroModelsPath())
  }
}

export interface MaestroLlmServiceState {
  applyLlmTarget(provider: string, model: string, effort: LlmEffort): void
  getLlmRuntimeTarget(): LlmStoredTarget
  hasActiveAgentTurn(): boolean
  resetLlmTurnState(): void
  resetLlmAgentSessions(): void
  readMaestroSettings(): CoachSettings
  saveMaestroSettings(patch: Partial<CoachSettings>): CoachSettings
  emitTrace(e: TraceEvent): void
}

@injectable()
export class MaestroLlmService extends CommonService<MaestroLlmServiceState> {
  private activeLlmLoginProvider = ''
  private anthropicIpv6Server: ReturnType<typeof createServer> | null = null
  private anthropicCaptureResolve: ((url: string) => void) | null = null

  private async readStoredLlmTarget(): Promise<LlmStoredTarget> {
    const fallback = this._state.readMaestroSettings()
    const fromDb = await configStore.get({ domain: LLM_CONFIG_DOMAIN, key: LLM_TARGET_KEY }).catch(() => null)
    const parsed = parseStoredLlmTarget(fromDb?.options)
    return normalizeSelectableLlmTarget(parsed || { provider: fallback.llmProvider, model: fallback.llmModel, effort: fallback.llmEffort })
  }

  private async writeStoredLlmTarget(target: LlmStoredTarget): Promise<void> {
    await configStore.upsert({ domain: LLM_CONFIG_DOMAIN, key: LLM_TARGET_KEY, options: target }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'save LLM config: ' + (err as Error).message, ts: Date.now() })
    })
    this._state.saveMaestroSettings({ llmProvider: target.provider, llmModel: target.model, llmEffort: target.effort })
  }

  private async readStoredLlmCompressionPrefs(): Promise<LlmCompressionPrefs> {
    const fromDb = await configStore.get({ domain: LLM_CONFIG_DOMAIN, key: LLM_COMPRESSION_REMAINING_KEY }).catch(() => null)
    return parseStoredLlmCompressionPrefs(fromDb?.options)
  }

  private async writeStoredLlmCompressionPrefs(prefs: LlmCompressionPrefs): Promise<void> {
    await configStore.upsert({ domain: LLM_CONFIG_DOMAIN, key: LLM_COMPRESSION_REMAINING_KEY, options: prefs }).catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'save LLM compression config: ' + (err as Error).message, ts: Date.now() })
    })
  }

  private async checkLlmProviderReady(provider: string, model: string): Promise<boolean> {
    if (provider === 'openai-codex') {
      return (await codexCredentialService.getStatus()).connected
    }
    try {
      const pi = await loadPiAuthModule()
      const { modelRuntime, modelRegistry } = await createPiModelRegistry(pi)
      if (modelRuntime) {
        const found = modelRuntime.getModel(provider, model)
        return Boolean(found && modelRuntime.hasConfiguredAuth(provider))
      }
      const found = modelRegistry.find(provider, model)
      return Boolean(found && modelRegistry.hasConfiguredAuth(found))
    } catch {
      return false
    }
  }

  private async buildLlmProviderStates(activeProvider: string): Promise<LlmProviderState[]> {
    const out: LlmProviderState[] = []
    for (const provider of LLM_PROVIDERS) {
      const preset = firstPresetForProvider(provider.provider)
      const ready = await this.checkLlmProviderReady(provider.provider, preset?.model || '')
      out.push({
        provider: provider.provider,
        label: provider.label,
        authLabel: provider.authLabel,
        ready,
        active: provider.provider === activeProvider,
        hint: ready ? undefined : provider.hint
      })
    }
    return out
  }

  private async getAndBroadcastLlmConfig(): Promise<LlmConfig> {
    const cfg = await this.getLlmConfig()
    xpcMain.broadcast('coach/llm-config', cfg)
    return cfg
  }

  private broadcastLlmLoginState(provider: string, loading: boolean): void {
    this.activeLlmLoginProvider = loading ? provider : ''
    xpcMain.broadcast('coach/llm-login-state', { provider, loading, ts: Date.now() })
  }

  async getLlmConfig(): Promise<LlmConfig> {
    const target = await this.readStoredLlmTarget()
    const active = this._state.getLlmRuntimeTarget()
    if (active.provider !== target.provider || active.model !== target.model || active.effort !== target.effort) {
      this._state.applyLlmTarget(target.provider, target.model, target.effort)
    }
    const providers = await this.buildLlmProviderStates(target.provider)
    const selectedProvider = providers.find((item) => item.provider === target.provider)
    const ready = Boolean(selectedProvider?.ready)
    const { presets, windows } = await this.withResolvedContextWindows(
      applyCompressionPrefs(selectableLlmPresets(), await this.readStoredLlmCompressionPrefs())
    )
    this.syncPiCompaction(target, presets, windows)
    return {
      provider: target.provider,
      model: target.model,
      effort: target.effort,
      ready,
      hint: ready ? undefined : selectedProvider?.hint,
      providers,
      presets,
      loginProviders: selectableLlmLoginProviders()
    }
  }

  /**
   * 把预设里**手写**的 `contextLengthK` 换成 pi 目录里的真实窗口。
   *
   * 手写值与 pi 实际用的窗口没有任何同步机制 —— 而压缩的触发线、reserve 预算、summary 上限
   * 全都乘在它上面。1M 的模型被当 256K 会提前压;200K 的被当 1M,压缩**永远不触发直到溢出**。
   *
   * 解析失败(目录读不到、未登录、provider 不认识)**不阻断配置** —— 整批退回 256K 兜底,
   * 并留一条日志。配置面板打不开比窗口不准严重得多。
   */
  private async withResolvedContextWindows(
    presets: LlmTarget[]
  ): Promise<{ presets: LlmTarget[]; windows: Record<string, number> }> {
    try {
      const windows = await new PiRuntimeAdapter().describeContextWindows({
        authPath: maestroAuthPath(),
        modelsPath: maestroModelsPath(),
        targets: presets.map((preset) => ({ providerId: preset.provider, modelId: preset.model }))
      })
      return { presets: applyResolvedContextWindows(presets, windows), windows }
    } catch (err) {
      console.warn('[llm] 解析上下文窗口失败,整批退 256K:', err instanceof Error ? err.message : err)
      return { presets: applyResolvedContextWindows(presets, {}), windows: {} }
    }
  }

  /**
   * 把选中模型的压缩参数同步进 `<agentDir>/settings.json`,让 **pi 自带的** auto-compaction
   * 与我们自己那条触发线用同一个比例。
   *
   * 为什么挂在取配置这条路上而不是单独一个监听:`getLlmConfig()` 是**换模型、改余量百分比、
   * 启动**三件事的共同下游(改动都经 `getAndBroadcastLlmConfig()` 回到这里),挂一处就全覆盖。
   * 写盘只在值真变时发生,所以这条路被频繁调用也不产生噪音。
   *
   * **用精确 token 数,不用 `contextLengthK`** —— 那个字段是给人看的、四舍五入到 K 的
   * (272,000 → 266K → 反推回来是 272,384),拿它算触发线等于凭空给自己引入 384 token 的偏差。
   *
   * 解析不到窗口就退 `DEFAULT_CONTEXT_WINDOW_TOKENS`,与 `applyResolvedContextWindows` 同一口径。
   */
  private syncPiCompaction(target: LlmStoredTarget, presets: LlmTarget[], windows: Record<string, number>): void {
    const selected = presets.find((item) => item.provider === target.provider && item.model === target.model)
    const result = syncPiCompactionSettings({
      agentDir: maestroAgentDir(),
      contextWindowTokens: windows[modelPresetKey(target.provider, target.model)] || DEFAULT_CONTEXT_WINDOW_TOKENS,
      remainingPercent: selected?.compressionRemainingPercent ?? DEFAULT_COMPRESSION_REMAINING_PERCENT
    })
    if (result.error) {
      console.warn('[llm] pi 压缩参数写入失败,pi 侧退回其固定缺省 16384:', result.error)
    } else if (result.written) {
      console.log(
        `[llm] pi compaction -> reserve ${result.reserveTokens} / keepRecent ${result.keepRecentTokens} (${result.path})`
      )
    }
  }

  async setLlmConfig(params: { provider: string; model: string; effort?: LlmEffort }): Promise<LlmConfig> {
    if (this._state.hasActiveAgentTurn()) {
      throw new Error('The model cannot be changed while a Maestro turn is active.')
    }
    const target = requireSelectableLlmTarget(params)
    await this.writeStoredLlmTarget(target)
    this._state.applyLlmTarget(target.provider, target.model, target.effort)
    this._state.resetLlmTurnState()
    this._state.emitTrace({ kind: 'info', msg: `LLM backend -> ${target.provider}/${target.model}/${target.effort} (conversations reset)`, ts: Date.now() })
    return await this.getAndBroadcastLlmConfig()
  }

  async setLlmCompression(params: { provider: string; model: string; compressionRemainingPercent: number }): Promise<LlmConfig> {
    const provider = normalizeLlmProvider(params.provider || '')
    const model = String(params.model || '').trim()
    const preset = LLM_PRESETS.find((item) => item.provider === provider && item.model === model)
    if (!preset) return await this.getAndBroadcastLlmConfig()

    const prefs = await this.readStoredLlmCompressionPrefs()
    prefs[modelPresetKey(preset.provider, preset.model)] = normalizeCompressionRemainingPercent(params.compressionRemainingPercent)
    await this.writeStoredLlmCompressionPrefs(prefs)
    return await this.getAndBroadcastLlmConfig()
  }

  private ensureAnthropicIpv6Server(): void {
    if (this.anthropicIpv6Server) return
    const server = createServer((req, res) => {
      if ((req.url || '').startsWith('/callback')) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end('<html><body>Claude sign-in complete - you can close this tab.</body></html>')
        this.anthropicCaptureResolve?.('http://localhost:53692' + (req.url || ''))
      } else {
        res.statusCode = 404
        res.end()
      }
    })
    server.on('error', (err) => {
      this._state.emitTrace({ kind: 'info', msg: 'claude login (ipv6 callback unavailable): ' + err.message, ts: Date.now() })
      this.anthropicIpv6Server = null
    })
    server.listen(53692, '::1')
    this.anthropicIpv6Server = server
  }

  async loginLlm(params: { provider?: string; method?: string }): Promise<LlmConfig> {
    const active = this._state.getLlmRuntimeTarget()
    const provider = requireSelectableLlmProvider(
      params?.provider || active.provider || 'openai-codex'
    )
    if (this.activeLlmLoginProvider) return await this.getLlmConfig()
    this.broadcastLlmLoginState(provider, true)
    try {
      return await this.performLlmLogin(provider, params?.method)
    } finally {
      this.broadcastLlmLoginState(provider, false)
    }
  }

  private async performLlmLogin(provider: string, requestedMethod?: string): Promise<LlmConfig> {
    const method = resolveLoginMethod(provider, requestedMethod)
    const active = this._state.getLlmRuntimeTarget()
    const target = normalizeLlmTarget({
      provider,
      model: active.provider === provider ? active.model : DEFAULT_PRESET_MODEL[provider],
      effort: active.provider === provider ? active.effort : undefined
    })
    await this.writeStoredLlmTarget(target)
    this._state.applyLlmTarget(target.provider, target.model, target.effort)
    try {
      if (provider === 'openai-codex') {
        await codexCredentialService.connect({
          method,
          onDeviceCode: (info) => {
            this._state.emitTrace({ kind: 'info', msg: `codex device login: enter code ${info.userCode} at ${info.verificationHost}`, ts: Date.now() })
            xpcMain.broadcast('coach/codex-device', {
              userCode: info.userCode,
              verificationUri: `https://${info.verificationHost}/codex/device`
            })
          },
          onProgress: (message) => this._state.emitTrace({ kind: 'info', msg: `OpenAI Codex (ChatGPT) login: ${message}`, ts: Date.now() })
        })
        xpcMain.broadcast('coach/codex-device', null)
        return await this.getAndBroadcastLlmConfig()
      }
      mkdirSync(dirname(maestroAuthPath()), { recursive: true })
      const pi = await loadPiAuthModule()
      let captureResolve: ((url: string) => void) | undefined
      const captured = new Promise<string>((resolve) => {
        captureResolve = resolve
      })
      if (method === 'browser') {
        this.ensureAnthropicIpv6Server()
        this.anthropicCaptureResolve = captureResolve ?? null
      }
      const timeoutMs = method === 'device_code' ? 16 * 60_000 : 180_000
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('sign-in timed out — authorization did not complete')), timeoutMs)
      })
      try {
        const modelRuntime = await createPiModelRuntime(pi)
        const manualCodeInput = async (): Promise<string> => await captured
        if (modelRuntime) {
          await Promise.race([
            modelRuntime.login(provider, 'oauth', {
              signal: AbortSignal.timeout(timeoutMs),
              prompt: async (prompt) => {
                if (prompt.type === 'select') return method
                if (prompt.type === 'manual_code') return await manualCodeInput()
                return await new Promise<string>(() => {})
              },
              notify: (event) => {
                if (event.type === 'auth_url' && event.url) void shell.openExternal(event.url)
                if (event.type === 'device_code' && event.verificationUri) {
                  void shell.openExternal(event.verificationUri)
                  this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} device login: enter code ${event.userCode || ''} at ${event.verificationUri}`, ts: Date.now() })
                  xpcMain.broadcast('coach/codex-device', { userCode: event.userCode || '', verificationUri: event.verificationUri })
                }
                if ((event.type === 'progress' || event.type === 'info') && event.message) {
                  this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} login: ${event.message}`, ts: Date.now() })
                }
              }
            }),
            timeout
          ])
        } else {
          const auth = pi.AuthStorage.create(maestroAuthPath())
          await Promise.race([
            auth.login(provider, {
              onSelect: async () => method,
              onAuth: ({ url }: { url: string }) => {
                void shell.openExternal(url)
              },
              onManualCodeInput: manualCodeInput,
              onDeviceCode: (info: { userCode: string; verificationUri: string }) => {
                void shell.openExternal(info.verificationUri)
                this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} device login: enter code ${info.userCode} at ${info.verificationUri}`, ts: Date.now() })
                xpcMain.broadcast('coach/codex-device', { userCode: info.userCode, verificationUri: info.verificationUri })
              },
              onPrompt: () => new Promise<string>(() => {}),
              onProgress: (m: string) => this._state.emitTrace({ kind: 'info', msg: `${providerLabel(provider)} login: ${m}`, ts: Date.now() })
            }),
            timeout
          ])
        }
      } finally {
        if (timer) clearTimeout(timer)
        this.anthropicCaptureResolve = null
      }
    } catch (err) {
      const e = err as Error
      const msg = e?.message || String(err)
      this._state.emitTrace({ kind: 'error', msg: providerLabel(provider) + ' login failed: ' + msg + (e?.stack ? '\n' + e.stack : ''), ts: Date.now() })
      const cfg = await this.getLlmConfig()
      xpcMain.broadcast('coach/codex-device', null)
      const next = { ...cfg, ready: false, hint: 'Sign-in failed: ' + msg }
      xpcMain.broadcast('coach/llm-config', next)
      return next
    }
    xpcMain.broadcast('coach/codex-device', null)
    return await this.getAndBroadcastLlmConfig()
  }

  async loginCodex(params: { method?: string }): Promise<LlmConfig> {
    return await this.loginLlm({ provider: 'openai-codex', method: params?.method })
  }

  async logoutLlm(params?: { provider?: string }): Promise<LlmConfig> {
    const active = this._state.getLlmRuntimeTarget()
    const provider = requireSelectableLlmProvider(
      params?.provider || active.provider || 'openai-codex'
    )
    try {
      if (provider === 'openai-codex') {
        await codexCredentialService.disconnect()
      } else {
        const pi = await loadPiAuthModule()
        const modelRuntime = await createPiModelRuntime(pi)
        if (modelRuntime) {
          await modelRuntime.logout(provider)
        } else {
          pi.AuthStorage.create(maestroAuthPath()).logout(provider)
        }
      }
    } catch (err) {
      this._state.emitTrace({ kind: 'error', msg: providerLabel(provider) + ' logout failed: ' + (err as Error).message, ts: Date.now() })
    }
    this._state.resetLlmAgentSessions()
    const cfg = await this.getLlmConfig()
    const next = { ...cfg, ready: false, hint: undefined }
    xpcMain.broadcast('coach/llm-config', next)
    return next
  }

  async logoutCodex(): Promise<LlmConfig> {
    return await this.logoutLlm({ provider: 'openai-codex' })
  }
}
