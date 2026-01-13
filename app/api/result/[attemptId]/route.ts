// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function isNumericId(x: string) {
  return /^\d+$/.test(x);
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choice_texts ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") return c.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const { attemptId: raw } = await context.params;
    const attemptIdStr = s(raw);

    if (!attemptIdStr) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }
    if (!isNumericId(attemptIdStr)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const attemptId = Number(attemptIdStr);

    /** 1) attempt */
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String(e1.message || e1) }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    /** 2) exam_answers: question_id(bigint) + selected_index(int) */
    const { data: answers, error: eAns } = await supabaseAdmin
      .from("exam_answers")
      .select("question_id, selected_index")
      .eq("attempt_id", attemptId);

    if (eAns) {
      return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED", detail: String(eAns.message || eAns) }, { status: 500 });
    }

    // question_id(bigint) => selected_index(int)
    const ansMap = new Map<string, number>();
    for (const a of answers ?? []) {
      const qid = a?.question_id;
      const sel = a?.selected_index;
      if (qid === null || qid === undefined) continue;
      if (sel === null || sel === undefined) continue;
      ansMap.set(String(qid), Number(sel));
    }

    /** 3) questions 조회: id(bigint) 기반으로 매칭 */
    const { data: questions, error: eQ } = await supabaseAdmin
      .from("questions")
      .select("*"); // content, choices, correct_index/answer_index, points 등 포함

    if (eQ) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String(eQ.message || eQ) }, { status: 500 });
    }

    let score = 0;
    let correctCount = 0;

    const graded = (questions ?? []).map((q: any) => {
      const qid = String(q?.id); // 🔥 questions.id가 bigint
      const correctIndex = q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      const chosen = ansMap.has(qid) ? ansMap.get(qid)! : null;

      const isCorrect =
        correctIndex !== null &&
        chosen !== null &&
        Number.isFinite(Number(correctIndex)) &&
        Number.isFinite(Number(chosen)) &&
        Number(correctIndex) === Number(chosen);

      const pts = n(q?.points, 0) ?? 0;
      if (isCorrect) {
        score += pts;
        correctCount += 1;
      }

      return {
        questionId: q?.id,
        content: q?.content ?? q?.question ?? q?.title ?? "",
        choices: pickChoices(q),
        correctIndex: correctIndex === null ? null : Number(correctIndex),
        selectedIndex: chosen === null ? null : Number(chosen),
        isCorrect,
        points: pts,
      };
    });

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        emp_id: attempt.emp_id,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        total_questions: attempt.total_questions,
        total_points: attempt.total_points,
        score,
        correct_count: correctCount,
        status: attempt.status,
        answers_source: "exam_answers(attempt_id)",
      },
      graded,
      totalQuestions: graded.length,
      wrongCount: graded.filter((g: any) => g?.isCorrect === false).length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
