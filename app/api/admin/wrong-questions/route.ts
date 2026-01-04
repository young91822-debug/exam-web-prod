import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ATTEMPTS_TABLE = "attempts";
const QUESTIONS_TABLE = "questions";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const empId = searchParams.get("empId");

    if (!empId) {
      return NextResponse.json(
        { ok: false, message: "empId required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 1) 제출된 attempt만 가져오기
    const { data: attempts, error: aErr } = await supabase
      .from(ATTEMPTS_TABLE)
      .select("id, submitted_at, question_ids, answers")
      .eq("emp_id", empId)
      .not("submitted_at", "is", null)
      .order("id", { ascending: false });

    if (aErr) {
      return NextResponse.json(
        { ok: false, message: aErr.message },
        { status: 500 }
      );
    }

    const safeAttempts = (attempts || []).filter((a: any) => a?.answers);

    // 2) question ids 모으기
    const allQids = Array.from(
      new Set(safeAttempts.flatMap((a: any) => a.question_ids || []))
    );

    if (allQids.length === 0) {
      return NextResponse.json({ ok: true, empId, count: 0, wrongQuestions: [] });
    }

    // 3) questions 가져오기 (정답/보기/내용)
    const { data: questions, error: qErr } = await supabase
      .from(QUESTIONS_TABLE)
      .select("id, content, choices, answer_index, points")
      .in("id", allQids);

    if (qErr) {
      return NextResponse.json(
        { ok: false, message: qErr.message },
        { status: 500 }
      );
    }

    const qMap = new Map<number, any>();
    for (const q of questions || []) qMap.set(Number((q as any).id), q);

    // 4) 틀린 문제 누적
    const wrongList: any[] = [];

    for (const a of safeAttempts as any[]) {
      const attemptId = a.id;
      const submittedAt = a.submitted_at;
      const ansObj = a.answers || {}; // ✅ {"111":2,...}

      for (const [qidStr, userChoice] of Object.entries(ansObj)) {
        const qid = Number(qidStr);
        const q = qMap.get(qid);
        if (!q) continue;

        const correct = Number(q.answer_index);
        const chosen = Number(userChoice);

        if (Number.isFinite(chosen) && chosen !== correct) {
          wrongList.push({
            attemptId,
            submittedAt,
            questionId: qid,
            question: q.content,
            choices: q.choices,
            correctIndex: correct,
            userAnswer: chosen,
            points: q.points ?? 0,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      empId,
      count: wrongList.length,
      wrongQuestions: wrongList,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
