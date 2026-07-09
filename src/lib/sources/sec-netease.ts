import { companies, type Company, type FinancialMetric } from "@/lib/mock-data";

const SEC_EXHIBIT_URL =
  "https://www.sec.gov/Archives/edgar/data/1110646/000110465926064764/tm2615053d1_ex99-1.htm";

const USER_AGENT = "earnings-dashboard/0.1 contact: zhouziyi@example.com";

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&middot;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRmbBillion(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function updateMetric(
  metric: FinancialMetric,
  next: Partial<Pick<FinancialMetric, "value" | "displayValue" | "source" | "sourceUrl">>,
) {
  return {
    ...metric,
    ...next,
  };
}

export async function fetchVerifiedNetEase(): Promise<Company> {
  const seeded = companies.find((company) => company.id === "netease") ?? companies[0];
  const response = await fetch(SEC_EXHIBIT_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    throw new Error(`SEC fetch failed: ${response.status}`);
  }

  const text = htmlToText(await response.text());
  const revenue = parseRmbBillion(text, /Net revenues were RMB([\d.]+) billion/i);
  const grossProfit = parseRmbBillion(text, /Gross profit was RMB([\d.]+) billion/i);
  const netIncome = parseRmbBillion(
    text,
    /Net income attributable to the Company'?s shareholders was RMB([\d.]+) billion/i,
  );
  const games = parseRmbBillion(
    text,
    /Games and related value-added services net revenues were RMB([\d.]+) billion/i,
  );
  const youdao = parseRmbBillion(text, /Youdao net revenues were RMB([\d.]+) billion/i);
  const music = parseRmbBillion(text, /NetEase Cloud Music net revenues were RMB([\d.]+) billion/i);
  const innovation = parseRmbBillion(
    text,
    /Innovative businesses and others net revenues were RMB([\d.]+) billion/i,
  );

  const grossMargin =
    revenue && grossProfit ? Number(((grossProfit / revenue) * 100).toFixed(1)) : null;
  const sourceNote = "Live parsed from SEC 6-K Exhibit 99.1";

  return {
    ...seeded,
    dataQuality: "SEC verified",
    sourceUrl: SEC_EXHIBIT_URL,
    sourceLabel: "Live SEC 6-K Exhibit 99.1",
    verifiedAt: new Date().toISOString(),
    metrics: seeded.metrics.map((metric) => {
      if (metric.label === "总营收" && revenue) {
        return updateMetric(metric, {
          value: revenue * 10,
          displayValue: `${Math.round(revenue * 10)} 亿`,
          source: `${sourceNote}: Net revenues were RMB${revenue} billion.`,
          sourceUrl: SEC_EXHIBIT_URL,
        });
      }
      if (metric.label === "毛利润" && grossProfit) {
        return updateMetric(metric, {
          value: grossProfit * 10,
          displayValue: `${Math.round(grossProfit * 10)} 亿`,
          source: `${sourceNote}: Gross profit was RMB${grossProfit} billion.`,
          sourceUrl: SEC_EXHIBIT_URL,
        });
      }
      if (metric.label === "毛利率" && grossMargin) {
        return updateMetric(metric, {
          value: grossMargin,
          displayValue: `${grossMargin}%`,
          source: `${sourceNote}: calculated from RMB${grossProfit}bn gross profit / RMB${revenue}bn net revenues.`,
          sourceUrl: SEC_EXHIBIT_URL,
        });
      }
      if (metric.label === "归母净利润" && netIncome) {
        return updateMetric(metric, {
          value: netIncome * 10,
          displayValue: `${Math.round(netIncome * 10)} 亿`,
          source: `${sourceNote}: net income attributable to shareholders was RMB${netIncome} billion.`,
          sourceUrl: SEC_EXHIBIT_URL,
        });
      }
      return metric;
    }),
    segments: seeded.segments.map((segment) => {
      const value =
        segment.name === "游戏及相关增值服务"
          ? games
          : segment.name === "有道"
            ? youdao
            : segment.name === "网易云音乐"
              ? music
              : segment.name === "创新及其他业务"
                ? innovation
                : null;

      if (!value) return segment;
      return {
        ...segment,
        revenue: value * 10,
        displayRevenue: `${Math.round(value * 10)} 亿`,
      };
    }),
  };
}
