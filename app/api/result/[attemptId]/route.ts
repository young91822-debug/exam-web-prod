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

function pickAttemptUuid(attempt: any): string | null {
  // ✅ exam_attempts 안에 있을 법한 UUID 후보들
  const candidates = [
    attempt?.attempt_id,      // 흔함
    attempt?.attempt_uuid,
    attempt?.attempt_uid,
    attempt?.uuid,
    attempt?.id_uuid,
    attempt?.public_id,
    attempt?.session_id,
    attempt?.exam_attempt_id,
  ];

  for (const v of candidates) {
    const str = s(v);
    // uuid v4 형태 대충 체크
    if (/^[0-9a-fA-F-]{36}$/.test(str)) return str;
  }
  return null;
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

    // ✅ 2) attempt_answers는 attempt_id(UUID)를 요구함 → attempt에서 UUID 찾아서 조회
    const attemptUuid = pickAttemptUuid(attempt);
    if (!attemptUuid) {
      return NextResponse.json(
        {
          ok: true,
          attempt,
          graded: [],
          totalQuestions: 0,
          hint: {
            message: "attempt_answers.attempt_id is uuid, but exam_attempts does not expose a uuid column",
            need: "Add uuid column (e.g., attempt_uuid) to exam_attempts OR store numeric attempt_id in attempt_answers",
          },
        },
        { status: 200 }
      );
    }

    // 2) answers (UUID로 조회)
    const { data: answers, error: e2 } = await supabaseAdmin
      .from("attempt_answers")
      .select("*")
      .eq("attempt_id", attemptUuid);

    if (e2) {
      return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED", detail: e2, attemptUuid }, { status: 500 });
    }

    // 3) questions
    const qids = Array.from(
      new Set((answers ?? []).map((a: any) => a?.question_id).filter(Boolean))
    );

    const { data: questions, error: e3 } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids.length ? qids : [-1]);

    if (e3) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: e3 }, { status: 500 });
    }

    const qMap = new Map<any, any>();
    for (const q of questions ?? []) qMap.set(q.id, q);

    const graded = (answers ?? []).map((a: any) => {
      const q = qMap.get(a.question_id);

      const correctIndex =
        q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      const chosenIndex =
        a?.chosen_index ?? a?.chosenIndex ?? a?.answer_index ?? a?.answerIndex ?? null;

      const isCorrect =
        a?.is_correct !== undefined && a?.is_correct !== null
          ? Boolean(a.is_correct)
          : correctIndex !== null &&
            chosenIndex !== null &&
            Number(correctIndex) === Number(chosenIndex);

      return {
        questionId: a.question_id,
        content: q?.content ?? q?.question ?? q?.title ?? "",
        choices: q?.choices ?? q?.options ?? [],
        correctIndex,
        selectedIndex: chosenIndex,
        isCorrect,
        points: n(q?.points, 0),
      };
    });

    return NextResponse.json({
      ok: true,
      attempt,
      attemptUuid,
      graded,
      totalQuestions: graded.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
