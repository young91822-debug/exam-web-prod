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
function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId: raw } = await context.params;
  const attemptId = toInt(s(raw));

  if (!Number.isFinite(attemptId) || attemptId <= 0) {
    return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
  }

  try {
    // 1) attempt 기본
    const { data: attempt, error: attemptErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, submitted_at")
      .eq("id", attemptId)
      .single();

    if (attemptErr || !attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: attemptErr }, { status: 404 });
    }

    // 2) wrongQuestionIds (기존 로직 유지)
    let wrongQuestionIds: (number | string)[] = [];

    const wq = await supabaseAdmin
      .from("wrong_questions")
      .select("question_id")
      .eq("attempt_id", attemptId);

    if (!wq.error && Array.isArray(wq.data)) {
      wrongQuestionIds = wq.data.map((r: any) => r.question_id);
    } else {
      const aaWrong = await supabaseAdmin
        .from("attempt_answers")
        .select("question_id")
        .eq("attempt_id", attemptId)
        .eq("is_correct", false);

      if (!aaWrong.error && Array.isArray(aaWrong.data)) {
        wrongQuestionIds = aaWrong.data.map((r: any) => r.question_id);
      }
    }

    // 3) ✅ graded 만들기: attempt_answers + questions 조회
    const { data: answers, error: ansErr } = await supabaseAdmin
      .from("attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (ansErr) {
      // summary는 최소한 보여줘야 하니 graded 없이도 응답은 OK로 보냄(화면은 여전히 "상세없음"일 수 있음)
      return NextResponse.json({
        ok: true,
        attempt: {
          empId: attempt.emp_id,
          score: attempt.score ?? 0,
          submittedAt: attempt.submitted_at ?? null,
        },
        wrongCount: wrongQuestionIds.length,
        wrongQuestionIds,
        graded: [],
        totalQuestions: 0,
        hint: { graded: "attempt_answers query failed", ansErr },
      });
    }

    const qids = Array.from(
      new Set((answers ?? []).map((a: any) => a?.question_id).filter((x: any) => x != null))
    );

    const { data: questions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids.length ? qids : [-1]);

    if (qErr) {
      return NextResponse.json({
        ok: true,
        attempt: {
          empId: attempt.emp_id,
          score: attempt.score ?? 0,
          submittedAt: attempt.submitted_at ?? null,
        },
        wrongCount: wrongQuestionIds.length,
        wrongQuestionIds,
        graded: [],
        totalQuestions: 0,
        hint: { graded: "questions query failed", qErr },
      });
    }

    const qMap = new Map<any, any>();
    for (const q of questions ?? []) qMap.set(q.id, q);

    const graded = (answers ?? []).map((a: any) => {
      const q = qMap.get(a.question_id);

      const correctIndex =
        q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      const chosenIndex =
        a?.chosen_index ?? a?.chosenIndex ?? a?.answer_index ?? a?.answerIndex ?? null;

      // attempt_answers에 is_correct가 있으면 그걸 우선 사용하고, 없으면 인덱스로 계산
      const isCorrect =
        a?.is_correct !== undefined && a?.is_correct !== null
          ? Boolean(a.is_correct)
          : correctIndex !== null &&
            chosenIndex !== null &&
            Number(correctIndex) === Number(chosenIndex);

      return {
        questionId: a.question_id,
        question: q?.content ?? q?.question ?? q?.title ?? "",
        choices: q?.choices ?? q?.options ?? [],
        correctIndex,
        chosenIndex,
        isCorrect,
        points: n(q?.points, 0),
      };
    });

    return NextResponse.json({
      ok: true,
      attempt: {
        empId: attempt.emp_id,
        score: attempt.score ?? 0,
        submittedAt: attempt.submitted_at ?? null,
      },
      wrongCount: wrongQuestionIds.length,
      wrongQuestionIds,
      graded,
      totalQuestions: graded.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
