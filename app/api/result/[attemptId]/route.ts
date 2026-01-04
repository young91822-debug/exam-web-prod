// app/api/result/[attemptId]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request, ctx: any) {
  try {
    const p = await Promise.resolve(ctx?.params);
    const attemptId = Number(p?.attemptId);

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID", raw: p }, { status: 400 });
    }

    // 1) attempt 조회
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, question_ids, total_questions, answers, score, submitted_at, status")
      .eq("id", attemptId)
      .single();

    if (aErr || !attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND", detail: aErr?.message ?? "no attempt" },
        { status: 404 }
      );
    }

    const qids: number[] = Array.isArray(attempt.question_ids) ? attempt.question_ids.map((x: any) => Number(x)) : [];
    const totalQuestions = qids.length;

    // 🔥 여기서 0이면: start가 question_ids를 저장 못한 거야.
    if (totalQuestions === 0) {
      return NextResponse.json({
        ok: true,
        attemptId,
        score: Number(attempt.score ?? 0),
        totalQuestions: 0,
        totalPoints: 100,
        wrongCount: 0,
        wrongQuestions: [],
        debug: {
          message: "question_ids is empty on this attempt. /api/exam/start is not saving question_ids.",
          attempt: {
            id: attempt.id,
            emp_id: attempt.emp_id,
            total_questions: attempt.total_questions,
            status: attempt.status,
            submitted_at: attempt.submitted_at,
            has_answers: !!attempt.answers,
          },
        },
      });
    }

    // 2) 문제 조회
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, content, choices, points, answer_index")
      .in("id", qids);

    if (qErr || !qs) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr?.message }, { status: 500 });
    }

    // 3) 점수/오답 계산(answers 없으면 score만 보여주고 오답은 비움)
    const answers: Record<string, number> | null = attempt.answers ?? null;

    // 총점(원래 배점 합) -> 화면은 100 고정이라 score만 보여주되,
    // 필요하면 여기서 totalRawPoints로도 쓸 수 있음
    let score = Number(attempt.score ?? 0);

    const wrongQuestions: any[] = [];
    if (answers) {
      // score가 DB에 없거나 0인 경우를 대비해서 재계산도 가능
      let computed = 0;

      for (const q of qs as any[]) {
        const picked = answers[String(q.id)];
        const correct = Number(q.answer_index);
        const pts = Number(q.points ?? 0);

        if (typeof picked === "number" && picked === correct) {
          computed += pts;
        } else {
          wrongQuestions.push({
            id: Number(q.id),
            content: String(q.content ?? ""),
            choices: Array.isArray(q.choices) ? q.choices : [],
            points: pts,
            answer_index: correct,
            picked_index: typeof picked === "number" ? picked : null,
          });
        }
      }

      // DB score가 비었거나(0)인데 computed가 있으면 computed를 사용
      if (!attempt.score && computed > 0) score = computed;
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      score,
      totalQuestions,
      totalPoints: 100, // ✅ 화면은 100점 만점 고정
      wrongCount: wrongQuestions.length,
      wrongQuestions,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "RESULT_CRASH", message: e?.message ?? String(e) }, { status: 500 });
  }
}
