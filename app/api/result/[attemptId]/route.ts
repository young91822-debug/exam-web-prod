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

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    // ✅ Next.js 타입이 params를 Promise로 기대하는 경우 대응
    const { attemptId: raw } = await context.params;
    const attemptId = s(raw);

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // 숫자 PK만 쓰는 구조면 안전하게 제한(원하면 제거 가능)
    if (!isNumericId(attemptId)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // 1) attempt 조회 (테이블/컬럼명은 너 프로젝트 기준으로 맞춰져 있어야 함)
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED" }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // 2) 답안(선택) 조회
    // - 시트/스키마에 맞춰 테이블명/컬럼명 확인 필요
    const { data: answers, error: e2 } = await supabaseAdmin
      .from("attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (e2) {
      return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED" }, { status: 500 });
    }

    // 3) 문항 조회 (attempt에 문항 id 목록이 있으면 그걸로 IN 조회하는 구조로 바꿔도 됨)
    // 여기서는 answers에 question_id가 있다고 가정
    const qids = Array.from(new Set((answers ?? []).map((a: any) => a?.question_id).filter(Boolean)));

    const { data: questions, error: e3 } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids.length ? qids : [-1]); // 빈배열 방지

    if (e3) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED" }, { status: 500 });
    }

    const qMap = new Map<any, any>();
    for (const q of questions ?? []) qMap.set(q.id, q);

    // 4) 채점 결과 구성
    const graded = (answers ?? []).map((a: any) => {
      const q = qMap.get(a.question_id);
      const correctIndex =
        q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      const chosenIndex =
        a?.chosen_index ?? a?.chosenIndex ?? a?.answer_index ?? a?.answerIndex ?? null;

      const isCorrect =
        correctIndex !== null &&
        chosenIndex !== null &&
        Number(correctIndex) === Number(chosenIndex);

      return {
        questionId: a.question_id,
        question: q?.content ?? q?.question ?? q?.title ?? "",
        choices: q?.choices ?? q?.options ?? [],
        correctIndex,
        chosenIndex,
        isCorrect,
        points: n(q?.points, 0) ?? 0,
      };
    });

    return NextResponse.json({
      ok: true,
      attempt,
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
