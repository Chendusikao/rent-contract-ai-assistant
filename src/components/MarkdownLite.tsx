/**
 * 轻量级 markdown 渲染：段落分隔、**加粗**、> 引用块
 * 用于追问回答（assistant 消息）
 */

export function MarkdownLite({ text }: { text: string }) {
  // 按空行分段落
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  return (
    <div className="space-y-2">
      {paragraphs.map((para, idx) => {
        // 整段都是 > 引用
        if (para.split('\n').every(line => line.startsWith('>'))) {
          const quoteText = para.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n');
          return (
            <div
              key={idx}
              className="pl-3 py-1 my-1 text-xs italic border-l-2"
              style={{
                borderColor: 'var(--td-brand-color)',
                backgroundColor: 'rgba(12, 68, 124, 0.06)',
                color: 'inherit',
              }}
            >
              {renderInline(quoteText)}
            </div>
          );
        }

        // 整段是数字编号列表（1. xxx / 2. xxx）
        const lines = para.split('\n');
        if (lines.length > 1 && lines.every(line => /^\d+\.\s/.test(line.trim()))) {
          return (
            <ol key={idx} className="list-decimal list-inside space-y-1 pl-1">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^\d+\.\s+/, ''))}</li>
              ))}
            </ol>
          );
        }

        // 普通段落
        return <p key={idx} className="leading-relaxed">{renderInline(para)}</p>;
      })}
    </div>
  );
}

// 处理 **加粗**
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} style={{ color: 'var(--td-brand-color)' }}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}