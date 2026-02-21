import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessageChunk } from '@langchain/core/messages';
import { createModel } from './model.adaptor';
import type { ModelConfig } from './model.adaptor';

export type { ModelConfig };

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant. Please provide clear, accurate, and concise responses to user questions.';

class LangGraphHelper {
  private currentConfig: ModelConfig | null = null;

  private buildGraph(config: ModelConfig) {
    const model = createModel(config);

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const response = await model.invoke(state.messages);
      return { messages: [response] };
    };

    return new StateGraph(MessagesAnnotation)
      .addNode('callModel', callModel)
      .addEdge(START, 'callModel')
      .addEdge('callModel', END)
      .compile();
  }

  private toMessages(inputs: ChatMessageInput[]) {
    return inputs.map((m) => {
      if (m.role === 'system') return new SystemMessage(m.content);
      if (m.role === 'assistant') return new AIMessageChunk(m.content);
      return new HumanMessage(m.content);
    });
  }

  updateModel(config: ModelConfig): void {
    this.currentConfig = config;
  }

  async streamChat(
    messages: ChatMessageInput[],
    options: { onChunk: (token: string) => void; config: ModelConfig },
  ): Promise<string> {
    const effectiveConfig = this.currentConfig || options.config;
    console.log('streamChat', effectiveConfig);

    const graph = this.buildGraph(effectiveConfig);
    let fullContent = '';
    console.log('streamChat', messages);
    
    const hasSystemPrompt = messages.some((m) => m.role === 'system');
    const messagesWithSystem = hasSystemPrompt
      ? messages
      : [{ role: 'system' as const, content: DEFAULT_SYSTEM_PROMPT }, ...messages];
    
    const finalMessages = this.toMessages(messagesWithSystem);
    console.log('finalMessages', finalMessages);
    const stream = await graph.stream(
      { messages:  finalMessages},
      { streamMode: 'messages' },
    );

    for await (const [messageChunk] of stream) {
      const content = typeof messageChunk.content === 'string' ? messageChunk.content : '';
      console.log('chunks', messageChunk.content);
      if (content) {
        fullContent += content;
        options.onChunk(content);
      }
    }

    return fullContent;
  }
}

export const langGraphHelper = new LangGraphHelper();
