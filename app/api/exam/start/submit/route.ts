import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = {
  attemptId: number;
  answers: Record<number, number>; // { [questionId]: choiceIndex }
};

function getEmpIdFromCookie(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)empId=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const empId = getEmpIdFromCookie(req);
    if (!empId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as Body;
    const attemptId = Number(body.attemptId);
    const answers = body.answers || {};

    if (!attemptId || !Number.isFinite(attemptId)) {
      return NextResponse.json({ error: "attemptId is required" }, { status: 400 });
    }

    // 1) attempt 소유 확인 (내 attempt인지)
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, submitted_at")
      .eq("id", attemptId)
      .single();

    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    if (!attempt || attempt.emp_id !== empId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 이미 제출했으면 그대로 반환(중복 제출 방지)
    if (attempt.submitted_at) {
      const { data: already } = await supabaseAdmin
        .from("exam_attempts")
        .select("id, emp_id, score, started_at, submitted_at")
        .eq("id", attemptId)
        .single();

      return NextResponse.json({ ok: true, attempt: already, alreadySubmitted: true });
    }

    // 2) 문제 정답/배점 로드 (답안 채점)
    const qids = Object.keys(answers).map((k) => Number(k)).filter(Boolean);
    if (qids.length === 0) {
      return NextResponse.json({ error: "No answers" }, { status: 400 });
    }

    const { data: qs, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, answer_index, points, content, choices")
      .in("id", qids);

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    const byId = new Map<number, any>();
    (qs || []).forEach((q: any) => byId.set(q.id, q));

    let score = 0;
    const wrongQuestions: any[] = [];

    for (const qid of qids) {
      const q = byId.get(qid);
      if (!q) continue;

      const my = Number(answers[qid]);
      const correct = Number(q.answer_index);

      if (my === correct) {
        score += Number(q.points || 0);
      } else {
        wrongQuestions.push({
          questionId: qid,
          content: q.content,
          choices: q.choices,
          correctIndex: correct,
          myIndex: my,
          points: Number(q.points || 0),
        });
      }
    }

    // 3) attempt 업데이트 (score + submitted_at 저장!)
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("exam_attempts")
      .update({
        score,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", attemptId)
      .select("id, emp_id, score, started_at, submitted_at")
      .single();

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, attempt: updated, score, wrongQuestions });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "SUBMIT_ERROR" }, { status: 500 });
  }
}
