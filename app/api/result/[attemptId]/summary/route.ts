// app/api/result/[attemptId]/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: any) {
  try {
    const p = await Promise.resolve(ctx?.params);
    const attemptId = String(p?.attemptId ?? "").trim();
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ attempt 조회 (점수/총점/응시시각 등)
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_SELECT_FAILED", detail: aErr.message },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // ✅ attempt_answers 조회 (틀린 문제 목록 만들기)
    const { data: answers, error: ansErr } = await supabaseAdmin
      .from("exam_attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (ansErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_SELECT_FAILED", detail: ansErr.message },
        { status: 500 }
      );
    }

    const wrong = (answers ?? []).filter((r: any) => r?.is_correct === false);

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        user_id: attempt.user_id ?? attempt.emp_id ?? attempt.account_id ?? null,
        score: attempt.score ?? 0,
        total_points: attempt.total_points ?? null,
        started_at: attempt.started_at ?? null,
        submitted_at: attempt.submitted_at ?? null,
      },
      wrong_count: wrong.length,
      wrong_question_ids: wrong.map((r: any) => r.question_id),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UNHANDLED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
