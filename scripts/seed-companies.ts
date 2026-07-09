import "dotenv/config";
import { prisma } from "@/lib/db";
import { trackedCompanyConfigs } from "@/lib/sources/company-config";
import { upsertTrackedCompany } from "@/lib/sources/persist";

async function main() {
  for (const config of trackedCompanyConfigs) {
    const company = await upsertTrackedCompany(prisma, config);
    console.log(`seeded ${company.name} ${company.ticker} (${company.market})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
