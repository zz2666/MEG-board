# 财报 Quick Notes 看板

一个面向 tracking 股票池的财报看板 MVP。当前版本已经跑通：公司搜索、财报摘要、核心指标、历史趋势、业务分部、AI 动态占位、来源追溯、PostgreSQL schema、SEC 官方财报抓取和网易 2026 Q1 确定性解析入库脚本。

## Run

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## Database

本地开发默认连接：

```text
postgresql://postgres:postgres@localhost:5432/earnings_dashboard?schema=public
```

如果本机有 Docker：

```bash
docker compose up -d postgres
npm run db:generate
npm run db:push
npm run db:seed
```

如果使用公司内部数据库或云数据库，把 `.env` 里的 `DATABASE_URL` 换成目标 PostgreSQL 连接串后执行同样命令。

## Official Data Import

网易 2026 Q1 已支持完整结构化导入，来源是 SEC 6-K Exhibit 99.1：

```bash
npm run import:earnings -- --company netease --period 2026Q1
```

没有数据库时可以只验证抓取和解析：

```bash
npm run import:earnings -- --company netease --period 2026Q1 --dry-run
```

临时不接数据库时，生成一个本地 snapshot：

```bash
npm run snapshot:earnings
```

这会写入 `data/earnings-snapshot.json`。`/api/companies` 的读取顺序是：

1. 如果配置了非本地模板的 `DATABASE_URL`，读取 PostgreSQL 中的结构化财报。
2. 本地 `data/earnings-snapshot.json`。
3. Live SEC fallback / 本地兜底 seed。

当前默认不主动连接 `localhost:5432`，避免没有本地数据库时页面卡住。后续接公司数据库时，把 `.env` 的 `DATABASE_URL` 换成公司库连接串即可切回 SQL-first。

当前 parser 使用 SEC HTML 表格精确值，单位统一存为 `RMB bn`。YoY 优先使用公告披露百分比；QoQ 在公告未直接给出时用表格精确值反算。脚本会把原始 source text、content hash、metrics、segments、quick note 和 processing job 写入 SQL。

当前数据源支持边界：

- 网易：SEC source 抓取 + 2026 Q1 deterministic parser + SQL 入库。
- 百度、阿里：SEC submissions 发现和 source document 抓取框架已接入；需要继续补公司 parser profile 才会进入看板。
- 腾讯：已进入 tracking config，但主要来源是 HKEX/公司 IR PDF，不走 SEC；需要单独实现 HKEX/IR PDF parser 后才能结构化数字。

## LLM Quick Notes

AI 财报生成已经接入 `/api/generate-note`，前端右侧「一键生成财报」按钮会调用该接口。当前只对 `dataQuality = "SEC verified"` 的官方校验数据开放，避免模型基于 demo 或未校验数据生成投研笔记。

`.env` 需要配置：

```bash
OPENAI_API_KEY="your_api_key"
OPENAI_BASE_URL="https://oneapi-comate.baidu-int.com/v1"
OPENAI_MODEL="gpt-5.5-coding-plan"
OPENAI_DISABLE_RESPONSE_STORAGE="true"
OPENAI_REASONING_EFFORT="xhigh"
```

实现原则：

- LLM 只接收已经解析好的结构化字段，不直接爬公告或自由抽数。
- 提示词明确禁止新增、猜测或改写财务数字。
- 输出使用 Responses API JSON schema，后端解析后再返回给前端。
- 请求默认 120 秒超时；`xhigh` 推理会比较慢，后续可以把 `OPENAI_REASONING_EFFORT` 调低来换响应速度。

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react
- Prisma + PostgreSQL schema
- SEC submissions / filing HTML import scripts
- OpenAI-compatible Responses API for structured Quick Notes
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

1. 给百度、阿里补 deterministic parser profile。
2. 实现腾讯 HKEX/IR PDF 抓取和表格解析。
3. 接公司 PostgreSQL 或云数据库，把 snapshot 切到 SQL-first。
4. 增加人工校验后台和 crawler / LLM 任务队列。
5. 接行情源，用财报后首个交易窗口替换静态市场反应。
