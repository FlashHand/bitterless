import { maestroAuthPath } from '@maestro-main/llm/llmPaths';
import { app } from 'electron';
import { codexModelsPath, codexSettingsPath } from './codexPaths';
import { ensureCodexProxyDispatcher } from './codexProxy.service';
import {
  CodexRuntimeService,
  type CodexRuntimePiModule,
} from './codexRuntime.service';

const loadPiModule = async (): Promise<CodexRuntimePiModule> => {
  await ensureCodexProxyDispatcher(codexSettingsPath(app.getPath('userData')));
  return (await import('@earendil-works/pi-coding-agent')) as unknown as CodexRuntimePiModule;
};

export const codexRuntimeService = new CodexRuntimeService({
  // **走 `maestroAuthPath()` 而不是 `codexAuthPath()`** —— 两者返回同一个路径,但前者会在返回前跑一次
  // 逐 provider 的前向合并。状态检查与登录都在这条路上,而它们通常**先于**任何 agent 回合发生:
  // 只用裸路径的话,凭据只在退役库里的用户会一直看到"未登录",直到某次回合恰好调了 `maestroAuthPath()`。
  authPath: () => maestroAuthPath(),
  modelsPath: () => codexModelsPath(app.getPath('userData')),
  loadPiModule,
});
