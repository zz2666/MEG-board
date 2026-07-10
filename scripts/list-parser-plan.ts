import { trackedCompanyConfigs } from "@/lib/sources/company-config";

const implementedProfiles = new Set(["netease-q1-2026", "baidu-q1-2026"]);

function parserFamily(profile: string | undefined) {
  if (profile === "sec-companyfacts-us-tech") return "SEC CompanyFacts / 10-Q XBRL";
  if (profile === "sec-6k-standard") return "SEC 6-K Exhibit HTML";
  if (profile === "pdf-text-standard") return "Official PDF text parser";
  if (profile?.includes("q1-2026")) return "Deterministic company profile";
  return "Source discovery only";
}

console.table(
  trackedCompanyConfigs.map((company) => ({
    id: company.id,
    name: company.name,
    ticker: company.displayTicker,
    provider: company.sourceProvider,
    profile: company.parserProfile ?? "none",
    family: parserFamily(company.parserProfile),
    status: implementedProfiles.has(company.parserProfile ?? "") ? "implemented" : "scaffolded",
    secCik: company.secCik ?? "",
    hkexCode: company.hkexCode ?? "",
  })),
);
