import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Input,
  Button,
  MessagePlugin,
  Tag,
} from 'tdesign-react';
import {
  CheckCircleFilledIcon,
  CloseCircleFilledIcon,
  RefreshIcon,
} from 'tdesign-icons-react';
import { api } from '../api';

interface DeepSeekStatus {
  status: 'no_key' | 'ok' | 'error' | 'checking';
  message: string;
  apiKey: string;
}

export function SettingsPage() {
  // DeepSeek API 配置
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<DeepSeekStatus>({ status: 'checking', message: '正在检查连接状态...', apiKey: '' });

  // 检查 DeepSeek 连接状态
  const checkStatus = useCallback(async () => {
    setStatus(prev => ({ ...prev, status: 'checking', message: '正在检查连接状态...' }));
    try {
      const res = await fetch(api('/api/deepseek-status'));
      const data = await res.json();
      setStatus({
        status: data.status === 'no_key' ? 'no_key' : data.status === 'ok' ? 'ok' : 'error',
        message: data.message || '',
        apiKey: data.apiKey || '',
      });
    } catch (e: any) {
      setStatus({ status: 'error', message: e?.message || '无法连接后端服务', apiKey: '' });
    }
  }, []);

  // 初始化时检查
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // 保存配置
  const handleSave = async () => {
    if (!apiKey.trim()) {
      MessagePlugin.warning('请填写 DeepSeek API Key');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(api('/api/save-deepseek-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        MessagePlugin.success(data.message);
        setApiKey('');
        setBaseUrl('');
        checkStatus();
      } else {
        MessagePlugin.error(data.error || '保存失败');
      }
    } catch (e: any) {
      MessagePlugin.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 页面标题 */}
        <div>
          <h1
            className="text-2xl font-semibold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            设置
          </h1>
          <p style={{ color: 'var(--td-text-color-secondary)' }}>
            配置 DeepSeek API，合同分析的 AI 引擎
          </p>
        </div>

        {/* DeepSeek API 配置 */}
        <Card title="DeepSeek API 配置" bordered>
          {/* 当前状态 */}
          <div className="flex items-center gap-3 mb-6">
            {status.status === 'checking' ? (
              <>
                <RefreshIcon size="20px" className="animate-spin" style={{ color: 'var(--td-text-color-placeholder)' }} />
                <span style={{ color: 'var(--td-text-color-secondary)' }}>
                  {status.message}
                </span>
              </>
            ) : status.status === 'ok' ? (
              <>
                <CheckCircleFilledIcon size="20px" style={{ color: 'var(--td-success-color)' }} />
                <span style={{ color: 'var(--td-text-color-primary)' }}>
                  API 连接正常
                </span>
                {status.apiKey && (
                  <Tag size="small" variant="light">
                    {status.apiKey}
                  </Tag>
                )}
              </>
            ) : status.status === 'no_key' ? (
              <>
                <CloseCircleFilledIcon size="20px" style={{ color: 'var(--td-text-color-placeholder)' }} />
                <span style={{ color: 'var(--td-text-color-secondary)' }}>
                  未配置 API Key，请在下方填写并点击"验证并保存"
                </span>
              </>
            ) : (
              <>
                <CloseCircleFilledIcon size="20px" style={{ color: 'var(--td-danger-color)' }} />
                <span style={{ color: 'var(--td-danger-color)' }}>
                  {status.message}
                </span>
              </>
            )}
            <Button variant="text" size="small" icon={<RefreshIcon />} onClick={checkStatus}>
              刷新
            </Button>
          </div>

          {/* 表单 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>
                API Key <span style={{ color: 'var(--td-danger-color)' }}>*</span>
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(v) => setApiKey(v as string)}
                placeholder="sk-..."
                style={{ maxWidth: 480 }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                获取地址：https://platform.deepseek.com/api_keys
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>
                Base URL <span style={{ color: 'var(--td-text-color-placeholder)' }}>(可选)</span>
              </label>
              <Input
                value={baseUrl}
                onChange={(v) => setBaseUrl(v as string)}
                placeholder="https://api.deepseek.com"
                style={{ maxWidth: 480 }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button theme="primary" loading={saving} onClick={handleSave}>
                验证并保存
              </Button>
              <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                验证通过后保存到本地配置，重启后依然有效
              </span>
            </div>
          </div>
        </Card>

        {/* 使用说明 */}
        <Card title="使用说明" bordered>
          <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--td-text-color-secondary)' }}>
            <div className="flex items-start gap-2">
              <span>1.</span>
              <span>合同分析使用 DeepSeek 模型，支持 <strong>DeepSeek V3</strong>（deepseek-chat）和 <strong>DeepSeek R1</strong>（deepseek-reasoner）。</span>
            </div>
            <div className="flex items-start gap-2">
              <span>2.</span>
              <span>在首页上传租房合同（PDF 或 Word），AI 会自动解析并生成风险分析报告。</span>
            </div>
            <div className="flex items-start gap-2">
              <span>3.</span>
              <span>报告生成后支持继续追问，可针对任意条款咨询含义、风险和谈判建议。</span>
            </div>
            <div className="flex items-start gap-2">
              <span>4.</span>
              <span>历史分析记录可在「分析记录」中查看，运行问题可在「分析记录 → 运行日志」中排查。</span>
            </div>
            <div className="flex items-start gap-2">
              <span>5.</span>
              <span>分析结果由 AI 生成，仅供参考，不构成法律意见。</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
