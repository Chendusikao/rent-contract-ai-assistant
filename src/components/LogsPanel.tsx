import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Button, Select, Input, Tag, MessagePlugin, Tooltip } from 'tdesign-react';
import { RefreshIcon, DeleteIcon, StopCircleIcon, PlayCircleIcon } from 'tdesign-icons-react';
import { api } from '../api';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  info: { label: '信息', color: '#0052d9', bg: '#0052d918' },
  warn: { label: '警告', color: '#e37318', bg: '#e3731818' },
  error: { label: '错误', color: '#e34d59', bg: '#e34d5918' },
};

const REFRESH_INTERVAL = 3000; // 3 秒自动刷新

export function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstLoadRef = useRef(true);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (level !== 'all') params.set('level', level);
      if (search) params.set('search', search);

      const res = await fetch(api(`/api/logs?${params.toString()}`));
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        // 首次加载滚到底部（最新）
        if (firstLoadRef.current && scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          firstLoadRef.current = false;
        }
      }
    } catch (e) {
      console.error('获取日志失败:', e);
    }
  }, [level, search]);

  // 自动刷新
  useEffect(() => {
    if (autoRefresh) {
      fetchLogs();
      timerRef.current = setInterval(fetchLogs, REFRESH_INTERVAL);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  const handleRefresh = async () => {
    setLoading(true);
    await fetchLogs();
    setLoading(false);
  };

  const handleClear = async () => {
    const confirmed = window.confirm('确定要清空所有日志吗？');
    if (!confirmed) return;
    try {
      const res = await fetch(api('/api/logs'), { method: 'DELETE' });
      if (res.ok) {
        setLogs([]);
        MessagePlugin.success('日志已清空');
      }
    } catch (e) {
      MessagePlugin.error('清空失败');
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  return (
    <Card bordered>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            级别
          </span>
          <Select
            value={level}
            onChange={(v) => setLevel(v as any)}
            style={{ width: 110 }}
            options={[
              { label: '全部', value: 'all' },
              { label: '信息', value: 'info' },
              { label: '警告', value: 'warn' },
              { label: '错误', value: 'error' },
            ]}
          />
        </div>
        <Input
          value={search}
          onChange={(v) => setSearch(v as string)}
          placeholder="搜索关键词（如 sessionId、意图）"
          clearable
          style={{ width: 260 }}
        />
        <div className="flex-1" />
        <Tooltip content={autoRefresh ? '暂停自动刷新' : '开启自动刷新（3 秒）'}>
          <Button
            variant="text"
            shape="circle"
            icon={autoRefresh ? <StopCircleIcon /> : <PlayCircleIcon />}
            onClick={() => setAutoRefresh(!autoRefresh)}
          />
        </Tooltip>
        <Button variant="outline" icon={<RefreshIcon />} loading={loading} onClick={handleRefresh}>
          刷新
        </Button>
        <Button variant="outline" theme="danger" icon={<DeleteIcon />} onClick={handleClear}>
          清空
        </Button>
      </div>

      {/* 日志内容 */}
      <div
        ref={scrollRef}
        className="rounded-lg overflow-y-auto"
        style={{
          height: 'calc(100vh - 320px)',
          minHeight: 300,
          backgroundColor: 'var(--td-bg-color-component)',
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          fontSize: 12,
        }}
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--td-text-color-placeholder)' }}>
            暂无日志
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {logs.map(log => {
              const meta = LEVEL_META[log.level] || LEVEL_META.info;
              return (
                <div
                  key={log.id}
                  className="flex gap-2 items-start py-0.5 px-1.5 rounded hover:opacity-90"
                  style={{ backgroundColor: 'transparent' }}
                >
                  <span className="flex-shrink-0" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {formatTime(log.timestamp)}
                  </span>
                  <Tag
                    size="small"
                    variant="light"
                    style={{
                      color: meta.color,
                      backgroundColor: meta.bg,
                      borderColor: 'transparent',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {meta.label}
                  </Tag>
                  <pre
                    className="flex-1 whitespace-pre-wrap break-all leading-relaxed m-0"
                    style={{
                      color: log.level === 'error'
                        ? meta.color
                        : log.level === 'warn'
                          ? meta.color
                          : 'var(--td-text-color-primary)',
                    }}
                  >
                    {log.message}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
