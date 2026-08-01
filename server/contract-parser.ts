/**
 * 合同文件解析模块
 * 支持 .docx（mammoth）、.pdf（pdf-parse）、.jpg/.png（tesseract.js OCR）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParseResult {
  text: string;
  fileName: string;
  fileType: string;
  characterCount: number;
}

// 支持的文件类型
export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export function getFileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function isSupportedFile(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(getFileExtension(fileName));
}

export function getFileTypeLabel(fileName: string): string {
  const ext = getFileExtension(fileName);
  switch (ext) {
    case '.pdf': return 'PDF';
    case '.docx': return 'Word 文档';
    case '.doc': return 'Word 文档（旧版）';
    case '.jpg': case '.jpeg': return '图片';
    case '.png': return '图片';
    default: return ext || '未知类型';
  }
}

// 解析 PDF（动态导入 pdf-parse）
async function parsePdf(filePath: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const dataBuffer = fs.readFileSync(filePath);
  const result = await pdfParse(dataBuffer);
  return result.text || '';
}

// 解析 docx（动态导入 mammoth）
async function parseDocx(filePath: string): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

// 解析 .doc（旧格式）— 提示需要转换
async function parseDoc(filePath: string): Promise<string> {
  return Promise.reject(new Error('旧版 .doc 格式暂不支持，请另存为 .docx 或 PDF 后上传'));
}

// OCR 解析图片（tesseract.js 中文识别）
let ocrWorkerPromise: Promise<any> | null = null;

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      console.log('[OCR] 正在初始化中文识别引擎（首次约需下载语言包）...');
      const worker = await createWorker('chi_sim+eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            const pct = Math.round(m.progress * 100);
            if (pct % 25 === 0) console.log(`[OCR] 识别进度: ${pct}%`);
          }
        },
      });
      console.log('[OCR] 中文识别引擎就绪');
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

// OCR 识别图片为文本
async function parseImage(filePath: string): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(filePath);
  return data.text || '';
}

// 关闭 OCR worker（进程退出时调用）
export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorkerPromise) {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
    ocrWorkerPromise = null;
  }
}

/**
 * 解析合同文件为文本
 */
export async function parseContractFile(filePath: string, fileName: string): Promise<ParseResult> {
  const ext = getFileExtension(fileName);

  let text = '';
  switch (ext) {
    case '.pdf':
      text = await parsePdf(filePath);
      break;
    case '.docx':
      text = await parseDocx(filePath);
      break;
    case '.doc':
      text = await parseDoc(filePath);
      break;
    case '.jpg':
    case '.jpeg':
    case '.png':
      text = await parseImage(filePath);
      break;
    default:
      throw new Error(`不支持的文件类型: ${ext}，请上传 PDF、Word 文档或图片`);
  }

  // 清理多余空白
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length < 20) {
    if (IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error('未能从图片中识别到文字。请确认图片清晰、文字正立，或改用文字版 PDF/Word 上传。');
    }
    throw new Error('未能从文件中提取到文本内容。如果是扫描件/图片版 PDF，请使用文字版 PDF 或 Word 文档重新上传。');
  }

  return {
    text: cleaned,
    fileName,
    fileType: getFileTypeLabel(fileName),
    characterCount: cleaned.length,
  };
}

/**
 * 清理上传的临时文件
 */
export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('[Parser] 清理临时文件失败:', e);
  }
}

// 上传临时目录
export const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
