import { trackedCompanyConfigs } from "@/lib/sources/company-config";
import { hasPdfTextCompanyProfile } from "@/lib/sources/pdf-text-profile";
import { hasSec6kCompanyProfile } from "@/lib/sources/sec-6k-standard-profile";

const implementedProfiles = new Set([
  "netease-q1-2026",
  "baidu-q1-2026",
  "aeromexico-20f-2025",
  "sec-companyfacts-us-tech",
]);

function parserFamily(profile: string | undefined) {
  if (profile === "sec-companyfacts-us-tech") return "SEC CompanyFacts / 10-Q XBRL";
  if (profile === "sec-6k-standard") return "SEC 6-K Exhibit HTML";
  if (profile === "pdf-text-standard") return "Official PDF text parser";
  if (profile === "aeromexico-20f-2025") return "SEC 20-F inline XBRL";
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
    status:
      implementedProfiles.has(company.parserProfile ?? "") ||
      (company.parserProfile === "pdf-text-standard" && hasPdfTextCompanyProfile(company.id)) ||
      (company.parserProfile === "sec-6k-standard" && hasSec6kCompanyProfile(company.id))
        ? "implemented"
        : "scaffolded",
    secCik: company.secCik ?? "",
    hkexCode: company.hkexCode ?? "",
  })),
);
