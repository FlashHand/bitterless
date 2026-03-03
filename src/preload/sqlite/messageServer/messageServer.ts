import { messageDao } from '../dao/message.dao';
import { settingDao } from '../dao/setting.dao';
import { langGraphHelper } from '../../base/langGraph/langGraph.helper';
import type { ChatMessageInput, ModelConfig } from '../../base/langGraph/langGraph.helper';
import type { ProxyConfig } from '../../base/langGraph/model.adaptor';
import { xpcRenderer } from 'electron-xpc/preload';
import moment from 'moment';

interface ProxySetting {
  switch: boolean;
  ip: string;
  port: string;
}

const getProxyConfig = async (): Promise<ProxyConfig | undefined> => {
  const proxySetting = await settingDao.get<ProxySetting>({ key: 'PROXY' });
  if (proxySetting?.switch && proxySetting.ip && proxySetting.port) {
    return { ip: proxySetting.ip, port: proxySetting.port };
  }
  return undefined;
};

let isStopped = false;

export const initMessageServer = (): void => {
  xpcRenderer.handle('chat/stop', async () => {
    isStopped = true;
    return 'ok';
  });

  xpcRenderer.handle('chat/send', async (payload) => {

    const { sessionId, content } = payload.params || {};
    if (!sessionId || !content) {
      console.error('[messageServer] missing sessionId or content');
      return null;
    }

    // console.log('[messageServer] received chat/send:', sessionId);
    // await messageDao.insert({ sessionId, role: 'user', content });
    // const testContent = `${moment().valueOf()}`;
    // xpcRenderer.send('chat/stream/chunk', { sessionId, chunk:testContent });
    // let fc = `${moment().valueOf()}`;
    // xpcRenderer.send('chat/stream/done', { sessionId, content: testContent });
    // await messageDao.insert({ sessionId, role: 'assistant', content: fc });
    //
    // return null;
    // 1. Save user message to SQLite immediately

    // 2. Build message history for LangGraph
    const rows = await messageDao.getHistoryBySessionId({ sessionId });
    const messages: ChatMessageInput[] = rows.map((r) => ({
      role: r.role as ChatMessageInput['role'],
      content: r.content as string,
    }));

    // 3. Stream response back to home renderer
    try {
      const llmConfig = await settingDao.get<ModelConfig>({ key: 'LLM' });
      if (!llmConfig?.provider || !llmConfig?.model || !llmConfig?.apiKey) {
        console.error('[messageServer] LLM config not set');
        xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: 'LLM config not set' });
        return null;
      }

      const proxy = await getProxyConfig();
      isStopped = false;

      const fullContent = await langGraphHelper.streamChat(messages, {
        onChunk: (chunk) => {
          if (isStopped) throw new Error('AbortError');
          xpcRenderer.send('chat/stream/chunk', { sessionId, chunk });
        },
        config: { ...llmConfig as ModelConfig, ...(proxy ? { proxy } : {}) },
      });

      await messageDao.insert({ sessionId, role: 'assistant', content: fullContent });
      xpcRenderer.send('chat/stream/done', { sessionId, content: fullContent });
    } catch (err: any) {
      if (err.message === 'AbortError' || isStopped) {
        xpcRenderer.send('chat/stream/done', { sessionId, content: '' });
      } else {
        console.error('[messageServer] streamChat error:', err.message);
        xpcRenderer.send('chat/stream/done', { sessionId, content: '', error: err.message });
      }
    }

    return 'ok';
  });

  console.log('[messageServer] initialized');
};
