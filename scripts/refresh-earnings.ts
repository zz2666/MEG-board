import "dotenv/config";
import { prisma } from "@/lib/db";
import { refreshCompanyEarnings } from "@/lib/earnings-refresh";

function parseArgs(argv: string[]) {
  const args: { company?: string; noSnapshot?: boolean; noPersist?: boolean; checkLatest?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--company") args.company = argv[index + 1];
    if (arg === "--no-snapshot") args.noSnapshot = true;
    if (arg === "--no-persist") args.noPersist = true;
    if (arg === "--check-latest") args.checkLatest = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.company) {
    console.log("Usage: npm run refresh:earnings -- --company aeromexico");
    process.exitCode = 1;
    return;
  }

  const result = await refreshCompanyEarnings(args.company, {
    persist: !args.noPersist,
    snapshot: !args.noSnapshot,
    checkLatest: args.checkLatest ?? false,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
