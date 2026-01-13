import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? [];
  if (Array.isArray(c)) return c.map(String);
  return [];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { attemptId: string } }
) {
  const attemptId = Number(params.attemptId);
  if (!Number.isFinite(attemptId)) {
    return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
  }

  /** 1️⃣ attempt */
  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
  }

  /** 2️⃣ exam_answers (🔥 bigint 기준) */
  const { data: answers } = await supabaseAdmin
    .from("exam_answers")
    .select("question_id, selected_index")
    .eq("attempt_id", attemptId);

  const answerMap = new Map<number, number>();
  for (const a of answers ?? []) {
    if (a.question_id != null && a.selected_index != null) {
      answerMap.set(Number(a.question_id), Number(a.selected_index));
    }
  }

  /** 3️⃣ questions (uuid + bigint 같이 사용) */
  const { data: questions } = await supabaseAdmin
    .from("questions")
    .select("id, content, choices, correct_index, points");

  let score = 0;
  let correctCount = 0;

  const graded = (questions ?? []).map((q: any) => {
    const qIdBigint = Number(q.id); // ⚠️ questions.id 가 bigint PK임
    const selected = answerMap.get(qIdBigint) ?? null;
    const correct = q.correct_index;

    const isCorrect =
      selected !== null &&
      correct !== null &&
      Number(selected) === Number(correct);

    if (isCorrect) {
      score += q.points ?? 0;
      correctCount += 1;
    }

    return {
      questionId: q.id,
      content: q.content,
      choices: pickChoices(q),
      correctIndex: correct,
      selectedIndex: selected,
      isCorrect,
      points: q.points ?? 0,
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
    },
    graded,
    totalQuestions: graded.length,
    wrongCount: graded.filter((g) => !g.isCorrect).length,
  });
}
