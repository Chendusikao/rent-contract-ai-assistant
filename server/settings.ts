/**
 * 运行时设置管理
 * - 优先读取 data/settings.json（用户通过界面保存的配置，不会被 git 跟踪）
 * - 回退读取 .env 环境变量（部署场景）
 * 文件位于 data/ 目录，已加入 .gitignore，不会泄漏给下载项目的人
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

interface AppSettings {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
}

let cache: AppSettings | null = null;

function ensureDataDir(): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readSettings(): AppSettings {
  if (cache) return cache;
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      cache = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as AppSettings;
    }
  } catch (e) {
    console.error('[Settings] 读取 settings.json 失败:', e?.message);
  }
  cache = cache || {};
  return cache;
}

/**
 * 获取 DeepSeek API Key（界面设置优先，回退环境变量）
 */
export function getDeepSeekApiKey(): string {
  const fromSettings = readSettings().deepseekApiKey;
  if (fromSettings) return fromSettings;
  return process.env.DEEPSEEK_API_KEY || '';
}

/**
 * 获取 DeepSeek Base URL（界面设置优先，回退环境变量）
 */
export function getDeepSeekBaseUrl(): string {
  const fromSettings = readSettings().deepseekBaseUrl;
  if (fromSettings) return fromSettings;
  return process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
}

/**
 * 保存 DeepSeek 配置到 settings.json（持久化）
 */
export function saveDeepSeekConfig(apiKey: string, baseUrl?: string): void {
  ensureDataDir();
  const settings = readSettings();
  settings.deepseekApiKey = apiKey;
  if (baseUrl) {
    settings.deepseekBaseUrl = baseUrl;
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  cache = settings;
  console.log('[Settings] DeepSeek 配置已保存到 data/settings.json');
}

/**
 * 获取当前配置状态（用于前端展示，Key 打码）
 */
export function getDeepSeekConfigStatus(): { configured: boolean; source: 'settings' | 'env' | 'none'; maskedKey: string } {
  const fromSettings = readSettings().deepseekApiKey;
  const fromEnv = process.env.DEEPSEEK_API_KEY;

  if (fromSettings) {
    return {
      configured: true,
      source: 'settings',
      maskedKey: maskKey(fromSettings),
    };
  }
  if (fromEnv) {
    return {
      configured: true,
      source: 'env',
      maskedKey: maskKey(fromEnv),
    };
  }
  return { configured: false, source: 'none', maskedKey: '' };
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '****';
  return key.slice(0, 8) + '****' + key.slice(-4);
}
