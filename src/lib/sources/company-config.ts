import type { CompanySourceConfig } from "./types";

export const trackedCompanyConfigs: CompanySourceConfig[] = [
  {
    id: "netease",
    name: "网易",
    ticker: "9999.HK",
    displayTicker: "9999.HK / NTES",
    market: "HK",
    industry: "游戏与互联网服务",
    irUrl: "https://ir.netease.com/",
    secCik: "0001110646",
    hkexCode: "9999",
    sourceProvider: "sec",
    parserProfile: "netease-q1-2026",
    filingKeywords: ["financial results", "unaudited financial results", "first quarter"],
    knownReports: {
      "2026Q1": {
        fiscalYear: 2026,
        fiscalQuarter: "Q1",
        periodLabel: "2026 Q1",
        releaseDate: "2026-05-21T18:30:00.000+08:00",
        title: "NetEase Announces First Quarter 2026 Unaudited Financial Results",
        sourceUrl:
          "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm",
      },
    },
  },
  {
    id: "baidu",
    name: "百度",
    ticker: "9888.HK",
    displayTicker: "9888.HK / BIDU",
    market: "HK",
    industry: "搜索、广告、云与自动驾驶",
    irUrl: "https://ir.baidu.com/",
    secCik: "0001329099",
    hkexCode: "9888",
    sourceProvider: "sec",
    filingKeywords: ["financial results", "quarter", "unaudited"],
  },
  {
    id: "alibaba",
    name: "阿里巴巴",
    ticker: "9988.HK",
    displayTicker: "9988.HK / BABA",
    market: "HK",
    industry: "电商、云与本地生活",
    irUrl: "https://www.alibabagroup.com/en-US/ir",
    secCik: "0001577552",
    hkexCode: "9988",
    sourceProvider: "sec",
    filingKeywords: ["results", "quarter", "earnings"],
  },
  {
    id: "tencent",
    name: "腾讯控股",
    ticker: "0700.HK",
    displayTicker: "0700.HK",
    market: "HK",
    industry: "社交、游戏、广告、金融科技与云",
    irUrl: "https://www.tencent.com/en-us/investors.html",
    hkexCode: "0700",
    sourceProvider: "hkex-ir",
    filingKeywords: ["results announcement", "quarterly results"],
  },
];

export function getCompanyConfig(companyId: string) {
  return trackedCompanyConfigs.find(
    (company) =>
      company.id === companyId ||
      company.ticker.toLowerCase() === companyId.toLowerCase() ||
      company.displayTicker.toLowerCase().includes(companyId.toLowerCase()),
  );
}
