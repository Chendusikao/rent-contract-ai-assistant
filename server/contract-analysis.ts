/**
 * 租房合同分析引擎
 * 包含：租房坑点知识库、分析提示词构建、结构化结果解析
 */
import OpenAI from 'openai';

// ============= 租房合同常见坑点知识库 =============
// 每个坑点包含：名称、风险说明、建议核查方式
export interface RentPitfall {
  name: string;
  description: string;
  riskIfFound: string;
}

export const RENT_PITFALLS: RentPitfall[] = [
  {
    name: '押金退还条款缺失或模糊',
    description: '未写明押金退还的时间、条件，或"押金抵作违约金"等霸王表述',
    riskIfFound: '退租时押金可能被无故扣押，维权困难',
  },
  {
    name: '租金涨幅条款',
    description: '"每年递增 5%"或"租金随市场调整"等隐形涨价条款',
    riskIfFound: '第二年租金可能大幅上涨，超出承受能力',
  },
  {
    name: '提前退租违约金过高',
    description: '违约金超过 1-2 个月租金，或"不退押金"一刀切',
    riskIfFound: '因工作/学业变动提前退租时损失巨大',
  },
  {
    name: '维修责任不清',
    description: '未明确家电/水管/墙体等自然损坏由谁维修，或全部推给租客',
    riskIfFound: '房屋设施损坏时需自掏腰包维修',
  },
  {
    name: '转租/换租限制',
    description: '完全禁止转租，或转租需缴纳高额费用',
    riskIfFound: '中途无法转租，造成房屋空置损失',
  },
  {
    name: '水电物业费不明确',
    description: '未写明水电气单价、物业费由谁承担、如何分摊',
    riskIfFound: '退租时可能被扣大额水电费，或承担不合理的公摊',
  },
  {
    name: '房东单方解除权',
    description: '"房东可随时收回房屋"或解除合同不承担违约责任',
    riskIfFound: '可能被临时赶走且得不到赔偿',
  },
  {
    name: '免责条款过度',
    description: '房屋损毁、财物丢失等一概免责，或租客承担全部责任',
    riskIfFound: '意外损失时无法向房东追责',
  },
  {
    name: '续租条款缺失',
    description: '未约定租期届满后是否自动续租、租金如何调整',
    riskIfFound: '租期届满后可能被迫搬家或租金被抬高',
  },
  {
    name: '房屋状态与家具清单缺失',
    description: '未附家具家电清单及损坏状态记录',
    riskIfFound: '退租时无法证明物品原有状态，易被扣押金',
  },
  {
    name: '合同主体不明',
    description: '出租方不是产权人（二房东/无代理授权），或未核对房产证',
    riskIfFound: '可能遭遇"一房多租"或真房东清退，钱房两空',
  },
  {
    name: '定金/订金混淆',
    description: '"定金"与"订金"混用，或未明确定金退还规则',
    riskIfFound: '定金不退，订金可退，混淆导致经济损失',
  },
  {
    name: '租期与付款方式不清',
    description: '租期起止不明，或要求一次性付清长租期租金',
    riskIfFound: '付款纠纷，或长租期一次性付款风险大',
  },
  {
    name: '口头承诺未写入合同',
    description: '看房时承诺（包物业、送家具、允许养宠）未写入合同',
    riskIfFound: '口头承诺无凭据，入住后无法兑现',
  },
  {
    name: '违约责任不对等',
    description: '只约定租客违约责任，房东违约无约束',
    riskIfFound: '房东违约时无法获得赔偿',
  },
];

// ============= 分析提示词构建 =============

export interface ContractAnalysisInput {
  contractText: string;
  fileName: string;
}

const MAX_CONTRACT_LENGTH = 24000; // 合同文本截断上限（约 8000 汉字）

// ============= 法律依据知识库（民法典） =============

export const RENT_LAW_REFS: { law: string; content: string }[] = [
  {
    law: '《民法典》第703条',
    content: '租赁合同是出租人将租赁物交付承租人使用、收益，承租人支付租金的合同。',
  },
  {
    law: '《民法典》第712条',
    content: '出租人应当履行租赁物的维修义务，但是当事人另有约定的除外。',
  },
  {
    law: '《民法典》第713条',
    content: '承租人在租赁物需要维修时可以请求出租人在合理期限内维修。出租人未履行维修义务的，承租人可以自行维修，维修费用由出租人负担。',
  },
  {
    law: '《民法典》第716条',
    content: '承租人经出租人同意，可以将租赁物转租给第三人。承租人未经出租人同意转租的，出租人可以解除合同。',
  },
  {
    law: '《民法典》第718条',
    content: '出租人知道或者应当知道承租人转租，但是在六个月内未提出异议的，视为出租人同意转租。',
  },
  {
    law: '《民法典》第722条',
    content: '承租人无正当理由未支付或者迟延支付租金的，出租人可以请求承租人在合理期限内支付；承租人逾期不支付的，出租人可以解除合同。',
  },
  {
    law: '《民法典》第730条',
    content: '当事人对租赁期限没有约定或者约定不明确，视为不定期租赁；当事人可以随时解除合同，但是应当在合理期限之前通知对方。',
  },
  {
    law: '《民法典》第733条',
    content: '租赁期限届满，承租人应当返还租赁物。返还的租赁物应当符合按照约定或者根据租赁物的性质使用后的状态。',
  },
  {
    law: '《民法典》第734条',
    content: '租赁期限届满，承租人继续使用租赁物，出租人没有提出异议的，原租赁合同继续有效，但是租赁期限为不定期。',
  },
  {
    law: '《民法典》第585条',
    content: '约定的违约金过分高于造成的损失的，人民法院或者仲裁机构可以根据当事人的请求予以适当减少。',
  },
  {
    law: '《民法典》第586条',
    content: '定金的数额由当事人约定；但是，不得超过主合同标的额的百分之二十，超过部分不产生定金的效力。',
  },
  {
    law: '《民法典》第587条',
    content: '给付定金的一方不履行债务或者履行债务不符合约定，致使不能实现合同目的的，无权请求返还定金；收受定金的一方不履行债务的，应当双倍返还定金。',
  },
  {
    law: '《民法典》第497条',
    content: '提供格式条款一方不合理地免除或者减轻其责任、加重对方责任、限制对方主要权利的，该格式条款无效。',
  },
  {
    law: '《民法典》第506条',
    content: '造成对方人身损害的、因故意或者重大过失造成对方财产损失的免责条款无效。',
  },
];

export function buildAnalysisSystemPrompt(): string {
  const pitfalls = RENT_PITFALLS.map((p, i) =>
    `${i + 1}. **${p.name}**：${p.description}。若发现：${p.riskIfFound}`
  ).join('\n');

  const lawRefs = RENT_LAW_REFS.map((l, i) =>
    `${i + 1}. ${l.law}：${l.content}`
  ).join('\n');

  return `你是一名专业的租房合同法律分析专家，擅长从租客视角审查房屋租赁合同，帮助第一次租房的大学生识别风险。

## 你的任务
阅读用户提供的租房合同全文，找出对租客不利的条款，给出风险评分和改进建议。

## 输出格式（必须严格输出 JSON，不要输出任何其他内容）
{
  "riskScore": 0-100 的整数（风险越高分数越高；60-79 中风险，80+ 高风险，<60 低风险），
  "riskLevel": "低风险" | "中风险" | "高风险",
  "summary": "对合同整体的一句话评价（面向租客）",
  "issues": [
    {
      "clause": "问题条款的原文摘录（引用合同里的原话，不要自己编）",
      "risk": "风险类型简述，如：押金退还风险",
      "level": "高" | "中" | "低",
      "reason": "为什么这个条款对租客不利（结合法律常识解释）",
      "suggestion": "建议怎么修改 / 怎么和房东谈判（具体可操作）",
      "law": "适用的法律依据，格式如：《民法典》第712条（若确实适用，可从下方法律依据知识库选择；若无法条直接适用可写'相关法律依据：...'或省略）"
    }
  ],
  "goodPoints": ["对租客有利的条款或安排（无则给空数组）"],
  "negotiationTips": ["可以直接发给房东/中介的协商话术，共 2-4 条"]
}

## 审查要点（优先排查以下坑点，但不限于）
${pitfalls}

## 可引用的法律依据（民法典）
${lawRefs}

## 规则
1. 严格基于合同原文分析，逐条引用原文，不要臆造合同内容
2. 从租客立场出发，标注风险等级
3. 如果合同整体规范，风险较低，也要如实给出好评并说明理由
4. 每个问题条款尽量给出适用的法律依据（law 字段），优先从上方知识库选择；知识库没有合适法条时，可引用《民法典》其他相关条文或省略
5. 中文输出
6. 只输出 JSON，不要有 markdown 代码块标记`;
}

export function buildAnalysisUserPrompt(input: ContractAnalysisInput): string {
  const text = input.contractText.length > MAX_CONTRACT_LENGTH
    ? input.contractText.slice(0, MAX_CONTRACT_LENGTH) + '\n...(合同过长，已截断，如需要可分段上传)'
    : input.contractText;

  return `合同文件名：${input.fileName}

以下是我要分析的租房合同全文：
---合同开始---
${text}
---合同结束---

请按照系统提示词要求的 JSON 格式输出分析结果。`;
}

// ============= 结构化结果解析 =============

export interface ContractIssue {
  clause: string;
  risk: string;
  level: '高' | '中' | '低';
  reason: string;
  suggestion: string;
  law?: string;
}

export interface ContractAnalysisResult {
  riskScore: number;
  riskLevel: string;
  summary: string;
  issues: ContractIssue[];
  goodPoints: string[];
  negotiationTips: string[];
}

// 从 DeepSeek 输出中提取并解析 JSON
export function parseAnalysisResult(rawContent: string): ContractAnalysisResult | null {
  try {
    // 去除可能的 markdown 代码块标记
    let content = rawContent.trim();
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // 提取第一个 { 到最后一个 }
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('未找到 JSON 对象');
    }
    const jsonStr = content.slice(start, end + 1);
    const data = JSON.parse(jsonStr);

    // 规范化字段
    const result: ContractAnalysisResult = {
      riskScore: clampScore(typeof data.riskScore === 'number' ? data.riskScore : 50),
      riskLevel: typeof data.riskLevel === 'string' ? data.riskLevel : '',
      summary: typeof data.summary === 'string' ? data.summary : '',
      issues: Array.isArray(data.issues) ? data.issues.map((i: any) => ({
        clause: i.clause || '',
        risk: i.risk || '',
        level: ['高', '中', '低'].includes(i.level) ? i.level : '中',
        reason: i.reason || '',
        suggestion: i.suggestion || '',
        law: typeof i.law === 'string' ? i.law : undefined,
      })) : [],
      goodPoints: Array.isArray(data.goodPoints) ? data.goodPoints.filter((g: any) => typeof g === 'string') : [],
      negotiationTips: Array.isArray(data.negotiationTips) ? data.negotiationTips.filter((t: any) => typeof t === 'string') : [],
    };

    return result;
  } catch (e) {
    console.error('[Analysis] 解析分析结果失败:', e);
    return null;
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============= 追问提示词构建 =============

export function buildFollowUpSystemPrompt(contractText: string): string {
  const text = contractText.length > MAX_CONTRACT_LENGTH
    ? contractText.slice(0, MAX_CONTRACT_LENGTH)
    : contractText;

  return `你是一名专业的租房合同法律分析专家，面向第一次租房的大学生。

用户上传了一份租房合同，以下是合同全文：
---合同开始---
${text}
---合同结束---

用户会针对合同内容提问（可能涉及具体条款的含义、风险、谈判建议、法律依据等）。请结合合同原文回答：
1. 引用合同原文相关部分
2. 用通俗易懂的语言解释，大学生能听懂
3. 给出具体可操作的建议或谈判话术
4. 中文回答，简洁清晰`;
}
