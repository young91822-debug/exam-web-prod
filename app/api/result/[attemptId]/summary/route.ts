// app/api/result/[attemptId]/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ attemptId: string }> | { attemptId: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const p: any = await Promise.resolve((ctx as any)?.params);
    const attemptId = String(p?.attemptId ?? "").trim();

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ DB 스키마에 맞춰 select 컬럼은 바꿔도 됨
    const { data: attempt, error } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, total_points, started_at, submitted_at")
      .eq("id", attemptId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", detail: error.message },
        { status: 500 }
      );
    }

    if (!attempt) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, attempt }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
