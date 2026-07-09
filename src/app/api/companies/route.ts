import { NextResponse } from "next/server";
import { mapDbCompanyToDashboard, hasPublishedFinancials } from "@/lib/db-to-dashboard";
import { prisma } from "@/lib/db";
import { companies } from "@/lib/mock-data";
import { readEarningsSnapshot } from "@/lib/snapshot";
import { fetchVerifiedNetEase } from "@/lib/sources/sec-netease";

function shouldUseDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  return Boolean(databaseUrl && !databaseUrl.includes("localhost:5432"));
}

async function fetchDbCompanies() {
  const rows = await prisma.company.findMany({
    where: {
      isTracked: true,
    },
    include: {
      aiDevelopments: {
        orderBy: {
          publishedAt: "desc",
        },
        take: 5,
      },
      reports: {
        where: {
          status: "PUBLISHED",
        },
        orderBy: [
          {
            fiscalYear: "asc",
          },
          {
            fiscalQuarter: "asc",
          },
        ],
        include: {
          metrics: true,
          segments: true,
          quickNotes: {
            orderBy: {
              version: "desc",
            },
            take: 1,
          },
        },
      },
    },
  });

  return rows.filter(hasPublishedFinancials).map(mapDbCompanyToDashboard).filter(Boolean);
}

export async function GET() {
  if (shouldUseDatabase()) {
    try {
      const dbCompanies = await fetchDbCompanies();
      if (dbCompanies.length) {
        return NextResponse.json({
          fetchedAt: new Date().toISOString(),
          provenance: {
            mode: "sql",
            verifiedCompanies: dbCompanies.map((company) => company?.id).filter(Boolean),
            note:
              "Dashboard data is loaded from PostgreSQL. Financial numbers were imported from official source documents and stored with source anchors.",
          },
          companies: dbCompanies,
        });
      }
    } catch (error) {
      console.warn("DB company fetch failed; falling back to snapshot/live SEC/mock data", error);
    }
  }

  const snapshot = await readEarningsSnapshot();
  if (snapshot?.companies.length) {
    return NextResponse.json({
      fetchedAt: snapshot.generatedAt,
      provenance: {
        ...snapshot.provenance,
        verifiedCompanies: snapshot.companies.map((company) => company.id),
      },
      companies: snapshot.companies,
    });
  }

  try {
    const netease = await fetchVerifiedNetEase();
    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      provenance: {
        mode: "live-sec",
        verifiedCompanies: ["netease"],
        note:
          "NetEase Q1 2026 metrics are parsed live from SEC 6-K Exhibit 99.1. Other companies are withheld from the default view until official filings are wired.",
      },
      companies: [netease, ...companies.filter((company) => company.id !== "netease")],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SEC fetch error";
    const fallback = companies.map((company) =>
      company.id === "netease"
        ? {
            ...company,
            sourceLabel: `${company.sourceLabel} (fallback seed)`,
          }
        : company,
    );

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      provenance: {
        mode: "verified-fallback",
        verifiedCompanies: ["netease"],
        error: message,
        note:
          "Live SEC fetch failed; NetEase data is using the local seed that was manually checked against SEC 6-K Exhibit 99.1.",
      },
      companies: fallback,
    });
  }
}

export async function HEAD() {
  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
  });
}
