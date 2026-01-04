// app/api/exam/submit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAdmin(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  return cookie.includes("admin=1");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const attemptId = Number(body?.attemptId);
    const answers = body?.answers as Record<string, number> | undefined;

    if (!attemptId || !answers) {
      return NextResponse.json({ ok: false, error: "INVALID_PAYLOAD" }, { status: 400 });
    }

    // attempt 조회
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, question_ids")
      .eq("id", attemptId)
      .single();

    if (aErr || !attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND", detail: aErr?.message },
        { status: 404 }
      );
    }

    const qids: number[] = attempt.question_ids || [];
    if (!Array.isArray(qids) || qids.length === 0) {
      return NextResponse.json({ ok: false, error: "NO_QUESTION_IDS" }, { status: 400 });
    }

    // 문제 정답/배점 조회
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, content, choices, answer_index, points")
      .in("id", qids);

    if (qErr || !qs) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr?.message },
        { status: 500 }
      );
    }

    // 점수 계산 + 오답 목록
    let score = 0;
    const wrongQuestionIds: number[] = [];

    for (const q of qs as any[]) {
      const picked = (answers as any)[String(q.id)];
      if (typeof picked === "number" && picked === q.answer_index) score += q.points ?? 0;
      else wrongQuestionIds.push(q.id);
    }

    // attempt 업데이트 (응시자 기록은 항상 저장)
    const { error: uErr } = await supabaseAdmin
      .from("exam_attempts")
      .update({
        answers,
        score,
        submitted_at: new Date().toISOString(),
        status: "submitted",
      })
      .eq("id", attemptId);

    if (uErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: uErr.message },
        { status: 500 }
      );
    }

    // ✅ 오답 "누적"은 관리자만 (admin=1)일 때만 수행
    // (지금은 "누적시키지마"가 요구라서, 기본은 아무것도 안 함)
    if (isAdmin(req)) {
      // 여기에서만 누적 테이블 insert/update 하도록 만들면 됨.
      // 지금은 요구대로 "일반 응시자 제출 시 누적 0"이 핵심이라
      // 누적 로직이 있던 프로젝트라면 그 코드를 이 블록 안으로 옮겨줘.
    }

    return NextResponse.json({ ok: true, attemptId, score, wrongQuestionIds });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_CRASH", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
