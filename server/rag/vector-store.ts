/**
 * 向量存储与语义检索（sqlite-vec + 本地 BGE-small-zh）
 * - 合同条款分块入库（按合同维度隔离）
 * - 法规知识库入库（全局共享）
 * - 语义检索：本地模型生成 query 向量 + sqlite-vec 余弦相似度；向量缺失时降级 TF-IDF
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { embedTexts, EMBEDDING_DIM } from './embedder.js';

const DB_PATH = './data/chat.db';

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    sqliteVec.load(dbInstance);
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS plain_chunks (
        chunk_id TEXT PRIMARY KEY,
        contract_id TEXT,
        chunk_index INTEGER,
        text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_plain_chunks_contract ON plain_chunks(contract_id);

      -- 知识条目（可进化的法规/常识库，网页可管理）
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        hit_count INTEGER DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        not_helpful_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_enabled ON knowledge_items(enabled);
    `);
  }
  return dbInstance;
}

export interface Chunk {
  id: string;
  contractId: string;
  index: number;
  text: string;
  embedding: number[];
}

// ============= 合同文本分块 =============

const CHUNK_SIZE = 600;     // 每块最大字符数
const CHUNK_OVERLAP = 100;  // 块间重叠，保持语义连贯

/**
 * 按条款（第X条）优先分块，超长再按长度切分
 */
export function chunkContractText(text: string): string[] {
  // 尝试按"第X条"切分
  const clausePattern = /第[一二三四五六七八九十百千万0-9]+条/g;
  const matches = [...text.matchAll(clausePattern)];
  const chunks: string[] = [];

  if (matches.length >= 3) {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i < matches.length - 1 ? matches[i + 1].index! : text.length;
      let clause = text.slice(start, end).trim();
      if (clause.length > CHUNK_SIZE) {
        chunks.push(...splitByLength(clause, start));
      } else if (clause.length > 20) {
        chunks.push(clause);
      }
    }
  } else {
    chunks.push(...splitByLength(text, 0));
  }

  return chunks.filter(c => c.length >= 10);
}

function splitByLength(text: string, offset: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const part = text.slice(i, i + CHUNK_SIZE);
    if (part.trim().length >= 10) {
      parts.push(part.trim());
    }
  }
  return parts;
}

// ============= 入库 =============

/**
 * 将合同分块入库（有 API 时同时存向量）
 */
export async function indexContract(
  contractId: string,
  contractText: string
): Promise<number> {
  const db = getDb();
  const chunks = chunkContractText(contractText);

  // 删除该合同的旧索引
  db.prepare('DELETE FROM plain_chunks WHERE contract_id = ?').run(contractId);

  const insertStmt = db.prepare(`
    INSERT INTO plain_chunks (chunk_id, contract_id, chunk_index, text)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    chunks.forEach((text, i) => {
      insertStmt.run(`${contractId}:${i}`, contractId, i, text);
    });
  });
  tx();

  // 生成向量并入库（本地模型，异步执行不阻塞主流程）
  embedTexts(chunks)
    .then(vectors => {
      const vecDb = new Database(DB_PATH);
      sqliteVec.load(vecDb);
      try {
        vecDb.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id TEXT PRIMARY KEY,
            contract_id TEXT,
            chunk_index FLOAT,
            text TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
        vecDb.prepare('DELETE FROM vec_chunks WHERE contract_id = ?').run(contractId);
        const ins = vecDb.prepare('INSERT INTO vec_chunks (chunk_id, contract_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)');
        const tx2 = vecDb.transaction(() => {
          chunks.forEach((t, i) => ins.run(`${contractId}:${i}`, contractId, i, t, JSON.stringify(vectors[i])));
        });
        tx2();
        console.log(`[Vector] 合同 ${contractId} 向量索引完成: ${chunks.length} 块`);
      } finally {
        vecDb.close();
      }
    })
    .catch(e => console.error('[Vector] 向量索引失败（继续使用关键词检索）:', e?.message));

  console.log(`[Vector] 合同 ${contractId} 已索引 ${chunks.length} 个分块`);
  return chunks.length;
}

// ============= TF-IDF 关键词检索（降级方案） =============

function tokenize(text: string): string[] {
  // 中文按字/词切分：2-gram + 提取连续中文字符
  const cjk = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const terms = new Set<string>();
  for (const seq of cjk) {
    // 2-gram
    for (let i = 0; i < seq.length - 1; i++) {
      terms.add(seq.slice(i, i + 2));
    }
  }
  // 英文数字词
  const latin = text.match(/[a-zA-Z0-9]{2,}/g) || [];
  latin.forEach(w => terms.add(w.toLowerCase()));
  return [...terms];
}

function tfidfSearch(chunks: { chunk_id: string; chunk_index: number; text: string }[], query: string, topK: number): { chunk_index: number; text: string; score: number }[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const docCount = chunks.length;
  const df = new Map<string, number>();

  for (const c of chunks) {
    const terms = new Set(tokenize(c.text));
    for (const t of terms) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const scored = chunks.map(c => {
    const terms = tokenize(c.text);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const qt of queryTerms) {
      const t = tf.get(qt);
      if (t) {
        const idf = Math.log((docCount + 1) / ((df.get(qt) || 0) + 1)) + 1;
        score += (t / terms.length) * idf;
      }
    }
    return { chunk_index: c.chunk_index, text: c.text, score };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============= 语义检索 =============

export interface RetrievedChunk {
  contractId: string;
  index: number;
  text: string;
  score: number;
  kbId?: string;  // 知识条目 id（来自 knowledge_items，反馈统计用）
}

/**
 * 检索与 query 最相关的合同分块（语义优先，降级关键词）
 */
export async function searchContractChunks(
  contractId: string,
  query: string,
  topK = 4
): Promise<RetrievedChunk[]> {
  const db = getDb();
  const rows = db.prepare('SELECT chunk_id, chunk_index, text FROM plain_chunks WHERE contract_id = ?')
    .all(contractId) as { chunk_id: string; chunk_index: number; text: string }[];

  if (rows.length === 0) return [];

  // 语义检索（sqlite-vec 向量距离查询）
  try {
    const vecDb = new Database(DB_PATH);
    sqliteVec.load(vecDb);
    try {
      const [queryVec] = await embedTexts([query]);
      // vec_distance_cosine(embedding, ?) 返回余弦距离，越小越相似；第一个参数必须是列名
      const vecRows = vecDb.prepare(`
        SELECT chunk_id, chunk_index, text, vec_distance_cosine(embedding, ?) AS distance
        FROM vec_chunks WHERE contract_id = ?
        ORDER BY distance ASC LIMIT ?
      `).all(JSON.stringify(queryVec), contractId, topK) as { chunk_id: string; chunk_index: number; text: string; distance: number }[];

      if (vecRows.length > 0) {
        const results = vecRows.map(row => ({
          contractId,
          index: row.chunk_index,
          text: row.text,
          score: 1 - row.distance, // 余弦距离 → 相似度（归一化向量，distance∈[0,2]）
        }));
        // 距离过远视为无关（distance > 0.7 ≈ 相似度 < 0.3）
        return results.filter(r => r.score > 0.3);
      }
    } finally {
      vecDb.close();
    }
  } catch (e) {
    console.error('[Vector] 语义检索失败，降级关键词检索:', e?.message);
  }

  // 降级：TF-IDF 关键词检索
  const results = tfidfSearch(rows, query, topK).map(r => ({
    contractId,
    index: r.chunk_index,
    text: r.text,
    score: r.score,
  }));
  return results;
}

/**
 * 检索全局法规知识库（混合检索：语义向量 + BM25 关键词加权）
 */
export async function searchLawKnowledgeBase(query: string, topK = 3): Promise<RetrievedChunk[]> {
  const db = getDb();
  const rows = db.prepare("SELECT chunk_id, chunk_index, text FROM plain_chunks WHERE contract_id = '__LAW_KB__'")
    .all() as { chunk_id: string; chunk_index: number; text: string }[];

  if (rows.length === 0) return [];

  let semanticResults: RetrievedChunk[] | null = null;

  // 语义检索（sqlite-vec 向量距离查询）
  try {
    const vecDb = new Database(DB_PATH);
    sqliteVec.load(vecDb);
    try {
      const [queryVec] = await embedTexts([query]);
      const vecRows = vecDb.prepare(`
        SELECT chunk_id, chunk_index, text, vec_distance_cosine(embedding, ?) AS distance
        FROM vec_chunks WHERE contract_id = '__LAW_KB__'
        ORDER BY distance ASC LIMIT ?
      `).all(JSON.stringify(queryVec), Math.max(topK * 3, 10)) as { chunk_id: string; chunk_index: number; text: string; distance: number }[];

      if (vecRows.length > 0) {
        semanticResults = vecRows.map(row => ({
          contractId: '__LAW_KB__',
          index: row.chunk_index,
          text: row.text,
          score: 1 - row.distance,
        }));
      }
    } finally {
      vecDb.close();
    }
  } catch (e) {
    console.error('[Vector] 法规库语义检索失败，降级关键词检索:', e?.message);
  }

  // BM25 关键词检索（独立于语义）
  const keywordResults = tfidfSearch(rows, query, topK * 3);

  // 混合融合：语义 + 关键词加权合并（RRF 风格）
  const merged = fuseResults(semanticResults || [], keywordResults, topK);

  // 附加知识条目 id（chunk_id 形如 law:xxx 或 law:seed-N 或 law:mig-xxx）
  if (merged.length > 0) {
    try {
      const chunkRows = db.prepare(`
        SELECT chunk_id, chunk_index FROM plain_chunks WHERE contract_id = '__LAW_KB__' AND chunk_index IN (${merged.map(() => '?').join(',')})
      `).all(...merged.map(m => m.index)) as { chunk_id: string; chunk_index: number }[];
      const idByIndex = new Map(chunkRows.map(r => [r.chunk_index, r.chunk_id.replace(/^law:/, '')]));
      for (const m of merged) {
        m.kbId = idByIndex.get(m.index) || undefined;
      }
    } catch { /* 附加失败不影响检索 */ }
  }

  // 记录命中（用于知识库统计，按 kbId 精确匹配）
  if (merged.length > 0) {
    try {
      const kbIds = merged.map(m => m.kbId).filter(Boolean);
      if (kbIds.length > 0) {
        const placeholders = kbIds.map(() => '?').join(',');
        db.prepare(`UPDATE knowledge_items SET hit_count = hit_count + 1, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...kbIds);
      }
    } catch { /* 统计失败不影响检索 */ }
  }

  return merged;
}

/**
 * RRF 风格混合融合：语义结果 + 关键词结果按排名加权合并
 */
function fuseResults(
  semantic: RetrievedChunk[],
  keyword: { chunk_index: number; text: string; score: number }[],
  topK: number
): RetrievedChunk[] {
  const scoreMap = new Map<number, { text: string; score: number }>();

  // 语义：排名贡献（1 / (60 + rank)）
  semantic.forEach((r, i) => {
    const rank = i + 1;
    const s = 1 / (60 + rank);
    const existing = scoreMap.get(r.index);
    if (existing) {
      existing.score += s;
      // 保留更高分
      if (r.score > s) existing.score += r.score * 0.3;
    } else {
      scoreMap.set(r.index, { text: r.text, score: s });
    }
  });

  // 关键词：排名贡献 + 原始分数加权
  keyword.forEach((r, i) => {
    const rank = i + 1;
    const s = 1 / (60 + rank) + r.score * 0.5;
    const existing = scoreMap.get(r.chunk_index);
    if (existing) {
      existing.score += s;
    } else {
      scoreMap.set(r.chunk_index, { text: r.text, score: s });
    }
  });

  return [...scoreMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([index, v]) => ({
      contractId: '__LAW_KB__',
      index,
      text: v.text,
      score: Math.min(1, v.score),
    }));
}

/**
 * 初始化法规知识库（幂等）
 * 种子同时写入 knowledge_items（管理页可见）+ plain_chunks（检索用）
 */
export async function seedLawKnowledgeBase(entries: { title: string; content: string }[]): Promise<void> {
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) as c FROM plain_chunks WHERE contract_id = '__LAW_KB__'").get() as { c: number };

  // 旧格式迁移：已有 plain_chunks 但 knowledge_items 为空 → 从 plain_chunks 恢复
  const itemCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_items').get() as { c: number }).c;
  if (itemCount === 0 && existing.c > 0) {
    console.log(`[Vector] 检测到旧版知识库（${existing.c} 条），迁移到 knowledge_items...`);
    const oldRows = db.prepare("SELECT chunk_id, chunk_index, text FROM plain_chunks WHERE contract_id = '__LAW_KB__'").all() as { chunk_id: string; chunk_index: number; text: string }[];
    const tx = db.transaction(() => {
      for (const row of oldRows) {
        const match = row.text.match(/^【(.+?)】/);
        const title = match ? match[1] : `知识条目 ${row.chunk_index + 1}`;
        const content = match ? row.text.slice(match[0].length) : row.text;
        const kbId = `mig-${row.chunk_index}`;
        db.prepare(`
          INSERT OR IGNORE INTO knowledge_items (id, title, content, enabled, created_at, updated_at)
          VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
        `).run(kbId, title, content);
        // 重写 chunk_id 为 law:{kbId}，与 knowledge_items 对齐
        db.prepare("UPDATE plain_chunks SET chunk_id = ? WHERE chunk_id = ?").run(`law:${kbId}`, row.chunk_id);
      }
    });
    tx();
    console.log(`[Vector] 旧版知识库迁移完成`);
    return;
  }

  if (existing.c > 0) {
    console.log(`[Vector] 法规知识库已存在 ${existing.c} 条，跳过初始化`);
    return;
  }

  const chunks: string[] = [];
  entries.forEach(e => {
    const title = `【${e.title}】`;
    if (e.content.length <= 400) {
      chunks.push(`${title}${e.content}`);
    } else {
      for (let i = 0; i < e.content.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(`${title}${e.content.slice(i, i + CHUNK_SIZE)}`);
      }
    }
  });

  const insertStmt = db.prepare(`
    INSERT INTO plain_chunks (chunk_id, contract_id, chunk_index, text)
    VALUES (?, ?, ?, ?)
  `);
  const insertItemStmt = db.prepare(`
    INSERT INTO knowledge_items (id, title, content, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
  `);
  const tx = db.transaction(() => {
    chunks.forEach((text, i) => {
      insertStmt.run(`law:seed-${i}`, '__LAW_KB__', i, text);
    });
    // 种子条目写入 knowledge_items（供管理页展示）
    entries.forEach((e, i) => {
      insertItemStmt.run(`seed-${i}`, e.title, e.content);
    });
  });
  tx();

  // 生成向量（本地模型，异步执行）
  embedTexts(chunks)
    .then(vectors => {
      const vecDb = new Database(DB_PATH);
      sqliteVec.load(vecDb);
      try {
        vecDb.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id TEXT PRIMARY KEY,
            contract_id TEXT,
            chunk_index FLOAT,
            text TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
        const ins = vecDb.prepare('INSERT INTO vec_chunks (chunk_id, contract_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)');
        const tx2 = vecDb.transaction(() => {
          chunks.forEach((t, i) => ins.run(`law:seed-${i}`, '__LAW_KB__', i, t, JSON.stringify(vectors[i])));
        });
        tx2();
        console.log(`[Vector] 法规知识库向量化完成: ${chunks.length} 条`);
      } finally {
        vecDb.close();
      }
    })
    .catch(e => console.error('[Vector] 法规库向量化失败（继续使用关键词检索）:', e?.message));

  console.log(`[Vector] 法规知识库初始化完成，共 ${chunks.length} 条（语义向量模式）`);
}

// ============= 知识条目管理（可进化 RAG） =============

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  enabled: number;
  hit_count: number;
  helpful_count: number;
  not_helpful_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * 将知识条目内容转成检索用文本块（带标题前缀）
 */
function knowledgeToChunk(item: { title: string; content: string }): string {
  const title = `【${item.title}】`;
  return title + item.content;
}

/**
 * 插入一条知识（同步写 plain_chunks，异步向量化）
 */
export async function addKnowledgeItem(item: { id: string; title: string; content: string }): Promise<void> {
  const db = getDb();
  const text = knowledgeToChunk(item);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO knowledge_items (id, title, content, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(item.id, item.title, item.content, now, now);

  // 写检索索引（chunk_index 用自增序号）
  const maxIdx = db.prepare("SELECT COALESCE(MAX(chunk_index), -1) as m FROM plain_chunks WHERE contract_id = '__LAW_KB__'").get() as { m: number };
  db.prepare(`
    INSERT INTO plain_chunks (chunk_id, contract_id, chunk_index, text)
    VALUES (?, '__LAW_KB__', ?, ?)
  `).run(`law:${item.id}`, maxIdx.m + 1, text);

  // 向量化
  embedTexts([text]).then(vectors => {
    const vecDb = new Database(DB_PATH);
    sqliteVec.load(vecDb);
    try {
      vecDb.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
          chunk_id TEXT PRIMARY KEY,
          contract_id TEXT,
          chunk_index FLOAT,
          text TEXT,
          embedding float[${EMBEDDING_DIM}]
        );
      `);
      vecDb.prepare('INSERT INTO vec_chunks (chunk_id, contract_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)')
        .run(`law:${item.id}`, '__LAW_KB__', maxIdx.m + 1, text, JSON.stringify(vectors[0]));
    } finally {
      vecDb.close();
    }
  }).catch(e => console.error('[Vector] 新增知识向量化失败:', e?.message));

  console.log(`[Vector] 已添加知识条目: ${item.title}`);
}

/**
 * 更新知识条目（重新向量化）
 */
export async function updateKnowledgeItem(id: string, updates: { title?: string; content?: string; enabled?: boolean }): Promise<boolean> {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id) as KnowledgeItem | undefined;
  if (!existing) return false;

  const title = updates.title ?? existing.title;
  const content = updates.content ?? existing.content;
  const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled;
  const text = knowledgeToChunk({ title, content });

  db.prepare(`
    UPDATE knowledge_items SET title = ?, content = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, content, enabled, id);

  // 更新检索索引
  db.prepare("DELETE FROM plain_chunks WHERE chunk_id = ?").run(`law:${id}`);
  if (enabled) {
    db.prepare(`
      INSERT INTO plain_chunks (chunk_id, contract_id, chunk_index, text)
      VALUES (?, '__LAW_KB__', ?, ?)
    `).run(`law:${id}`, existing.chunk_index ?? 0, text);
  }

  // 重新向量化
  const vecDb = new Database(DB_PATH);
  sqliteVec.load(vecDb);
  try {
    vecDb.prepare('DELETE FROM vec_chunks WHERE chunk_id = ?').run(`law:${id}`);
    if (enabled) {
      const [vec] = await embedTexts([text]);
      vecDb.prepare('INSERT INTO vec_chunks (chunk_id, contract_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)')
        .run(`law:${id}`, '__LAW_KB__', existing.chunk_index ?? 0, text, JSON.stringify(vec));
    }
  } finally {
    vecDb.close();
  }

  console.log(`[Vector] 已更新知识条目: ${title} (enabled=${enabled})`);
  return true;
}

/**
 * 删除知识条目（软删除：enabled=0，保留统计）
 */
export async function deleteKnowledgeItem(id: string): Promise<boolean> {
  return updateKnowledgeItem(id, { enabled: false });
}

/**
 * 记录知识反馈（帮助/不帮助）
 */
export function recordKnowledgeFeedback(id: string, helpful: boolean): void {
  const db = getDb();
  const field = helpful ? 'helpful_count' : 'not_helpful_count';
  db.prepare(`UPDATE knowledge_items SET ${field} = ${field} + 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

/**
 * 知识条目列表（按命中数/帮助率排序）
 */
export function listKnowledgeItems(): KnowledgeItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM knowledge_items ORDER BY enabled DESC, hit_count DESC, created_at DESC')
    .all() as KnowledgeItem[];
}

/**
 * 知识库统计
 */
export function getKnowledgeStats(): { total: number; enabled: number; totalHits: number; totalHelpful: number; helpfulRate: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM knowledge_items').get() as { c: number }).c;
  const enabled = (db.prepare('SELECT COUNT(*) as c FROM knowledge_items WHERE enabled = 1').get() as { c: number }).c;
  const totalHits = (db.prepare('SELECT COALESCE(SUM(hit_count),0) as s FROM knowledge_items').get() as { s: number }).s;
  const totalHelpful = (db.prepare('SELECT COALESCE(SUM(helpful_count),0) as s FROM knowledge_items').get() as { s: number }).s;
  const totalNotHelpful = (db.prepare('SELECT COALESCE(SUM(not_helpful_count),0) as s FROM knowledge_items').get() as { s: number }).s;
  const feedbackTotal = totalHelpful + totalNotHelpful;
  return {
    total,
    enabled,
    totalHits,
    totalHelpful,
    helpfulRate: feedbackTotal > 0 ? totalHelpful / feedbackTotal : 0,
  };
}
