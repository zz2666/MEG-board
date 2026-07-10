# 财报 Quick Notes 看板

一个面向 tracking 股票池的财报看板 MVP。当前版本已经跑通公司搜索与下拉选择、财报摘要、核心指标、历史趋势、业务分部展示、来源追溯、AI Quick Notes 生成、AI 相关新闻抓取、PostgreSQL schema、SEC 官方财报抓取，以及 AkShare/EastMoney 第三方指标 bootstrap。

核心原则是：财务数字先结构化、再展示和总结；官方 parser 覆盖到的公司标记为 `SEC verified`，第三方指标标记为 `AkShare third-party`；缺失的营业利润率、费用率、业务分部和行情反应显示为未接入/无数据，不用 0 冒充真实披露。

## Run

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

常用校验命令：

```bash
npm run lint
npm run build
```

## Tech Stack

前端和交互：

- Next.js 16 App Router、React 19、TypeScript。
- Tailwind CSS 4 负责样式，`src/app/globals.css` 承载当前 dashboard 的布局和组件样式。
- `lucide-react` 提供按钮和状态图标。
- 前端主页面在 `src/app/page.tsx`，包含公司下拉选择、左侧 tracking list、财务 KPI、趋势图、业务分部、AI 动态和 Quick Notes 生成入口。

后端 API：

- Next.js Route Handlers 提供接口。
- `/api/companies` 负责把 PostgreSQL、snapshot、live SEC fallback 或 seed 数据转换成前端可用结构。
- `/api/generate-note` 调用 OpenAI-compatible Responses API 生成结构化中文 Quick Notes。
- `/api/ai-news` 抓取 AI HOT、Google News RSS 和 GDELT，给单家公司返回近三个月 AI 相关新闻。

数据和存储：

- Prisma 7 + PostgreSQL schema，核心模型包括 `Company`、`EarningsReport`、`FinancialMetric`、`BusinessSegment`、`QuickNote`、`AIDevelopment`、`SourceDocument`、`ProcessingJob`。
- 本地无数据库时使用 `data/earnings-snapshot.json`，方便页面和 demo 稳定运行。
- `SourceDocument` 保存原始公告/PDF/HTML、source URL、content hash 和 source anchor，保证财务数字可追溯。

爬虫和解析：

- SEC submissions / Archives / CompanyFacts 接官方公告和 XBRL。
- HKEX / 公司 IR / CNINFO 路径已经在 company config 里建好分类，PDF 文本抽取 scaffold 已接入。
- `pdf-parse` 用于官方 PDF 文本抽取。
- AkShare Python provider 作为第三方历史指标 bootstrap，底层数据源是 AkShare/EastMoney。
- deterministic parser 目前已落地网易 2026 Q1 和百度 2026 Q1。

AI 和外部服务：

- OpenAI-compatible Responses API 用于生成财报 Quick Notes。
- AI HOT public API、Google News RSS、GDELT 用于 AI 相关新闻检索。
- 财务数字不交给模型自由抽取或补全；LLM 只做基于结构化字段的总结、组织和措辞。

工程工具：

- ESLint 9、TypeScript、tsx、tsconfig-paths。
- `scripts/import-earnings.ts`、`scripts/import-akshare.ts`、`scripts/repair-snapshot.ts`、`scripts/list-parser-plan.ts` 负责导入、修复和 parser 覆盖检查。

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

当前默认不主动连接 `localhost:5432`，避免没有本地数据库时页面卡住。后续接公司数据库时，把 `.env` 的 `DATABASE_URL` 换成公司库连接串即可切回 SQL-first。

## Data Loading Order

`/api/companies` 的读取顺序是：

1. 如果配置了非本地模板的 `DATABASE_URL`，优先读取 PostgreSQL 中已发布的结构化财报。
2. 如果存在 `data/earnings-snapshot.json`，读取本地 snapshot。
3. 如果没有 snapshot，尝试 live SEC fallback 拉取网易官方 6-K。
4. 如果 live SEC 失败，使用本地 seed 数据兜底，并在 provenance 里标注 fallback。

这个顺序保证本地 demo 不依赖数据库，同时公司库接上后可以自然切到 SQL-first。

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

这会抓取当前已实现 deterministic parser 的官方 SEC 文件，并写入 `data/earnings-snapshot.json`。未实现 parser 的公司不会进入 verified 看板，避免展示未校验数字。

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

当前验证结果：17 家 tracking 公司都能拉到公司级核心指标；网易、百度由现有 SEC parser 覆盖为官方 verified，其余公司先用 AkShare/EastMoney third-party 指标展示。AkShare 不提供本项目需要的业务分部拆解、经营费用明细和公告原文 source anchor，所以分部面板、营业利润率、费用率会等待官方 parser 或更细的数据源。

如果历史 snapshot 中把缺失的营业利润率/费用率写成了 0，可以运行：

```bash
npm run snapshot:repair
```

修复脚本会把缺失值改成 `null`，并把行情反应文案改成“未接入行情源”。

## AI Usage

AI 在项目里分成两类能力：财报总结和 AI 动态检索。

财报 Quick Notes：

- 前端右侧「一键生成财报」按钮调用 `/api/generate-note`。
- 后端只允许 `dataQuality = "SEC verified"` 的官方校验数据进入 LLM，第三方 AkShare 数据和 demo seed 不开放生成。
- `src/lib/llm.ts` 会把公司基本信息、报告期、指标、分部、已有 AI 动态和 source 信息组织成 JSON 输入。
- 系统提示明确要求模型只能基于结构化字段写作，不能新增、猜测、改写财务数字，未披露必须写“未披露”或“仍需观察”。
- 输出走 Responses API JSON schema，后端解析为 `headline`、`summary`、`financials`、`segments`、`aiDynamics`、`watchItems`、`copyText`，再给前端展示。

`.env` 需要配置：

```bash
OPENAI_API_KEY="your_api_key"
OPENAI_BASE_URL="https://oneapi-comate.baidu-int.com/v1"
OPENAI_MODEL="gpt-5.5-coding-plan"
OPENAI_DISABLE_RESPONSE_STORAGE="true"
OPENAI_REASONING_EFFORT="xhigh"
```

AI 相关新闻：

- 前端切换公司后调用 `/api/ai-news?companyId=...&companyName=...&ticker=...`。
- 后端为每家公司维护别名，例如百度对应 `Baidu`、`百度`、`ERNIE`、`文心`、`Apollo`，阿里对应 `Alibaba`、`Qwen`、`通义千问`。
- 优先查 AI HOT public API；不足三条时查 Google News RSS；仍不足时查 GDELT。
- 新闻窗口是近三个月，AI HOT 侧偏近期精选，Google News/GDELT 侧使用 `when:90d` 或 90 天时间参数。
- 候选新闻必须在标题、摘要或来源里命中公司别名，之后按来源优先级和日期排序、去重，最多展示三条。
- 每条新闻保留 `sourceUrl`，前端可点开跳转原链接。抓不到足够新闻时展示可点击的官方财报入口或 Google News 搜索入口，不编造动态。

AI 不负责的事情：

- 不直接从公告里自由抽财务数字。
- 不补全缺失的营业利润率、费用率、分部收入或行情反应。
- 不把第三方指标包装成官方 verified。
- 不输出投资建议、目标价或未核验结论。

## Crawler And Parser Logic

财务官方源抓取：

1. 每家公司在 `src/lib/sources/company-config.ts` 里配置市场、ticker、SEC CIK、HKEX code、IR 地址、source provider、parser profile、关键词和排除词。
2. `scripts/import-earnings.ts` 根据 company config 决定来源路径。
3. SEC 公司先走 `data.sec.gov/submissions/CIK*.json` 找最近 filings，按 6-K / 10-Q、关键词和排除词筛选。
4. 6-K 会进一步打开 filing index，优先找 Exhibit 99.1、press release 或包含财报关键词的 HTML。
5. HKEX、公司 IR、CNINFO 目前支持传入官方 PDF/HTML URL 后抽取文本，deterministic 表格规则仍需逐家公司补齐。
6. 抓到 source 后计算 SHA-256 content hash，保存 raw text/source URL/source title，避免后续无法追溯。
7. 如果 parser profile 已实现，`parseEarningsReport` 进入公司专属 deterministic parser，把指标、同比/环比、业务分部、source anchor 和 quick note 转成统一 `ParsedEarningsReport`。
8. 如果 parser profile 还没实现，只保存 source-only 或跳过结构化入库，不把未校验数字展示成 verified。

第三方指标 bootstrap：

1. `scripts/import-akshare.ts` 调用 `.venv/bin/python scripts/akshare-provider.py`。
2. Python provider 按公司市场走对应 AkShare/EastMoney 接口，拉最近多期财务指标。
3. TypeScript 层把 payload 转为统一 `ParsedEarningsReport`，补出公司级收入、毛利润、毛利率、归母净利润和历史趋势。
4. 生成 snapshot 时，官方 verified 公司覆盖同公司 AkShare 结果。
5. AkShare 不给业务分部和足够细的费用明细，所以这部分保持为空/未披露。

AI 新闻抓取：

1. `/api/ai-news` 根据 companyId、companyName、ticker 生成最多四个别名。
2. 并发查询 AI HOT，使用浏览器 UA 和 `aihot-skill/0.2.0` 标识。
3. 如果少于三条，再查询 Google News RSS 的 `"alias" AI when:90d`。
4. 如果仍少于三条，再查询 GDELT 近 90 天文章，关键词包含 artificial intelligence、generative AI、large language model、大模型、人工智能等。
5. 所有候选结果按 alias 命中、URL 去重、来源优先级和日期排序，最多返回三条。
6. 返回值带 `sourceWindow`、`warnings` 和每条新闻的 `sourceUrl`，前端直接用外链打开原始来源。

行情反应：

- 当前没有接实时/历史行情源，所以看板明确展示“行情源未接入”。
- 需要接入交易所或行情 API 后，按财报发布时间后的首个交易窗口计算涨跌幅、成交量和指数相对表现，再替换当前文案。

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
- AI 动态由 crawler 抓来源，LLM 只在后续需要时做去重、分类和摘要。

## Next Implementation Steps

1. 给京东 / 阿里补 `sec-6k-standard` deterministic row label profile。
2. 给 B 站 / 知乎 / 携程 / 微博补 6-K Exhibit 精确选择和分部映射。
3. 给 Alphabet / Meta / Apple / 微软补 CompanyFacts concept profile。
4. 给腾讯 / 快手 / 美团 / 美图 / 中文在线补 PDF 表格解析规则。
5. 接公司 PostgreSQL 或云数据库，把 snapshot 切到 SQL-first。
6. 增加人工校验后台和 crawler / LLM 任务队列。
7. 接行情源，用财报后首个交易窗口替换静态市场反应。
