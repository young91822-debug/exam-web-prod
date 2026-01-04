import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ✅ 브라우저로 /api/exam/submit 열면 이 JSON이 떠야 함
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/exam/submit" });
}
