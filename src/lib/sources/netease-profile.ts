import type {
  ParsedBusinessSegment,
  ParsedComparativeReport,
  ParsedEarningsReport,
  ParsedFinancialMetric,
  ParsedQuickNote,
} from "./types";
import { htmlToText, sha256 } from "./sec";

type TripleValue = {
  current: number;
  previousQuarter: number;
  sameQuarterPriorYear: number;
  snippet: string;
  disclosedYoy?: number;
};

function round(value: number, decimals = 1) {
  return Number(value.toFixed(decimals));
}

function parseDisclosureYoy(text: string, pattern: RegExp, label: string) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse NetEase disclosed YoY: ${label}`);
  }
  const sign = match[1]?.toLowerCase() === "decrease" ? -1 : 1;
  return sign * Number.parseFloat(match[2]);
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function tableRowToTriple(html: string, rowLabel: string, sourceLabel = rowLabel): TripleValue {
  const normalizedLabel = normalizeLabel(rowLabel);
  const rows = [...html.matchAll(/<TR[^>]*>[\s\S]*?<\/TR>/gi)].map((match) => match[0]);

  for (const row of rows) {
    if (!normalizeLabel(htmlToText(row)).includes(normalizedLabel)) continue;

    const values = [...row.matchAll(/text-align:\s*right[^>]*>\(?([\d,]+)(?:&nbsp;)?/gi)].map(
      (value) => Number.parseFloat(value[1].replace(/,/g, "")) / 1_000_000,
    );

    if (values.length >= 3) {
      return {
        sameQuarterPriorYear: values[0],
        previousQuarter: values[1],
        current: values[2],
        snippet: `${sourceLabel} table row: ${values[0]}, ${values[1]}, ${values[2]} RMB bn`,
      };
    }
  }

  throw new Error(`Unable to parse NetEase table row with three RMB values: ${rowLabel}`);
}

function parseSingle(text: string, pattern: RegExp, label: string) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse NetEase value: ${label}`);
  }
  return {
    value: Number.parseFloat(match[1]),
    snippet: match[0],
  };
}

function yoy(current: number, prior: number) {
  return round(((current - prior) / prior) * 100);
}

function qoq(current: number, previous: number) {
  return round(((current - previous) / previous) * 100);
}

function metric(
  name: string,
  normalized: string,
  value: number,
  unit: "RMB bn" | "%",
  sourceAnchor: string,
  options: Partial<Pick<ParsedFinancialMetric, "yoy" | "qoq" | "confidence">> = {},
): ParsedFinancialMetric {
  return {
    name,
    normalized,
    value: round(value, unit === "%" ? 1 : 4),
    unit,
    yoy: options.yoy ?? null,
    qoq: options.qoq ?? null,
    sourceAnchor,
    confidence: options.confidence ?? 0.95,
  };
}

function segment(
  name: string,
  values: TripleValue,
  totalRevenue: number,
  driver: string,
  grossMargin?: number,
): ParsedBusinessSegment {
  return {
    name,
    revenue: values.current,
    revenueUnit: "RMB bn",
    share: round((values.current / totalRevenue) * 100),
    yoy: values.disclosedYoy ?? yoy(values.current, values.sameQuarterPriorYear),
    qoq: qoq(values.current, values.previousQuarter),
    grossMargin: grossMargin ?? null,
    driver,
    confidence: 0.95,
  };
}

function comparativeMetric(
  name: string,
  normalized: string,
  value: number,
  unit: "RMB bn" | "%",
  sourceAnchor: string,
): ParsedFinancialMetric {
  return {
    name,
    normalized,
    value: round(value, unit === "%" ? 1 : 4),
    unit,
    sourceAnchor,
    confidence: 0.9,
  };
}

function buildComparatives(values: {
  revenue: TripleValue;
  grossProfit: TripleValue;
  netIncome: TripleValue;
  operatingExpenses: TripleValue;
}): ParsedComparativeReport[] {
  const periods = [
    {
      fiscalYear: 2025,
      fiscalQuarter: "Q1",
      periodLabel: "2025 Q1",
      reportDate: "2025-03-31",
      revenue: values.revenue.sameQuarterPriorYear,
      grossProfit: values.grossProfit.sameQuarterPriorYear,
      netIncome: values.netIncome.sameQuarterPriorYear,
      operatingExpenses: values.operatingExpenses.sameQuarterPriorYear,
    },
    {
      fiscalYear: 2025,
      fiscalQuarter: "Q4",
      periodLabel: "2025 Q4",
      reportDate: "2025-12-31",
      revenue: values.revenue.previousQuarter,
      grossProfit: values.grossProfit.previousQuarter,
      netIncome: values.netIncome.previousQuarter,
      operatingExpenses: values.operatingExpenses.previousQuarter,
    },
  ];

  return periods.map((period) => {
    const operatingProfit = period.grossProfit - period.operatingExpenses;
    const grossMargin = (period.grossProfit / period.revenue) * 100;
    const operatingMargin = (operatingProfit / period.revenue) * 100;
    const expenseRatio = (period.operatingExpenses / period.revenue) * 100;

    return {
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      periodLabel: period.periodLabel,
      reportDate: period.reportDate,
      metrics: [
        comparativeMetric("总营收", "revenue", period.revenue, "RMB bn", values.revenue.snippet),
        comparativeMetric("毛利润", "gross_profit", period.grossProfit, "RMB bn", values.grossProfit.snippet),
        comparativeMetric("归母净利润", "net_income_attributable", period.netIncome, "RMB bn", values.netIncome.snippet),
        comparativeMetric("营业利润", "operating_profit", operatingProfit, "RMB bn", "Derived from gross profit less total operating expenses."),
        comparativeMetric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by net revenues."),
        comparativeMetric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating profit divided by net revenues."),
        comparativeMetric("费用率", "expense_ratio", expenseRatio, "%", "Derived from total operating expenses divided by net revenues."),
      ],
    };
  });
}

function buildQuickNote(params: {
  revenue: TripleValue;
  grossProfit: TripleValue;
  netIncome: TripleValue;
  operatingExpenses: TripleValue;
  games: TripleValue;
  youdao: TripleValue;
  music: TripleValue;
  innovation: TripleValue;
  grossMargin: number;
  operatingProfit: number;
  operatingMargin: number;
}): ParsedQuickNote {
  return {
    headline:
      "整体业绩超预期，游戏主业环比反弹、毛利率提升至高位，归母净利润创单季高位；后续增长仍需观察新游兑现节奏。",
    highlights: [
      `总营收 RMB${params.revenue.current}bn，YoY ${yoy(
        params.revenue.current,
        params.revenue.sameQuarterPriorYear,
      )}%，QoQ ${qoq(params.revenue.current, params.revenue.previousQuarter)}%，主要由游戏业务驱动。`,
      `游戏及相关增值服务收入 RMB${params.games.current}bn，YoY ${yoy(
        params.games.current,
        params.games.sameQuarterPriorYear,
      )}%，QoQ ${qoq(params.games.current, params.games.previousQuarter)}%。`,
      `毛利率 ${round(params.grossMargin)}%，归母净利润 RMB${params.netIncome.current}bn。`,
    ],
    weaknesses: [
      `创新及其他业务收入 RMB${params.innovation.current}bn，YoY ${yoy(
        params.innovation.current,
        params.innovation.sameQuarterPriorYear,
      )}%，QoQ ${qoq(params.innovation.current, params.innovation.previousQuarter)}%，电商和广告业务承压。`,
      "新游催化主要集中在后续季度，市场仍需观察增长持续性。",
      "AI 相关产品化进展有披露，但集团收入贡献占比仍小。",
    ],
    segmentComments: {
      游戏及相关增值服务: "Fantasy Westward Journey 与 Where Winds Meet 等自研游戏收入提升。",
      有道: "学习服务和智能硬件收入环比下降，AI 订阅服务仍处产品化早期。",
      网易云音乐: "收入同比温和增长，业务修复延续。",
      创新及其他业务: "电商和广告业务收入下滑，是本季主要弱项。",
    },
    marginComments: `毛利润 RMB${params.grossProfit.current}bn，毛利率 ${round(
      params.grossMargin,
    )}%；营业利润约 RMB${round(params.operatingProfit)}bn，营业利润率 ${round(params.operatingMargin)}%。`,
    aiSummary:
      "财报和公司动态显示 AI 主要落在教育、办公和企业服务场景，现阶段更偏产品迭代和商业化试点。",
    watchItems: ["H2 新游上线与流水兑现", "创新及其他业务修复", "AI 产品收入是否形成集团级披露"],
    marketReaction: "港股财报后高开，具体行情需接入实时行情源校验。",
    sourceMap: {
      revenue: params.revenue.snippet,
      netIncome: params.netIncome.snippet,
      segments: params.games.snippet,
    },
  };
}

export function parseNetEaseQ12026SecReport(params: {
  companyId: string;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  const rawText = htmlToText(params.html);
  const revenue = tableRowToTriple(params.html, "Net revenues");
  revenue.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Net revenues were RMB[\d.]+ billion \(US\$[\d.]+ billion\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "net revenues",
  );
  const games = tableRowToTriple(params.html, "Games and related value-added services");
  games.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Games and related value-added services net revenues were RMB[\d.]+ billion \(US\$[\d.]+ billion\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "games",
  );
  const youdao = tableRowToTriple(params.html, "Youdao");
  youdao.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Youdao net revenues were RMB[\d.]+ billion \(US\$[\d.]+ million\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "youdao",
  );
  const music = tableRowToTriple(params.html, "NetEase Cloud Music");
  music.disclosedYoy = parseDisclosureYoy(
    rawText,
    /NetEase Cloud Music net revenues were RMB[\d.]+ billion \(US\$[\d.]+ million\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "music",
  );
  const innovation = tableRowToTriple(params.html, "Innovative businesses and others");
  innovation.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Innovative businesses and others net revenues were RMB[\d.]+ billion \(US\$[\d.]+ million\), a (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "innovation",
  );
  const grossProfit = tableRowToTriple(params.html, "Gross profit");
  grossProfit.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Gross profit was RMB[\d.]+ billion \(US\$[\d.]+ billion\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "gross profit",
  );
  const operatingExpenses = tableRowToTriple(params.html, "Total operating expenses");
  operatingExpenses.disclosedYoy = parseDisclosureYoy(
    rawText,
    /Total operating expenses were RMB[\d.]+ billion \(US\$[\d.]+ billion\), an (increase|decrease) of ([\d.]+)% compared with the same quarter of 2025/i,
    "operating expenses",
  );
  const operatingProfit = tableRowToTriple(params.html, "Operating profit");
  const netIncome = tableRowToTriple(params.html, "Net income attributable to the Company's shareholders", "Net income attributable to shareholders");
  const onlineGameShare = parseSingle(
    rawText,
    /Net revenues from the operation of online games accounted for approximately ([\d.]+)% of the segment's net revenues for the first quarter of 2026/i,
    "online game share",
  );

  const grossMargin = (grossProfit.current / revenue.current) * 100;
  const operatingMargin = (operatingProfit.current / revenue.current) * 100;
  const expenseRatio = (operatingExpenses.current / revenue.current) * 100;

  const metrics: ParsedFinancialMetric[] = [
    metric("总营收", "revenue", revenue.current, "RMB bn", revenue.snippet, {
      yoy: revenue.disclosedYoy ?? yoy(revenue.current, revenue.sameQuarterPriorYear),
      qoq: qoq(revenue.current, revenue.previousQuarter),
    }),
    metric("毛利润", "gross_profit", grossProfit.current, "RMB bn", grossProfit.snippet, {
      yoy: grossProfit.disclosedYoy ?? yoy(grossProfit.current, grossProfit.sameQuarterPriorYear),
      qoq: qoq(grossProfit.current, grossProfit.previousQuarter),
    }),
    metric("毛利率", "gross_margin", grossMargin, "%", "Derived from gross profit divided by net revenues.", {
      yoy: round(grossMargin - (grossProfit.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: round(grossMargin - (grossProfit.previousQuarter / revenue.previousQuarter) * 100),
      confidence: 0.9,
    }),
    metric("营业费用", "operating_expenses", operatingExpenses.current, "RMB bn", operatingExpenses.snippet, {
      yoy: operatingExpenses.disclosedYoy ?? yoy(operatingExpenses.current, operatingExpenses.sameQuarterPriorYear),
      qoq: qoq(operatingExpenses.current, operatingExpenses.previousQuarter),
    }),
    metric("营业利润", "operating_profit", operatingProfit.current, "RMB bn", operatingProfit.snippet, {
      yoy: yoy(
        operatingProfit.current,
        operatingProfit.sameQuarterPriorYear,
      ),
      qoq: qoq(operatingProfit.current, operatingProfit.previousQuarter),
      confidence: 0.95,
    }),
    metric("营业利润率", "operating_margin", operatingMargin, "%", "Derived from operating profit divided by net revenues.", {
      yoy: round(
        operatingMargin -
          ((grossProfit.sameQuarterPriorYear - operatingExpenses.sameQuarterPriorYear) /
            revenue.sameQuarterPriorYear) *
            100,
      ),
      qoq: round(
        operatingMargin -
          ((grossProfit.previousQuarter - operatingExpenses.previousQuarter) /
            revenue.previousQuarter) *
            100,
      ),
      confidence: 0.9,
    }),
    metric("费用率", "expense_ratio", expenseRatio, "%", "Derived from total operating expenses divided by net revenues.", {
      yoy: round(expenseRatio - (operatingExpenses.sameQuarterPriorYear / revenue.sameQuarterPriorYear) * 100),
      qoq: round(expenseRatio - (operatingExpenses.previousQuarter / revenue.previousQuarter) * 100),
      confidence: 0.9,
    }),
    metric("归母净利润", "net_income_attributable", netIncome.current, "RMB bn", netIncome.snippet, {
      yoy: yoy(netIncome.current, netIncome.sameQuarterPriorYear),
      qoq: qoq(netIncome.current, netIncome.previousQuarter),
    }),
    metric("在线游戏收入占游戏分部比例", "online_game_revenue_share", onlineGameShare.value, "%", onlineGameShare.snippet, {
      confidence: 0.95,
    }),
  ];

  const segments: ParsedBusinessSegment[] = [
    segment(
      "游戏及相关增值服务",
      games,
      revenue.current,
      "Fantasy Westward Journey franchise and Where Winds Meet 等自研游戏收入提升。",
    ),
    segment("有道", youdao, revenue.current, "学习服务和智能硬件收入环比下降。"),
    segment("网易云音乐", music, revenue.current, "收入同比温和增长，环比基本持平。"),
    segment("创新及其他业务", innovation, revenue.current, "电商和广告业务收入下滑。"),
  ];

  return {
    companyId: params.companyId,
    fiscalYear: 2026,
    fiscalQuarter: "Q1",
    periodLabel: "2026 Q1",
    reportDate: "2026-03-31",
    releaseDate: params.releaseDate,
    sourceTitle: params.sourceTitle,
    sourceUrl: params.sourceUrl,
    contentHash: sha256(params.html),
    rawText,
    metrics,
    segments,
    quickNote: buildQuickNote({
      revenue,
      grossProfit,
      netIncome,
      operatingExpenses,
      games,
      youdao,
      music,
      innovation,
      grossMargin,
      operatingProfit: operatingProfit.current,
      operatingMargin,
    }),
    comparativeReports: buildComparatives({ revenue, grossProfit, netIncome, operatingExpenses }),
  };
}
