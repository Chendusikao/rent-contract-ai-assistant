import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { loadEnvFile } from "./env.js";

// 安全加载 .env（不存在时不报错，API Key 可在网页设置页配置）
loadEnvFile();
import * as db from "./db.js";
import { installLogCapture, getLogs, clearLogs, type LogLevel } from "./logger.js";
import {
  DEEPSEEK_MODELS,
  DEEPSEEK_DEFAULT_MODEL,
  checkDeepSeekStatus,
  resetClient,
} from "./deepseek.js";
import {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  saveDeepSeekConfig,
  getDeepSeekConfigStatus,
} from "./settings.js";
import {
  parseContractFile,
  cleanupTempFile,
  isSupportedFile,
  UPLOAD_DIR,
} from "./contract-parser.js";
import {
  parseAnalysisResult,
  type ContractAnalysisResult,
} from "./contract-analysis.js";
import { runContractAgent, resetLlm } from "./agent/contract-agent.js";
import {
  indexContract,
  seedLawKnowledgeBase,
} from "./rag/vector-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// 启用日志收集（拦截 console 输出）
installLogCapture();

// 启动时异步初始化法规知识库（RAG 第二路）
const LAW_KB_SEED = [
  { title: '押金与定金法律规定', content: '《民法典》第586条：定金不得超过主合同标的额的百分之二十，超过部分不产生定金的效力。第587条：给付定金的一方不履行债务致使不能实现合同目的的，无权请求返还定金；收受定金的一方不履行债务的，应当双倍返还定金。押金与定金不同，押金本质是担保，无"定金罚则"，退租时房屋无损坏应全额退还。' },
  { title: '维修责任', content: '《民法典》第712条：出租人应当履行租赁物的维修义务，但是当事人另有约定的除外。第713条：承租人在租赁物需要维修时可以请求出租人在合理期限内维修。出租人未履行维修义务的，承租人可以自行维修，维修费用由出租人负担。房屋自然损耗、家电老化应由出租方负责，将维修责任全部推给租客的条款对租客不利。' },
  { title: '转租规定', content: '《民法典》第716条：承租人经出租人同意，可以将租赁物转租给第三人。承租人未经出租人同意转租的，出租人可以解除合同。第718条：出租人知道或者应当知道承租人转租，但是在六个月内未提出异议的，视为出租人同意转租。' },
  { title: '提前退租与违约金', content: '《民法典》第585条：约定的违约金过分高于造成的损失的，人民法院或者仲裁机构可以根据当事人的请求予以适当减少。司法实践中，违约金超过实际损失30%可能被认定为过高。提前退租违约金以1-2个月租金为常见合理范围，3个月以上租金作为违约金通常过高。' },
  { title: '房东单方解除权限制', content: '《民法典》第563条：当事人可以解除合同的情形包括：不可抗力致合同目的不能实现；履行期限届满前一方明确表示或以行为表明不履行主要债务；一方迟延履行主要债务经催告后合理期限内仍未履行；一方迟延履行债务或有其他违约行为致使不能实现合同目的。房东无正当理由不得随意解除合同。' },
  { title: '格式条款与免责条款', content: '《民法典》第497条：提供格式条款一方不合理地免除或者减轻其责任、加重对方责任、限制对方主要权利的，该格式条款无效。第506条：造成对方人身损害的、因故意或者重大过失造成对方财产损失的免责条款无效。' },
  { title: '续租与不定期租赁', content: '《民法典》第734条：租赁期限届满，承租人继续使用租赁物，出租人没有提出异议的，原租赁合同继续有效，但是租赁期限为不定期。第730条：当事人对租赁期限没有约定或者约定不明确，视为不定期租赁；当事人可以随时解除合同，但是应当在合理期限之前通知对方。' },
  { title: '租金支付', content: '《民法典》第722条：承租人无正当理由未支付或者迟延支付租金的，出租人可以请求承租人在合理期限内支付；承租人逾期不支付的，出租人可以解除合同。租客应按时支付租金，但房东不得随意提高租金，租金调整需双方约定。' },
  { title: '退租与押金退还', content: '《民法典》第733条：租赁期限届满，承租人应当返还租赁物。返还的租赁物应当符合按照约定或者根据租赁物的性质使用后的状态。房屋正常使用后的自然损耗不应成为扣押金理由，押金应在退租后合理期限内（通常7-15天）退还。' },
  { title: '优先购买权', content: '《民法典》第726条：出租人出卖租赁房屋的，应当在出卖之前的合理期限内通知承租人，承租人享有以同等条件优先购买的权利。' },
];

// 后台初始化 RAG（不阻塞服务启动）
(async () => {
  try {
    console.log('[RAG] 正在初始化法规知识库...');
    await seedLawKnowledgeBase(LAW_KB_SEED);
    console.log('[RAG] 法规知识库就绪');
  } catch (e: any) {
    console.error('[RAG] 法规知识库初始化失败（稍后重试）:', e?.message);
  }
})();

// 上传目录
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置（内存存储，直接转 Buffer）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 上限
});

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============= 运行日志 API =============

app.get("/api/logs", (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    const level = (req.query.level as LogLevel | 'all') || 'all';
    const search = req.query.search as string | undefined;
    const logs = getLogs({ limit: Math.min(limit, 500), level, search });
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取日志失败" });
  }
});

app.delete("/api/logs", (req, res) => {
  clearLogs();
  res.json({ success: true, message: "日志已清空" });
});

// ============= DeepSeek API 状态检查 =============

app.get("/api/deepseek-status", async (req, res) => {
  const status = getDeepSeekConfigStatus();

  if (!status.configured) {
    return res.json({
      status: 'no_key',
      message: '尚未配置 DeepSeek API Key，请点击右上角"设置"填写',
      apiKey: '',
      source: 'none',
    });
  }

  const result = await checkDeepSeekStatus();
  res.json({
    status: result.ok ? 'ok' : 'error',
    message: result.ok ? 'DeepSeek API 连接正常' : result.error,
    apiKey: status.maskedKey,
    source: status.source,
  });
});

// 保存 DeepSeek 配置（先验证 Key 有效，再持久化到 data/settings.json）
app.post("/api/save-deepseek-config", async (req, res) => {
  const { apiKey, baseUrl } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: '请提供 DeepSeek API Key' });
  }

  // 先用临时 Key 验证有效性
  const probeClient = new OpenAI({
    apiKey,
    baseURL: baseUrl || getDeepSeekBaseUrl(),
  });
  try {
    await probeClient.models.list();
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('401') || msg.includes('Authentication') || msg.includes('Incorrect API key')) {
      return res.status(400).json({ error: 'API Key 无效，请检查后重试' });
    }
    if (msg.includes('402') || msg.includes('Insufficient Balance')) {
      return res.status(400).json({ error: 'API Key 有效，但账户余额不足' });
    }
    return res.status(400).json({ error: `验证失败，无法连接 DeepSeek: ${msg.slice(0, 120)}` });
  }

  // 验证通过 → 保存到 settings.json
  saveDeepSeekConfig(apiKey, baseUrl);
  resetClient();
  resetLlm();

  res.json({
    success: true,
    message: 'API Key 验证通过，配置已生效',
  });
});

// ============= 模型列表 =============

app.get("/api/models", (req, res) => {
  res.json({
    models: DEEPSEEK_MODELS,
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
  });
});

// ============= 合同上传与分析 API =============

// 上传合同文件并解析
app.post("/api/contracts/upload", upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "未收到文件" });
    }

    const fileName = file.originalname;
    if (!isSupportedFile(fileName)) {
      return res.status(400).json({ error: "不支持的文件类型，请上传 PDF 或 Word 文档（.pdf / .docx）" });
    }

    console.log(`[Upload] 收到合同文件: ${fileName} (${(file.size / 1024).toFixed(1)}KB)`);

    // 解析文本
    const parsed = await parseContractFileFromBuffer(file.buffer, fileName);

    res.json({
      success: true,
      fileName,
      fileType: parsed.fileType,
      characterCount: parsed.characterCount,
      text: parsed.text,
    });
  } catch (error: any) {
    console.error("[Upload] 解析失败:", error?.message);
    res.status(400).json({ error: error?.message || "文件解析失败" });
  }
});

// 分析合同（生成风险报告）
app.post("/api/contracts/analyze", async (req, res) => {
  const { text, fileName } = req.body;

  console.log(`\n[Analyze] ========== 合同分析请求 ==========`);
  console.log(`[Analyze] 文件: ${fileName}, 文本长度: ${text?.length || 0}`);

  if (!text || text.length < 20) {
    return res.status(400).json({ error: "合同文本为空或过短，无法分析" });
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: "未配置 DEEPSEEK_API_KEY" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // 创建合同记录（先保存 contract_text，供 Agent 使用）
    const contractId = uuidv4();
    const sessionId = uuidv4();
    const now = new Date().toISOString();

    db.createSession({
      id: sessionId,
      title: fileName || '租房合同分析',
      model: DEEPSEEK_DEFAULT_MODEL,
      sdk_session_id: null,
      created_at: now,
      updated_at: now,
    });

    db.createContract({
      id: contractId,
      session_id: sessionId,
      file_name: fileName || '租房合同',
      file_type: null,
      contract_text: text,
      risk_score: null,
      risk_level: null,
      analysis_json: null,
    });

    // RAG：合同分块向量化入库（后台执行，不阻塞分析）
    indexContract(contractId, text).catch((e: any) => {
      console.error('[RAG] 合同索引失败:', e?.message);
    });

    // 使用 LangGraph Agent 分析（状态机：检索 → 生成）
    console.log(`[Agent] LangGraph 分析开始: ${contractId}`);
    const output = await runContractAgent({
      contractId,
      contractText: text,
      question: '请分析这份租房合同的整体风险',
      isAnalysis: true,
    });

    // 解析结构化结果
    const analysis = parseAnalysisResult(output.answer);
    if (!analysis) {
      console.error('[Analyze] 无法解析 AI 输出为 JSON');
      res.write(`data: ${JSON.stringify({ type: "error", message: "分析结果解析失败，请重试" })}\n\n`);
      res.end();
      return;
    }

    // 更新合同记录
    db.updateContract(contractId, {
      risk_score: analysis.riskScore,
      risk_level: analysis.riskLevel,
      analysis_json: JSON.stringify(analysis),
    });

    console.log(`[Agent] 分析完成: 风险 ${analysis.riskScore}分 (${analysis.riskLevel}), ${analysis.issues.length} 条问题`);

    res.write(`data: ${JSON.stringify({
      type: "analysis_done",
      contractId,
      sessionId,
      analysis,
    })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("[Analyze] 错误:", error?.message);
    res.write(`data: ${JSON.stringify({ type: "error", message: error?.message || "分析失败" })}\n\n`);
    res.end();
  }
});

// 追问（基于合同原文的后续问答）
app.post("/api/contracts/:contractId/follow-up", async (req, res) => {
  const { contractId } = req.params;
  const { question, history } = req.body;

  const contract = db.getContractById(contractId);
  if (!contract || !contract.contract_text) {
    return res.status(404).json({ error: "合同不存在或文本缺失" });
  }

  if (!question) {
    return res.status(400).json({ error: "问题不能为空" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // 使用 LangGraph Agent：检索相关条款块 + 检索法规库 → 生成回答
    console.log(`[Agent] 追问请求: ${question.slice(0, 40)}...`);
    const output = await runContractAgent({
      contractId,
      contractText: contract.contract_text,
      question,
      history: Array.isArray(history) ? history : [],
      isAnalysis: false,
    });

    console.log(`[Agent] 追问完成，引用来源: ${output.sources.join(', ') || '无'}`);

    // 将完整回答一次性发出（保留 text 事件兼容前端流式渲染）
    res.write(`data: ${JSON.stringify({ type: "text", content: output.answer })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("[FollowUp] 错误:", error?.message);
    res.write(`data: ${JSON.stringify({ type: "error", message: error?.message || "追问失败" })}\n\n`);
    res.end();
  }
});

// 合同记录列表（工作台）
app.get("/api/contracts", (req, res) => {
  try {
    const contracts = db.getContractsSummary();
    res.json({ contracts });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取合同记录失败" });
  }
});

// 合同详情
app.get("/api/contracts/:contractId", (req, res) => {
  try {
    const contract = db.getContractById(req.params.contractId);
    if (!contract) {
      return res.status(404).json({ error: "合同不存在" });
    }
    const analysis = contract.analysis_json ? JSON.parse(contract.analysis_json) as ContractAnalysisResult : null;
    res.json({ contract: { ...contract, analysis } });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取合同详情失败" });
  }
});

// 删除合同记录
app.delete("/api/contracts/:contractId", (req, res) => {
  try {
    const contract = db.getContractById(req.params.contractId);
    if (!contract) {
      return res.status(404).json({ error: "合同不存在" });
    }
    // 删除关联会话（级联删除 messages）
    db.deleteSession(contract.session_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "删除合同失败" });
  }
});

// ============= 会话 API（历史记录） =============

app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.getAllSessions();
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    const messages = db.getMessagesBySession(sessionId);
    const contracts = db.getContractsBySession(sessionId);
    res.json({ session, messages, contracts });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = db.deleteSession(sessionId);
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 分析规则（租房坑点清单，只读） =============

app.get("/api/analysis-rules", (req, res) => {
  try {
    res.json({ rules: RENT_PITFALLS_FOR_API });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取分析规则失败" });
  }
});

// ============= 生产模式：静态托管前端（可选） =============
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`[Static] 前端静态文件托管已启用: ${distDir}`);
} else {
  console.log(`[Static] 未找到 dist 目录，仅提供 API 服务（开发模式）`);
}

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║   ◉ 租房合同分析 Agent 已启动               ║
║                                            ║
║   地址: http://localhost:${PORT}            ║
║   AI 引擎: DeepSeek                         ║
║   支持: 合同上传 / 风险分析 / 追问           ║
║   数据库: SQLite (data/chat.db)            ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});

// 从文件 buffer 解析合同（上传直接内存解析）
async function parseContractFileFromBuffer(buffer: Buffer, fileName: string) {
  // 写入临时文件
  const tempPath = path.join(UPLOAD_DIR, `${uuidv4()}-${fileName}`);
  fs.writeFileSync(tempPath, buffer);
  try {
    return await parseContractFile(tempPath, fileName);
  } finally {
    cleanupTempFile(tempPath);
  }
}

// API 用的坑点清单（精简版）
const RENT_PITFALLS_FOR_API = [
  { name: '押金退还条款缺失或模糊', description: '未写明押金退还时间、条件，或"押金抵作违约金"' },
  { name: '租金涨幅条款', description: '"每年递增"等隐形涨价条款' },
  { name: '提前退租违约金过高', description: '违约金超过 1-2 个月租金' },
  { name: '维修责任不清', description: '自然损坏由谁维修未明确' },
  { name: '转租/换租限制', description: '完全禁止转租或转租收费过高' },
  { name: '水电物业费不明确', description: '单价、承担方、分摊方式不清' },
  { name: '房东单方解除权', description: '房东可随时收房且无违约责任' },
  { name: '免责条款过度', description: '房屋损毁、财物丢失一概免责' },
  { name: '续租条款缺失', description: '未约定是否自动续租及租金调整' },
  { name: '家具清单缺失', description: '未附家具家电状态清单' },
  { name: '合同主体不明', description: '二房东/无产权证明，未核对房产证' },
  { name: '定金订金混淆', description: '未明确定金退还规则' },
  { name: '租期付款不清', description: '租期起止不明或要求一次性付清长租期' },
  { name: '口头承诺未入合同', description: '看房承诺未写入合同无法兑现' },
  { name: '违约责任不对等', description: '只约束租客，房东违约无责' },
];
