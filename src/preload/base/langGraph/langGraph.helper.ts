import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessageChunk } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
import { createModel } from './model.adaptor';
import type { ModelConfig } from './model.adaptor';
import { createAllSkills, SKILL_SELECTOR_PROMPT } from './defaultSkills/skill.registry';
import type { ProxyConfig } from './model.adaptor';

export type { ModelConfig };

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

class LangGraphHelper {
  private currentConfig: ModelConfig | null = null;

  private async selectSkills(
    messages: ChatMessageInput[],
    config: ModelConfig,
    proxy?: ProxyConfig,
  ): Promise<string[]> {
    const t0 = Date.now();
    try {
      console.log('[selectSkills] start...');
      const model = createModel(config);
      const lastMessages = messages.slice(-3);
      const prompt = lastMessages.map((m) => `${m.role}: ${m.content}`).join('\n');

      console.log('[selectSkills] >>> system:', SKILL_SELECTOR_PROMPT.slice(0, 300));
      console.log('[selectSkills] >>> user prompt:', prompt);

      const response = await model.invoke([
        new SystemMessage(SKILL_SELECTOR_PROMPT),
        new HumanMessage(prompt),
      ]);

      const text = typeof response.content === 'string' ? response.content.trim() : '';
      console.log('[selectSkills] <<< raw response:', text);

      const match = text.match(/\[.*?\]/s);
      if (!match) return [];

      const allSkills = createAllSkills(proxy);
      const parsed = JSON.parse(match[0]) as string[];
      const valid = parsed.filter((name) => name in allSkills);
      console.log(`[selectSkills] <<< selected skills: ${JSON.stringify(valid)} (${Date.now() - t0}ms)`);
      return valid;
    } catch (err: any) {
      console.warn(`[langGraph] skill selection failed (${Date.now() - t0}ms):`, err.message);
      return [];
    }
  }

  private buildGraph(
    config: ModelConfig,
    skillNames: string[],
    proxy?: ProxyConfig,
    onToolCall?: (name: string, input: Record<string, unknown>) => void,
  ) {
    const model = createModel(config);
    const allSkills = createAllSkills(proxy);
    const selectedSkills = skillNames.map((name) => allSkills[name]).filter(Boolean);
    const modelWithTools = selectedSkills.length > 0 ? model.bindTools(selectedSkills) : model;
    const toolNode = new ToolNode(selectedSkills);

    const toolDescriptions = selectedSkills.length > 0
      ? selectedSkills.map((s) => `- ${s.name}: ${(s as any).description ?? ''}`).join('\n')
      : '';

    const TOOL_SYSTEM = new SystemMessage(
      'You are a helpful assistant with access to the following tools:\n' +
      (toolDescriptions ? `${toolDescriptions}\n\n` : '') +
      'STRICT TOOL USAGE RULES:\n' +
      '1. get_date / search_web / get_setting: call each AT MOST ONCE. Reuse their results from message history.\n' +
      '2. After search_web returns results, you MUST call fetch_page on each result URL one by one.\n' +
      '3. fetch_page: call with ONE URL at a time. Maximum 20 calls total.\n' +
      '4. If fetch_page returns status=ok with non-empty content that answers the question — STOP ALL TOOL CALLS immediately and write your final answer.\n' +
      '5. If fetch_page returns status=no_useful_content — call fetch_page again with the NEXT URL from search_web results.\n' +
      '6. If all URLs are exhausted and no useful content found — respond to the user saying no content was found and give your best suggestion.\n' +
      '7. Never call a tool if you already have enough information to answer.',
    );

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const msgs = state.messages[0]?._getType() === 'system'
        ? state.messages
        : [TOOL_SYSTEM, ...state.messages];

      console.log('[callModel] >>> sending messages to model, count:', msgs.length);
      for (const m of msgs) {
        const type = m._getType();
        const content = typeof m.content === 'string' ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200);
        const toolCalls = (m as any).tool_calls?.length ? ` tool_calls:${JSON.stringify((m as any).tool_calls)}` : '';
        const toolCallId = (m as any).tool_call_id ? ` tool_call_id:${(m as any).tool_call_id}` : '';
        console.log(`  [${type}]${toolCallId}${toolCalls} ${content}`);
      }

      const response = await modelWithTools.invoke(msgs);

      const respType = response._getType();
      const respContent = typeof response.content === 'string' ? response.content.slice(0, 200) : JSON.stringify(response.content).slice(0, 200);
      const respToolCalls = (response as any).tool_calls?.length
        ? ` tool_calls:${JSON.stringify((response as any).tool_calls)}`
        : '';
      console.log(`[callModel] <<< model response [${respType}]${respToolCalls} ${respContent}`);

      return { messages: [response] };
    };

    const SINGLE_CALL_TOOLS = new Set(['get_date', 'search_web', 'get_setting', 'fetch_url']);

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) return END;

      const prevMessages = state.messages.slice(0, -1);

      const calledSingleTools = new Set(
        prevMessages
          .filter((m) => m._getType() === 'ai')
          .flatMap((m: any) => (m.tool_calls ?? []) as Array<{ name: string }>)
          .filter((tc) => SINGLE_CALL_TOOLS.has(tc.name))
          .map((tc) => tc.name),
      );

      const calledPageUrls = new Set(
        prevMessages
          .filter((m) => m._getType() === 'ai')
          .flatMap((m: any) => (m.tool_calls ?? []) as Array<{ name: string; args: Record<string, unknown> }>)
          .filter((tc) => tc.name === 'fetch_page')
          .map((tc) => String(tc.args?.url ?? '')),
      );

      const newCalls = lastMessage.tool_calls.filter((tc) => {
        if (SINGLE_CALL_TOOLS.has(tc.name)) {
          if (calledSingleTools.has(tc.name)) {
            console.log('[graph] skipping duplicate single-call tool:', tc.name);
            return false;
          }
          return true;
        }
        if (tc.name === 'fetch_page') {
          const url = String(tc.args?.url ?? '');
          if (calledPageUrls.has(url)) {
            console.log('[graph] skipping already fetched url:', url);
            return false;
          }
          return true;
        }
        return true;
      });

      if (newCalls.length === 0) {
        console.log('[graph] all tool calls already executed, stopping loop');
        return END;
      }
      for (const tc of newCalls) {
        console.log('[graph] skill call detected:', tc.name, tc.args);
        onToolCall?.(tc.name, tc.args as Record<string, unknown>);
      }
      return 'tools';
    };

    return new StateGraph(MessagesAnnotation)
      .addNode('callModel', callModel)
      .addNode('tools', toolNode)
      .addEdge(START, 'callModel')
      .addConditionalEdges('callModel', shouldContinue)
      .addEdge('tools', 'callModel')
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
    options: {
      onChunk: (token: string) => void;
      onToolCall?: (name: string, input: Record<string, unknown>) => void;
      config: ModelConfig;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const effectiveConfig = this.currentConfig || options.config;
    console.log('streamChat', effectiveConfig);

    const proxy = effectiveConfig.proxy;
    const totalT0 = Date.now();
    const skillNames = await this.selectSkills(messages, effectiveConfig, proxy);
    console.log('[langGraph] building graph with skills:', skillNames);

    const graph = this.buildGraph(effectiveConfig, skillNames, proxy, options.onToolCall);
    let fullContent = '';

    const finalMessages = this.toMessages(messages);

    const stream = await graph.stream(
      { messages: finalMessages },
      { streamMode: 'messages' },
    );

    for await (const [messageChunk, metadata] of stream) {
      if (!messageChunk) continue;
      const msgType = messageChunk._getType ? messageChunk._getType() : 'unknown';
      const toolCalls = (messageChunk as AIMessage).tool_calls?.length ?? 0;
      console.log('[streamChat] chunk type:', msgType, 'toolCalls:', toolCalls, 'node:', (metadata as any)?.langgraph_node);
      if (toolCalls > 0) continue;
      if (msgType === 'tool') continue;
      const content = typeof messageChunk.content === 'string' ? messageChunk.content : '';
      if (content) {
        fullContent += content;
        options.onChunk(content);
      }
    }
    console.log(`[streamChat] stream finished, fullContent length: ${fullContent.length}, total elapsed: ${Date.now() - totalT0}ms`);

    return fullContent;
  }
}

export const langGraphHelper = new LangGraphHelper();
