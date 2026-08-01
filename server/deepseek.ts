/**
 * DeepSeek API 封装
 * 使用 OpenAI 兼容接口对接 DeepSeek
 */
import OpenAI from 'openai';
import { getDeepSeekApiKey, getDeepSeekBaseUrl } from './settings.js';

// DeepSeek 模型列表
export const DEEPSEEK_MODELS = [
  { modelId: 'deepseek-chat', name: 'DeepSeek V3' },
  { modelId: 'deepseek-reasoner', name: 'DeepSeek R1' },
];

// 默认模型
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

// 系统提示词最大长度（DeepSeek 上下文窗口较大，但 sys prompt 不要太长）
const MAX_SYSTEM_PROMPT_LENGTH = 8000;

/**
 * 获取 DeepSeek 客户端（不要每次创建新实例，复用）
 */
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = getDeepSeekApiKey();
    const baseURL = getDeepSeekBaseUrl();

    if (!apiKey) {
      throw new Error('缺少 DeepSeek API Key，请打开网页右上角"设置"填写');
    }

    _client = new OpenAI({
      apiKey,
      baseURL,
      // DeepSeek 兼容 OpenAI 接口，不需要额外配置
    });
  }
  return _client;
}

/**
 * 重置客户端（当 API Key 变更时）
 */
export function resetClient(): void {
  _client = null;
}

/**
 * 检查 DeepSeek API 是否可用
 */
export async function checkDeepSeekStatus(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getClient();
    // 尝试列出模型来验证 API Key
    const models = await client.models.list();
    return { ok: true };
  } catch (error: any) {
    const msg = error?.message || String(error);
    // 常见错误码处理
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Authentication')) {
      return { ok: false, error: 'API Key 无效，请检查 DEEPSEEK_API_KEY' };
    }
    if (msg.includes('403') || msg.includes('Forbidden')) {
      return { ok: false, error: 'API Key 无权限，请检查账户余额' };
    }
    if (msg.includes('429') || msg.includes('Rate limit')) {
      return { ok: false, error: 'API 请求频率过高，请稍后重试' };
    }
    return { ok: false, error: `连接失败: ${msg}` };
  }
}

/**
 * 构建消息数组（含系统提示词 + 历史对话）
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  currentMessage: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // 系统提示词（截断过长内容）
  const truncatedPrompt = systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH
    ? systemPrompt.slice(0, MAX_SYSTEM_PROMPT_LENGTH) + '\n...(FAQ知识库已截断)'
    : systemPrompt;

  messages.push({ role: 'system', content: truncatedPrompt });

  // 历史对话（保留最近 20 轮）
  const recentHistory = history.slice(-40); // 20 pairs of Q&A
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // 当前消息
  messages.push({ role: 'user', content: currentMessage });

  return messages;
}

/**
 * 流式聊天（返回 AsyncGenerator，逐 token 产出）
 */
export async function* streamChat(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  }
): AsyncGenerator<{
  type: 'text' | 'done' | 'error';
  content?: string;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  const client = getClient();

  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      top_p: options?.topP ?? 0.9,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', content: delta.content };
      }

      // 最后一帧包含 usage
      if (chunk.choices?.[0]?.finish_reason) {
        const usage = chunk.usage;
        yield {
          type: 'done',
          usage: usage ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          } : undefined,
        };
      }
    }
  } catch (error: any) {
    const msg = error?.message || String(error);

    // DeepSeek 特定错误处理
    if (msg.includes('402') || msg.includes('Insufficient Balance')) {
      yield { type: 'error', error: 'DeepSeek 账户余额不足，请充值后重试' };
    } else {
      yield { type: 'error', error: `DeepSeek API 错误: ${msg}` };
    }
  }
}
