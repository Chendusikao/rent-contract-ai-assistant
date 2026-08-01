/**
 * Embedding 服务
 * 本地运行 BGE-small-zh-v1.5（@xenova/transformers + onnxruntime，约 90MB）
 * - 首次运行自动从 HuggingFace 下载（走代理），之后完全离线，无需任何 API Key
 * - 完全本地推理，面试演示稳定
 */
import { pipeline, env } from '@xenova/transformers';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

// 为模型下载配置代理（代理软件监听 127.0.0.1:7890；若用户已开启代理则走代理下载）
// 仅影响模型下载，不影响其他 API（DeepSeek 国内直连）
const PROXY_URL = process.env.EMBEDDING_PROXY || 'http://127.0.0.1:7890';
try {
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  console.log(`[Embedding] 已配置下载代理: ${PROXY_URL}`);
} catch (e) {
  console.error('[Embedding] 代理配置失败，将尝试直连:', e?.message);
}

// 模型下载配置（下载后缓存到 ./data/models，之后离线可用）
env.allowRemoteModels = true;
env.cacheDir = './data/models';

const EMBEDDING_MODEL = 'Xenova/bge-small-zh-v1.5';
const EMBEDDING_DIM = 512; // bge-small-zh 输出维度

let extractorPromise: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      console.log('[Embedding] 正在加载本地模型 bge-small-zh-v1.5（首次需下载约 90MB）...');
      const p = await pipeline('feature-extraction', EMBEDDING_MODEL);
      console.log('[Embedding] 本地模型就绪（后续离线可用）');
      return p;
    })();
  }
  return extractorPromise;
}

/**
 * 对单个文本生成 embedding 向量
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'cls', normalize: true });
  return Array.from(output.data as Float32Array).map(v => Number(v));
}

/**
 * 对多个文本生成 embedding（批量）
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const results: number[][] = [];
  // 分批处理避免内存过大
  const BATCH = 8;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const outputs = await extractor(batch, { pooling: 'cls', normalize: true });

    let batchVectors: number[][];
    if (Array.isArray(outputs)) {
      // 返回数组：每个元素是一个文本的 Tensor
      batchVectors = outputs.map((o: any) => Array.from(o.data as Float32Array).map(v => Number(v)));
    } else if (outputs.dims && outputs.dims.length >= 2 && outputs.dims[0] === batch.length) {
      // 返回单个 Tensor：shape [batch, dim]，需按行切分
      const dim = outputs.dims[outputs.dims.length - 1];
      const flat = Array.from(outputs.data as Float32Array).map(v => Number(v));
      batchVectors = [];
      for (let r = 0; r < batch.length; r++) {
        batchVectors.push(flat.slice(r * dim, (r + 1) * dim));
      }
    } else {
      // 单文本 Tensor
      batchVectors = [Array.from(outputs.data as Float32Array).map(v => Number(v))];
    }
    results.push(...batchVectors);
  }
  return results;
}

export { EMBEDDING_DIM };

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
