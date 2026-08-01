import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Loading, Tag, MessagePlugin } from 'tdesign-react';
import { UploadIcon, FileIcon, CopyIcon, ChatIcon, ArrowLeftIcon, MicrophoneIcon, SoundIcon, CameraIcon, ImageIcon } from 'tdesign-icons-react';
import { api } from '../api';
import { SAMPLE_CONTRACT } from '../sampleContract';
import { MarkdownLite } from '../components/MarkdownLite';
import { useIsMobile } from '../hooks/useIsMobile';
import { compressImage } from '../utils/imageCompress';
import html2canvas from 'html2canvas';

interface ContractIssue {
  clause: string;
  risk: string;
  level: '高' | '中' | '低';
  reason: string;
  suggestion: string;
  law?: string;
}

interface ContractAnalysis {
  riskScore: number;
  riskLevel: string;
  summary: string;
  issues: ContractIssue[];
  goodPoints: string[];
  negotiationTips: string[];
}

interface FollowUpMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 风险等级颜色
const LEVEL_COLORS: Record<string, string> = {
  '高': '#e34d59',
  '中': '#ed7b2f',
  '低': '#00a870',
};

function getRiskColor(score: number): string {
  if (score >= 80) return '#e34d59';
  if (score >= 60) return '#ed7b2f';
  return '#00a870';
}

export function ContractPage() {
  const navigate = useNavigate();
  const { contractId: urlContractId } = useParams<{ contractId: string }>();
  const isMobile = useIsMobile();
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [contractText, setContractText] = useState('');
  const [fileName, setFileName] = useState('');
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [followUpInput, setFollowUpInput] = useState('');
  const [followUpHistory, setFollowUpHistory] = useState<FollowUpMessage[]>([]);
  const [followingUp, setFollowingUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // 从 URL 加载历史分析记录
  useEffect(() => {
    if (!urlContractId) return;

    let cancelled = false;
    const loadContract = async () => {
      setLoadingHistory(true);
      try {
        const res = await fetch(api(`/api/contracts/${urlContractId}`));
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          setAnalysis(data.contract.analysis);
          setContractId(urlContractId);
          setContractText(data.contract.contract_text || '');
          setFileName(data.contract.file_name || '租房合同');
          setExpandedIssue(null);
          setFollowUpHistory([]);
        } else {
          MessagePlugin.error('未找到该分析记录');
          navigate('/');
        }
      } catch (e) {
        MessagePlugin.error('加载分析记录失败');
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    loadContract();
    return () => { cancelled = true; };
  }, [urlContractId, navigate]);

  // 发起分析（SSE 流式），返回是否成功
  const runAnalysis = useCallback(async (text: string, fileName: string) => {
    setAnalysis(null);
    setContractId(null);
    setFollowUpHistory([]);
    setAnalyzing(true);

    try {
      const analyzeRes = await fetch(api('/api/contracts/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName }),
      });

      const reader = analyzeRes.body?.getReader();
      const decoder = new TextDecoder();
      let analysisDone = false;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.type === 'analysis_done') {
                setAnalysis(msg.analysis);
                setContractId(msg.contractId);
                setContractText(text);
                analysisDone = true;
              } else if (msg.type === 'error') {
                MessagePlugin.error(msg.message || '分析失败');
              }
            } catch { /* ignore */ }
          }
        }
      }

      if (!analysisDone) {
        MessagePlugin.error('分析未完成，请重试');
        return false;
      }
      return true;
    } catch (e: any) {
      MessagePlugin.error(e?.message || '分析失败');
      return false;
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // 处理文件选择（图片先压缩再上传）
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file) return;
    setUploading(true);

    try {
      // 图片压缩（手机拍照大图 → 减小体积加速 OCR）
      const finalFile = await compressImage(file);

      const formData = new FormData();
      formData.append('file', finalFile);

      const res = await fetch(api('/api/contracts/upload'), {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        MessagePlugin.error(data.error || '文件解析失败');
        return;
      }

      setFileName(data.fileName);
      MessagePlugin.success(`解析成功，共 ${data.characterCount} 字，开始分析...`);
      await runAnalysis(data.text, data.fileName);
    } catch (e: any) {
      MessagePlugin.error(e?.message || '处理失败');
    } finally {
      setUploading(false);
    }
  }, [runAnalysis]);

  // 使用示例合同分析
  const handleSampleContract = useCallback(async () => {
    setFileName('示例合同（含常见坑点）');
    MessagePlugin.info('正在分析示例合同，请稍候...');
    await runAnalysis(SAMPLE_CONTRACT, '示例租房合同.docx');
  }, [runAnalysis]);

  // 追问
  const handleFollowUp = useCallback(async () => {
    const question = followUpInput.trim();
    if (!question || !contractId || followingUp) return;

    setFollowUpInput('');
    setFollowingUp(true);
    const newHistory: FollowUpMessage[] = [...followUpHistory, { role: 'user', content: question }];
    setFollowUpHistory(newHistory);

    try {
      const res = await fetch(api(`/api/contracts/${contractId}/follow-up`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: followUpHistory }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let answer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.type === 'text') {
                answer += msg.content;
                // 实时更新最后一条 assistant 消息
                setFollowUpHistory(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    next[next.length - 1] = { ...last, content: answer };
                  } else {
                    next.push({ role: 'assistant', content: answer });
                  }
                  return next;
                });
              } else if (msg.type === 'error') {
                MessagePlugin.error(msg.message || '追问失败');
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (e: any) {
      MessagePlugin.error(e?.message || '追问失败');
    } finally {
      setFollowingUp(false);
    }
  }, [contractId, followUpInput, followUpHistory, followingUp]);

  const copyAllTips = () => {
    if (!analysis) return;
    const text = analysis.negotiationTips.map((t, i) => `${i + 1}. ${t}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      MessagePlugin.success('协商话术已复制');
    });
  };

  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // ===== 语音能力（Web Speech API：ASR 输入 + TTS 输出） =====
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);

  // TTS：朗读文本
  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      MessagePlugin.warning('当前浏览器不支持语音朗读');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, []);

  // ASR：语音输入（识别为文字填入追问框）
  const toggleListening = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      MessagePlugin.warning('当前浏览器不支持语音输入，建议使用 Chrome/Edge');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (e: any) => {
      setListening(false);
      if (e.error === 'not-allowed') MessagePlugin.warning('麦克风权限被拒绝');
    };
    recognition.onresult = (e: any) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setFollowUpInput(transcript);
    };
    recognition.start();
  }, [listening]);

  // 导出报告为 PNG 图片
  const handleExport = useCallback(async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `租房合同分析报告_${fileName.replace(/\.[^.]+$/, '')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      MessagePlugin.success('报告已导出为图片');
    } catch (e) {
      MessagePlugin.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }, [fileName]);

  // ===== 加载历史记录中 =====
  if (loadingHistory && !analysis) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loading text="加载分析记录..." />
      </div>
    );
  }

  // ===== 上传视图（无分析结果时） =====
  if (!analysis) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`mx-auto ${isMobile ? 'max-w-full px-4 py-6' : 'max-w-2xl px-6 py-16'}`}>
        <div className={`text-center mb-8 ${isMobile ? 'mb-6' : 'mb-10'}`}>
          <h2 className={`font-bold mb-3 ${isMobile ? 'text-2xl' : 'text-3xl'}`} style={{ color: 'var(--td-text-color-primary)' }}>
            大学生租房避坑 🏠
          </h2>
          <p className={`${isMobile ? 'text-sm' : 'text-base'}`} style={{ color: 'var(--td-text-color-secondary)' }}>
            上传你的租房合同，AI 帮你揪出风险条款，给出租房前的安心建议
          </p>
          <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
            <Tag variant="light" style={{ color: 'var(--td-success-color)', backgroundColor: 'var(--td-success-color-light)' }}>
              PDF / Word 文档
            </Tag>
            <Tag variant="light" style={{ color: 'var(--td-brand-color)', backgroundColor: 'var(--td-brand-color-light)' }}>
              30 秒出报告
            </Tag>
            <Tag variant="light" style={{ color: 'var(--td-warning-color)', backgroundColor: 'var(--td-warning-color-light)' }}>
              免费
            </Tag>
          </div>
        </div>

        {/* 上传区域 */}
        <div
          className={`border-2 border-dashed rounded-2xl text-center cursor-pointer transition-colors ${isMobile ? 'p-6' : 'p-10'}`}
          style={{
            borderColor: dragOver ? 'var(--td-brand-color)' : 'var(--td-component-border)',
            backgroundColor: dragOver ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-container)',
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelect(file);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color-light)' }}>
            {uploading || analyzing ? (
              <Loading size="large" />
            ) : (
              <UploadIcon size={32} style={{ color: 'var(--td-brand-color)' }} />
            )}
          </div>
          <div className={`font-medium mb-1 ${isMobile ? 'text-base' : 'text-lg'}`} style={{ color: 'var(--td-text-color-primary)' }}>
            {uploading ? '正在解析合同...' : analyzing ? 'AI 正在分析合同...' : isMobile ? '点击上传合同' : '点击或拖拽上传合同'}
          </div>
          <div className="text-sm" style={{ color: 'var(--td-text-color-placeholder)' }}>
            支持 .pdf / .docx / 图片（jpg / png），最大 10MB
          </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
            />
            {/* 移动端：拍照输入（后置摄像头） */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* 上传按钮区：桌面单按钮，移动端拍照+相册双入口 */}
          <div className={`mt-4 ${isMobile ? 'flex gap-3' : 'hidden'}`}>
            <Button
              theme="primary"
              block
              size="large"
              icon={<CameraIcon />}
              loading={uploading || analyzing}
              onClick={() => cameraInputRef.current?.click()}
            >
              拍照上传
            </Button>
            <Button
              variant="outline"
              theme="primary"
              block
              size="large"
              icon={<ImageIcon />}
              disabled={uploading || analyzing}
              onClick={() => fileInputRef.current?.click()}
            >
              相册/文件
            </Button>
          </div>

          {/* 示例合同 */}
          <div className="mt-5">
            <Button
              variant="outline"
              theme="primary"
              block
              icon={<ChatIcon />}
              loading={analyzing}
              onClick={handleSampleContract}
            >
              没有合同？用示例合同体验分析流程
            </Button>
          </div>

          {/* 使用说明 */}
          <div className="mt-8 p-5 rounded-xl" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
            <div className="font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>
              💡 如何获得最好的分析效果
            </div>
            <ul className="text-sm space-y-1.5" style={{ color: 'var(--td-text-color-secondary)' }}>
              <li>· 上传**文字版** PDF 或 Word（扫描照片识别度低）</li>
              <li>· 确保是完整合同（含所有条款和附件）</li>
              <li>· 分析结果仅供参考，重大决策请咨询专业律师</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ===== 报告视图 =====
  const riskColor = getRiskColor(analysis.riskScore);
  const sortedIssues = [...analysis.issues].sort((a, b) => {
    const order = { '高': 0, '中': 1, '低': 2 };
    return (order[a.level] ?? 3) - (order[b.level] ?? 3);
  });

  return (
    <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3' : 'p-6'}`}>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 顶栏 */}
        <div className={`flex items-center justify-between ${isMobile ? 'flex-wrap gap-2' : ''}`}>
          <div className="flex items-center gap-2 min-w-0">
            {urlContractId && (
              <Button
                variant="text"
                shape="circle"
                size="small"
                icon={<ArrowLeftIcon />}
                onClick={() => navigate('/admin')}
              />
            )}
            <FileIcon size={20} style={{ color: 'var(--td-brand-color)' }} />
            <span className="text-sm font-medium truncate max-w-[120px]" style={{ color: 'var(--td-text-color-primary)' }}>
              {fileName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="small" loading={exporting} onClick={handleExport}>
              导出报告
            </Button>
            <Button variant="outline" size="small" onClick={() => navigate('/')}>
              分析新合同
            </Button>
          </div>
        </div>

        {/* 报告内容（导出区域） */}
        <div ref={reportRef} className="space-y-6">
        <div className={`rounded-xl p-6 ${isMobile ? 'flex flex-col items-center gap-4' : 'flex items-center gap-6'}`}
          style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-border)' }}>
          {/* 评分圆环 */}
          <div className={`relative w-28 h-28 ${isMobile ? '' : 'flex-shrink-0'}`}>
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="50" fill="none" strokeWidth="10"
                stroke="var(--td-bg-color-component)" />
              <circle cx="60" cy="60" r="50" fill="none" strokeWidth="10"
                stroke={riskColor}
                strokeLinecap="round"
                strokeDasharray={`${(analysis.riskScore / 100) * 314} 314`}
                style={{ transition: 'stroke-dasharray 1s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold" style={{ color: riskColor }}>
                {analysis.riskScore}
              </span>
              <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                风险分
              </span>
            </div>
          </div>
          <div className={`flex-1 min-w-0 ${isMobile ? 'text-center' : ''}`}>
            <div className={`flex items-center gap-3 mb-2 ${isMobile ? 'justify-center' : ''}`}>
              <Tag size="large" variant="light"
                style={{ color: riskColor, backgroundColor: riskColor + '18', borderColor: 'transparent' }}>
                {analysis.riskLevel}
              </Tag>
              <span className="text-sm" style={{ color: 'var(--td-text-color-placeholder)' }}>
                分数越高风险越大
              </span>
            </div>
            <p className="text-base leading-relaxed" style={{ color: 'var(--td-text-color-primary)' }}>
              {analysis.summary}
            </p>
          </div>
        </div>

        {/* 问题条款 */}
        <div>
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
            ⚠️ 发现 {analysis.issues.length} 个风险点
          </h3>
          <div className="space-y-3">
            {sortedIssues.map((issue, idx) => (
              <div key={idx} className="rounded-xl overflow-hidden"
                style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-border)' }}>
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedIssue(expandedIssue === idx ? null : idx)}
                >
                  <Tag variant="light" style={{
                    color: LEVEL_COLORS[issue.level] || '#888',
                    backgroundColor: (LEVEL_COLORS[issue.level] || '#888') + '18',
                    borderColor: 'transparent',
                  }}>
                    {issue.level}风险
                  </Tag>
                  <span className="flex-1 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {issue.risk}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {expandedIssue === idx ? '收起 ▲' : '展开 ▼'}
                  </span>
                </div>
                {expandedIssue === idx && (
                  <div className="px-4 pb-4 space-y-3">
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                        原文条款
                      </div>
                      <div className="text-sm p-3 rounded-lg bg-amber-50 border border-amber-200"
                        style={{ color: '#7a5b00', backgroundColor: 'var(--td-warning-color-light)', borderColor: 'var(--td-warning-color)' }}>
                        「{issue.clause}」
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                        风险说明
                      </div>
                      <div className="text-sm leading-relaxed" style={{ color: 'var(--td-text-color-primary)' }}>
                        {issue.reason}
                      </div>
                    </div>
                    {issue.law && (
                      <div>
                        <div className="text-xs font-medium mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                          📖 法律依据
                        </div>
                        <div className="text-sm leading-relaxed p-3 rounded-lg"
                          style={{ backgroundColor: 'var(--td-brand-color-light)', color: '#0c447c' }}>
                          {issue.law}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                        💡 修改建议
                      </div>
                      <div className="text-sm leading-relaxed p-3 rounded-lg"
                        style={{ backgroundColor: 'var(--td-success-color-light)', color: '#085041' }}>
                        {issue.suggestion}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 加分项 */}
        {analysis.goodPoints.length > 0 && (
          <div className="rounded-xl p-5"
            style={{ backgroundColor: 'var(--td-success-color-light)', border: '1px solid var(--td-success-color)' }}>
            <div className="font-semibold mb-2" style={{ color: '#085041' }}>
              ✅ 对租客有利的地方
            </div>
            <ul className="space-y-1 text-sm" style={{ color: '#085041' }}>
              {analysis.goodPoints.map((point, i) => (
                <li key={i}>· {point}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 协商话术 */}
        {analysis.negotiationTips.length > 0 && (
          <div className="rounded-xl p-5"
            style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
                🗣️ 跟房东/中介怎么谈
              </div>
              <Button size="small" variant="outline" icon={<CopyIcon />} onClick={copyAllTips}>
                {copied ? '已复制' : '复制全部'}
              </Button>
            </div>
            <div className="space-y-2">
              {analysis.negotiationTips.map((tip, i) => (
                <div key={i} className="text-sm leading-relaxed p-3 rounded-lg"
                  style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }}>
                  <span className="font-medium" style={{ color: 'var(--td-brand-color)' }}>话术 {i + 1}：</span>
                  {tip}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 免责声明 */}
        <div className="text-xs text-center" style={{ color: 'var(--td-text-color-placeholder)' }}>
          * 本分析由 AI 生成，仅供参考，不构成法律意见。重大决策请咨询专业律师。
        </div>
        </div>

        {/* 追问区 */}
        <div className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-border)' }}>
          <div className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--td-text-color-primary)' }}>
            <ChatIcon size={18} style={{ color: 'var(--td-brand-color)' }} />
            还想了解哪一条？
          </div>

          {/* 追问历史 */}
          {followUpHistory.length > 0 && (
            <div className="space-y-3 mb-4 max-h-72 overflow-y-auto">
              {followUpHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                    msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                  }`}
                    style={{
                      backgroundColor: msg.role === 'user' ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                      color: msg.role === 'user' ? 'white' : 'var(--td-text-color-primary)',
                    }}>
                    {msg.role === 'assistant' ? (
                      <MarkdownLite text={msg.content} />
                    ) : (
                      msg.content
                    )}
                    {msg.role === 'assistant' && followingUp && i === followUpHistory.length - 1 && (
                      <span className="ml-0.5 inline-block w-2 h-4 align-middle" style={{ backgroundColor: 'var(--td-brand-color)' }}>
                        <span className="animate-pulse">|</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            {/* 语音输入（ASR） */}
            <Button
              variant="outline"
              shape="circle"
              icon={listening ? <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#e34d59' }} /> : <MicrophoneIcon />}
              onClick={toggleListening}
              title={listening ? '正在聆听，点击停止' : '语音输入问题'}
            />
            <textarea
              className="flex-1 p-3 rounded-lg border resize-none text-sm"
              style={{
                borderColor: listening ? '#e34d59' : 'var(--td-component-border)',
                backgroundColor: 'var(--td-bg-color-component)',
                color: 'var(--td-text-color-primary)',
              }}
              rows={isMobile ? 1 : 2}
              placeholder={listening ? '🎤 正在聆听，请说话...' : "例如：押金条款我该怎么和房东谈？提前退租违约金合理吗？"}
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleFollowUp();
                }
              }}
            />
            <Button
              theme="primary"
              loading={followingUp}
              onClick={handleFollowUp}
              disabled={!followUpInput.trim()}
            >
              {isMobile ? '发送' : '提问'}
            </Button>
            {/* 朗读回答（TTS） */}
            {!isMobile && followUpHistory.some(m => m.role === 'assistant') && (
              <Button
                variant="outline"
                shape="circle"
                icon={<SoundIcon />}
                onClick={() => {
                  if (speaking) {
                    stopSpeaking();
                  } else {
                    const last = [...followUpHistory].reverse().find(m => m.role === 'assistant');
                    if (last) speakText(last.content);
                  }
                }}
                title={speaking ? '停止朗读' : '朗读最后一条回答'}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
