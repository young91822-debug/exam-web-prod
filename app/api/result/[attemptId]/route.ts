// app/api/result/[attemptId]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function n(v: any, d: number | null = null) {
  const x = Number(v);
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

export async function GET(_req: Request, { params }: { params: { attemptId: string } }) {
  try {
    const attemptId = n(params?.attemptId, null);
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // attempt
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // answers (내 선택)
    const { data: ansRows, error: ansErr } = await supabaseAdmin
      .from("exam_attempt_answers")
      .select("question_id, selected_index")
      .eq("attempt_id", attemptId);

    if (ansErr) {
      return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED", detail: ansErr }, { status: 500 });
    }

    const selectedByQid = new Map<string, number>();
    for (const r of ansRows ?? []) {
      const qid = s((r as any)?.question_id);
      const idx = n((r as any)?.selected_index, null);
      if (qid && idx !== null) selectedByQid.set(qid, idx);
    }

    // questionIds: attempt.answers.questionIds 우선, 없으면 답안 qid
    let questionIds: string[] = [];
    const a = attempt?.answers;

    if (a && typeof a === "object" && Array.isArray(a?.questionIds)) {
      questionIds = a.questionIds.map((x: any) => s(x)).filter(Boolean);
    } else {
      questionIds = Array.from(selectedByQid.keys());
    }

    // questions
    const { data: questions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", questionIds);

    if (qErr) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    const graded = questionIds.map((qid) => {
      const q = qById.get(String(qid)) ?? {};
      const selectedIndex = selectedByQid.has(String(qid)) ? selectedByQid.get(String(qid))! : null;
      const correctIndex = pickCorrectIndex(q);

      const status = selectedIndex == null ? "unsubmitted" : "submitted";
      const isCorrect = status === "submitted" && correctIndex != null ? selectedIndex === correctIndex : false;

      return {
        questionId: q?.id ?? qid,
        content: q?.content ?? "",
        choices: pickChoices(q),
        selectedIndex,
        correctIndex,
        status,
        isCorrect,
      };
    });

    return NextResponse.json({ ok: true, attempt, graded, totalQuestions: graded.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULT_API_UNHANDLED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
