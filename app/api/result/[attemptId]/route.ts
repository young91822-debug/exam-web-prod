// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function isNumericId(x: string) {
  return /^\d+$/.test(x);
}
function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
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
    const attemptId = s(raw);

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }
    if (!isNumericId(attemptId)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // 1) attempt (숫자 PK)
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: e1 }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // ✅ 핵심: exam_attempts 안에 question_ids + answers(맵)가 이미 있음
    const questionIds: string[] = Array.isArray(attempt?.question_ids)
      ? attempt.question_ids.map((x: any) => String(x))
      : [];

    const answersMap: Record<string, any> =
      (attempt?.answers && typeof attempt.answers === "object") ? attempt.answers : {};

    // question_ids가 비었으면 answers 키로라도 시도
    const qids = questionIds.length
      ? questionIds
      : Object.keys(answersMap || {}).map((k) => String(k));

    if (!qids.length) {
      return NextResponse.json({
        ok: true,
        attempt,
        graded: [],
        totalQuestions: 0,
        hint: { message: "No question_ids/answers in exam_attempts." },
      });
    }

    // 2) questions 조회 (uuid in)
    const { data: questions, error: e2 } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids);

    if (e2) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: e2 }, { status: 500 });
    }

    const qMap = new Map<string, any>();
    for (const q of questions ?? []) qMap.set(String(q?.id), q);

    // 3) graded 구성 (question_ids 순서 유지)
    const order = questionIds.length ? questionIds : qids;

    const graded = order.map((qid: string) => {
      const q = qMap.get(String(qid));

      const correctIndex =
        q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      const chosenIndexRaw =
        answersMap?.[qid] ?? answersMap?.[String(qid)] ?? null;

      const chosenIndex =
        chosenIndexRaw === null || chosenIndexRaw === undefined ? null : n(chosenIndexRaw, NaN);

      const isCorrect =
        correctIndex !== null &&
        chosenIndex !== null &&
        Number.isFinite(Number(correctIndex)) &&
        Number.isFinite(Number(chosenIndex)) &&
        Number(correctIndex) === Number(chosenIndex);

      return {
        questionId: qid,
        content: q?.content ?? q?.question ?? q?.title ?? "",
        choices: pickChoices(q),
        correctIndex: correctIndex === null ? null : Number(correctIndex),
        selectedIndex: chosenIndex === null || !Number.isFinite(chosenIndex) ? null : Number(chosenIndex),
        isCorrect,
        points: n(q?.points, 0),
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
        score: attempt.score,
        correct_count: attempt.correct_count,
        status: attempt.status,
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
