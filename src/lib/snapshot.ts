import { promises as fs } from "node:fs";
import path from "node:path";
import type { Company } from "@/lib/mock-data";

export type EarningsSnapshot = {
  generatedAt: string;
  provenance: {
    mode: "snapshot";
    note: string;
    sourceUrls: string[];
  };
  companies: Company[];
};

export const snapshotPath = path.join(process.cwd(), "data", "earnings-snapshot.json");

export async function readEarningsSnapshot() {
  try {
    const content = await fs.readFile(snapshotPath, "utf8");
    return JSON.parse(content) as EarningsSnapshot;
  } catch {
    return null;
  }
}

export async function writeEarningsSnapshot(snapshot: EarningsSnapshot) {
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}
