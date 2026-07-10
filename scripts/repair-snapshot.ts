import { readEarningsSnapshot, writeEarningsSnapshot } from "@/lib/snapshot";
import type { Company } from "@/lib/mock-data";

function hasMetric(company: Company, label: string) {
  return company.metrics.some((metric) => metric.label === label);
}

function repairCompany(company: Company): Company {
  const repaired = {
    ...company,
    shareReaction: company.shareReaction.includes("待接入")
      ? "未配置实时行情源；需接入交易所/行情 API 后校验财报后首个交易窗口。"
      : company.shareReaction,
    highlights: company.highlights.map((item) =>
      !company.segments.length && item.includes("分部收入已按官方披露抽取")
        ? `${company.name} 当前来源只覆盖公司级核心指标，业务分部等待官方公告 parser。`
        : item,
    ),
    risks: company.risks.map((item) =>
      item.includes("市场反应和一致预期差异尚未接入实时行情源")
        ? "市场反应需要接入实时/历史行情源后校验。"
        : item,
    ),
    quarters: company.quarters.map((point) => ({
      ...point,
      operatingMargin:
        hasMetric(company, "营业利润率") || point.operatingMargin !== 0 ? point.operatingMargin : null,
      expenseRatio: hasMetric(company, "费用率") || point.expenseRatio !== 0 ? point.expenseRatio : null,
    })),
  };

  return repaired;
}

async function main() {
  const snapshot = await readEarningsSnapshot();
  if (!snapshot) {
    throw new Error("No data/earnings-snapshot.json found");
  }

  await writeEarningsSnapshot({
    ...snapshot,
    generatedAt: new Date().toISOString(),
    provenance: {
      ...snapshot.provenance,
      note:
        "Snapshot combines official verified parsers when available with AkShare/EastMoney third-party historical indicators for broader coverage. Missing operating margin, expense ratio, segment data, and market reaction are shown as unavailable instead of zero.",
    },
    companies: snapshot.companies.map(repairCompany),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
