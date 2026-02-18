import { messageDao } from '../dao/message.dao';
import { streamChat } from '../../base/langGraph/langGraph.helper';
import type { ChatMessageInput } from '../../base/langGraph/langGraph.helper';
import { xpcRenderer } from 'electron-buff/xpc/preload';

const QDRANT_URL = 'http://localhost:12833';
const QDRANT_API_KEY = '123456';
const QDRANT_COLLECTION = 'messages';

let vectorDim: number | null = null;

const getVectorDim = async (): Promise<number> => {
  if (vectorDim !== null) return vectorDim;
  try {
    const dim = await xpcRenderer.send('llama/embedding/dimension') as number;
    vectorDim = dim;
    return dim;
  } catch {
    vectorDim = 1024;
    return 1024;
  }
};

const getEmbeddingVector = async (text: string): Promise<number[]> => {
  try {
    const vector = await xpcRenderer.send('llama/embedding', { text });
    return vector as number[];
  } catch (err: any) {
    console.error('[messageServer] embedding failed, using zero vector:', err.message);
    const dim = await getVectorDim();
    return new Array(dim).fill(0);
  }
};

const ensureQdrantCollection = async (): Promise<void> => {
  const dim = await getVectorDim();
  try {
    const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
      headers: { 'api-key': QDRANT_API_KEY },
    });
    if (res.status === 404) {
      await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'api-key': QDRANT_API_KEY,
        },
        body: JSON.stringify({
          vectors: { size: dim, distance: 'Cosine' },
        }),
      });
      console.log('[messageServer] created qdrant collection:', QDRANT_COLLECTION);
    }
  } catch (err: any) {
    console.error('[messageServer] qdrant collection check failed:', err.message);
  }
};

interface QdrantSaveParams {
  id: number;
  conversationId: string;
  role: string;
  content: string;
  platform: string;
}

const saveMessageToQdrant = async (params: QdrantSaveParams): Promise<void> => {
  const { id, conversationId, role, content, platform } = params;
  try {
    await ensureQdrantCollection();
    const vector = await getEmbeddingVector(content);
    await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'api-key': QDRANT_API_KEY,
      },
      body: JSON.stringify({
        points: [
          {
            id,
            vector,
            payload: { conversation_id: conversationId, role, content, platform },
          },
        ],
      }),
    });
  } catch (err: any) {
    console.error('[messageServer] qdrant write failed:', err.message);
  }
};

export const initMessageServer = (): void => {
  xpcRenderer.handle('chat/send', async (payload) => {
    const { conversationId, content } = payload.params || {};
    if (!conversationId || !content) {
      console.error('[messageServer] missing conversationId or content');
      return null;
    }

    console.log('[messageServer] received chat/send:', conversationId);

    // 1. Save user message to SQLite immediately
    const userMsgId = messageDao.insert({ conversationId, role: 'user', content });
    saveMessageToQdrant({ id: userMsgId, conversationId, role: 'user', content, platform: 'bitterless' }).catch(() => {});

    // 2. Build message history for LangGraph
    const rows = messageDao.getHistoryByConversationId({ conversationId });
    const messages: ChatMessageInput[] = rows.map((r) => ({
      role: r.role as ChatMessageInput['role'],
      content: r.content as string,
    }));

    // 3. Stream response back to home renderer
    try {
      const fullContent = await streamChat(messages, (chunk) => {
        xpcRenderer.send('chat/stream/chunk', { conversationId, chunk });
      });

      // 4. Save assistant message to SQLite + Qdrant
      const assistantMsgId = messageDao.insert({ conversationId, role: 'assistant', content: fullContent });
      saveMessageToQdrant({ id: assistantMsgId, conversationId, role: 'assistant', content: fullContent, platform: 'bitterless' }).catch(() => {});

      // 5. Notify home renderer stream is done
      xpcRenderer.send('chat/stream/done', { conversationId, content: fullContent });
    } catch (err: any) {
      console.error('[messageServer] streamChat error:', err.message);
      xpcRenderer.send('chat/stream/done', { conversationId, content: '', error: err.message });
    }

    return 'ok';
  });

  console.log('[messageServer] initialized');
};
