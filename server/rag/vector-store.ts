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
 * 检索全局法规知识库
 */
export async function searchLawKnowledgeBase(query: string, topK = 3): Promise<RetrievedChunk[]> {
  const db = getDb();
  const rows = db.prepare("SELECT chunk_id, chunk_index, text FROM plain_chunks WHERE contract_id = '__LAW_KB__'")
    .all() as { chunk_id: string; chunk_index: number; text: string }[];

  if (rows.length === 0) return [];

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
      `).all(JSON.stringify(queryVec), topK) as { chunk_id: string; chunk_index: number; text: string; distance: number }[];

      if (vecRows.length > 0) {
        const results = vecRows.map(row => ({
          contractId: '__LAW_KB__',
          index: row.chunk_index,
          text: row.text,
          score: 1 - row.distance,
        }));
        return results.filter(r => r.score > 0.35);
      }
    } finally {
      vecDb.close();
    }
  } catch (e) {
    console.error('[Vector] 法规库语义检索失败，降级关键词检索:', e?.message);
  }

  return tfidfSearch(rows, query, topK).map(r => ({
    contractId: '__LAW_KB__',
    index: r.chunk_index,
    text: r.text,
    score: r.score,
  }));
}

/**
 * 初始化法规知识库（幂等）
 */
export async function seedLawKnowledgeBase(entries: { title: string; content: string }[]): Promise<void> {
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) as c FROM plain_chunks WHERE contract_id = '__LAW_KB__'").get() as { c: number };
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
  const tx = db.transaction(() => {
    chunks.forEach((text, i) => {
      insertStmt.run(`law:${i}`, '__LAW_KB__', i, text);
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
          chunks.forEach((t, i) => ins.run(`law:${i}`, '__LAW_KB__', i, t, JSON.stringify(vectors[i])));
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
