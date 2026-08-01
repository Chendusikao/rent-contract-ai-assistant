/**
 * LangGraph 合同分析 Agent
 * 使用 StateGraph 编排：分析 → 追问检索 → 生成回答 的状态机
 * 工具：检索合同条款块、检索法规知识库
 */
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { searchContractChunks, searchLawKnowledgeBase } from '../rag/vector-store.js';
import { getDeepSeekApiKey, getDeepSeekBaseUrl } from '../settings.js';
import {
  RENT_PITFALLS,
  RENT_LAW_REFS,
  buildAnalysisSystemPrompt,
  parseAnalysisResult,
  type ContractAnalysisResult,
} from '../contract-analysis.js';

// ============= LangChain LLM（DeepSeek 兼容） =============

let _llm: ChatOpenAI | null = null;

export function getLlm(): ChatOpenAI {
  if (!_llm) {
    _llm = new ChatOpenAI({
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 4096,
      timeout: 180000,
      maxRetries: 2,
      configuration: {
        baseURL: getDeepSeekBaseUrl(),
        apiKey: getDeepSeekApiKey(),
      },
    });
  }
  return _llm;
}

// 追问专用 LLM：低温度，严格遵守格式
export function getFollowUpLlm(): ChatOpenAI {
  return new ChatOpenAI({
    model: 'deepseek-chat',
    temperature: 0.1,
    maxTokens: 1500,
    timeout: 180000,
    maxRetries: 2,
    configuration: {
      baseURL: getDeepSeekBaseUrl(),
      apiKey: getDeepSeekApiKey(),
    },
  });
}

export function resetLlm(): void {
  _llm = null;
}

// ============= LangGraph 状态定义 =============

const ContractState = Annotation.Root({
  contractId: Annotation<string>,
  contractText: Annotation<string>,
  question: Annotation<string>,
  history: Annotation<Array<{ role: string; content: string }>>,
  context: Annotation<string>,
  sources: Annotation<string[]>,
  answer: Annotation<string>,
  isAnalysis: Annotation<boolean>,
});

type ContractStateT = typeof ContractState.State;

// ============= 节点：检索合同条款 =============

async function retrieveContractNode(state: ContractStateT): Promise<Partial<ContractStateT>> {
  const { contractId, contractText, question } = state;

  // 初次分析：检索合同整体结构（取开头 + 关键条款提示）
  if (state.isAnalysis) {
    const truncated = contractText.length > 12000
      ? contractText.slice(0, 12000) + '\n...(合同过长，仅展示前部分，后续追问可针对性检索)'
      : contractText;
    return {
      context: truncated,
      sources: ['合同全文（初次分析）'],
    };
  }

  // 追问：语义检索最相关条款
  const chunks = await searchContractChunks(contractId, question, 4);
  if (chunks.length === 0) {
    return {
      context: contractText.slice(0, 4000),
      sources: ['合同全文（未命中精准条款，使用开头部分）'],
    };
  }
  return {
    context: chunks.map(c => `[第${c.index + 1}块] ${c.text}`).join('\n\n---\n\n'),
    sources: chunks.map(c => `合同条款块 #${c.index + 1}`),
  };
}

// ============= 节点：检索法规知识库 =============

async function retrieveLawNode(state: ContractStateT): Promise<Partial<ContractStateT>> {
  const lawChunks = await searchLawKnowledgeBase(state.question, 3);
  if (lawChunks.length === 0) return {};
  return {
    sources: [...(state.sources || []), ...lawChunks.map(c => c.text.split('\n')[0].replace(/^【|】$/g, ''))],
  };
}

// ============= 节点：分析/回答生成 =============

async function generateNode(state: ContractStateT): Promise<Partial<ContractStateT>> {
  const llm = getLlm();

  if (state.isAnalysis) {
    // 初次分析：完整报告（结构化 JSON）
    const prompt = buildAnalysisSystemPrompt();
    const userMsg = `合同文件名：待分析\n\n以下是我要分析的租房合同全文：\n---合同开始---\n${state.context}\n---合同结束---\n\n请按照系统提示词要求的 JSON 格式输出分析结果。`;

    const messages = [new SystemMessage(prompt), new HumanMessage(userMsg)];
    const response = await llm.invoke(messages);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const analysis = parseAnalysisResult(content);

    if (!analysis) {
      return { answer: '分析结果解析失败，请重试', sources: state.sources };
    }

    return {
      answer: JSON.stringify(analysis),
      sources: state.sources,
    };
  }

  // 追问：基于检索到的条款 + 法规库回答
  const lawRefsText = RENT_LAW_REFS.map((l, i) => `${i + 1}. ${l.law}：${l.content}`).join('\n');

  const systemPrompt = `你是一名租房合同法律分析专家，面向第一次租房的大学生。

【用户合同的相关条款】（已根据用户问题检索）
---合同相关条款---
${state.context}
---条款结束---

【可参考的法律依据】
${lawRefsText}

# 输出格式（必须严格遵守，任何偏差都会让前端渲染失败）

## 强制规则
1. **必须输出 4 个段落**，顺序固定：结论 → 合同原文引用 → 分析说明 → 具体建议
2. **段落标题必须用 **结论** 合同原文引用** **分析说明** **具体建议** 这种 **加粗** 格式**（注意前后各两个 *）
3. **段落之间必须用空行分隔**（每段之间有一个空行）
4. **引用合同原文时必须用 > 引用块**（每行原文前面加 > 和空格）
5. **不要使用任何 emoji**（📌💡⚠️✅❌🎯 等都不要）
6. **不要使用 *** --- ### 等装饰性 Markdown**
7. **不要使用"首先/其次/再次/最后"等凑字数连词**
8. **每段控制在 80-150 字**，整体 300-500 字

## 正确示例（请严格模仿此格式）

**结论**  
不能要求退还剩余租金，因为合同约定租金不退，属于格式条款，可依《民法典》第497条主张无效。

> 第四条 租金：本合同签订时乙方需支付定金 5000 元，若乙方违约，定金不退。

**分析说明**  
"定金不退"是常见的格式条款。民法典规定，定金罚则仅适用于收受定金方违约的情形；如果是收定金方违约，应双倍返还。单方面约定"不退"对你明显不利。

**具体建议**  
1. 回复房东："定金罚则需双向约束，建议改为双方违约均按定金罚则处理，否则对我不公平。"  
2. 若协商无果，可向消协投诉该条款属于显失公平的格式条款。  
3. 签约前用手机拍照留存合同，并保留转账凭证。

---
现在请用同样格式回答用户的问题。`;

  const historyMessages = (state.history || []).slice(-6).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const messages = [
    new SystemMessage(systemPrompt),
    ...historyMessages,
    new HumanMessage(state.question),
  ];

  const followUpLlm = getFollowUpLlm();
  const response = await followUpLlm.invoke(messages);
  const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  return {
    answer: content,
    sources: state.sources,
  };
}

// ============= 构建图 =============

let _graph: any = null;
let _app: any = null;

export async function getContractGraph() {
  if (_app) return _app;

  const builder = new StateGraph(ContractState)
    .addNode('retrieve_contract', retrieveContractNode)
    .addNode('retrieve_law', retrieveLawNode)
    .addNode('generate', generateNode)
    .addEdge('retrieve_contract', 'retrieve_law')
    .addEdge('retrieve_law', 'generate')
    .addEdge('generate', '__end__')
    .addEdge('__start__', 'retrieve_contract');

  const graph = builder.compile();
  _graph = graph;
  _app = graph;
  return _app;
}

// ============= 对外接口 =============

export interface AgentInput {
  contractId: string;
  contractText: string;
  question: string;
  history?: Array<{ role: string; content: string }>;
  isAnalysis?: boolean;
}

export interface AgentOutput {
  answer: string;
  sources: string[];
}

/**
 * 运行合同分析 Agent（LangGraph 状态机）
 */
export async function runContractAgent(input: AgentInput): Promise<AgentOutput> {
  const app = await getContractGraph();
  const result = await app.invoke({
    contractId: input.contractId,
    contractText: input.contractText,
    question: input.question,
    history: input.history || [],
    isAnalysis: input.isAnalysis || false,
    context: '',
    sources: [],
    answer: '',
  });

  return {
    answer: result.answer || '',
    sources: result.sources || [],
  };
}

export { RENT_PITFALLS, RENT_LAW_REFS };
