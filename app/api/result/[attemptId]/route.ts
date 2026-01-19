// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

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

export async function GET(_req: NextRequest, context: { params: Promise<{ attemptId: string }> }) {
  try {
    const { attemptId: raw } = await context.params;
    const attemptIdStr = s(raw);

    if (!attemptIdStr) return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    if (!isNumericIdStr(attemptIdStr)) return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });

    const attemptId = Number(attemptIdStr);

    // 1) attempt (uuid 포함)
    const { data: attempt, error: e1 } = await sb
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: e1 }, { status: 500 });
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });

    const attemptUuid = s((attempt as any)?.uuid);
    const qids: string[] = Array.isArray((attempt as any)?.question_ids)
      ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    const uniqQids = Array.from(new Set(qids)).filter(Boolean);

    // 2) answers: attempt_answers(uuid) 우선
    const ansMap = new Map<string, number>();
    let answersSource = "none";

    if (isUUIDStr(attemptUuid)) {
      const { data: aRows, error: aErr } = await sb
        .from("attempt_answers")
        .select("question_id, selected_index")
        .eq("attempt_id", attemptUuid);

      if (aErr) return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED", detail: aErr }, { status: 500 });

      for (const a of aRows ?? []) {
        const qid = s((a as any)?.question_id);
        const sel = (a as any)?.selected_index;
        if (!isUUIDStr(qid)) continue;
        if (sel === null || sel === undefined) continue;
        ansMap.set(qid, Number(sel));
      }
      if (ansMap.size > 0) answersSource = "attempt_answers(uuid)";
    }

    // 3) fallback: attempt.answers(JSON)
    if (ansMap.size === 0 && (attempt as any)?.answers && typeof (attempt as any).answers === "object") {
      const rawA = (attempt as any).answers?.map ?? (attempt as any).answers;
      if (rawA && typeof rawA === "object") {
        for (const [k, v] of Object.entries(rawA)) {
          const qid = s(k);
          const sel = n(v, null);
          if (!isUUIDStr(qid)) continue;
          if (sel === null) continue;
          ansMap.set(qid, Number(sel));
        }
        if (ansMap.size > 0) answersSource = "attempt.answers(JSON)";
      }
    }

    // 4) questions
    const { data: questions, error: eQ } = uniqQids.length
      ? await sb.from("questions").select("*").in("id", uniqQids as any)
      : { data: [], error: null as any };

    if (eQ) return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: eQ }, { status: 500 });

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(s((q as any)?.id), q);

    // 5) graded + 점수
    let score = 0;
    let totalPoints = 0;

    const graded = uniqQids
      .map((qid) => {
        const q = qById.get(s(qid));
        if (!q) return null;

        const pts = n(q?.points, null);
        const point = pts === null ? 1 : (pts ?? 0);
        totalPoints += point;

        const correctIndex = pickCorrectIndex(q);
        const chosen = ansMap.has(qid) ? ansMap.get(qid)! : null;

        const isCorrect =
          correctIndex !== null &&
          chosen !== null &&
          Number.isFinite(Number(correctIndex)) &&
          Number.isFinite(Number(chosen)) &&
          Number(correctIndex) === Number(chosen);

        if (isCorrect) score += point;

        return {
          questionId: q?.id,
          content: q?.content ?? q?.question ?? q?.title ?? "",
          choices: pickChoices(q),
          correctIndex: correctIndex === null ? null : Number(correctIndex),
          selectedIndex: chosen === null ? null : Number(chosen),
          isCorrect,
          points: Number(point),
        };
      })
      .filter(Boolean) as any[];

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        uuid: attemptUuid || null,
        emp_id: (attempt as any).emp_id,
        started_at: (attempt as any).started_at,
        submitted_at: (attempt as any).submitted_at,
        status: (attempt as any).status,
        answers_source: answersSource,
        score,
        total_points: totalPoints,
        total_questions: graded.length,
      },
      graded,
      totalQuestions: graded.length,
      wrongCount: graded.filter((g: any) => g?.isCorrect === false).length,
      totalPoints,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) }, { status: 500 });
  }
}
