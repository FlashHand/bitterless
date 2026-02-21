import { messageDao } from '../dao/message.dao';
import { settingDao } from '../dao/setting.dao';
import { langGraphHelper } from '../../base/langGraph/langGraph.helper';
import type { ChatMessageInput, ModelConfig } from '../../base/langGraph/langGraph.helper';
import type { ProxyConfig } from '../../base/langGraph/model.adaptor';
import { xpcRenderer } from 'electron-xpc/preload';

interface ProxySetting {
  switch: boolean;
  ip: string;
  port: string;
}

const getProxyConfig = (): ProxyConfig | undefined => {
  const proxySetting = settingDao.get<ProxySetting>({ key: 'PROXY' });
  if (proxySetting?.switch && proxySetting.ip && proxySetting.port) {
    return { ip: proxySetting.ip, port: proxySetting.port };
  }
  return undefined;
};

export const initMessageServer = (): void => {
  xpcRenderer.handle('chat/send', async (payload) => {
    const { sessionId, content } = payload.params || {};
    if (!sessionId || !content) {
      console.error('[messageServer] missing sessionId or content');
      return null;
    }

    console.log('[messageServer] received chat/send:', sessionId);

    // 1. Save user message to SQLite immediately
    messageDao.insert({ sessionId, role: 'user', content });

    // 2. Build message history for LangGraph
    const rows = messageDao.getHistoryBySessionId({ sessionId });
    const messages: ChatMessageInput[] = rows.map((r) => ({
      role: r.role as ChatMessageInput['role'],
      content: r.content as string,
    }));

    // 3. Stream response back to home renderer
    try {
      const llmConfig = settingDao.get<ModelConfig>({ key: 'LLM' });
      if (!llmConfig?.provider || !llmConfig?.model || !llmConfig?.apiKey) {
        console.error('[messageServer] LLM config not set');
        xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: 'LLM config not set' });
        return null;
      }

      const proxy = getProxyConfig();
      const fullContent = await langGraphHelper.streamChat(messages, {
        onChunk: (chunk) => xpcRenderer.send('chat/stream/chunk', { sessionId, chunk }),
        config: { ...llmConfig, ...(proxy ? { proxy } : {}) },
      });

      // 4. Save assistant message to SQLite
      messageDao.insert({ sessionId, role: 'assistant', content: fullContent });

      // 5. Notify home renderer stream is done
      xpcRenderer.send('chat/stream/done', { sessionId, content: fullContent });
    } catch (err: any) {
      console.error('[messageServer] streamChat error:', err.message);
      xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: err.message });
    }

    return 'ok';
  });

  console.log('[messageServer] initialized');
};
