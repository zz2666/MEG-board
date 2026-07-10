import "dotenv/config";
import { PDFParse } from "pdf-parse";
import { getCompanyConfig } from "@/lib/sources/company-config";
import { discoverLatestSecEarningsFiling, fetchSecText, htmlToText, sha256 } from "@/lib/sources/sec";

type Args = {
  company?: string;
  sourceUrl?: string;
  out?: string;
};

function parseArgs(argv: string[]) {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--company") args.company = argv[index + 1];
    if (arg === "--source-url") args.sourceUrl = argv[index + 1];
    if (arg === "--out") args.out = argv[index + 1];
  }
  return args;
}

async function fetchGenericSourceText(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": process.env.SEC_USER_AGENT ?? "earnings-dashboard/0.1 contact: zhouziyi@example.com",
      Accept: "application/pdf,text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`source fetch failed ${response.status}: ${sourceUrl}`);
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());

  if (contentType.includes("pdf") || sourceUrl.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: bytes });
    try {
      const text = await parser.getText();
      return text.text.replace(/\s+/g, " ").trim();
    } finally {
      await parser.destroy();
    }
  }

  return htmlToText(bytes.toString("utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.company) {
    throw new Error("Usage: npm run extract:source -- --company baidu [--source-url official.pdf]");
  }

  const config = getCompanyConfig(args.company);
  if (!config) throw new Error(`Unknown company: ${args.company}`);

  const sourceUrl =
    args.sourceUrl ??
    (config.sourceProvider === "sec" ? (await discoverLatestSecEarningsFiling(config))?.documentUrl : undefined);

  if (!sourceUrl) {
    throw new Error(`${config.name} requires --source-url for ${config.sourceProvider} sources.`);
  }

  const raw = sourceUrl.includes("sec.gov") ? await fetchSecText(sourceUrl) : await fetchGenericSourceText(sourceUrl);
  const text = sourceUrl.includes("sec.gov") ? htmlToText(raw) : raw;
  const keywordHits =
    config.filingKeywords?.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase())) ?? [];

  console.log(`company=${config.name}`);
  console.log(`source=${sourceUrl}`);
  console.log(`hash=${sha256(raw)}`);
  console.log(`chars=${text.length}`);
  console.log(`keywordHits=${keywordHits.join(", ") || "none"}`);
  console.log(text.slice(0, 1000));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
