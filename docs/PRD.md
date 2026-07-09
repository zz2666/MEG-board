# 财报 Quick Notes 看板 PRD

## 目标

面向部门 tracking 的港股/美股公司，自动沉淀历史财务数据、抓取新财报、生成标准化中文 Quick Notes，并在一个高信息密度看板中展示公司、季度、分业务、利润率、股价反应和 AI 相关动态。

## MVP 范围

- 覆盖 5-20 家 tracking 公司。
- 使用 PostgreSQL 保存结构化历史财务数据。
- 使用官方 IR、SEC、HKEX、公告和可信新闻作为优先来源。
- 财务数字由解析器或人工录入进入数据库，LLM 不凭空生成。
- Earning calls 暂不实现，只保留未来扩展空间。

## 页面结构

- `/dashboard`：股票池总览，搜索公司、查看最新财报摘要和处理状态。
- `/company/[ticker]`：公司详情，展示历史趋势、业务分部、Quick Notes 和 AI 动态。
- `/company/[ticker]/earnings/[period]`：单季度财报详情，展示完整财报 notes、来源和人工校验记录。
- `/admin/data`：数据管理，处理抓取失败、人工补录和人工校验。
- `/admin/companies`：股票池维护。

当前 MVP 先用首页承载完整演示体验，后续拆分路由。

## 数据流

1. 在 `Company` 表维护股票池。
2. 初始化历史财报，可来自官方财报、SEC/HKEX、公司 IR、Excel 或已有 notes。
3. 标准化写入 `EarningsReport`、`FinancialMetric` 和 `BusinessSegment`。
4. 新财报发布后创建 `ProcessingJob`。
5. crawler 下载原始文件，保存 `SourceDocument`。
6. parser 抽取财务指标并计算 YoY/QoQ。
7. LLM 基于结构化数据和来源材料生成 `QuickNote`。
8. AI 动态由 crawler 抓取来源，LLM 去重、分类、摘要后写入 `AIDevelopment`。
9. 低置信结果进入人工校验。

## Quick Notes 结构

- 一句话结论。
- 核心亮点。
- 主要弱项。
- 业务分部点评。
- 利润率变化原因。
- AI 相关进展。
- 后续观察点。
- 市场反应。
- 来源映射。

## LLM 边界

LLM 负责总结、分类、结构化和解释草稿。财务数字必须来自数据库或人工校验记录。没有来源的 AI 收入或商业化判断必须标记为未知或暂无明确披露。

## 技术栈

- Next.js App Router + TypeScript。
- Tailwind CSS。
- lucide-react。
- PostgreSQL + Prisma。
- Redis + BullMQ，后续用于抓取和 LLM 任务队列。
- OpenAI Responses API，后续用于结构化 JSON 输出。
- 本地 `storage/` 起步，生产可切 S3/R2。
