import { NextResponse } from "next/server";
import { companies } from "@/lib/mock-data";
import { fetchVerifiedNetEase } from "@/lib/sources/sec-netease";

export async function GET() {
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
