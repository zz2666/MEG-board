# 财报 Quick Notes 看板

一个面向 tracking 股票池的财报看板 MVP。当前版本用 mock 数据跑通核心体验：公司搜索、财报摘要、核心指标、历史趋势、业务分部、AI 动态和来源追溯。数据库结构已通过 Prisma schema 定义，后续可以接入 PostgreSQL、crawler 和 LLM pipeline。

## Run

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react
- Prisma + PostgreSQL schema
- OpenAI Responses API planned for structured Quick Notes
- Redis + BullMQ planned for crawler and LLM jobs

## Data Model

Prisma schema 位于 `prisma/schema.prisma`，核心模型包括：

- `Company`
- `EarningsReport`
- `FinancialMetric`
- `BusinessSegment`
- `QuickNote`
- `AIDevelopment`
- `SourceDocument`
- `ProcessingJob`

## Product Notes

完整 PRD 位于 `docs/PRD.md`。

关键原则：

- SQL 保存结构化历史财务数据。
- 原始公告/PDF/HTML 保存为 source documents。
- 财务数字必须可追溯来源。
- LLM 负责总结和结构化，不自由生成财务数字。
- AI 动态由 crawler 抓来源，LLM 做去重、分类和摘要。

## Next Implementation Steps

1. 拆分真实路由：`/dashboard`、`/company/[ticker]`、`/admin/data`。
2. 接 PostgreSQL 并写 seed/import 脚本。
3. 实现官方 IR/SEC/HKEX 抓取 worker。
4. 实现 LLM JSON schema 生成 Quick Notes。
5. 增加人工校验后台。
