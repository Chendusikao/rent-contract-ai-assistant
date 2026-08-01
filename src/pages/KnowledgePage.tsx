import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Input, Textarea, Tag, MessagePlugin, Dialog, Switch, Popconfirm, Loading } from 'tdesign-react';
import { AddIcon, RefreshIcon, SearchIcon } from 'tdesign-icons-react';
import { api } from '../api';

interface KnowledgeItem {
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

interface KnowledgeStats {
  total: number;
  enabled: number;
  totalHits: number;
  totalHelpful: number;
  helpfulRate: number;
}

export function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // 新增/编辑弹窗
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api('/api/knowledge'));
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setStats(data.stats || null);
      }
    } catch (e) {
      MessagePlugin.error('获取知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openAdd = () => {
    setEditId(null);
    setFormTitle('');
    setFormContent('');
    setDialogOpen(true);
  };

  const openEdit = (item: KnowledgeItem) => {
    setEditId(item.id);
    setFormTitle(item.title);
    setFormContent(item.content);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      MessagePlugin.warning('标题和内容不能为空');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        const res = await fetch(api(`/api/knowledge/${editId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: formTitle.trim(), content: formContent.trim() }),
        });
        if (!res.ok) throw new Error();
        MessagePlugin.success('已更新');
      } else {
        const res = await fetch(api('/api/knowledge'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: formTitle.trim(), content: formContent.trim() }),
        });
        if (!res.ok) throw new Error();
        MessagePlugin.success('已添加，正在生成向量索引...');
      }
      setDialogOpen(false);
      fetchItems();
    } catch (e) {
      MessagePlugin.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(api(`/api/knowledge/${id}`), { method: 'DELETE' });
      if (res.ok) {
        MessagePlugin.success('已停用（保留统计）');
        fetchItems();
      } else {
        MessagePlugin.error('操作失败');
      }
    } catch (e) {
      MessagePlugin.error('操作失败');
    }
  };

  const handleToggle = async (item: KnowledgeItem, enabled: boolean) => {
    try {
      const res = await fetch(api(`/api/knowledge/${item.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        MessagePlugin.success(enabled ? '已启用' : '已停用');
        fetchItems();
      }
    } catch (e) {
      MessagePlugin.error('操作失败');
    }
  };

  // 搜索过滤
  const filtered = search.trim()
    ? items.filter(i =>
        i.title.includes(search.trim()) || i.content.includes(search.trim())
      )
    : items;

  const helpfulRate = (item: KnowledgeItem) => {
    const total = item.helpful_count + item.not_helpful_count;
    return total > 0 ? Math.round((item.helpful_count / total) * 100) + '%' : '—';
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 标题 + 统计 */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--td-text-color-primary)' }}>
              📚 知识库管理
            </h1>
            <p className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              管理 AI 检索用的法规/常识库，改动即时生效（自动重新向量化）
            </p>
          </div>
          <Button theme="primary" icon={<AddIcon />} onClick={openAdd}>
            新增知识
          </Button>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '知识条目', value: stats.total, color: 'var(--td-brand-color)' },
              { label: '已启用', value: stats.enabled, color: 'var(--td-success-color)' },
              { label: '被引用次数', value: stats.totalHits, color: 'var(--td-warning-color)' },
              { label: '帮助率', value: stats.helpfulRate > 0 ? Math.round(stats.helpfulRate * 100) + '%' : '—', color: 'var(--td-brand-color)' },
            ].map((s, i) => (
              <div key={i} className="rounded-xl p-4" style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-border)' }}>
                <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>{s.label}</div>
                <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* 搜索栏 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 max-w-sm">
            <Input
              value={search}
              onChange={(v) => setSearch(v as string)}
              placeholder="搜索标题或内容..."
              prefixIcon={<SearchIcon />}
              clearable
            />
          </div>
          <Button variant="outline" icon={<RefreshIcon />} onClick={fetchItems}>
            刷新
          </Button>
        </div>

        {/* 知识列表 */}
        {loading ? (
          <div className="flex justify-center py-16"><Loading size="large" text="加载中" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--td-text-color-placeholder)' }}>
            {items.length === 0 ? '知识库为空，点击右上角"新增知识"添加第一条' : '没有匹配的知识条目'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <div key={item.id} className="rounded-xl p-5" style={{
                backgroundColor: 'var(--td-bg-color-container)',
                border: '1px solid var(--td-component-border)',
                opacity: item.enabled ? 1 : 0.55,
              }}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {item.title}
                    </span>
                    {!item.enabled && <Tag size="small" theme="warning" variant="light">已停用</Tag>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="small" variant="outline" onClick={() => openEdit(item)}>编辑</Button>
                    <Popconfirm content="停用后不再参与检索，确定？" onConfirm={() => handleDelete(item.id)}>
                      <Button size="small" variant="outline" theme="danger">停用</Button>
                    </Popconfirm>
                    <Switch
                      size="small"
                      value={item.enabled === 1}
                      onChange={(v) => handleToggle(item, !!v)}
                    />
                  </div>
                </div>
                <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
                  {item.content}
                </p>
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  <span>🔗 引用 {item.hit_count} 次</span>
                  <span style={{ color: 'var(--td-success-color)' }}>👍 {item.helpful_count}</span>
                  <span style={{ color: 'var(--td-danger-color)' }}>👎 {item.not_helpful_count}</span>
                  <span>帮助率 {helpfulRate(item)}</span>
                  <span className="ml-auto">更新于 {item.updated_at?.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 新增/编辑弹窗 */}
        <Dialog
          header={editId ? '编辑知识' : '新增知识'}
          visible={dialogOpen}
          width={560}
          onClose={() => setDialogOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button theme="primary" loading={saving} onClick={handleSave}>保存</Button>
            </div>
          }
        >
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>
                标题（如：押金退还时限）
              </label>
              <Input
                value={formTitle}
                onChange={(v) => setFormTitle(v as string)}
                placeholder="给这条知识起个简短标题"
                maxlength={50}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>
                内容（法条原文 + 通俗解释）
              </label>
              <Textarea
                value={formContent}
                onChange={(v) => setFormContent(v as string)}
                placeholder={'例：《民法典》第733条：租赁期限届满，承租人应当返还租赁物。押金应在退租后合理期限内（通常7-15天）退还。'}
                rows={6}
                autosize={{ minRows: 4, maxRows: 12 }}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              保存后自动向量化，追问检索时立即可用
            </p>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
