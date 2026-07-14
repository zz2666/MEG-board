import { parseAeromexicoReport } from "./aeromexico-profile";
import { parseBaiduQ12026SecReport } from "./baidu-profile";
import { parseNetEaseQ12026SecReport } from "./netease-profile";
import { parsePdfTextStandardReport } from "./pdf-text-profile";
import { parseSec6kStandardReport } from "./sec-6k-standard-profile";
import { parseSecCompanyFactsUsTechReport } from "./sec-companyfacts-profile";
import { fetchSecCompanyFacts } from "./sec";
import type { CompanySourceConfig, ParsedEarningsReport } from "./types";

export async function parseEarningsReport(params: {
  config: CompanySourceConfig;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): Promise<ParsedEarningsReport> {
  if (params.config.parserProfile === "netease-q1-2026") {
    return parseNetEaseQ12026SecReport({
      companyId: params.config.id,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  if (params.config.parserProfile === "baidu-q1-2026") {
    return parseBaiduQ12026SecReport({
      companyId: params.config.id,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  if (params.config.parserProfile === "aeromexico-20f-2025") {
    return parseAeromexicoReport({
      companyId: params.config.id,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  if (params.config.parserProfile === "sec-companyfacts-us-tech") {
    if (!params.config.secCik) throw new Error(`${params.config.name} requires secCik for CompanyFacts parsing`);
    const facts = await fetchSecCompanyFacts(params.config.secCik);
    return parseSecCompanyFactsUsTechReport({
      companyId: params.config.id,
      companyName: params.config.name,
      facts,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  if (params.config.parserProfile === "sec-6k-standard") {
    return parseSec6kStandardReport({
      companyId: params.config.id,
      companyName: params.config.name,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  if (params.config.parserProfile === "pdf-text-standard") {
    return parsePdfTextStandardReport({
      companyId: params.config.id,
      companyName: params.config.name,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  throw new Error(`No parser profile is configured for ${params.config.name}`);
}
