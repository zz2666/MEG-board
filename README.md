# 财报 Quick Notes 看板

面向互联网、AI 和内容平台股票池的财报分析 dashboard。项目目标是把公司财报、历史核心指标、业务分部、市场反应、AI 相关动态和中文 Quick Notes 放在一个可追溯的数据看板里，方便快速浏览和整理投研/跟踪笔记。

当前项目是 MVP，但已经能本地完整运行：前端 dashboard、公司筛选、核心财务指标、历史趋势、业务分部展示、行情反应、AI 动态检索、官方财报 parser、AkShare/EastMoney 第三方指标 bootstrap、PostgreSQL schema、snapshot fallback 和 LLM Quick Notes 生成链路都已经接通。

核心原则：

- 财务数字必须来自结构化字段、官方 parser、第三方数据源或人工校验数据，不让 LLM 自由编数字。
- 官方 parser 覆盖到的公司标记为 `SEC verified`；第三方指标标记为 `AkShare third-party`；演示兜底数据标记为 `Demo`。
- 缺失的业务分部、费用率、营业利润率、公告日或行情反应必须显示为未接入/无数据，不用 `0` 冒充披露值。
- LLM 只负责总结、组织语言和生成 copy，不负责凭空补全财务、行情或业务判断。

## 快速启动

安装 Node 依赖：

```bash
npm install
```

启动开发服务器：

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

本地页面默认优先读取 `data/earnings-snapshot.json`，所以即使没有 PostgreSQL 和 OpenAI key，也能打开 dashboard 查看已有 snapshot 数据。

## 财务看板怎么用

首页就是当前 MVP 的完整工作台。

### 1. 选择和搜索公司

左侧 sidebar 是 tracking list。可以用搜索框按公司名、ticker、行业或市场筛选公司。点击公司后，主区域会切换到该公司的最新财报视图。

公司卡片会显示：

- 公司名称和 ticker。
- 市场和行业。
- 最新财报期。
- 数据质量：`SEC verified`、`AkShare third-party` 或 `Demo`。
- 披露状态：已发布、待校验、抓取中。

### 2. 看最新财报结论

顶部 hero 区域展示：

- 公司 ticker、市场、行业、报告日期。
- 官方来源或第三方数据来源链接。
- 一句话 Quick Note。
- 核心亮点和主要风险。
- Market Reaction 行情反应卡片。

Market Reaction 当前按“财报公告日前/当日收盘价 -> 财报后首个交易日开盘/收盘”计算。只有拿到可靠公告日并且 AkShare/EastMoney 历史日线返回成功的公司才展示具体涨跌。没有可靠公告日的公司会显示“未接入行情源”。

### 3. 看核心 KPI

KPI 区域展示最新季度/年度的核心指标：

- 总营收。
- 毛利润。
- 毛利率。
- 营业利润、营业利润率，只有官方 parser 抽到时显示。
- 归母净利润。
- YoY / QoQ。
- source anchor 和来源链接。

鼠标移动到指标来源区域可以查看该指标来自哪个公告或数据源。

### 4. 看历史趋势

Financial Trend 面板可以切换指标：

- 总营收。
- 毛利润。
- 归母净利润。
- 毛利率。
- 营业利润率。
- 费用率。

时间窗口支持最近 1Q、2Q、4Q、8Q。没有结构化数据的指标不会强行画图。

### 5. 看业务分部

Business Segments 面板展示公司业务分部的收入、占比、同比、环比、毛利率和驱动说明。

当前只有官方 parser 已抽取到分部的公司会展示完整分部。AkShare/EastMoney 第三方指标只覆盖公司级核心指标，所以多数 `AkShare third-party` 公司会显示“业务分部等待官方公告 parser”。

### 6. 生成中文财报摘要

右侧 AI Report Writer 可以生成中文 Quick Notes。

限制：

- 只对 `SEC verified` 的官方校验数据开放。
- `AkShare third-party` 和 `Demo` 数据不能生成，避免把第三方或演示数据包装成官方结论。
- 生成内容只基于结构化字段、来源信息和已有 AI 动态，不允许模型新增财务数字。

需要 `.env` 中配置 OpenAI-compatible API。

### 7. 看 AI 相关动态

右侧 AI Tracker 会按当前公司检索近三个月 AI 相关新闻和公司动态。后端会查询：

- AI HOT public API。
- Google News RSS。
- GDELT。

如果抓不到足够高置信条目，会展示本地记录或待补充入口，不编造新闻。

## 技术栈

### 前端

- `Next.js 16.2.10` App Router。
- `React 19.2.4`。
- `TypeScript` strict mode。
- `Tailwind CSS 4`，当前主要样式集中在 `src/app/globals.css`。
- `lucide-react` 用于图标。
- 自定义 SVG chart components：`src/lib/charts.tsx`。

主要页面：

- `src/app/page.tsx`：dashboard 主界面。
- `src/app/layout.tsx`：应用 layout 和 metadata。
- `src/app/globals.css`：全局样式、布局、卡片、图表和响应式规则。

### 后端 API

使用 Next.js Route Handlers：

- `src/app/api/companies/route.ts`：返回 dashboard 公司数据。
- `src/app/api/generate-note/route.ts`：调用 LLM 生成财报 Quick Notes。
- `src/app/api/ai-news/route.ts`：抓取 AI 相关新闻。

### 数据库和存储

- `PostgreSQL 16`。
- `Prisma 7.8`。
- `@prisma/client` + `@prisma/adapter-pg`。
- 本地 snapshot fallback：`data/earnings-snapshot.json`。
- Prisma schema：`prisma/schema.prisma`。

核心模型：

- `Company`：股票池公司。
- `EarningsReport`：财报记录。
- `FinancialMetric`：结构化财务指标。
- `BusinessSegment`：业务分部。
- `QuickNote`：财报摘要和观察点。
- `AIDevelopment`：AI 相关动态。
- `SourceDocument`：官方公告、PDF、HTML、新闻原文和 source hash。
- `ProcessingJob`：抓取、解析、LLM、校验等任务记录。

### 数据源和解析

官方/半官方来源：

- SEC submissions / Archives / CompanyFacts。
- HKEX / 公司 IR / CNINFO 的 source provider scaffold。
- `pdf-parse` 用于 PDF 文本抽取。

第三方 bootstrap：

- Python `.venv`。
- `AkShare 1.18.64`。
- AkShare/EastMoney 财务指标和历史日线。

解析层：

- `src/lib/sources/parser.ts`：统一 parser 入口。
- `src/lib/sources/netease-profile.ts`：网易 2026 Q1 deterministic parser。
- `src/lib/sources/baidu-profile.ts`：百度 2026 Q1 deterministic parser。
- `src/lib/sources/sec-6k-standard-profile.ts`：SEC 6-K 通用 parser scaffold。
- `src/lib/sources/sec-companyfacts-profile.ts`：美股 10-Q / CompanyFacts parser scaffold。
- `src/lib/sources/pdf-text-profile.ts`：PDF 文本 parser scaffold。
- `src/lib/sources/akshare.ts`：AkShare payload 到 dashboard 数据结构的转换。

### AI 和外部服务

- OpenAI-compatible Responses API。
- AI HOT public API。
- Google News RSS。
- GDELT document API。

LLM 相关代码：

- `src/lib/llm.ts`：Prompt、schema、API 调用和结果解析。
- `src/app/api/generate-note/route.ts`：LLM 生成入口。

### 工程工具

- `ESLint 9`。
- `tsx`。
- `tsconfig-paths`。
- `Docker Compose`，用于本地 PostgreSQL。
- `dotenv`。

## 已实现功能

### Dashboard 交互

- 公司 tracking list。
- 公司搜索和选择。
- 最新财报 hero。
- 数据质量 badge。
- 核心 KPI 卡片。
- 指标来源展示和外链。
- 近 1Q / 2Q / 4Q / 8Q 趋势图。
- 趋势图 hover tooltip。
- 业务分部 tab 和总览。
- Market Reaction 卡片。
- AI Report Writer。
- AI Tracker。
- 复制 Quick Notes 文案。

### 数据读取

`/api/companies` 当前读取顺序：

1. 如果配置了非本地模板的 `DATABASE_URL`，优先读取 PostgreSQL 中已发布的结构化财报。
2. 如果存在 `data/earnings-snapshot.json`，读取本地 snapshot。
3. 如果没有 snapshot，尝试 live SEC fallback 拉取网易官方 6-K。
4. 如果 live SEC 失败，使用本地 seed 数据兜底。

这个顺序保证本地 demo 不依赖数据库，同时接上真实数据库后可以自然切到 SQL-first。

### 官方 parser

当前已实现 deterministic parser：

- 网易 2026 Q1：SEC 6-K Exhibit 99.1。
- 百度 2026 Q1：SEC 6-K Exhibit 99.1。
- Aeromexico 2025 FY：SEC 20-F inline XBRL。
- Alphabet、Meta、Apple、微软：SEC CompanyFacts / 10-Q XBRL 公司级指标。
- 阿里、京东、携程、微博、知乎：SEC 6-K Exhibit HTML 公司级指标和主要收入分部。

支持内容：

- 总营收。
- 毛利润。
- 毛利率。
- 营业利润和营业利润率，视公告表格而定。
- 归母净利润。
- YoY / QoQ。
- 业务分部收入、占比、同比、环比。
- source anchor。
- Quick Note seed。
- SQL 持久化和 snapshot 输出。

CompanyFacts parser 当前覆盖公司级指标，不直接抽业务分部。Alphabet、Meta、Apple、微软的分部收入表还需要后续补 10-Q HTML 表格 parser 或 CompanyFacts dimensional facts 映射。

### 外部 parser 选型

- SEC：优先参考 `edgartools` 的 XBRL / CompanyFacts 思路，但当前项目先直接调用 SEC 官方 CompanyFacts JSON，在 TypeScript parser 内归一化到 `ParsedEarningsReport`，避免把 Python 运行时嵌进 Next API。
- 中概 6-K：继续使用现有 deterministic row-label parser，`edgar-parser` 类项目只适合作为 8-K/6-K exhibit 发现和 fact 对齐参考。
- A 股 / 港股 PDF：ZenParse 和 FilingDelta 更适合做 PDF 预处理、引用定位和表格 JSON，不直接作为主 parser 依赖；后续可把它们的“父子分块 + 表格组”思路接到 `SourceDocument`。
- AkShare：继续作为第三方 fallback 和行情反应 bootstrap，不替代官方 parser。
- Smart-Finance-Rating：偏 AI 提数和评分，不适合作为 deterministic parser 主链路。

### AkShare/EastMoney 第三方指标

AkShare bootstrap 已经覆盖当前 tracking list 的 17 家公司，能拉到公司级核心财务指标：

- 总营收。
- 毛利润。
- 毛利率。
- 归母净利润。
- YoY / QoQ。
- 多期历史趋势。

这些公司在看板中标记为 `AkShare third-party`。它们能用于看板浏览，但不开放 LLM 财报生成。

### 行情反应

已接入 AkShare/EastMoney 历史日线，用于计算财报后首个交易日反应。

当前 snapshot 已算出 6 家：

- `chineseall`：中文在线。
- `alphabet`：Alphabet。
- `meta`：Meta。
- `apple`：Apple。
- `netease`：网易。
- `baidu`：百度。

计算口径：

```text
公告日前/当日收盘价 -> 公告后首个交易日开盘价/收盘价
```

只在存在可靠公告日并且历史行情请求成功时写入结果。其余公司继续显示未接入状态，避免用季度截止日误算市场反应。

### AI 相关新闻

`/api/ai-news` 已实现：

- 公司别名生成。
- AI HOT 查询。
- Google News RSS 查询。
- GDELT 查询。
- 近三个月窗口。
- 去重、相关性过滤和排序。
- 最多展示三条。
- 保留原始 source URL。
- 失败时 fallback 到本地记录或待补充项。

### LLM Quick Notes

已实现：

- 只允许 `SEC verified` 公司调用。
- 输入使用结构化指标、业务分部、AI 动态和 source 信息。
- JSON schema 输出。
- 输出字段包括 `headline`、`summary`、`financials`、`segments`、`aiDynamics`、`watchItems`、`copyText`。
- 前端支持重新生成和复制。

## 待实现功能

### 官方 parser 覆盖

需要继续补齐公司级 deterministic parser：

- B 站：SEC 6-K 结果公告 discovery 与 row label 映射。
- Alphabet、Meta、Apple、微软：已补 CompanyFacts 公司级指标；分部表仍待补。
- 腾讯、快手、美团、美图：HKEX / 公司 IR PDF 表格解析规则。
- 中文在线：CNINFO / A 股 PDF 表格解析规则。

### 公告日和行情反应

还需要：

- 给未覆盖公司补 `knownReports.releaseDate` 或实现公告发现逻辑。
- 区分盘前、盘后、港股/美股/ A 股交易日历。
- 增加指数相对表现，例如相对恒生科技、纳斯达克、创业板。
- 增加成交量、换手率和异常波动。
- 后续如需商用，应替换为正式授权行情 API。

### 数据平台

待实现：

- 把 snapshot 流程迁移到 SQL-first 的定时任务。
- 增加人工校验后台。
- 增加 parser 置信度和人工 override。
- 增加 ProcessingJob 队列和失败重试。
- Redis/BullMQ 目前只在 PRD 里规划，代码中尚未落地。

### 产品功能

待实现：

- 公司详情页 `/company/[ticker]`。
- 单季度财报详情页 `/company/[ticker]/earnings/[period]`。
- 数据管理页 `/admin/data`。
- 股票池维护页 `/admin/companies`。
- 多报告期切换。
- 下载/导出 Markdown、PDF 或 CSV。
- 用户权限和登录。
- Earning call transcript 接入。
- 估值和一致预期对比。

## 环境变量

复制 `.env.example` 到 `.env`，按需填写。

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/earnings_dashboard?schema=public"
OPENAI_API_KEY=""
OPENAI_BASE_URL="https://oneapi-comate.baidu-int.com/v1"
OPENAI_MODEL="gpt-5.5-coding-plan"
OPENAI_DISABLE_RESPONSE_STORAGE="true"
OPENAI_REASONING_EFFORT="xhigh"
REDIS_URL="redis://localhost:6379"
```

说明：

- `DATABASE_URL`：PostgreSQL 连接串。当前 `/api/companies` 默认不会主动使用本地模板库，避免本机没有数据库时页面卡住。
- `OPENAI_API_KEY`：生成 Quick Notes 必需。
- `OPENAI_BASE_URL`：OpenAI-compatible API 地址。
- `OPENAI_MODEL`：生成财报摘要使用的模型。
- `REDIS_URL`：预留给后续任务队列，当前未实际使用。

## 本地数据库

启动 PostgreSQL：

```bash
docker compose up -d postgres
```

生成 Prisma Client：

```bash
npm run db:generate
```

推送 schema：

```bash
npm run db:push
```

写入 tracking companies：

```bash
npm run db:seed
```

如果要连接云数据库或公司数据库，把 `.env` 中的 `DATABASE_URL` 换成目标连接串，再执行同样命令。

## 数据导入和维护脚本

查看 parser 覆盖状态：

```bash
npm run parser:plan
```

抓官方财报并入库：

```bash
npm run import:earnings -- --company netease --period 2026Q1
```

只 dry-run，不入库：

```bash
npm run import:earnings -- --company netease --period 2026Q1 --dry-run
```

生成官方 parser snapshot：

```bash
npm run snapshot:earnings
```

抽取官方来源文本但不解析：

```bash
npm run extract:source -- --company jd
npm run extract:source -- --company tencent --source-url https://example.com/results.pdf
```

安装 AkShare Python 依赖：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-akshare.txt
```

验证 AkShare 覆盖，不写文件：

```bash
npm run import:akshare -- --all --dry-run
```

生成合并 snapshot：

```bash
npm run snapshot:akshare
```

修复历史 snapshot 中的缺失值占位：

```bash
npm run snapshot:repair
```

## 目录结构

```text
src/app/page.tsx                       Dashboard 主页面
src/app/api/companies/route.ts          公司数据 API
src/app/api/generate-note/route.ts      LLM Quick Notes API
src/app/api/ai-news/route.ts            AI 新闻 API
src/lib/charts.tsx                      图表组件
src/lib/mock-data.ts                    前端数据类型和 demo fallback
src/lib/parsed-to-dashboard.ts          parser 结果转 dashboard 数据
src/lib/db-to-dashboard.ts              SQL 结果转 dashboard 数据
src/lib/snapshot.ts                     snapshot 读写
src/lib/llm.ts                          LLM 调用和 schema
src/lib/sources/*                       数据源、parser、profile 和持久化逻辑
scripts/import-earnings.ts              官方财报导入
scripts/import-akshare.ts               AkShare 第三方指标导入
scripts/akshare-provider.py             AkShare Python provider
scripts/list-parser-plan.ts             parser 覆盖检查
scripts/repair-snapshot.ts              snapshot 修复脚本
prisma/schema.prisma                    数据库模型
data/earnings-snapshot.json             本地 snapshot
docs/PRD.md                             产品需求说明
```

## 数据质量说明

`SEC verified`：

- 官方 SEC 来源。
- 已经过 deterministic parser。
- source URL 和 source anchor 可追溯。
- 可以使用 LLM Quick Notes。

`AkShare third-party`：

- AkShare/EastMoney 第三方指标。
- 适合做 tracking list 和趋势预览。
- 不替代官方 parser。
- 不开放 LLM 财报生成。

`Demo`：

- 本地 seed/fallback 演示数据。
- 只用于页面兜底。

## 当前已知限制

- 大部分公司还没有完整官方 parser，业务分部和细粒度费用指标仍需要补规则。
- AkShare/EastMoney 是第三方公开数据源，可能因上游字段、网络或限流变化导致抓取失败。
- 行情反应依赖可靠公告日，不能用财报报告期截止日替代。
- 当前 dashboard 是单页 MVP，后续详情页和管理页还没拆。
- Redis/BullMQ、权限、定时任务、人工校验后台尚未实现。
- LLM 生成依赖外部 OpenAI-compatible 服务和 API key。

## 设计和实现原则

- 先结构化，再总结。
- 先官方来源，再第三方补齐。
- 有来源才展示数字。
- 缺失就明确显示缺失。
- 让 parser 和数据质量决定功能开关，而不是让 UI 或 LLM 掩盖数据边界。
