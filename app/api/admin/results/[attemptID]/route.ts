import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function requireAdmin() {
  const cookieStore = cookies();
  const admin = cookieStore.get("admin")?.value;
  return admin === "1";
}

export async function GET(req: Request, { params }: { params: { attemptId: string } }) {
  if (!requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attemptId = params.attemptId;

  // attempts
  const { data: attempt, error: aerr } = await supabaseAdmin
    .from("attempts")
    .select("id,user_id,score,total_points,started_at,submitted_at,duration_sec")
    .eq("id", attemptId)
    .single();

  if (aerr) return NextResponse.json({ error: aerr.message }, { status: 500 });

  // attempt_answers: attempt_id, question_id, selected_index, is_correct
  const { data: answers, error: ansErr } = await supabaseAdmin
    .from("attempt_answers")
    .select("question_id,selected_index,is_correct")
    .eq("attempt_id", attemptId)
    .order("question_id", { ascending: true });

  if (ansErr) return NextResponse.json({ error: ansErr.message }, { status: 500 });

  // questions: id, content, choice1..4, answer_index
  const qids = (answers || []).map((a) => a.question_id);
  let questionsMap: Record<string, any> = {};
  if (qids.length > 0) {
    const { data: qs, error: qerr } = await supabaseAdmin
      .from("questions")
      .select("id,content,choice1,choice2,choice3,choice4,answer_index")
      .in("id", qids);

    if (qerr) return NextResponse.json({ error: qerr.message }, { status: 500 });
    for (const q of qs || []) questionsMap[String(q.id)] = q;
  }

  const merged = (answers || []).map((a) => {
    const q = questionsMap[String(a.question_id)];
    return {
      question_id: a.question_id,
      is_correct: a.is_correct,
      selected_index: a.selected_index,
      question: q
        ? {
            id: q.id,
            content: q.content,
            choices: [q.choice1, q.choice2, q.choice3, q.choice4],
            answer_index: q.answer_index,
          }
        : null,
    };
  });

  const wrong = merged.filter((x) => x.is_correct === false);

  return NextResponse.json({
    attempt,
    answers: merged,
    wrong,
  });
}
