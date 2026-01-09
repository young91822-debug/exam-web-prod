// app/api/result/[attemptId]/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function toInt(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId: raw } = await context.params;
  const attemptId = toInt(s(raw));

  if (!Number.isFinite(attemptId) || attemptId <= 0) {
    return NextResponse.json(
      { ok: false, error: "INVALID_ATTEMPT_ID" },
      { status: 400 }
    );
  }

  try {
    // 1) attempt 기본
    const { data: attempt, error: attemptErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, submitted_at")
      .eq("id", attemptId)
      .single();

    if (attemptErr || !attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND" },
        { status: 404 }
      );
    }

    // 2) 1차: wrong_questions 테이블에서 조회(가장 안정적)
    let wrongQuestionIds: (number | string)[] = [];

    const wq = await supabaseAdmin
      .from("wrong_questions")
      .select("question_id")
      .eq("attempt_id", attemptId);

    if (!wq.error && Array.isArray(wq.data)) {
      wrongQuestionIds = wq.data.map((r: any) => r.question_id);
    } else {
      // 3) fallback: attempt_answers(is_correct=false)
      const aa = await supabaseAdmin
        .from("attempt_answers")
        .select("question_id")
        .eq("attempt_id", attemptId)
        .eq("is_correct", false);

      if (!aa.error && Array.isArray(aa.data)) {
        wrongQuestionIds = aa.data.map((r: any) => r.question_id);
      }
    }

    return NextResponse.json({
      ok: true,
      attempt: {
        empId: attempt.emp_id,
        score: attempt.score ?? 0,
        submittedAt: attempt.submitted_at ?? null,
      },
      wrongCount: wrongQuestionIds.length,
      wrongQuestionIds,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
