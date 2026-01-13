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
function numOrNull(v: any): number | null {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : null;
}
function first<T>(...vals: T[]) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}

function pickChoices(q: any): string[] {
  const c = first<any>(q?.choices, q?.options, q?.choice_list, q?.choice_texts) ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") return c.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function pickCorrectIndex(q: any): number | null {
  const v = first(
    q?.correct_index,
    q?.answer_index,
    q?.correctIndex,
    q?.answerIndex,
    q?.correct,
    q?.answer
  );
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * answersMap[qid] 형태가 케이스별로 다를 수 있어서 전부 대응
 * - 2
 * - "2"
 * - { selectedIndex: 2 }
 * - { choice_index: 2 }
 * - { answer_index: 2 }
 */
function pickChosenIndex(raw: any): number | null {
  if (raw === null || raw === undefined) return null;

  // 객체면 내부 필드 우선
  if (typeof raw === "object") {
    const v = first(
      (raw as any)?.selected_index,
      (raw as any)?.selectedIndex,
      (raw as any)?.choice_index,
      (raw as any)?.choiceIndex,
      (raw as any)?.answer_index,
      (raw as any)?.answerIndex,
      (raw as any)?.index
    );
    const n = numOrNull(v);
    return n === null ? null : Math.trunc(n);
  }

  // 숫자/문자
  const n = numOrNull(raw);
  return n === null ? null : Math.trunc(n);
}

/** 1~4로 저장된 경우 0~3으로 보정 */
function normalizeIndex(idx: number | null): number | null {
  if (idx === null) return null;
  if (idx >= 1 && idx <= 4) return idx - 1;
  return idx;
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

    // 1) attempt
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

    const questionIds: string[] = Array.isArray(attempt?.question_ids)
      ? attempt.question_ids.map((x: any) => String(x))
      : [];

    const answersMap: Record<string, any> =
      attempt?.answers && typeof attempt.answers === "object" ? attempt.answers : {};

    const qids = questionIds.length ? questionIds : Object.keys(answersMap || {}).map((k) => String(k));

    if (!qids.length) {
      return NextResponse.json({
        ok: true,
        attempt,
        graded: [],
        totalQuestions: 0,
        wrongCount: 0,
      });
    }

    // 2) questions
    const { data: questions, error: e2 } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids);

    if (e2) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: e2 }, { status: 500 });
    }

    const qMap = new Map<string, any>();
    for (const q of questions ?? []) qMap.set(String(q?.id), q);

    // 3) graded (order 유지)
    const order = questionIds.length ? questionIds : qids;

    const graded = order.map((qid: string) => {
      const q = qMap.get(String(qid));

      const correctIndexRaw = pickCorrectIndex(q);
      const chosenIndexRaw = pickChosenIndex(answersMap?.[qid] ?? answersMap?.[String(qid)]);

      const correctIndex = normalizeIndex(correctIndexRaw);
      const selectedIndex = normalizeIndex(chosenIndexRaw);

      const isCorrect =
        correctIndex !== null &&
        selectedIndex !== null &&
        Number(correctIndex) === Number(selectedIndex);

      const pts = numOrNull(q?.points) ?? 0;

      return {
        questionId: qid,
        content: q?.content ?? q?.question ?? q?.title ?? "",
        choices: pickChoices(q),
        correctIndex,
        selectedIndex,
        isCorrect,
        points: pts,
      };
    });

    const correctCount = graded.filter((g: any) => g?.isCorrect === true).length;
    const wrongCount = graded.filter((g: any) => g?.isCorrect === false).length;

    // ✅ score가 DB에 없거나 0인데, graded로 계산 가능하면 재계산해서 내려줌
    const computedScore = graded.reduce((acc: number, g: any) => acc + (g.isCorrect ? (Number(g.points) || 0) : 0), 0);
    const dbScore = numOrNull(attempt?.score);
    const scoreOut = dbScore !== null && dbScore > 0 ? dbScore : computedScore;

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        emp_id: attempt.emp_id,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        total_questions: attempt.total_questions ?? graded.length,
        total_points: attempt.total_points ?? null,
        score: scoreOut,
        correct_count: attempt.correct_count ?? correctCount,
        status: attempt.status ?? null,
      },
      graded,
      totalQuestions: graded.length,
      wrongCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
