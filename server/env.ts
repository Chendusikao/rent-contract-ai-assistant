/**
 * 安全加载 .env 环境变量
 * - .env 存在时加载（保留原有内容，不覆盖已存在的环境变量）
 * - .env 不存在时静默跳过（不报错）——配合网页内配置 API Key 使用
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.log('[Env] 未找到 .env 文件（可选），API Key 可通过网页设置页配置');
    return;
  }
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith('#')) continue;
      // 只处理 KEY=VALUE 格式
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // 去除可选引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // 不覆盖已存在的环境变量（process.env 优先）
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (e) {
    console.warn('[Env] 读取 .env 失败（忽略，继续启动）:', e?.message);
  }
}
