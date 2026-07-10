import { NextRequest, NextResponse } from "next/server";
import type { AiDevelopment } from "@/lib/mock-data";

const AIHOT_ENDPOINT = "https://aihot.virxact.com/api/public/items";
const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_RSS_ENDPOINT = "https://news.google.com/rss/search";
const AIHOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 earnings-dashboard/0.1 aihot-skill/0.2.0";
const NEWS_TIMEOUT_MS = 15_000;
const MAX_ITEMS = 3;

type AiHotItem = {
  title?: string;
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  category?: string | null;
  score?: number | null;
};

type GdeltArticle = {
  title?: string;
  url?: string;
  domain?: string;
  seendate?: string;
};

type Candidate = AiDevelopment & {
  priority: number;
};

const aliasMap: Record<string, string[]> = {
  alibaba: ["Alibaba", "阿里巴巴", "Qwen", "通义千问", "通义"],
  jd: ["JD.com", "京东", "Jingdong"],
  chineseall: ["中文在线", "ChineseAll", "AIGC"],
  kuaishou: ["Kuaishou", "快手", "Kling", "可灵"],
  alphabet: ["Google", "Alphabet", "Gemini", "DeepMind"],
  bilibili: ["Bilibili", "哔哩哔哩", "B站"],
  meituan: ["Meituan", "美团"],
  meitu: ["Meitu", "美图"],
  zhihu: ["Zhihu", "知乎"],
  trip: ["Trip.com", "携程", "携程集团"],
  tencent: ["Tencent", "腾讯", "混元", "Hunyuan"],
  weibo: ["Weibo", "微博"],
  meta: ["Meta", "Llama", "Meta AI"],
  apple: ["Apple", "Apple Intelligence"],
  microsoft: ["Microsoft", "微软", "Copilot", "Azure AI"],
  netease: ["NetEase", "网易", "有道", "Youdao"],
  baidu: ["Baidu", "百度", "ERNIE", "文心", "Apollo"],
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatDate(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function gdeltDate(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}000000`;
}

function sourceFromUrl(url?: string | null) {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripHtml(value: string) {
  return decodeXml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleWithoutSource(title: string, source: string) {
  return title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(source)}$`, "i"), "").trim();
}

function containsAlias(text: string, alias: string) {
  return text.toLowerCase().includes(alias.toLowerCase());
}

function googleNewsSearchUrl(alias: string) {
  const url = new URL("https://news.google.com/search");
  url.searchParams.set("q", `"${alias}" AI when:90d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return url.toString();
}

function uniqueAliases(companyId: string, companyName: string, ticker: string) {
  const tickerTokens = ticker
    .split(/[/. ]/)
    .map((item) => item.trim())
    .filter((item) => /^[A-Z]{2,6}$/.test(item));
  return [...new Set([...(aliasMap[companyId] ?? []), companyName, ...tickerTokens])].filter(
    (item) => item.length >= 2,
  );
}

function summarizeGdeltTitle(title: string, alias: string) {
  return title.toLowerCase().includes("ai") || /人工智能|大模型|智能|模型|agent|cloud|copilot|gemini|llama/i.test(title)
    ? title
    : `${alias} 相关新闻：${title}`;
}

async function fetchJsonWithTimeout(url: URL, headers: HeadersInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      next: {
        revalidate: 60 * 60,
      },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url: URL, headers: HeadersInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      next: {
        revalidate: 60 * 60,
      },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAiHot(alias: string): Promise<Candidate[]> {
  const url = new URL(AIHOT_ENDPOINT);
  url.searchParams.set("q", alias);
  url.searchParams.set("take", "5");

  const payload = (await fetchJsonWithTimeout(url, {
    Accept: "application/json",
    "User-Agent": AIHOT_USER_AGENT,
  })) as { items?: AiHotItem[] };

  return (payload.items ?? []).flatMap((item) => {
    if (!item.title || !item.url) return [];
    const searchable = `${item.title} ${item.summary ?? ""} ${item.source ?? ""}`;
    if (!containsAlias(searchable, alias)) return [];
    return [
      {
        title: item.title,
        category: "可信新闻",
        date: formatDate(item.publishedAt),
        status: "早期产品化",
        summary: item.summary ?? `${alias} 相关 AI HOT 条目。`,
        source: item.source ?? sourceFromUrl(item.url),
        sourceUrl: item.url,
        priority: 100 + (item.score ?? 0),
      },
    ];
  });
}

async function fetchGdelt(alias: string): Promise<Candidate[]> {
  const query = `"${alias}" ("artificial intelligence" OR "generative artificial intelligence" OR "large language model" OR chatbot OR robotaxi OR 大模型 OR 人工智能)`;
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "10");
  url.searchParams.set("sort", "hybridrel");
  url.searchParams.set("startdatetime", gdeltDate(90));
  url.searchParams.set("enddatetime", gdeltDate(0));

  const payload = (await fetchJsonWithTimeout(url, {
    Accept: "application/json",
    "User-Agent": AIHOT_USER_AGENT,
  })) as { articles?: GdeltArticle[] };

  return (payload.articles ?? []).flatMap((item) => {
    if (!item.title || !item.url) return [];
    return [
      {
        title: summarizeGdeltTitle(item.title, alias),
        category: "可信新闻",
        date: formatDate(item.seendate),
        status: "暂无明确披露",
        summary: "近三个月公开新闻命中公司与 AI 关键词，需点开原文核对业务影响和商业化口径。",
        source: item.domain ?? sourceFromUrl(item.url),
        sourceUrl: item.url,
        priority: 50,
      },
    ];
  });
}

function rssField(item: string, field: string) {
  const match = item.match(new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${field}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function rssSource(item: string) {
  const sourceMatch = item.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
  if (!sourceMatch) return { name: "", url: "" };
  return {
    url: decodeXml(sourceMatch[1] ?? ""),
    name: decodeXml(sourceMatch[2] ?? ""),
  };
}

async function fetchGoogleNews(alias: string): Promise<Candidate[]> {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set("q", `"${alias}" AI when:90d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const xml = await fetchTextWithTimeout(url, {
    Accept: "application/rss+xml,text/xml",
    "User-Agent": AIHOT_USER_AGENT,
  });

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).flatMap((match) => {
    const item = match[1];
    const rawTitle = stripHtml(rssField(item, "title"));
    const rawDescription = stripHtml(rssField(item, "description"));
    const link = rssField(item, "link");
    const pubDate = rssField(item, "pubDate");
    const source = rssSource(item);

    if (!rawTitle || !link) return [];
    if (!containsAlias(`${rawTitle} ${rawDescription} ${source.name}`, alias)) return [];

    return [
      {
        title: titleWithoutSource(rawTitle, source.name),
        category: "可信新闻",
        date: formatDate(pubDate),
        status: "暂无明确披露",
        summary: "近三个月新闻源命中公司与 AI 关键词，点开原文核对业务影响、产品进展和商业化口径。",
        source: source.name || sourceFromUrl(link),
        sourceUrl: link,
        priority: 75,
      },
    ];
  });
}

function fallbackItems(companyName: string): AiDevelopment[] {
  return [
    {
      title: `${companyName} AI 动态待实时检索`,
      category: "可信新闻",
      date: new Date().toISOString().slice(0, 10),
      status: "暂无明确披露",
      summary: "AI HOT 或新闻源暂未返回足够条目；请稍后重试或补充公司官方新闻源。",
      source: "AI news crawler",
    },
  ];
}

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId")?.trim() ?? "";
  const companyName = request.nextUrl.searchParams.get("companyName")?.trim() ?? "";
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  const officialSourceUrl = request.nextUrl.searchParams.get("sourceUrl")?.trim() ?? "";

  if (!companyId || !companyName) {
    return NextResponse.json({ error: "companyId and companyName are required" }, { status: 400 });
  }

  const aliases = uniqueAliases(companyId, companyName, ticker).slice(0, 4);
  const candidates: Candidate[] = [];
  const errors: string[] = [];

  const aiHotResults = await Promise.allSettled(aliases.map((alias) => fetchAiHot(alias)));
  aiHotResults.forEach((result, index) => {
    const alias = aliases[index];
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      errors.push(isAbortError(result.reason) ? `${alias}: AI HOT timeout` : `${alias}: AI HOT failed`);
    }
  });

  if (candidates.length < MAX_ITEMS) {
    const googleResults = await Promise.allSettled(aliases.slice(0, 3).map((alias) => fetchGoogleNews(alias)));
    googleResults.forEach((result, index) => {
      const alias = aliases[index];
      if (result.status === "fulfilled") {
        candidates.push(...result.value);
      } else {
        errors.push(isAbortError(result.reason) ? `${alias}: Google News timeout` : `${alias}: Google News failed`);
      }
    });
  }

  if (candidates.length < MAX_ITEMS) {
    const gdeltResults = await Promise.allSettled(aliases.slice(0, 2).map((alias) => fetchGdelt(alias)));
    gdeltResults.forEach((result, index) => {
      const alias = aliases[index];
      if (result.status === "fulfilled") {
        candidates.push(...result.value);
      } else {
        errors.push(isAbortError(result.reason) ? `${alias}: GDELT timeout` : `${alias}: GDELT failed`);
      }
    });
  }

  if (candidates.length < MAX_ITEMS) {
    candidates.push({
      title: "财报披露中的 AI 相关信息",
      category: "财报披露",
      date: new Date().toISOString().slice(0, 10),
      status: "暂无明确披露",
      summary: "公开新闻源不足三条时，保留财报披露入口；需以公司公告和原始新闻链接继续核验。",
      source: "earnings snapshot",
      sourceUrl: officialSourceUrl || undefined,
      priority: 20,
    });
    candidates.push({
      title: `${companyName} 官方 AI 动态待补充`,
      category: "官方新闻",
      date: new Date().toISOString().slice(0, 10),
      status: "暂无明确披露",
      summary: "尚未接入该公司的官方新闻 RSS/IR 新闻流，当前不编造未抓到的动态。",
      source: "official news crawler pending",
      sourceUrl: googleNewsSearchUrl(aliases[0] ?? companyName),
      priority: 10,
    });
    candidates.push({
      title: `${companyName} 行业新闻待补充`,
      category: "可信新闻",
      date: new Date().toISOString().slice(0, 10),
      status: "暂无明确披露",
      summary: "三个月窗口内未检出足够高置信新闻时展示待补充项，避免把无关 AI 热点误归因给公司。",
      source: "news crawler pending",
      sourceUrl: googleNewsSearchUrl(companyName),
      priority: 5,
    });
  }

  const seen = new Set<string>();
  const items = candidates
    .filter((item) => {
      const key = item.sourceUrl ?? item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => second.priority - first.priority || second.date.localeCompare(first.date))
    .slice(0, MAX_ITEMS)
    .map((candidate) => ({
      title: candidate.title,
      category: candidate.category,
      date: candidate.date,
      status: candidate.status,
      summary: candidate.summary,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
    }));

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      sourceWindow: "AI HOT 最近 7 天 + Google News/GDELT 近三个月公开新闻，按相关性优先展示。",
      items: items.length ? items : fallbackItems(companyName),
      warnings: errors.slice(0, 4),
    },
    {
      headers: {
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
