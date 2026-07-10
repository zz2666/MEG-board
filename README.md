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

当前 parser 使用官方 HTML/PDF/XBRL 来源，已支持 `RMB bn`、`USD bn`、`HKD bn` 和 `%`。YoY 优先使用公告披露百分比；QoQ 在公告未直接给出且表格没有上一季度时保留为空，不让模型补数。脚本会把原始 source text、content hash、metrics、segments、quick note 和 processing job 写入 SQL。

当前数据源支持边界：

- 网易：SEC source 抓取 + 2026 Q1 deterministic parser + SQL/snapshot 入库。
- 百度：SEC Exhibit 99.1 抓取 + 2026 Q1 deterministic parser + SQL/snapshot 入库，含 Baidu Core AI-powered Business、AI Cloud Infra、在线营销、爱奇艺等分部。
- 阿里、京东、B 站、知乎、携程、微博：SEC 6-K Exhibit HTML source discovery 已接入；通用 `sec-6k-standard` parser scaffold 已有，但需要继续给每家公司确认 row label / 分部映射后再开放结构化入库。
- Alphabet、Meta、Apple、微软：SEC 10-Q discovery 已接入，`sec-companyfacts-us-tech` / CompanyFacts scaffold 已有；需要逐家公司确认 XBRL concept 和分部表后再开放结构化入库。
- 腾讯、快手、美团、美图：HKEX/公司 IR PDF 分类已接入，`pdf-text-standard` scaffold 和 PDF 文本抽取已可用；需要传官方 PDF URL 并为每家公司确认表格规则。
- 中文在线：CNINFO/A 股公告分类已接入，先走官方 PDF 文本抽取；需要确认公告 URL 和 A 股财报表格规则。

查看所有公司 parser 分类和状态：

```bash
npm run parser:plan
```

抽取官方来源文本但不入库：

```bash
npm run extract:source -- --company jd
npm run extract:source -- --company tencent --source-url https://static.www.tencent.com/uploads/2026-q1-results.pdf
```

只生成当前已实现 deterministic parser 的 snapshot：

```bash
npm run snapshot:earnings
```

这会抓取网易和百度官方 SEC 文件并写入 `data/earnings-snapshot.json`。未实现 parser 的公司不会进入 verified 看板，避免展示未校验数字。

## AkShare Third-Party Bootstrap

AkShare 可作为历史结构化指标的第三方加速源，用来补全 tracking list 的公司级总营收、毛利润、毛利率、归母净利润、YoY/QoQ 和历史趋势。它不替代官方 SEC/HKEX/CNINFO/IR parser：第三方数据在看板中标记为 `AkShare third-party`，不会开放 LLM 财报生成；官方 parser 跑通后会覆盖同公司 snapshot，标记为 `SEC verified`。

首次使用先创建项目内 Python venv 并安装依赖：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-akshare.txt
```

只验证 AkShare 全量覆盖，不写文件：

```bash
npm run import:akshare -- --all --dry-run
```

生成合并 snapshot：

```bash
npm run snapshot:akshare
```

当前验证结果：17 家 tracking 公司都能拉到公司级核心指标；网易、百度由现有 SEC parser 覆盖为官方 verified，其余公司先用 AkShare/EastMoney third-party 指标展示。AkShare 不提供本项目需要的业务分部拆解和公告原文 source anchor，所以分部面板会等待官方 parser。

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

1. 给京东 / 阿里补 `sec-6k-standard` deterministic row label profile。
2. 给 B 站 / 知乎 / 携程 / 微博补 6-K Exhibit 精确选择和分部映射。
3. 给 Alphabet / Meta / Apple / 微软补 CompanyFacts concept profile。
4. 给腾讯 / 快手 / 美团 / 美图 / 中文在线补 PDF 表格解析规则。
5. 接公司 PostgreSQL 或云数据库，把 snapshot 切到 SQL-first。
6. 增加人工校验后台和 crawler / LLM 任务队列。
7. 接行情源，用财报后首个交易窗口替换静态市场反应。
