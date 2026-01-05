// app/api/result/wrong-csv/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    { ok: true, message: "wrong-csv route ok" },
    { status: 200 }
  );
}
