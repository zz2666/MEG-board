export type Market = "HK" | "US";

export type FinancialMetric = {
  label: string;
  shortLabel: string;
  value: number;
  displayValue: string;
  unit: string;
  yoy: number;
  qoq: number;
  source: string;
  sourceUrl?: string;
  rank: string;
};

export type QuarterPoint = {
  period: string;
  revenue: number;
  grossProfit: number;
  netProfit: number;
  grossMargin: number;
  operatingMargin: number;
  expenseRatio: number;
};

export type Segment = {
  name: string;
  revenue: number;
  displayRevenue: string;
  share: number;
  yoy: number;
  qoq: number;
  margin?: number;
  driver: string;
  color: string;
  trend: number[];
};

export type AiDevelopment = {
  title: string;
  category: "财报披露" | "官方新闻" | "可信新闻";
  date: string;
  status: "已贡献收入" | "早期产品化" | "战略投入" | "暂无明确披露";
  summary: string;
  source: string;
  sourceUrl?: string;
};

export type Company = {
  id: string;
  name: string;
  ticker: string;
  market: Market;
  industry: string;
  fiscalPeriod: string;
  reportDate: string;
  shareReaction: string;
  status: "已发布" | "待校验" | "抓取中";
  aiTag: AiDevelopment["status"];
  dataQuality: "SEC verified" | "Demo";
  sourceUrl?: string;
  sourceLabel?: string;
  verifiedAt?: string;
  quickNote: string;
  highlights: string[];
  risks: string[];
  metrics: FinancialMetric[];
  quarters: QuarterPoint[];
  segments: Segment[];
  aiDevelopments: AiDevelopment[];
};

export const companies: Company[] = [
  {
    id: "netease",
    name: "网易",
    ticker: "9999.HK / NTES",
    market: "HK",
    industry: "游戏与互联网服务",
    fiscalPeriod: "2026 Q1",
    reportDate: "2026-05-15 18:30",
    shareReaction: "港股高开 +7.5%",
    status: "已发布",
    aiTag: "早期产品化",
    dataQuality: "SEC verified",
    sourceLabel: "SEC 6-K Exhibit 99.1",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
    verifiedAt: "2026-07-09",
    quickNote:
      "Q1 2026 总营收 306 亿元，同比增长 6.1%，游戏主业环比反弹，毛利率约 69.4%，归母净利润 107 亿元。",
    highlights: [
      "游戏及相关增值服务收入 257 亿元，环比增长 17%，在无重磅新游上线情况下仍保持韧性。",
      "毛利率环比提升 5.2pct 至 69.4%，成本下降是本季最强财务亮点。",
      "归母净利润 107 亿元，环比增长 70.9%，创历史单季新高。",
    ],
    risks: [
      "H2 新游催化兑现节奏仍需观察。",
      "创新及其他业务收入同比下滑，电商和广告仍是主要拖累。",
      "AI 业务处于产品化早期，集团收入贡献仍小。",
    ],
    metrics: [
      {
        label: "总营收",
        shortLabel: "Revenue",
        value: 306,
        displayValue: "306 亿",
        unit: "RMB",
        yoy: 6.1,
        qoq: 11,
        source: "SEC 6-K Exhibit 99.1: Net revenues were RMB30.6 billion, +6.1% YoY; prior quarter RMB27.5 billion.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "近 8 季最高",
      },
      {
        label: "毛利润",
        shortLabel: "Gross Profit",
        value: 212,
        displayValue: "212 亿",
        unit: "RMB",
        yoy: 14.8,
        qoq: 20.1,
        source: "SEC 6-K Exhibit 99.1: Gross profit was RMB21.2 billion, +14.8% YoY; prior quarter RMB17.7 billion.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "近 8 季最高",
      },
      {
        label: "毛利率",
        shortLabel: "Gross Margin",
        value: 69.4,
        displayValue: "69.4%",
        unit: "%",
        yoy: 5.3,
        qoq: 5.2,
        source: "Calculated from SEC values: RMB21.217bn gross profit / RMB30.591bn net revenues.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "历史高位",
      },
      {
        label: "营业利润",
        shortLabel: "Operating Profit",
        value: 127,
        displayValue: "127 亿",
        unit: "RMB",
        yoy: 21.2,
        qoq: 32.5,
        source: "Derived from SEC values: gross profit RMB21.217bn less operating expenses RMB8.6bn.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "近 8 季最高",
      },
      {
        label: "营业利润率",
        shortLabel: "Operating Margin",
        value: 41.4,
        displayValue: "41.4%",
        unit: "%",
        yoy: 5.2,
        qoq: 6.8,
        source: "Derived from SEC values: operating profit / RMB30.591bn net revenues.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "近 8 季最高",
      },
      {
        label: "归母净利润",
        shortLabel: "Net Income",
        value: 107,
        displayValue: "107 亿",
        unit: "RMB",
        yoy: 3.6,
        qoq: 70.9,
        source: "SEC 6-K Exhibit 99.1: Net income attributable to shareholders was RMB10.7 billion.",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
        rank: "单季新高",
      },
    ],
    quarters: [
      {
        period: "24Q2",
        revenue: 255,
        grossProfit: 161,
        netProfit: 68,
        grossMargin: 63.1,
        operatingMargin: 34.8,
        expenseRatio: 29.2,
      },
      {
        period: "24Q3",
        revenue: 262,
        grossProfit: 166,
        netProfit: 74,
        grossMargin: 63.4,
        operatingMargin: 35.5,
        expenseRatio: 28.6,
      },
      {
        period: "24Q4",
        revenue: 276,
        grossProfit: 177,
        netProfit: 63,
        grossMargin: 64.2,
        operatingMargin: 33.1,
        expenseRatio: 31.1,
      },
      {
        period: "25Q1",
        revenue: 288,
        grossProfit: 185,
        netProfit: 103,
        grossMargin: 64.1,
        operatingMargin: 36.2,
        expenseRatio: 29.8,
      },
      {
        period: "25Q2",
        revenue: 271,
        grossProfit: 176,
        netProfit: 78,
        grossMargin: 65.0,
        operatingMargin: 35.6,
        expenseRatio: 30.6,
      },
      {
        period: "25Q3",
        revenue: 282,
        grossProfit: 181,
        netProfit: 86,
        grossMargin: 64.4,
        operatingMargin: 36.8,
        expenseRatio: 29.9,
      },
      {
        period: "25Q4",
        revenue: 276,
        grossProfit: 177,
        netProfit: 63,
        grossMargin: 64.2,
        operatingMargin: 34.6,
        expenseRatio: 31.2,
      },
      {
        period: "26Q1",
        revenue: 306,
        grossProfit: 212,
        netProfit: 107,
        grossMargin: 69.4,
        operatingMargin: 41.4,
        expenseRatio: 28.1,
      },
    ],
    segments: [
      {
        name: "游戏及相关增值服务",
        revenue: 257,
        displayRevenue: "257 亿",
        share: 84,
        yoy: 6.9,
        qoq: 17,
        margin: 72.8,
        driver: "《梦幻西游》系列与《燕云十六声》等自研游戏贡献收入提升。",
        color: "#1d4ed8",
        trend: [203, 216, 227, 241, 220, 232, 219, 257],
      },
      {
        name: "有道",
        revenue: 13,
        displayRevenue: "13 亿",
        share: 4,
        yoy: 3.8,
        qoq: -19,
        margin: 51.3,
        driver: "学习服务和智能硬件收入季节性回落，AI 订阅服务增长较快。",
        color: "#0f766e",
        trend: [12, 13, 14, 16, 12.5, 14.2, 16.1, 13],
      },
      {
        name: "网易云音乐",
        revenue: 20,
        displayRevenue: "20 亿",
        share: 7,
        yoy: 6.6,
        qoq: 0.3,
        margin: 37.1,
        driver: "音乐业务继续温和修复，毛利率同比基本稳定。",
        color: "#be123c",
        trend: [18, 18.5, 19.1, 19.7, 18.8, 19.3, 19.9, 20],
      },
      {
        name: "创新及其他业务",
        revenue: 15,
        displayRevenue: "15 亿",
        share: 5,
        yoy: -4.6,
        qoq: -25,
        driver: "电商和广告业务收入下滑，是本季主要弱项。",
        color: "#ca8a04",
        trend: [21, 20, 18, 20, 19, 21, 20, 15],
      },
    ],
    aiDevelopments: [
      {
        title: "有道 AI 订阅服务销售额超 1 亿元",
        category: "财报披露",
        date: "2026-05-15",
        status: "已贡献收入",
        summary:
          "有道披露 AI 订阅服务销售额同比增长 70% 以上，但在集团总收入中占比仍小。",
        source: "User-provided AI note, pending official source verification",
      },
      {
        title: "有道龙虾与有道宝库两款 AI Agent 产品推出",
        category: "官方新闻",
        date: "2026-04-28",
        status: "早期产品化",
        summary:
          "产品形态从教育工具延伸至办公与内容管理，当前重点是用户转化和订阅留存。",
        source: "NetEase Youdao product release",
      },
      {
        title: "网易智企发布企业级 AI Agent 管理平台“帝王蟹”",
        category: "官方新闻",
        date: "2026-05-08",
        status: "早期产品化",
        summary:
          "面向企业服务场景，仍以产品迭代和客户试点为主，尚未看到集团口径收入拆分。",
        source: "NetEase Shufan official update",
      },
    ],
  },
  {
    id: "tencent",
    name: "腾讯控股",
    ticker: "0700.HK",
    market: "HK",
    industry: "社交、游戏与云服务",
    fiscalPeriod: "2026 Q1",
    reportDate: "2026-05-14 17:00",
    shareReaction: "港股收涨 +3.2%",
    status: "待校验",
    aiTag: "战略投入",
    dataQuality: "Demo",
    quickNote:
      "游戏与广告稳健增长，视频号商业化延续，AI 主要体现为广告、云与办公产品提效。",
    highlights: [
      "国内游戏流水恢复，海外游戏贡献稳定。",
      "广告加载率和推荐效率提升，带动营销服务收入增长。",
      "费用纪律维持，利润率继续改善。",
    ],
    risks: [
      "云业务价格竞争仍压制收入弹性。",
      "AI 基建投入可能带来折旧压力。",
      "广告增长对宏观消费恢复仍敏感。",
    ],
    metrics: [
      {
        label: "总营收",
        shortLabel: "Revenue",
        value: 171,
        displayValue: "1710 亿",
        unit: "RMB",
        yoy: 8.4,
        qoq: 4.2,
        source: "FY2026 Q1 results announcement",
        rank: "近 8 季最高",
      },
      {
        label: "毛利率",
        shortLabel: "Gross Margin",
        value: 52.8,
        displayValue: "52.8%",
        unit: "%",
        yoy: 2.4,
        qoq: 1.1,
        source: "Calculated from gross profit and revenue",
        rank: "高位",
      },
      {
        label: "归母净利润",
        shortLabel: "Net Income",
        value: 534,
        displayValue: "534 亿",
        unit: "RMB",
        yoy: 13.5,
        qoq: 8.8,
        source: "FY2026 Q1 results announcement",
        rank: "近 8 季最高",
      },
    ],
    quarters: [
      {
        period: "24Q2",
        revenue: 149,
        grossProfit: 73,
        netProfit: 38,
        grossMargin: 49.0,
        operatingMargin: 31.0,
        expenseRatio: 20.3,
      },
      {
        period: "24Q3",
        revenue: 154,
        grossProfit: 77,
        netProfit: 42,
        grossMargin: 50.0,
        operatingMargin: 32.1,
        expenseRatio: 19.8,
      },
      {
        period: "24Q4",
        revenue: 160,
        grossProfit: 82,
        netProfit: 49,
        grossMargin: 51.2,
        operatingMargin: 33.4,
        expenseRatio: 19.1,
      },
      {
        period: "25Q1",
        revenue: 158,
        grossProfit: 80,
        netProfit: 47,
        grossMargin: 50.4,
        operatingMargin: 32.9,
        expenseRatio: 19.4,
      },
      {
        period: "25Q2",
        revenue: 162,
        grossProfit: 84,
        netProfit: 49,
        grossMargin: 51.6,
        operatingMargin: 33.2,
        expenseRatio: 19.0,
      },
      {
        period: "25Q3",
        revenue: 165,
        grossProfit: 86,
        netProfit: 50,
        grossMargin: 51.9,
        operatingMargin: 33.8,
        expenseRatio: 18.7,
      },
      {
        period: "25Q4",
        revenue: 164,
        grossProfit: 85,
        netProfit: 49,
        grossMargin: 51.7,
        operatingMargin: 33.1,
        expenseRatio: 19.3,
      },
      {
        period: "26Q1",
        revenue: 171,
        grossProfit: 90,
        netProfit: 53,
        grossMargin: 52.8,
        operatingMargin: 34.5,
        expenseRatio: 18.5,
      },
    ],
    segments: [
      {
        name: "增值服务",
        revenue: 84,
        displayRevenue: "840 亿",
        share: 49,
        yoy: 7.1,
        qoq: 5.8,
        color: "#1d4ed8",
        driver: "游戏流水恢复，长青游戏和海外发行共同贡献。",
        trend: [70, 73, 77, 78, 79, 80, 79, 84],
      },
      {
        name: "营销服务",
        revenue: 34,
        displayRevenue: "340 亿",
        share: 20,
        yoy: 16.5,
        qoq: 6.3,
        color: "#be123c",
        driver: "视频号和广告推荐效率提升带动增长。",
        trend: [25, 27, 28, 30, 29, 31, 32, 34],
      },
      {
        name: "金融科技与企业服务",
        revenue: 53,
        displayRevenue: "530 亿",
        share: 31,
        yoy: 5.1,
        qoq: 1.8,
        color: "#0f766e",
        driver: "支付活动恢复，云业务结构继续优化。",
        trend: [50, 51, 52, 52, 50, 52, 52, 53],
      },
    ],
    aiDevelopments: [
      {
        title: "混元能力接入广告、会议与企业微信场景",
        category: "财报披露",
        date: "2026-05-14",
        status: "战略投入",
        summary:
          "AI 更多体现为内部效率和产品能力升级，收入贡献未单独拆分。",
        source: "Tencent FY2026 Q1 management discussion",
      },
      {
        title: "腾讯云发布企业级模型工具链更新",
        category: "官方新闻",
        date: "2026-04-22",
        status: "早期产品化",
        summary:
          "围绕模型部署、知识库和智能客服场景更新，仍需观察云收入拉动。",
        source: "Tencent Cloud official update",
      },
    ],
  },
  {
    id: "bilibili",
    name: "哔哩哔哩",
    ticker: "9626.HK / BILI",
    market: "HK",
    industry: "在线视频与社区",
    fiscalPeriod: "2026 Q1",
    reportDate: "2026-05-21 19:00",
    shareReaction: "盘前 +5.8%",
    status: "抓取中",
    aiTag: "暂无明确披露",
    dataQuality: "Demo",
    quickNote:
      "广告与增值服务延续修复，成本控制推动亏损收窄，AI 收入贡献尚无明确披露。",
    highlights: [
      "广告收入继续受益于内容生态和转化效率提升。",
      "毛利率延续改善，带宽和内容成本优化贡献明显。",
      "现金流质量改善是市场关注重点。",
    ],
    risks: [
      "游戏业务新作节奏仍存在不确定性。",
      "社区增长和商业化平衡需要持续验证。",
      "AI 商业化披露有限。",
    ],
    metrics: [
      {
        label: "总营收",
        shortLabel: "Revenue",
        value: 71,
        displayValue: "71 亿",
        unit: "RMB",
        yoy: 12.2,
        qoq: 3.1,
        source: "FY2026 Q1 earnings release, pending verification",
        rank: "近 8 季最高",
      },
      {
        label: "毛利率",
        shortLabel: "Gross Margin",
        value: 34.5,
        displayValue: "34.5%",
        unit: "%",
        yoy: 4.8,
        qoq: 1.4,
        source: "Calculated from preliminary parse",
        rank: "历史高位",
      },
      {
        label: "调整后净亏损",
        shortLabel: "Adj. Net Loss",
        value: -2.1,
        displayValue: "-2.1 亿",
        unit: "RMB",
        yoy: 57.2,
        qoq: 24.4,
        source: "FY2026 Q1 earnings release, pending verification",
        rank: "亏损收窄",
      },
    ],
    quarters: [
      {
        period: "24Q2",
        revenue: 61,
        grossProfit: 18,
        netProfit: -8,
        grossMargin: 29.5,
        operatingMargin: -18.8,
        expenseRatio: 49.2,
      },
      {
        period: "24Q3",
        revenue: 63,
        grossProfit: 19,
        netProfit: -7,
        grossMargin: 30.1,
        operatingMargin: -15.9,
        expenseRatio: 46.0,
      },
      {
        period: "24Q4",
        revenue: 65,
        grossProfit: 20,
        netProfit: -5,
        grossMargin: 30.8,
        operatingMargin: -12.4,
        expenseRatio: 43.2,
      },
      {
        period: "25Q1",
        revenue: 63,
        grossProfit: 19,
        netProfit: -5,
        grossMargin: 29.7,
        operatingMargin: -12.9,
        expenseRatio: 42.6,
      },
      {
        period: "25Q2",
        revenue: 66,
        grossProfit: 21,
        netProfit: -4,
        grossMargin: 31.5,
        operatingMargin: -9.6,
        expenseRatio: 41.1,
      },
      {
        period: "25Q3",
        revenue: 68,
        grossProfit: 22,
        netProfit: -3,
        grossMargin: 32.8,
        operatingMargin: -7.4,
        expenseRatio: 40.2,
      },
      {
        period: "25Q4",
        revenue: 69,
        grossProfit: 23,
        netProfit: -3,
        grossMargin: 33.1,
        operatingMargin: -6.1,
        expenseRatio: 39.2,
      },
      {
        period: "26Q1",
        revenue: 71,
        grossProfit: 24,
        netProfit: -2.1,
        grossMargin: 34.5,
        operatingMargin: -3.8,
        expenseRatio: 38.3,
      },
    ],
    segments: [
      {
        name: "广告",
        revenue: 22,
        displayRevenue: "22 亿",
        share: 31,
        yoy: 24,
        qoq: 6,
        color: "#be123c",
        driver: "效果广告和内容场景转化效率提升。",
        trend: [15, 16, 17, 18, 18, 20, 21, 22],
      },
      {
        name: "增值服务",
        revenue: 28,
        displayRevenue: "28 亿",
        share: 39,
        yoy: 9,
        qoq: 3,
        color: "#1d4ed8",
        driver: "直播和会员业务温和增长。",
        trend: [25, 26, 26, 27, 26, 27, 27, 28],
      },
      {
        name: "游戏",
        revenue: 12,
        displayRevenue: "12 亿",
        share: 17,
        yoy: -4,
        qoq: -2,
        color: "#0f766e",
        driver: "新游节奏偏慢，存量产品贡献稳定。",
        trend: [14, 13, 13, 12, 13, 12.5, 12.2, 12],
      },
      {
        name: "IP 衍生及其他",
        revenue: 9,
        displayRevenue: "9 亿",
        share: 13,
        yoy: 6,
        qoq: 1,
        color: "#ca8a04",
        driver: "电商和 IP 衍生收入平稳。",
        trend: [7, 8, 8, 8.5, 8.3, 8.7, 8.9, 9],
      },
    ],
    aiDevelopments: [
      {
        title: "内容生产工具引入 AI 辅助能力",
        category: "可信新闻",
        date: "2026-04-18",
        status: "暂无明确披露",
        summary:
          "AI 主要用于创作者工具和审核效率，当前未见明确收入拆分。",
        source: "Product update summary, pending source review",
      },
    ],
  },
];

export const metricOptions = [
  { key: "revenue", label: "营收" },
  { key: "grossProfit", label: "毛利润" },
  { key: "netProfit", label: "净利润" },
  { key: "grossMargin", label: "毛利率" },
  { key: "operatingMargin", label: "营业利润率" },
  { key: "expenseRatio", label: "费用率" },
] as const;

export type MetricKey = (typeof metricOptions)[number]["key"];

export function getMetricDisplayName(key: MetricKey) {
  return metricOptions.find((option) => option.key === key)?.label ?? "营收";
}
