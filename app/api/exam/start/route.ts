// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function readCookieFromHeader(cookieHeader: string, key: string) {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get("cookie") || "";
    const empId =
      readCookieFromHeader(cookie, "empId") ||
      readCookieFromHeader(cookie, "emp_id") ||
      readCookieFromHeader(cookie, "userId") ||
      readCookieFromHeader(cookie, "employeeId") ||
      readCookieFromHeader(cookie, "emp");

    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_EMP_ID" }, { status: 401 });
    }

    // 1) 활성 문제 가져오기
    const { data: all, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, content, choices, points")
      .eq("is_active", true);

    if (qErr) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr.message }, { status: 500 });
    }

    const list = (all ?? []).map((q: any) => ({
      id: Number(q.id),
      content: String(q.content ?? ""),
      choices: Array.isArray(q.choices) ? q.choices : [],
      points: typeof q.points === "number" ? q.points : Number(q.points ?? 0),
    }));

    if (list.length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ACTIVE_QUESTIONS" }, { status: 400 });
    }

    // 2) 랜덤 20문제(부족하면 있는 만큼)
    const pickN = Math.min(20, list.length);
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, pickN);

    const question_ids = picked.map((q) => q.id);
    const total_questions = question_ids.length;

    // 3) attempt 생성 (🔥 question_ids 반드시 저장)
    const started_at = new Date().toISOString();

    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .insert([
        {
          emp_id: empId,
          started_at,
          total_questions,
          question_ids, // ✅ 이거 없으면 결과가 0개로 뜸
          status: "started",
        },
      ])
      .select("id")
      .single();

    if (aErr || !attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: aErr?.message ?? "no attempt" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      questions: picked, // 클라에서 바로 렌더
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "START_CRASH", message: e?.message ?? String(e) }, { status: 500 });
  }
}
