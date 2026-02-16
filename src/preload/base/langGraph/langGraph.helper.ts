import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessageChunk } from '@langchain/core/messages';

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const createModel = (): ChatOpenAI => {
  return new ChatOpenAI({
    model: 'openai/gpt-4.1-mini',
    temperature: 0.7,
    streaming: true,
    apiKey: process.env.VITE_OPENROUTER_API_KEY || '',
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://bitterless.app',
        'X-Title': 'BitterLess',
      },
    },
  });
};

const buildGraph = () => {
  const model = createModel();

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('callModel', callModel)
    .addEdge(START, 'callModel')
    .addEdge('callModel', END)
    .compile();

  return graph;
};

const toMessages = (inputs: ChatMessageInput[]) => {
  return inputs.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessageChunk(m.content);
    return new HumanMessage(m.content);
  });
};

export const streamChat = async (
  messages: ChatMessageInput[],
  onChunk: (token: string) => void,
): Promise<string> => {
  const graph = buildGraph();
  let fullContent = '';

  const stream = await graph.stream(
    { messages: toMessages(messages) },
    { streamMode: 'messages' },
  );

  for await (const [messageChunk] of stream) {
    const content = typeof messageChunk.content === 'string' ? messageChunk.content : '';
    if (content) {
      fullContent += content;
      onChunk(content);
    }
  }

  return fullContent;
};
