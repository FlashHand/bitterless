import { app, shell } from 'electron';
import { createCodexBrowserCallbackCapture } from './codexCallbackCapture';
import {
  CodexCredentialService,
  type PiAuthModule,
} from './codexCredential.service';
import { clearMaestroAuthProvider, maestroAuthPath } from '@maestro-main/llm/llmPaths';
import { codexModelsPath, codexSettingsPath } from './codexPaths';
import { ensureCodexProxyDispatcher } from './codexProxy.service';

const loadPiAuthModule = async (): Promise<PiAuthModule> => {
  await ensureCodexProxyDispatcher(codexSettingsPath(app.getPath('userData')));
  return (await import('@earendil-works/pi-coding-agent')) as unknown as PiAuthModule;
};

export const codexCredentialService = new CodexCredentialService({
  // **走 `maestroAuthPath()` 而不是 `codexAuthPath()`** —— 两者返回同一个路径,但前者会在返回前跑一次
  // 逐 provider 的前向合并。状态检查与登录都在这条路上,而它们通常**先于**任何 agent 回合发生:
  // 只用裸路径的话,凭据只在退役库里的用户会一直看到"未登录",直到某次回合恰好调了 `maestroAuthPath()`。
  authPath: () => maestroAuthPath(),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  // 退出登录连退役库一起清,免得前向合并把凭据复活。
  clearLegacyCredential: (provider) => void clearMaestroAuthProvider(provider),
  loadPiAuthModule,
  openExternal: async (url) => await shell.openExternal(url),
  createBrowserCallbackCapture: async () =>
    await createCodexBrowserCallbackCapture({
      onUnavailable: (message) => {
        console.info('[codex auth] IPv6 callback capture unavailable:', message);
      }
    }),
});
