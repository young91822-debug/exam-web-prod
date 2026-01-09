// app/api/result/[attemptId]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function s(v: any) {
  return String(v ?? "").trim();
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

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choiceList ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? ""));
    } catch {}
    if (c.includes("|")) return c.split("|").map((x) => x.trim());
    if (c.includes(",")) return c.split(",").map((x) => x.trim());
    return [c];
  }
  return [];
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId: raw } = await context.params;
  const attemptId = n(raw, null);

  if (!attemptId) {
    return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
  }

  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
  }

  const { data: answers } = await supabaseAdmin
    .from("exam_attempt_answers")
    .select("question_id, selected_index")
    .eq("attempt_id", attemptId);

  const selectedByQid = new Map<string, number>();
  for (const r of answers ?? []) {
    const qid = s((r as any)?.question_id);
    const idx = n((r as any)?.selected_index, null);
    if (qid && idx !== null) selectedByQid.set(qid, idx);
  }

  const questionIds = Array.from(selectedByQid.keys());

  const { data: questions } = await supabaseAdmin
    .from("questions")
    .select("*")
    .in("id", questionIds);

  const qById = new Map<string, any>();
  for (const q of questions ?? []) qById.set(String(q.id), q);

  const graded = questionIds.map((qid) => {
    const q = qById.get(qid) ?? {};
    const selectedIndex = selectedByQid.get(qid) ?? null;
    const correctIndex = pickCorrectIndex(q);

    const status = selectedIndex == null ? "unsubmitted" : "submitted";
    const isCorrect = status === "submitted" && correctIndex != null
      ? selectedIndex === correctIndex
      : false;

    return {
      questionId: qid,
      content: q?.content ?? "",
      choices: pickChoices(q),
      selectedIndex,
      correctIndex,
      status,
      isCorrect,
    };
  });

  return NextResponse.json({
    ok: true,
    attempt,
    graded,
    totalQuestions: graded.length,
  });
}
