export type SourceProvider = "sec" | "hkex-ir" | "company-ir";

export type ParserProfile = "netease-q1-2026";

export type CompanySourceConfig = {
  id: string;
  name: string;
  ticker: string;
  displayTicker: string;
  market: "HK" | "US" | "CN";
  industry: string;
  irUrl?: string;
  secCik?: string;
  hkexCode?: string;
  logoUrl?: string;
  sourceProvider: SourceProvider;
  parserProfile?: ParserProfile;
  filingKeywords?: string[];
  knownReports?: Record<
    string,
    {
      fiscalYear: number;
      fiscalQuarter: string;
      periodLabel: string;
      releaseDate: string;
      sourceUrl: string;
      title: string;
    }
  >;
};

export type ParsedFinancialMetric = {
  name: string;
  normalized: string;
  value: number;
  unit: "RMB bn" | "%";
  yoy?: number | null;
  qoq?: number | null;
  sourceAnchor: string;
  confidence: number;
  isManual?: boolean;
};

export type ParsedBusinessSegment = {
  name: string;
  revenue?: number | null;
  revenueUnit?: "RMB bn";
  share?: number | null;
  yoy?: number | null;
  qoq?: number | null;
  grossMargin?: number | null;
  driver?: string | null;
  confidence: number;
};

export type ParsedQuickNote = {
  headline: string;
  highlights: string[];
  weaknesses: string[];
  segmentComments: Record<string, string>;
  marginComments?: string;
  aiSummary?: string;
  watchItems: string[];
  marketReaction?: string;
  sourceMap?: Record<string, string>;
};

export type ParsedComparativeReport = {
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string;
  releaseDate?: string;
  metrics: ParsedFinancialMetric[];
};

export type ParsedEarningsReport = {
  companyId: string;
  fiscalYear: number;
  fiscalQuarter: string;
  periodLabel: string;
  reportDate?: string;
  releaseDate?: string;
  sourceTitle: string;
  sourceUrl: string;
  contentHash: string;
  rawText: string;
  metrics: ParsedFinancialMetric[];
  segments: ParsedBusinessSegment[];
  quickNote: ParsedQuickNote;
  comparativeReports?: ParsedComparativeReport[];
};

export type SecDiscoveredFiling = {
  accessionNumber: string;
  filingDate: string;
  reportDate?: string;
  form: string;
  primaryDocument: string;
  primaryDocDescription?: string;
  filingUrl: string;
  documentUrl: string;
};
