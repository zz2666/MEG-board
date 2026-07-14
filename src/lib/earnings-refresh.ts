import { spawn } from "node:child_process";
import { PDFParse } from "pdf-parse";
import { parsedReportToDashboardCompany } from "@/lib/parsed-to-dashboard";
import { prisma } from "@/lib/db";
import { readEarningsSnapshot, writeEarningsSnapshot } from "@/lib/snapshot";
import { getCompanyConfig } from "@/lib/sources/company-config";
import { persistDiscoveredSourceOnly, persistParsedEarningsReport } from "@/lib/sources/persist";
import { parseEarningsReport } from "@/lib/sources/parser";
import { hasPdfTextCompanyProfile } from "@/lib/sources/pdf-text-profile";
import { discoverLatestSecEarningsFiling, fetchSecText, htmlToText, sha256 } from "@/lib/sources/sec";
import { hasSec6kCompanyProfile } from "@/lib/sources/sec-6k-standard-profile";
import type { Company } from "@/lib/mock-data";
import type { CompanySourceConfig } from "@/lib/sources/types";

type RefreshOptions = {
  persist?: boolean;
  snapshot?: boolean;
  checkLatest?: boolean;
};

type RefreshStep =
  | "checking"
  | "source_found"
  | "fetching"
  | "parsing"
  | "updated"
  | "needs_parser"
  | "needs_review"
  | "failed";

type RefreshJobEvent = {
  step: RefreshStep;
  label: string;
  at: string;
};

function jobEvent(step: RefreshStep, label: string): RefreshJobEvent {
  return {
    step,
    label,
    at: new Date().toISOString(),
  };
}

function shouldUseDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  return Boolean(databaseUrl && !databaseUrl.includes("localhost:5432"));
}

function isImplementedParser(config: CompanySourceConfig) {
  return (
    config.parserProfile === "netease-q1-2026" ||
    config.parserProfile === "baidu-q1-2026" ||
    config.parserProfile === "aeromexico-20f-2025" ||
    config.parserProfile === "sec-companyfacts-us-tech" ||
    (config.parserProfile === "sec-6k-standard" && hasSec6kCompanyProfile(config.id)) ||
    (config.parserProfile === "pdf-text-standard" && hasPdfTextCompanyProfile(config.id))
  );
}

async function mergeSnapshot(company: Company, sourceUrl: string) {
  const existing = await readEarningsSnapshot();
  const companies = existing?.companies.filter((item) => item.id !== company.id) ?? [];
  companies.unshift(company);

  await writeEarningsSnapshot({
    generatedAt: new Date().toISOString(),
    provenance: {
      mode: "snapshot",
      note: "Snapshot updated by manual earnings refresh.",
      sourceUrls: [...(existing?.provenance.sourceUrls ?? []), sourceUrl],
    },
    companies,
  });
}

async function resolveSource(config: CompanySourceConfig, options: Pick<RefreshOptions, "checkLatest"> = {}) {
  const knownReports = Object.values(config.knownReports ?? {});
  const latestKnown = knownReports.sort((first, second) => second.releaseDate.localeCompare(first.releaseDate))[0];
  const discovered =
    options.checkLatest && config.sourceProvider === "sec"
      ? await discoverLatestSecEarningsFiling(config, {
          afterFilingDate: latestKnown?.releaseDate.slice(0, 10),
          maxCandidates: 6,
          fallbackToLatestCandidate: true,
        })
      : null;

  if (discovered && (!latestKnown || discovered.filingDate >= latestKnown.releaseDate.slice(0, 10))) {
    return {
      sourceUrl: discovered.documentUrl,
      sourceTitle: discovered.primaryDocDescription ?? `${config.name} ${discovered.form}`,
      releaseDate: discovered.filingDate,
      discovered: true,
    };
  }

  if (latestKnown) {
    return {
      sourceUrl: latestKnown.sourceUrl,
      sourceTitle: latestKnown.title,
      releaseDate: latestKnown.releaseDate,
      discovered: false,
    };
  }

  return null;
}

async function fetchGenericSourceText(url: string) {
  const response = await fetchGenericSourceResponse(url);
  if (!response.ok) throw new Error(`source fetch failed ${response.status}: ${url}`);

  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) {
    return htmlToText(bytes.toString("utf8"));
  }

  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText();
    return text.text
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    await parser.destroy();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGenericSourceResponse(url: string, attempts = 1) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.SOURCE_FETCH_TIMEOUT_MS ?? 8_000));
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": process.env.SEC_USER_AGENT ?? "earnings-dashboard/0.1 contact: zhouziyi@example.com",
          Accept: "application/pdf,text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(750 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    return await fetchWithCurl(url);
  } catch (curlError) {
    const fetchReason = reasonFromError(lastError);
    const curlReason = reasonFromError(curlError);
    throw new Error(`${fetchReason}; curl fallback failed: ${curlReason}`);
  }
}

function fetchWithCurl(url: string) {
  const timeoutSeconds = String(Math.ceil(Number(process.env.SOURCE_FETCH_CURL_TIMEOUT_MS ?? 18_000) / 1000));
  const args = [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--http1.1",
    "--max-time",
    timeoutSeconds,
    url,
  ];

  return new Promise<Response>((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `curl exited with ${code}`));
        return;
      }

      const bytes = Buffer.concat(stdout);
      const contentType = bytes.subarray(0, 4).toString("utf8") === "%PDF" ? "application/pdf" : "text/html";
      resolve(new Response(bytes, { status: 200, headers: { "content-type": contentType } }));
    });
  });
}

function reasonFromError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown parser error";
}

function sourceOnlyMessage(params: { companyName: string; discovered: boolean; reason: string }) {
  const prefix = params.discovered ? "已发现并抓取最新官方源文件" : "已抓取已配置官方源文件";
  return `${params.companyName}: ${prefix}，但当前 parser 未能发布数据，已标记为待人工校验。原因：${params.reason}`;
}

export async function refreshCompanyEarnings(companyId: string, options: RefreshOptions = {}) {
  const config = getCompanyConfig(companyId);
  if (!config) throw new Error(`Unknown company: ${companyId}`);
  const jobEvents: RefreshJobEvent[] = [jobEvent("checking", "检查官方披露源")];

  let source;
  try {
    source = await resolveSource(config, { checkLatest: options.checkLatest ?? false });
  } catch (error) {
    const reason = reasonFromError(error);
    jobEvents.push(jobEvent("failed", "检查官方披露源失败"));
    return {
      status: "failed" as const,
      companyId: config.id,
      error: reason,
      jobEvents,
      message: `${config.name}: 检查官方披露源失败。原因：${reason}`,
    };
  }

  if (!source) {
    jobEvents.push(jobEvent("failed", "未发现可抓取的官方财报源"));
    return {
      status: "skipped" as const,
      companyId: config.id,
      jobEvents,
      message: "No official earnings source was discovered.",
    };
  }
  jobEvents.push(
    jobEvent(
      "source_found",
      `${source.discovered ? "发现最新官方源文件" : "使用已配置官方源文件"}: ${source.sourceTitle}`,
    ),
  );

  jobEvents.push(jobEvent("fetching", "下载官方原文"));
  let html;
  try {
    html =
      config.sourceProvider === "sec"
        ? await fetchSecText(source.sourceUrl)
        : await fetchGenericSourceText(source.sourceUrl);
  } catch (error) {
    const reason = reasonFromError(error);
    jobEvents.push(jobEvent("failed", "官方源文件下载失败"));
    return {
      status: "failed" as const,
      companyId: config.id,
      sourceUrl: source.sourceUrl,
      sourceTitle: source.sourceTitle,
      releaseDate: source.releaseDate,
      error: reason,
      jobEvents,
      message: `${config.name}: 已发现官方源文件，但下载失败。原因：${reason}`,
    };
  }
  jobEvents.push(jobEvent("parsing", "调用确定性 parser"));

  if (!config.parserProfile || !isImplementedParser(config)) {
    const reason = "Deterministic parser is not implemented for this company/profile.";
    if (options.persist && shouldUseDatabase()) {
      await persistDiscoveredSourceOnly({
        prisma,
        config,
        title: source.sourceTitle,
        url: source.sourceUrl,
        rawText: htmlToText(html),
        contentHash: sha256(html),
        reason,
      });
    }
    jobEvents.push(jobEvent("needs_parser", "源文件已抓取，等待补 parser"));

    return {
      status: "source-only" as const,
      companyId: config.id,
      sourceUrl: source.sourceUrl,
      sourceTitle: source.sourceTitle,
      releaseDate: source.releaseDate,
      jobEvents,
      message: sourceOnlyMessage({
        companyName: config.name,
        discovered: source.discovered,
        reason,
      }),
    };
  }

  let parsed;
  try {
    parsed = await parseEarningsReport({
      config,
      html,
      sourceUrl: source.sourceUrl,
      sourceTitle: source.sourceTitle,
      releaseDate: source.releaseDate,
    });
  } catch (error) {
    const reason = reasonFromError(error);
    if (options.persist && shouldUseDatabase()) {
      await persistDiscoveredSourceOnly({
        prisma,
        config,
        title: source.sourceTitle,
        url: source.sourceUrl,
        rawText: htmlToText(html),
        contentHash: sha256(html),
        reason,
      });
    }
    jobEvents.push(jobEvent("needs_review", "源文件已抓取，parser 失败，等待人工校验"));

    return {
      status: "needs-review" as const,
      companyId: config.id,
      sourceUrl: source.sourceUrl,
      sourceTitle: source.sourceTitle,
      releaseDate: source.releaseDate,
      parserProfile: config.parserProfile,
      error: reason,
      jobEvents,
      message: sourceOnlyMessage({
        companyName: config.name,
        discovered: source.discovered,
        reason,
      }),
    };
  }
  const company = parsedReportToDashboardCompany(config, parsed);

  if (options.persist && shouldUseDatabase()) {
    await persistParsedEarningsReport(prisma, config, parsed);
  }

  if (options.snapshot ?? !shouldUseDatabase()) {
    await mergeSnapshot(company, parsed.sourceUrl);
  }
  jobEvents.push(jobEvent("updated", "解析成功并更新数据源"));

  return {
    status: "published" as const,
    companyId: config.id,
    sourceUrl: parsed.sourceUrl,
    sourceTitle: parsed.sourceTitle,
    releaseDate: parsed.releaseDate,
    jobEvents,
    message: `${config.name} ${parsed.periodLabel} parsed and updated.`,
    company,
  };
}
