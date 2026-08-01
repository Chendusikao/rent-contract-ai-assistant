import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    intent TEXT,
    escalated INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表（扩展：增加 intent 意图标记）
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    intent TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- FAQ 知识库表
  CREATE TABLE IF NOT EXISTS faq_entries (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    keywords TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 合同分析记录表
  CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    contract_text TEXT,
    risk_score INTEGER,
    risk_level TEXT,
    analysis_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_contracts_session_id ON contracts(session_id);
`);

// ============= 迁移：为旧表补充新列（容错） =============
try {
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some(c => c.name === 'intent')) {
    db.exec("ALTER TABLE sessions ADD COLUMN intent TEXT");
  }
  if (!sessionCols.some(c => c.name === 'escalated')) {
    db.exec("ALTER TABLE sessions ADD COLUMN escalated INTEGER DEFAULT 0");
  }
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!msgCols.some(c => c.name === 'intent')) {
    db.exec("ALTER TABLE messages ADD COLUMN intent TEXT");
  }
} catch (e) {
  // 忽略迁移错误
}

// ============= 类型定义 =============

export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  intent: string | null;
  escalated: number;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  intent: string | null;
  created_at: string;
  tool_calls: string | null;
}

export interface DbFaqEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string | null;
  created_at: string;
  updated_at: string;
}

// ============= 会话操作 =============

export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

export function createSession(session: Omit<DbSession, 'intent' | 'escalated'> & { intent?: string; escalated?: number }): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, intent, escalated, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    session.id,
    session.title,
    session.model,
    session.sdk_session_id,
    session.intent ?? null,
    session.escalated ?? 0,
    session.created_at,
    session.updated_at
  );
  return session as DbSession;
}

export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id' | 'intent' | 'escalated'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }
  if (updates.sdk_session_id !== undefined) { fields.push('sdk_session_id = ?'); values.push(updates.sdk_session_id); }
  if (updates.intent !== undefined) { fields.push('intent = ?'); values.push(updates.intent); }
  if (updates.escalated !== undefined) { fields.push('escalated = ?'); values.push(updates.escalated ? 1 : 0); }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

export function createMessage(message: Omit<DbMessage, 'intent'> & { intent?: string | null }): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, intent, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.intent ?? null,
    message.created_at,
    message.tool_calls
  );

  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);

  return message as DbMessage;
}

export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls' | 'intent'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.tool_calls !== undefined) { fields.push('tool_calls = ?'); values.push(updates.tool_calls); }
  if (updates.intent !== undefined) { fields.push('intent = ?'); values.push(updates.intent); }

  if (fields.length === 0) return false;

  values.push(id);

  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function createMessages(messages: Array<Omit<DbMessage, 'intent'> & { intent?: string | null }>): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, intent, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((msgs: typeof messages) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.intent ?? null, msg.created_at, msg.tool_calls);
    }
  });

  insertMany(messages);
}

// ============= FAQ 知识库操作 =============

export function getAllFaq(): DbFaqEntry[] {
  const stmt = db.prepare('SELECT * FROM faq_entries ORDER BY category, created_at ASC');
  return stmt.all() as DbFaqEntry[];
}

export function getFaqById(id: string): DbFaqEntry | undefined {
  const stmt = db.prepare('SELECT * FROM faq_entries WHERE id = ?');
  return stmt.get(id) as DbFaqEntry | undefined;
}

export function createFaq(entry: Omit<DbFaqEntry, 'created_at' | 'updated_at'>): DbFaqEntry {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO faq_entries (id, category, question, answer, keywords, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(entry.id, entry.category, entry.question, entry.answer, entry.keywords ?? null, now, now);
  return { ...entry, created_at: now, updated_at: now };
}

export function updateFaq(id: string, updates: Partial<Pick<DbFaqEntry, 'category' | 'question' | 'answer' | 'keywords'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.question !== undefined) { fields.push('question = ?'); values.push(updates.question); }
  if (updates.answer !== undefined) { fields.push('answer = ?'); values.push(updates.answer); }
  if (updates.keywords !== undefined) { fields.push('keywords = ?'); values.push(updates.keywords); }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE faq_entries SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteFaq(id: string): boolean {
  const stmt = db.prepare('DELETE FROM faq_entries WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 基于关键词检索 FAQ（返回按命中关键词数量排序的结果）
export function searchFaq(query: string, limit: number = 5): DbFaqEntry[] {
  const allFaq = getAllFaq();
  const queryLower = query.toLowerCase();

  const scored = allFaq.map(entry => {
    let score = 0;
    const haystack = `${entry.question} ${entry.answer} ${entry.keywords ?? ''}`.toLowerCase();
    // 简单关键词匹配
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0);
    for (const term of queryTerms) {
      if (haystack.includes(term)) score += 1;
    }
    // 完整问题包含加分
    if (entry.question.toLowerCase().includes(queryLower)) score += 3;
    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

// ============= 工具函数 =============

export interface DbContract {
  id: string;
  session_id: string;
  file_name: string;
  file_type: string | null;
  contract_text: string | null;
  risk_score: number | null;
  risk_level: string | null;
  analysis_json: string | null;
  created_at: string;
}

export function createContract(contract: Omit<DbContract, 'id' | 'created_at'> & { id?: string }): DbContract {
  const id = contract.id ?? randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO contracts (id, session_id, file_name, file_type, contract_text, risk_score, risk_level, analysis_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, contract.session_id, contract.file_name, contract.file_type ?? null, contract.contract_text ?? null, contract.risk_score ?? null, contract.risk_level ?? null, contract.analysis_json ?? null, now);
  return { ...contract, id, created_at: now } as DbContract;
}

export function getContractById(id: string): DbContract | undefined {
  const stmt = db.prepare('SELECT * FROM contracts WHERE id = ?');
  return stmt.get(id) as DbContract | undefined;
}

export function getContractsBySession(sessionId: string): DbContract[] {
  const stmt = db.prepare('SELECT * FROM contracts WHERE session_id = ? ORDER BY created_at DESC');
  return stmt.all(sessionId) as DbContract[];
}

export function getContractsSummary(): Array<Pick<DbContract, 'id' | 'session_id' | 'file_name' | 'risk_score' | 'risk_level' | 'created_at'>> {
  const stmt = db.prepare('SELECT id, session_id, file_name, risk_score, risk_level, created_at FROM contracts ORDER BY created_at DESC');
  return stmt.all() as Array<Pick<DbContract, 'id' | 'session_id' | 'file_name' | 'risk_score' | 'risk_level' | 'created_at'>>;
}

export function getAllContracts(): DbContract[] {
  const stmt = db.prepare('SELECT * FROM contracts ORDER BY created_at DESC');
  return stmt.all() as DbContract[];
}

export function updateContract(id: string, updates: Partial<Pick<DbContract, 'risk_score' | 'risk_level' | 'analysis_json'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.risk_score !== undefined) { fields.push('risk_score = ?'); values.push(updates.risk_score); }
  if (updates.risk_level !== undefined) { fields.push('risk_level = ?'); values.push(updates.risk_level); }
  if (updates.analysis_json !== undefined) { fields.push('analysis_json = ?'); values.push(updates.analysis_json); }

  if (fields.length === 0) return false;
  values.push(id);
  const stmt = db.prepare(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

function randomUUID(): string {
  // 使用 crypto 生成 UUID，避免依赖 uuid 包在 db 层
  return crypto.randomUUID();
}

// 清空所有数据（保留合同记录表结构）
export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM contracts');
}

export default db;
