# 合同分析改造设计（租房合同避坑）

## 目标
把现有智能客服项目垂直改造为「大学生租房合同智能分析」工具：上传合同 → 风险评分 + 问题条款清单 + 协商建议 → 支持逐条追问。

## 架构（方案 A：复用现有骨架，替换业务层）
- 保留：React + Vite 前端、Express 后端、DeepSeek API、SQLite、SSE 流式、多轮对话、运行日志、前后端分离
- 删除：客服人设、满意度评分、转人工工单、话术配置（客服版）
- 新增：
  - `server/contract-parser.ts` — PDF/docx → 文本提取
  - `server/contract-analysis.ts` — 分析提示词 + 租房坑点知识库 + JSON 结果解析
  - `src/pages/ContractPage.tsx` — 上传 + 报告展示 + 追问
  - `data` 新增 contracts 表

## 分析产出（DeepSeek 返回结构化 JSON）
riskScore(0-100) + riskLevel(低/中/高) + summary
issues[]: {clause, risk, level, reason, suggestion}
goodPoints[]: 对租客有利条款
negotiationTips[]: 协商话术

## 租房坑点知识库（20+ 条，注入提示词）
押金退还/租金涨幅/维修责任/转租/提前退租违约金/水电物业/免责条款/单方解除/续租

## 文件解析
- .docx → mammoth
- .pdf → pdf-parse（扫描件提示上传文字版）
- 图片 → 暂不支持（提示）

## 前端
- 首屏：上传页（拖拽 + 引导 + 示例演示）
- 报告页：风险评分圆环 + 条款卡片 + 加分项 + 协商话术 + 追问输入
- 侧边栏历史分析记录
- 工作台改为「分析记录 + 分析规则 + 运行日志」

## 数据
contracts(id, session_id, file_name, file_type, risk_score, risk_level, analysis_json, created_at)
