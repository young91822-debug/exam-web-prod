// app/api/result/[attemptId]/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ attemptId?: string }> | { attemptId?: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const p = await Promise.resolve(ctx?.params as any);
    const attemptId = String(p?.attemptId ?? "").trim();

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ 최소 요약 정보만 반환 (화면/관리자에서 쓰기 좋게)
    const { data: attempt, error } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, total_questions, started_at, submitted_at, duration_sec")
      .eq("id", attemptId as any)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: error.message }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", attemptId }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      empId: attempt.emp_id ?? null,
      score: attempt.score ?? null,
      totalQuestions: attempt.total_questions ?? null,
      startedAt: attempt.started_at ?? null,
      submittedAt: attempt.submitted_at ?? null,
      durationSec: attempt.duration_sec ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
