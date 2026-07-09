import { parseNetEaseQ12026SecReport } from "./netease-profile";
import type { CompanySourceConfig, ParsedEarningsReport } from "./types";

export function parseEarningsReport(params: {
  config: CompanySourceConfig;
  html: string;
  sourceUrl: string;
  sourceTitle: string;
  releaseDate: string;
}): ParsedEarningsReport {
  if (params.config.parserProfile === "netease-q1-2026") {
    return parseNetEaseQ12026SecReport({
      companyId: params.config.id,
      html: params.html,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      releaseDate: params.releaseDate,
    });
  }

  throw new Error(`No parser profile is configured for ${params.config.name}`);
}
