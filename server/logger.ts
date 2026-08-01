/**
 * 运行日志收集模块
 * 拦截 console 输出到内存环形缓冲区，提供查询 API
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
}

// 环形缓冲区，最多保留 1000 条
const MAX_LOGS = 1000;
const logs: LogEntry[] = [];
let nextId = 1;
let installed = false;

// 原始 console 方法
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function pushLog(level: LogLevel, args: unknown[]): void {
  // 格式化参数
  let message: string;
  try {
    message = args
      .map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  } catch {
    message = String(args[0] ?? '');
  }

  logs.push({
    id: nextId++,
    timestamp: new Date().toISOString(),
    level,
    message,
  });

  // 超过上限移除最旧
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

// 安装 console 拦截（只装一次）
export function installLogCapture(): void {
  if (installed) return;
  installed = true;

  console.log = (...args: unknown[]) => {
    pushLog('info', args);
    originalConsole.log(...args);
  };
  console.info = (...args: unknown[]) => {
    pushLog('info', args);
    originalConsole.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushLog('warn', args);
    originalConsole.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushLog('error', args);
    originalConsole.error(...args);
  };

  console.log('[Logger] 日志收集已启用');
}

// 查询日志
export function getLogs(options?: {
  limit?: number;
  level?: LogLevel | 'all';
  search?: string;
}): LogEntry[] {
  const { limit = 200, level = 'all', search } = options ?? {};

  let result = logs;

  if (level && level !== 'all') {
    result = result.filter(l => l.level === level);
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(l => l.message.toLowerCase().includes(s));
  }

  return result.slice(-limit).reverse(); // 最新在前
}

// 清空日志
export function clearLogs(): void {
  logs.length = 0;
}
