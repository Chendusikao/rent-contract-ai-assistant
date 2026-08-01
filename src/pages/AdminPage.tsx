import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Loading, Tabs, Button, MessagePlugin, Popconfirm } from 'tdesign-react';
import type { TableProps } from 'tdesign-react';
import { RefreshIcon, DeleteIcon } from 'tdesign-icons-react';
import { api } from '../api';
import { LogsPanel } from '../components/LogsPanel';

interface ContractRecord {
  id: string;
  session_id: string;
  file_name: string;
  risk_score: number | null;
  risk_level: string | null;
  created_at: string;
}

function getRiskColor(score: number | null): string {
  if (score === null) return '#888780';
  if (score >= 80) return '#e34d59';
  if (score >= 60) return '#ed7b2f';
  return '#00a870';
}

export function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('records');
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api('/api/contracts'));
      if (res.ok) {
        const data = await res.json();
        setContracts(data.contracts || []);
      }
    } catch (e) {
      console.error('获取记录失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(api(`/api/contracts/${id}`), { method: 'DELETE' });
      if (res.ok) {
        MessagePlugin.success('已删除');
        fetchContracts();
      } else {
        MessagePlugin.error('删除失败');
      }
    } catch (e) {
      MessagePlugin.error('删除失败');
    }
  };

  const columns: TableProps['columns'] = [
    {
      colKey: 'file_name',
      title: '合同文件',
      width: 240,
      cell: ({ row }: any) => (
        <span
          className="cursor-pointer hover:underline"
          style={{ color: 'var(--td-brand-color)' }}
          onClick={() => navigate(`/contract/${row.id}`)}
        >
          {row.file_name}
        </span>
      ),
    },
    {
      colKey: 'risk_score',
      title: '风险分',
      width: 90,
      align: 'center',
      cell: ({ row }: any) =>
        row.risk_score !== null ? (
          <span className="font-bold" style={{ color: getRiskColor(row.risk_score) }}>
            {row.risk_score}
          </span>
        ) : (
          <span style={{ color: 'var(--td-text-color-placeholder)' }}>—</span>
        ),
    },
    {
      colKey: 'risk_level',
      title: '风险等级',
      width: 100,
      align: 'center',
      cell: ({ row }: any) =>
        row.risk_level ? (
          <Tag variant="light" style={{
            color: getRiskColor(row.risk_score),
            backgroundColor: getRiskColor(row.risk_score) + '18',
            borderColor: 'transparent',
          }}>
            {row.risk_level}
          </Tag>
        ) : (
          <span style={{ color: 'var(--td-text-color-placeholder)' }}>—</span>
        ),
    },
    {
      colKey: 'created_at',
      title: '分析时间',
      width: 180,
      cell: ({ row }: any) => new Date(row.created_at).toLocaleString('zh-CN'),
    },
    {
      colKey: 'actions',
      title: '操作',
      width: 80,
      align: 'center',
      cell: ({ row }: any) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Popconfirm
            content="确定删除这条分析记录吗？"
            onConfirm={() => handleDelete(row.id)}
          >
            <Button variant="text" shape="circle" icon={<DeleteIcon />} />
          </Popconfirm>
        </span>
      ),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--td-text-color-primary)' }}>
            分析记录
          </h1>
          <Button variant="outline" icon={<RefreshIcon />} onClick={fetchContracts}>
            刷新
          </Button>
        </div>

        <Tabs value={tab} onChange={setTab as any} style={{ marginBottom: 24 }}>
          <Tabs.TabPanel value="records" label="合同分析记录" />
          <Tabs.TabPanel value="logs" label="运行日志" />
        </Tabs>

        {tab === 'logs' ? (
          <LogsPanel />
        ) : (
          <Card bordered>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loading text="加载中..." />
              </div>
            ) : contracts.length === 0 ? (
              <div className="text-center py-20" style={{ color: 'var(--td-text-color-placeholder)' }}>
                暂无分析记录，去首页上传一份租房合同试试吧
              </div>
            ) : (
              <Table
                data={contracts}
                columns={columns}
                rowKey="id"
                pagination={{ defaultPageSize: 15, pageSizeOptions: [10, 15, 20, 50] }}
                stripe
                hover
                onRowClick={({ row }: any) => navigate(`/contract/${row.id}`)}
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
