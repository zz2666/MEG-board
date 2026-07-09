import { NextResponse } from "next/server";
import { companies as fallbackCompanies } from "@/lib/mock-data";
import { readEarningsSnapshot } from "@/lib/snapshot";
import { generateQuickNoteWithLlm } from "@/lib/llm";

type GenerateNoteRequest = {
  companyId?: string;
};

async function getCompany(companyId: string) {
  const snapshot = await readEarningsSnapshot();
  return (
    snapshot?.companies.find((company) => company.id === companyId) ??
    fallbackCompanies.find((company) => company.id === companyId)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateNoteRequest;
    const companyId = body.companyId?.trim();

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const company = await getCompany(companyId);
    if (!company) {
      return NextResponse.json({ error: `Company not found: ${companyId}` }, { status: 404 });
    }

    if (company.dataQuality !== "SEC verified") {
      return NextResponse.json(
        { error: "LLM generation is only enabled for verified official-source data." },
        { status: 422 },
      );
    }

    const note = await generateQuickNoteWithLlm(company);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      model: process.env.OPENAI_MODEL ?? "gpt-5.5-coding-plan",
      companyId,
      note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM generation error";
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
