import type { Prisma, PrismaClient } from "@prisma/client";
import type { CompanySourceConfig, ParsedEarningsReport } from "./types";

function toDate(value?: string | null) {
  return value ? new Date(value) : null;
}

function toDecimal(value?: number | null) {
  return value === null || value === undefined ? null : value;
}

function sourceTypeFor(config: CompanySourceConfig) {
  if (config.sourceProvider === "sec") return "SEC_FILING" as const;
  if (config.sourceProvider === "hkex-ir") return "HKEX_ANNOUNCEMENT" as const;
  return "COMPANY_IR" as const;
}

type WritablePrisma = PrismaClient | Prisma.TransactionClient;

export async function upsertTrackedCompany(prisma: WritablePrisma, config: CompanySourceConfig) {
  return prisma.company.upsert({
    where: {
      ticker_market: {
        ticker: config.ticker,
        market: config.market,
      },
    },
    create: {
      name: config.name,
      ticker: config.ticker,
      market: config.market,
      industry: config.industry,
      irUrl: config.irUrl,
      secCik: config.secCik,
      hkexCode: config.hkexCode,
      logoUrl: config.logoUrl,
      isTracked: true,
    },
    update: {
      name: config.name,
      industry: config.industry,
      irUrl: config.irUrl,
      secCik: config.secCik,
      hkexCode: config.hkexCode,
      logoUrl: config.logoUrl,
      isTracked: true,
    },
  });
}

async function replaceMetrics(
  tx: Prisma.TransactionClient,
  reportId: string,
  sourceDocId: string,
  report: Pick<ParsedEarningsReport, "metrics">,
) {
  await tx.financialMetric.deleteMany({ where: { reportId } });

  if (!report.metrics.length) return;

  await tx.financialMetric.createMany({
    data: report.metrics.map((metric) => ({
      reportId,
      sourceDocId,
      name: metric.name,
      normalized: metric.normalized,
      value: metric.value,
      unit: metric.unit,
      yoy: toDecimal(metric.yoy),
      qoq: toDecimal(metric.qoq),
      sourceAnchor: metric.sourceAnchor,
      confidence: metric.confidence,
      isManual: metric.isManual ?? false,
    })),
  });
}

async function replaceSegments(
  tx: Prisma.TransactionClient,
  reportId: string,
  sourceDocId: string,
  report: Pick<ParsedEarningsReport, "segments">,
) {
  await tx.businessSegment.deleteMany({ where: { reportId } });

  if (!report.segments.length) return;

  await tx.businessSegment.createMany({
    data: report.segments.map((segment) => ({
      reportId,
      sourceDocId,
      name: segment.name,
      revenue: toDecimal(segment.revenue),
      revenueUnit: segment.revenueUnit,
      share: toDecimal(segment.share),
      yoy: toDecimal(segment.yoy),
      qoq: toDecimal(segment.qoq),
      grossMargin: toDecimal(segment.grossMargin),
      driver: segment.driver,
      confidence: segment.confidence,
    })),
  });
}

async function replaceQuickNote(tx: Prisma.TransactionClient, reportId: string, report: ParsedEarningsReport) {
  await tx.quickNote.deleteMany({ where: { reportId } });

  await tx.quickNote.create({
    data: {
      reportId,
      version: 1,
      headline: report.quickNote.headline,
      highlights: report.quickNote.highlights,
      weaknesses: report.quickNote.weaknesses,
      segmentComments: report.quickNote.segmentComments,
      marginComments: report.quickNote.marginComments,
      aiSummary: report.quickNote.aiSummary,
      watchItems: report.quickNote.watchItems,
      marketReaction: report.quickNote.marketReaction,
      sourceMap: report.quickNote.sourceMap,
      model: "deterministic-parser",
      promptVersion: "none",
      publishedAt: new Date(),
    },
  });
}

export async function persistParsedEarningsReport(
  prisma: PrismaClient,
  config: CompanySourceConfig,
  parsed: ParsedEarningsReport,
) {
  return prisma.$transaction(async (tx) => {
    const company = await upsertTrackedCompany(tx, config);

    const report = await tx.earningsReport.upsert({
      where: {
        companyId_fiscalYear_fiscalQuarter: {
          companyId: company.id,
          fiscalYear: parsed.fiscalYear,
          fiscalQuarter: parsed.fiscalQuarter,
        },
      },
      create: {
        companyId: company.id,
        fiscalYear: parsed.fiscalYear,
        fiscalQuarter: parsed.fiscalQuarter,
        periodLabel: parsed.periodLabel,
        reportDate: toDate(parsed.reportDate),
        releaseDate: toDate(parsed.releaseDate),
        status: "PUBLISHED",
        marketReaction: parsed.quickNote.marketReaction,
        sourceUrl: parsed.sourceUrl,
        isHumanReviewed: false,
      },
      update: {
        periodLabel: parsed.periodLabel,
        reportDate: toDate(parsed.reportDate),
        releaseDate: toDate(parsed.releaseDate),
        status: "PUBLISHED",
        marketReaction: parsed.quickNote.marketReaction,
        sourceUrl: parsed.sourceUrl,
      },
    });

    const sourceDoc = await tx.sourceDocument.upsert({
      where: {
        contentHash: parsed.contentHash,
      },
      create: {
        companyId: company.id,
        reportId: report.id,
        type: sourceTypeFor(config),
        title: parsed.sourceTitle,
        url: parsed.sourceUrl,
        contentHash: parsed.contentHash,
        rawText: parsed.rawText,
      },
      update: {
        companyId: company.id,
        reportId: report.id,
        title: parsed.sourceTitle,
        url: parsed.sourceUrl,
        rawText: parsed.rawText,
      },
    });

    await replaceMetrics(tx, report.id, sourceDoc.id, parsed);
    await replaceSegments(tx, report.id, sourceDoc.id, parsed);
    await replaceQuickNote(tx, report.id, parsed);

    for (const comparative of parsed.comparativeReports ?? []) {
      const comparativeReport = await tx.earningsReport.upsert({
        where: {
          companyId_fiscalYear_fiscalQuarter: {
            companyId: company.id,
            fiscalYear: comparative.fiscalYear,
            fiscalQuarter: comparative.fiscalQuarter,
          },
        },
        create: {
          companyId: company.id,
          fiscalYear: comparative.fiscalYear,
          fiscalQuarter: comparative.fiscalQuarter,
          periodLabel: comparative.periodLabel,
          reportDate: toDate(comparative.reportDate),
          releaseDate: toDate(comparative.releaseDate),
          status: "PUBLISHED",
          sourceUrl: parsed.sourceUrl,
        },
        update: {
          periodLabel: comparative.periodLabel,
          reportDate: toDate(comparative.reportDate),
          releaseDate: toDate(comparative.releaseDate),
          status: "PUBLISHED",
          sourceUrl: parsed.sourceUrl,
        },
      });

      await replaceMetrics(tx, comparativeReport.id, sourceDoc.id, comparative);
    }

    await tx.processingJob.create({
      data: {
        companyId: company.id,
        reportId: report.id,
        sourceDocId: sourceDoc.id,
        type: "PARSE_FINANCIALS",
        status: "SUCCEEDED",
        attempts: 1,
        payload: {
          parserProfile: config.parserProfile,
          sourceUrl: parsed.sourceUrl,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    return { company, report, sourceDoc };
  });
}

export async function persistDiscoveredSourceOnly(params: {
  prisma: PrismaClient;
  config: CompanySourceConfig;
  title: string;
  url: string;
  rawText: string;
  contentHash: string;
  reason: string;
}) {
  return params.prisma.$transaction(async (tx) => {
    const company = await upsertTrackedCompany(tx, params.config);
    const sourceDoc = await tx.sourceDocument.upsert({
      where: {
        contentHash: params.contentHash,
      },
      create: {
        companyId: company.id,
        type: sourceTypeFor(params.config),
        title: params.title,
        url: params.url,
        contentHash: params.contentHash,
        rawText: params.rawText,
      },
      update: {
        companyId: company.id,
        title: params.title,
        url: params.url,
        rawText: params.rawText,
      },
    });

    await tx.processingJob.create({
      data: {
        companyId: company.id,
        sourceDocId: sourceDoc.id,
        type: "PARSE_FINANCIALS",
        status: "SKIPPED",
        attempts: 1,
        payload: {
          reason: params.reason,
          sourceUrl: params.url,
          parserProfile: params.config.parserProfile ?? null,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    return { company, sourceDoc };
  });
}
