"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronRight,
  Copy,
  ExternalLink,
  LineChart,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MiniSparkline, SegmentStackChart, TrendChart } from "@/lib/charts";
import { type DisplayCurrency, formatDashboardMoneyValue } from "@/lib/financial-format";
import {
  companies,
  getMetricDisplayName,
  metricOptions,
  type Company,
  type MetricKey,
} from "@/lib/mock-data";

type GeneratedQuickNote = {
  headline: string;
  summary: string;
  financials: string[];
  segments: string[];
  aiDynamics: string[];
  watchItems: string[];
  copyText: string;
};

type LlmContext = {
  companyId: string;
  fiscalPeriod: string;
};

type LlmNoteState = LlmContext & {
  note: GeneratedQuickNote;
};

type LlmErrorState = LlmContext & {
  message: string;
};

type AiNewsState = {
  companyId: string;
  fiscalPeriod: string;
  items: Company["aiDevelopments"];
  error?: string;
  sourceWindow?: string;
};

type RefreshState = {
  companyId: string;
  loading: boolean;
  status?: "published" | "source-only" | "needs-review" | "skipped" | "failed";
  message?: string;
  error?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  jobEvents?: Array<{
    step: string;
    label: string;
    at: string;
  }>;
};

const statusStyles = {
  已发布: "status published",
  待校验: "status pending",
  抓取中: "status crawling",
};

function formatSigned(value: number, suffix = "%") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(value % 1 === 0 ? 0 : 1)}${suffix}`;
}

function getChangeClass(value: number) {
  if (value > 0) return "change positive";
  if (value < 0) return "change negative";
  return "change";
}

function normalizePeriodLabel(period: string) {
  return period.replace(/^20(\d{2})\s+/, "$1").replace(/\s+/g, "");
}

function getTopMetric(company: Company, label: string) {
  return company.metrics.find((metric) => metric.label === label) ?? company.metrics[0];
}

function getOptionalMetric(company: Company, label: string) {
  return company.metrics.find((metric) => metric.label === label) ?? null;
}

function getMarginMetric(company: Company) {
  return getOptionalMetric(company, "毛利率") ?? getOptionalMetric(company, "营业利润率") ?? company.metrics[0];
}

function isMarketReactionUnavailable(value: string) {
  return ["待接入", "未配置", "需接入", "实时行情源校验"].some((keyword) => value.includes(keyword));
}

function getCompanyCurrency(company: Company): DisplayCurrency {
  const unit = company.metrics.find((metric) => metric.unit !== "%")?.unit;
  return unit === "USD" || unit === "HKD" ? unit : "RMB";
}

function formatMetricValue(value: number, metric: MetricKey, currency: DisplayCurrency = "RMB") {
  if (metric.includes("Margin") || metric === "expenseRatio") {
    return `${value.toFixed(1)}%`;
  }

  return formatDashboardMoneyValue(value, currency);
}

function metricLabelForKey(metric: MetricKey) {
  if (metric === "revenue") return "总营收";
  if (metric === "grossProfit") return "毛利润";
  if (metric === "netProfit") return "归母净利润";
  if (metric === "grossMargin") return "毛利率";
  if (metric === "operatingMargin") return "营业利润率";
  return "费用率";
}

function isOfficialVerified(company: Company) {
  return company.dataQuality === "SEC verified" || company.dataQuality === "Official verified";
}

function hasMetricSeries(company: Company, metric: MetricKey) {
  const matchingCard = company.metrics.find((item) => item.label === metricLabelForKey(metric));
  if (matchingCard) return true;

  if (metric === "operatingMargin" || metric === "expenseRatio") {
    return (
      isOfficialVerified(company) &&
      company.quarters.some((point) => typeof point[metric] === "number" && point[metric] !== 0)
    );
  }

  return company.quarters.some((point) => Number.isFinite(point[metric]) && point[metric] !== 0);
}

function getPeriodDescription(range: string, company: Company) {
  const latest = company.quarters.at(-1)?.period ?? company.fiscalPeriod;
  if (range === "1Q") return `${latest} 单季度`;
  if (range === "2Q") return `最近半年：${company.quarters.at(-2)?.period ?? latest}-${latest}`;
  if (range === "4Q") return `最近一年：${company.quarters.at(-4)?.period ?? latest}-${latest}`;
  return `最近两年：${company.quarters.at(-8)?.period ?? latest}-${latest}`;
}

function qualityBadgeClass(dataQuality: Company["dataQuality"]) {
  if (dataQuality === "SEC verified" || dataQuality === "Official verified") return "quality-badge verified";
  if (dataQuality === "AkShare third-party") return "quality-badge third-party";
  return "quality-badge demo";
}

function buildGeneratedReport(company: Company) {
  const revenue = getTopMetric(company, "总营收");
  const grossMargin = getOptionalMetric(company, "毛利率");
  const operatingMargin = getOptionalMetric(company, "营业利润率");
  const netIncome =
    company.metrics.find((metric) => metric.label.includes("净")) ?? company.metrics.at(-1);
  const marginLine = grossMargin
    ? `毛利率 ${grossMargin.displayValue}，YoY ${formatSigned(grossMargin.yoy, "pct")}，QoQ ${formatSigned(
        grossMargin.qoq,
        "pct",
      )}。`
    : operatingMargin
      ? `营业利润率 ${operatingMargin.displayValue}，YoY ${formatSigned(
          operatingMargin.yoy,
          "pct",
        )}，QoQ ${formatSigned(operatingMargin.qoq, "pct")}。`
      : "毛利率/营业利润率暂无结构化数据。";
  const segmentNotes = company.segments.length
    ? company.segments
        .map(
          (segment) =>
            `${segment.name}：营收 ${segment.displayRevenue}，占比 ${segment.share}%，YoY ${formatSigned(
              segment.yoy,
            )}，QoQ ${formatSigned(segment.qoq)}。${segment.driver}`,
        )
        .join("\n")
    : "当前数据源尚未提供可结构化的业务分部收入；需接入对应公司官方公告 parser。";
  const aiNotes = company.aiDevelopments
    .map((item) => `${item.date}｜${item.title}：${item.summary}`)
    .join("\n");

  return `${company.name} ${company.fiscalPeriod} 财报 Quick Notes

整体结论：${company.quickNote}

核心财务数据：
总营收 ${revenue.displayValue}，YoY ${formatSigned(revenue.yoy)}，QoQ ${formatSigned(revenue.qoq)}。
${marginLine}
${netIncome ? `${netIncome.label} ${netIncome.displayValue}，YoY ${formatSigned(netIncome.yoy)}，QoQ ${formatSigned(netIncome.qoq)}。` : ""}

业务分部：
${segmentNotes}

AI 相关动态：
${aiNotes || "暂无明确披露。"}

后续观察：
${company.risks.map((risk) => `- ${risk}`).join("\n")}`;
}

export default function Home() {
  const [backendCompanies, setBackendCompanies] = useState<Company[]>(companies);
  const [dataLoadedAt, setDataLoadedAt] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCompanyId, setActiveCompanyId] = useState(companies[0].id);
  const [activeMetric, setActiveMetric] = useState<MetricKey>("revenue");
  const [activeSegment, setActiveSegment] = useState("总览");
  const [timeRange, setTimeRange] = useState("8Q");
  const [hoveredPoint, setHoveredPoint] = useState<{
    period: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [llmNote, setLlmNote] = useState<LlmNoteState | null>(null);
  const [llmLoading, setLlmLoading] = useState<LlmContext | null>(null);
  const [llmError, setLlmError] = useState<LlmErrorState | null>(null);
  const [aiNewsState, setAiNewsState] = useState<AiNewsState | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCompanies() {
      try {
        const response = await fetch("/api/companies", { cache: "no-store" });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as {
          fetchedAt: string;
          companies: Company[];
        };
        if (cancelled) return;
        setBackendCompanies(payload.companies);
        setDataLoadedAt(payload.fetchedAt);
        setDataError(null);
      } catch (error) {
        if (cancelled) return;
        setDataError(error instanceof Error ? error.message : "Failed to load backend data");
      }
    }

    loadCompanies();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const displayCompanies = backendCompanies.filter((company) => company.dataQuality !== "Demo");
    if (!normalized) return displayCompanies;
    return displayCompanies.filter((company) =>
      [company.name, company.ticker, company.industry, company.market]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [backendCompanies, query]);

  const activeCompany =
    backendCompanies.find((company) => company.id === activeCompanyId) ??
    filteredCompanies[0] ??
    backendCompanies[0];
  const selectableCompanies = backendCompanies.filter((company) => company.dataQuality !== "Demo");
  const availableMetricOptions = useMemo(
    () => metricOptions.filter((option) => hasMetricSeries(activeCompany, option.key)),
    [activeCompany],
  );
  const effectiveActiveMetric = availableMetricOptions.some((option) => option.key === activeMetric)
    ? activeMetric
    : availableMetricOptions[0]?.key ?? "revenue";

  const visibleQuarters = activeCompany.quarters.slice(
    timeRange === "1Q" ? -1 : timeRange === "2Q" ? -2 : timeRange === "4Q" ? -4 : -8,
  );
  const activeCurrency = getCompanyCurrency(activeCompany);
  const revenueMetric = getTopMetric(activeCompany, "总营收");
  const marginMetric = getMarginMetric(activeCompany);
  const activeLlmNote =
    llmNote?.companyId === activeCompany.id && llmNote.fiscalPeriod === activeCompany.fiscalPeriod
      ? llmNote.note
      : null;
  const activeLlmError =
    llmError?.companyId === activeCompany.id && llmError.fiscalPeriod === activeCompany.fiscalPeriod
      ? llmError.message
      : null;
  const llmLoadingForActive =
    llmLoading?.companyId === activeCompany.id && llmLoading.fiscalPeriod === activeCompany.fiscalPeriod;
  const aiNewsForActive =
    aiNewsState?.companyId === activeCompany.id && aiNewsState.fiscalPeriod === activeCompany.fiscalPeriod
      ? aiNewsState
      : null;
  const aiNewsLoadingForActive = !aiNewsForActive;
  const displayedAiDevelopments = aiNewsForActive?.items.length
    ? aiNewsForActive.items
    : activeCompany.aiDevelopments;
  const generatedReport = activeLlmNote?.copyText ?? buildGeneratedReport(activeCompany);
  const refreshForActive = refreshState?.companyId === activeCompany.id ? refreshState : null;

  const activeSegmentData =
    activeSegment === "总览"
      ? undefined
      : activeCompany.segments.find((segment) => segment.name === activeSegment);

  useEffect(() => {
    let cancelled = false;
    const requestContext = {
      companyId: activeCompany.id,
      fiscalPeriod: activeCompany.fiscalPeriod,
    };

    async function loadAiNews() {
      try {
        const params = new URLSearchParams({
          companyId: activeCompany.id,
          companyName: activeCompany.name,
          ticker: activeCompany.ticker,
        });
        if (activeCompany.sourceUrl) {
          params.set("sourceUrl", activeCompany.sourceUrl);
        }
        const response = await fetch(`/api/ai-news?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as {
          items?: Company["aiDevelopments"];
          sourceWindow?: string;
          error?: string;
        };

        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? `AI news API ${response.status}`);

        setAiNewsState({
          ...requestContext,
          items: payload.items ?? [],
          sourceWindow: payload.sourceWindow,
        });
      } catch (error) {
        if (cancelled) return;
        setAiNewsState({
          ...requestContext,
          items: [],
          error: error instanceof Error ? error.message : "AI news load failed",
        });
      }
    }

    loadAiNews();

    return () => {
      cancelled = true;
    };
  }, [
    activeCompany.id,
    activeCompany.name,
    activeCompany.ticker,
    activeCompany.fiscalPeriod,
    activeCompany.sourceUrl,
  ]);

  async function generateWithLlm() {
    const requestContext = {
      companyId: activeCompany.id,
      fiscalPeriod: activeCompany.fiscalPeriod,
    };

    setLlmLoading(requestContext);
    setLlmError(null);

    try {
      const response = await fetch("/api/generate-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyId: activeCompany.id }),
      });
      const payload = (await response.json()) as {
        note?: GeneratedQuickNote;
        error?: string;
      };

      if (!response.ok || !payload.note) {
        throw new Error(payload.error ?? `LLM API ${response.status}`);
      }

      setLlmNote({
        ...requestContext,
        note: payload.note,
      });
    } catch (error) {
      setLlmError({
        ...requestContext,
        message: error instanceof Error ? error.message : "LLM generation failed",
      });
    } finally {
      setLlmLoading((current) =>
        current?.companyId === requestContext.companyId &&
        current.fiscalPeriod === requestContext.fiscalPeriod
          ? null
          : current,
      );
    }
  }

  async function refreshEarnings() {
    const companyId = activeCompany.id;
    setRefreshState({ companyId, loading: true });

    try {
      const response = await fetch(`/api/companies/${companyId}/refresh-earnings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ persist: true }),
      });
      const payload = (await response.json()) as {
        status?: RefreshState["status"];
        company?: Company;
        message?: string;
        error?: string;
        sourceUrl?: string;
        sourceTitle?: string;
        jobEvents?: RefreshState["jobEvents"];
      };
      if (!response.ok) throw new Error(payload.error ?? `Refresh API ${response.status}`);

      if (payload.company) {
        setBackendCompanies((current) => {
          const next = current.filter((company) => company.id !== payload.company?.id);
          return [payload.company, ...next] as Company[];
        });
        setDataLoadedAt(new Date().toISOString());
      }

      setRefreshState({
        companyId,
        loading: false,
        status: payload.status,
        message: payload.message ?? "财报源已检查。",
        sourceUrl: payload.sourceUrl,
        sourceTitle: payload.sourceTitle,
        jobEvents: payload.jobEvents,
      });
    } catch (error) {
      setRefreshState({
        companyId,
        loading: false,
        error: error instanceof Error ? error.message : "Refresh failed",
      });
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <LineChart size={22} />
          </div>
          <div>
            <p className="eyebrow">Earnings OS</p>
            <h1>财报 Quick Notes</h1>
          </div>
        </div>

        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索公司 / ticker"
          />
        </label>

        <label className="company-select">
          <span>快速选择</span>
          <select
            value={activeCompany.id}
            onChange={(event) => {
              setActiveCompanyId(event.target.value);
              setActiveSegment("总览");
              setLlmNote(null);
              setLlmError(null);
              setCopied(false);
            }}
          >
            {selectableCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name} · {company.ticker}
              </option>
            ))}
          </select>
        </label>

        <div className="sidebar-section">
          <div className="section-label">Tracking Pool · {filteredCompanies.length}</div>
          <div className="company-list">
            {filteredCompanies.map((company) => {
              const isActive = company.id === activeCompany.id;
              return (
                <button
                  key={company.id}
                  className={`company-tab ${isActive ? "active" : ""}`}
                  onClick={() => {
                    setActiveCompanyId(company.id);
                    setActiveSegment("总览");
                    setLlmNote(null);
                    setLlmError(null);
                    setCopied(false);
                  }}
                >
                  <span className="company-avatar">{company.name.slice(0, 1)}</span>
                  <span>
                    <strong>{company.name}</strong>
                    <small>{company.ticker}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="sidebar-summary">
          <div className="section-label">Current View</div>
          <strong>{activeCompany.fiscalPeriod}</strong>
          <span>{getPeriodDescription(timeRange, activeCompany)}</span>
          <small>{dataLoadedAt ? `API synced ${new Date(dataLoadedAt).toLocaleString()}` : "API loading"}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dashboard / {activeCompany.fiscalPeriod}</p>
            <h2>{activeCompany.name}</h2>
            <div className="period-context">
              当前数据口径：{getPeriodDescription(timeRange, activeCompany)}
              {dataError ? ` · API fallback: ${dataError}` : ""}
            </div>
          </div>
          <div className="topbar-actions">
            <div className="period-switcher" aria-label="时间范围切换">
              {[
                ["1Q", "单季"],
                ["2Q", "半年"],
                ["4Q", "一年"],
                ["8Q", "两年"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={timeRange === value ? "active" : ""}
                  onClick={() => {
                    setTimeRange(value);
                    setHoveredPoint(null);
                  }}
                >
                  <span>{label}</span>
                  <small>{value}</small>
                </button>
              ))}
            </div>
            <span className={statusStyles[activeCompany.status]}>{activeCompany.status}</span>
            <span className={qualityBadgeClass(activeCompany.dataQuality)}>
              <BadgeCheck size={14} />
              {activeCompany.dataQuality}
            </span>
            <button
              className="refresh-button"
              aria-label="刷新财报任务"
              onClick={refreshEarnings}
              disabled={refreshForActive?.loading}
              title="检查并解析最新官方财报"
            >
              <Activity size={18} />
              <span>{refreshForActive?.loading ? "解析中" : "解析最新财报"}</span>
            </button>
          </div>
        </header>
        {refreshForActive?.message || refreshForActive?.error || refreshForActive?.jobEvents?.length ? (
          <div
            className={[
              "refresh-message",
              refreshForActive.error ? "error" : "",
              refreshForActive.status === "needs-review" ||
              refreshForActive.status === "source-only" ||
              refreshForActive.status === "failed" ||
              refreshForActive.status === "skipped"
                ? "pending"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div>{refreshForActive.error ?? refreshForActive.message}</div>
            {refreshForActive.sourceUrl ? (
              <a href={refreshForActive.sourceUrl} target="_blank" rel="noreferrer">
                {refreshForActive.sourceTitle ?? "查看官方源文件"}
              </a>
            ) : null}
            {refreshForActive.jobEvents?.length ? (
              <div className="refresh-steps">
                {refreshForActive.jobEvents.map((event) => (
                  <span key={`${event.step}-${event.at}`}>{event.label}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="hero-panel">
          <div className="hero-main">
            <div className="meta-row">
              <span>{activeCompany.ticker}</span>
              <span>{activeCompany.market}</span>
              <span>{activeCompany.industry}</span>
              <span>{activeCompany.reportDate}</span>
              {activeCompany.sourceUrl ? (
                <a href={activeCompany.sourceUrl} target="_blank" rel="noreferrer">
                  {activeCompany.sourceLabel}
                </a>
              ) : null}
            </div>
            <h3>{activeCompany.quickNote}</h3>
            <div className="insight-grid">
              {activeCompany.highlights.map((highlight) => (
                <div key={highlight} className="insight-card positive">
                  <ArrowUpRight size={16} />
                  <span>{highlight}</span>
                </div>
              ))}
              {activeCompany.risks.slice(0, 2).map((risk) => (
                <div key={risk} className="insight-card warning">
                  <ArrowDownRight size={16} />
                  <span>{risk}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="market-card">
            <p className="eyebrow">Market Reaction</p>
            <strong>
              {isMarketReactionUnavailable(activeCompany.shareReaction) ? "未接入行情源" : activeCompany.shareReaction}
            </strong>
            <span>
              {isMarketReactionUnavailable(activeCompany.shareReaction)
                ? "需要接入实时/历史行情 API，并用财报发布时间后的首个交易窗口校验。"
                : "财报后首个交易窗口"}
            </span>
            <div className="reaction-strip">
              <span>Revenue {formatSigned(revenueMetric.yoy)} YoY</span>
              <span>Margin {formatSigned(marginMetric.yoy, "pct")}</span>
            </div>
          </div>
        </section>

        <section className="kpi-grid">
          {activeCompany.metrics.map((metric) => (
            <article key={metric.label} className="kpi-card">
              <div className="kpi-top">
                <span>{metric.label}</span>
                <small>{normalizePeriodLabel(activeCompany.fiscalPeriod)}</small>
              </div>
              <strong>{metric.displayValue}</strong>
              <span className="kpi-period">{activeCompany.fiscalPeriod} · {metric.shortLabel}</span>
              <div className="kpi-change-row">
                <span className={getChangeClass(metric.yoy)}>
                  YoY {formatSigned(metric.yoy, metric.unit === "%" ? "pct" : "%")}
                </span>
                <span className={getChangeClass(metric.qoq)}>
                  QoQ {formatSigned(metric.qoq, metric.unit === "%" ? "pct" : "%")}
                </span>
              </div>
              <div className="source-popover">
                {metric.sourceUrl ? (
                  <a href={metric.sourceUrl} target="_blank" rel="noreferrer">
                    {metric.rank}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span>{metric.rank}</span>
                )}
                <small>{metric.source}</small>
              </div>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <div className="main-column">
            <section className="panel chart-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Financial Trend</p>
                  <h3>{getMetricDisplayName(effectiveActiveMetric)}趋势</h3>
                  <span className="chart-period-label">
                    {getPeriodDescription(timeRange, activeCompany)}
                  </span>
                </div>
              </div>
              <div className="metric-switcher">
                {availableMetricOptions.map((option) => (
                  <button
                    key={option.key}
                    className={effectiveActiveMetric === option.key ? "active" : ""}
                    onClick={() => setActiveMetric(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {hasMetricSeries(activeCompany, effectiveActiveMetric) ? (
                <div className="interactive-chart">
                  {hoveredPoint ? (
                    <div
                      className="chart-tooltip"
                      style={{
                        left: `clamp(88px, ${(hoveredPoint.x / 720) * 100}%, calc(100% - 88px))`,
                        top: `clamp(18px, ${(hoveredPoint.y / 260) * 100}%, calc(100% - 74px))`,
                      }}
                    >
                      <strong>{hoveredPoint.period}</strong>
                      <span>
                        {getMetricDisplayName(effectiveActiveMetric)}{" "}
                        {formatMetricValue(hoveredPoint.value, effectiveActiveMetric, activeCurrency)}
                      </span>
                      <small>当前选择：{getPeriodDescription(timeRange, activeCompany)}</small>
                    </div>
                  ) : null}
                  <TrendChart
                    points={visibleQuarters}
                    metric={effectiveActiveMetric}
                    currency={activeCurrency}
                    onHoverPoint={setHoveredPoint}
                  />
                </div>
              ) : (
                <div className="chart-empty">
                  <strong>{getMetricDisplayName(effectiveActiveMetric)}暂无结构化数据</strong>
                  <span>当前来源未披露该指标，系统不会用 0 代替缺失值。</span>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Business Segments</p>
                  <h3>业务分部拆解</h3>
                </div>
                <div className="total-pill">总营收 {revenueMetric.displayValue}</div>
              </div>
              <div className="segment-tabs">
                {["总览", ...activeCompany.segments.map((segment) => segment.name)].map((segment) => (
                  <button
                    key={segment}
                    className={activeSegment === segment ? "active" : ""}
                    onClick={() => setActiveSegment(segment)}
                  >
                    {segment}
                  </button>
                ))}
              </div>

              {!activeCompany.segments.length ? (
                <div className="segment-empty">
                  <strong>业务分部等待官方公告 parser</strong>
                  <span>
                    {activeCompany.dataQuality === "AkShare third-party"
                      ? "当前 AkShare/EastMoney 只覆盖公司级指标；需要接入该公司 SEC/HKEX/CNINFO 官方公告后才能展示分部收入。"
                      : "该官方 parser 尚未抽取分部表；已解析到分部的公司会在这里展示收入、占比和增速。"}
                  </span>
                </div>
              ) : activeSegmentData ? (
                <div className="segment-detail">
                  <div>
                    <p className="eyebrow">{activeSegmentData.name}</p>
                    <h4>{activeSegmentData.displayRevenue}</h4>
                    <p>{activeSegmentData.driver}</p>
                    <div className="metric-row">
                      <span>占比 {activeSegmentData.share}%</span>
                      <span className={getChangeClass(activeSegmentData.yoy)}>
                        YoY {formatSigned(activeSegmentData.yoy)}
                      </span>
                      <span className={getChangeClass(activeSegmentData.qoq)}>
                        QoQ {formatSigned(activeSegmentData.qoq)}
                      </span>
                      {activeSegmentData.margin ? <span>毛利率 {activeSegmentData.margin}%</span> : null}
                    </div>
                  </div>
                  <MiniSparkline values={activeSegmentData.trend} color={activeSegmentData.color} />
                </div>
              ) : (
                <div className="segment-table">
                  {activeCompany.segments.map((segment) => (
                    <div key={segment.name} className="segment-row">
                      <div className="segment-name">
                        <span style={{ background: segment.color }} />
                        <strong>{segment.name}</strong>
                      </div>
                      <span>{segment.displayRevenue}</span>
                      <span>{segment.share}%</span>
                      <span className={getChangeClass(segment.yoy)}>{formatSigned(segment.yoy)}</span>
                      <span className={getChangeClass(segment.qoq)}>{formatSigned(segment.qoq)}</span>
                    </div>
                  ))}
                  <SegmentStackChart segments={activeCompany.segments} />
                </div>
              )}
            </section>
          </div>

          <aside className="right-rail">
            <section className="panel report-generator">
              <div className="panel-header compact-header">
                <div>
                  <p className="eyebrow">AI Report Writer</p>
                  <h3>一键生成财报</h3>
                </div>
                <Sparkles size={18} />
              </div>
              <p className="generator-help">
                按 Quick Notes 模板生成最近一个季度的中文财报摘要；AI 只基于官方解析字段写作。
              </p>
              <button
                className="secondary-button"
                onClick={generateWithLlm}
                disabled={Boolean(llmLoading) || !isOfficialVerified(activeCompany)}
              >
                <Sparkles size={16} />
                {!isOfficialVerified(activeCompany)
                  ? "仅官方数据可生成"
                  : llmLoadingForActive
                    ? "AI 生成中"
                    : activeLlmNote
                      ? "重新生成 AI 财报"
                      : "AI 生成财报"}
              </button>
              {activeLlmError ? <p className="generator-error">{activeLlmError}</p> : null}
              <div className="generated-report">
                <pre>{generatedReport}</pre>
              </div>
              <button
                className="primary-button"
                onClick={async () => {
                  await navigator.clipboard.writeText(generatedReport);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                <Copy size={16} />
                {copied ? "已复制" : `复制 ${activeCompany.fiscalPeriod} 财报`}
              </button>
            </section>

            <section className="panel ai-panel">
              <div className="panel-header compact-header">
                <div>
                  <p className="eyebrow">AI Tracker</p>
                  <h3>AI 相关最新动向</h3>
                </div>
                <span className="ai-status">{activeCompany.aiTag}</span>
              </div>
              <div className="ai-feed">
                {aiNewsLoadingForActive ? (
                  <div className="ai-loading">正在检索近三个月 AI 动态</div>
                ) : null}
                {aiNewsForActive?.error ? (
                  <div className="ai-loading">AI 动态检索失败，展示本地记录。</div>
                ) : null}
                {displayedAiDevelopments.map((item) => (
                  <article key={`${item.title}-${item.sourceUrl ?? item.source}`} className="ai-item">
                    <div className="ai-item-top">
                      <span>{item.category}</span>
                      <small>{item.date}</small>
                    </div>
                    <h4>{item.title}</h4>
                    <p>{item.summary}</p>
                    <footer>
                      {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          {item.source}
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        item.source
                      )}
                    </footer>
                  </article>
                ))}
                {aiNewsForActive?.sourceWindow ? (
                  <div className="ai-source-note">{aiNewsForActive.sourceWindow}</div>
                ) : null}
              </div>
            </section>

          </aside>
        </section>
      </section>
    </main>
  );
}
