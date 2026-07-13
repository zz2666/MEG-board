import { NextRequest, NextResponse } from "next/server";
import { refreshCompanyEarnings } from "@/lib/earnings-refresh";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ companyId: string }> },
) {
  try {
    const { companyId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      persist?: boolean;
      snapshot?: boolean;
      checkLatest?: boolean;
    };
    const result = await refreshCompanyEarnings(companyId, {
      persist: body.persist ?? true,
      snapshot: body.snapshot,
      checkLatest: body.checkLatest ?? true,
    });

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Refresh failed",
      },
      { status: 500 },
    );
  }
}
