// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function isNumericIdStr(x: any) {
  return /^\d+$/.test(s(x));
}
function isUUIDStr(v: any) {
  const t = s(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}
function isValidQid(v: any) {
  return isNumericIdStr(v) || isUUIDStr(v);
}
function normQid(v: any) {
  const t = s(v);
  if (isNumericIdStr(t)) return Number(t);
  return t;
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choice_texts ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") return c.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function pickAttemptQuestionIds(attempt: any): string[] {
  const cands = [
    attempt?.question_ids,
    attempt?.questionIds,
    attempt?.questions,
    attempt?.question_list,
    attempt?.questionList,
    attempt?.qids,
  ];

  for (const v of cands) {
    if (!v) continue;

    if (Array.isArray(v)) {
      const out = v.map((x: any) => s(x)).filter((x) => isValidQid(x));
      if (out.length) return out;
    }

    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;

      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
          const out = parsed.map((x: any) => s(x)).filter((x) => isValidQid(x));
          if (out.length) return out;
        }
      } catch {}

      if (t.includes(",")) {
        const out = t.split(",").map((x) => s(x)).filter((x) => isValidQid(x));
        if (out.length) return out;
      }
    }
  }

  return [];
}

function pickAttemptAnswersMap(attempt: any): Map<string, number> {
  const m = new Map<string, number>();
  const raw = attempt?.answers;
  if (!raw) return m;

  const feed = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const key = s(k);
      if (!isValidQid(key)) continue;
      const val = n(v, null);
      if (val !== null) m.set(key, val);
    }
  };

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      feed(parsed);
    } catch {
      return m;
    }
    return m;
  }

  feed(raw);
  return m;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ attemptId: string }> }) {
  try {
    const { attemptId: raw } = await context.params;
    const attemptIdStr = s(raw);

    if (!attemptIdStr) return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    if (!isNumericIdStr(attemptIdStr)) return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });

    const attemptId = Number(attemptIdStr);

    // 1) attempt
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String((e1 as any)?.message ?? e1) },
        { status: 500 }
      );
    }
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });

    // 2) answers
    const ansMap = new Map<string, number>();

    const { data: answers, error: eAns } = await supabaseAdmin
      .from("exam_answers")
      .select("question_id, selected_index")
      .eq("attempt_id", attemptId);

    if (eAns) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_QUERY_FAILED", detail: String((eAns as any)?.message ?? eAns) },
        { status: 500 }
      );
    }

    for (const a of answers ?? []) {
      const qid = s((a as any)?.question_id);
      const sel = (a as any)?.selected_index;
      if (!isValidQid(qid)) continue;
      if (sel === null || sel === undefined) continue;
      ansMap.set(qid, Number(sel));
    }

    let answersSource = "exam_answers(attempt_id)";
    if (ansMap.size === 0) {
      const fallback = pickAttemptAnswersMap(attempt);
      if (fallback.size > 0) {
        for (const [k, v] of fallback.entries()) ansMap.set(k, v);
        answersSource = "attempt.answers(JSON)";
      }
    }

    // 3) qids
    const attemptQids = pickAttemptQuestionIds(attempt);
    const qids = attemptQids.length > 0 ? attemptQids : Array.from(ansMap.keys());
    const uniqQidsStr = Array.from(new Set(qids.map((x) => s(x)).filter((x) => isValidQid(x))));

    if (!uniqQidsStr.length) {
      return NextResponse.json({
        ok: true,
        attempt: {
          id: attempt.id,
          emp_id: attempt.emp_id,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
          total_questions: attempt.total_questions,
          status: attempt.status,
          answers_source: answersSource,
          score: 0,
          total_points: 0,
          correct_count: 0,
        },
        graded: [],
        totalQuestions: 0,
        wrongCount: 0,
        totalPoints: 0,
      });
    }

    const uniqQidsQuery = uniqQidsStr.map(normQid);

    // 4) questions
    const { data: questions, error: eQ } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", uniqQidsQuery as any);

    if (eQ) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((eQ as any)?.message ?? eQ) },
        { status: 500 }
      );
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(s((q as any)?.id), q);

    // 5) graded + 총점 계산
    let score = 0;
    let correctCount = 0;
    let totalPoints = 0;

    const graded = uniqQidsStr
      .map((qidStr) => {
        const q = qById.get(s(qidStr));
        if (!q) return null;

        const pts = n(q?.points, 0) ?? 0;
        totalPoints += pts;

        const correctIndex = pickCorrectIndex(q);
        const chosen = ansMap.has(qidStr) ? ansMap.get(qidStr)! : null;

        const isCorrect =
          correctIndex !== null &&
          chosen !== null &&
          Number.isFinite(Number(correctIndex)) &&
          Number.isFinite(Number(chosen)) &&
          Number(correctIndex) === Number(chosen);

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
      })
      .filter(Boolean) as any[];

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        emp_id: attempt.emp_id,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        status: attempt.status,
        answers_source: answersSource,
        // ✅ 화면용으로 항상 내려줌
        score,
        total_points: totalPoints,
        correct_count: correctCount,
        total_questions: graded.length,
      },
      graded,
      totalQuestions: graded.length,
      wrongCount: graded.filter((g: any) => g?.isCorrect === false).length,
      // ✅ 프론트가 이거 써도 됨
      totalPoints,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
