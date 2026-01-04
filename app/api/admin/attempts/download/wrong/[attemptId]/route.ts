// app/api/admin/attempts/download/wrong/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, any>[], headers: string[]) {
  const head = headers.join(",");
  const body = rows
    .map((r) => headers.map((h) => csvEscape(r[h])).join(","))
    .join("\n");
  return head + "\n" + body + "\n";
}

export async function GET(req: NextRequest, ctx: { params: { attemptId: string } }) {
  try {
    const attemptId = ctx?.params?.attemptId;
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ 너가 원한 다운로드 컬럼
    // emp_id / submitted_at / question
    // (테이블/컬럼명이 다를 수 있어서 가장 흔한 구조로 조회하고,
    //  실패하면 에러를 detail로 내려서 바로 다음 수정이 가능하게 함)

    // 1) attempt에서 emp_id + submitted_at 가져오기
    const { data: attempt, error: attemptErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, submitted_at")
      .eq("id", attemptId as any)
      .maybeSingle();

    if (attemptErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_QUERY_FAILED", detail: attemptErr.message },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", attemptId }, { status: 404 });
    }

    // 2) 오답 question_id 목록 가져오기 (가장 흔한 테이블명 후보)
    // - exam_wrong_questions (attempt_id, question_id)
    // - wrong_questions (attempt_id, question_id)
    // 둘 다 시도
    let wrongRows:
      | { question_id?: number; questionId?: number; id?: number; question?: string }[]
      | null = null;

    {
      const { data, error } = await supabaseAdmin
        .from("exam_wrong_questions")
        .select("question_id")
        .eq("attempt_id", attemptId as any);

      if (!error && data) wrongRows = data as any;
    }

    if (!wrongRows) {
      const { data, error } = await supabaseAdmin
        .from("wrong_questions")
        .select("question_id")
        .eq("attempt_id", attemptId as any);

      if (!error && data) wrongRows = data as any;
    }

    // 오답 테이블이 아예 없거나 비어 있어도 CSV는 내려줌
    const ids = (wrongRows ?? [])
      .map((r: any) => r.question_id ?? r.questionId ?? null)
      .filter((x: any) => x !== null);

    // 3) question 내용 가져오기 (가장 흔한 테이블명 candidates)
    // - questions (id, content)
    // - exam_questions (id, content)
    let questionMap = new Map<number, string>();

    if (ids.length > 0) {
      // 3-1) questions 먼저
      {
        const { data, error } = await supabaseAdmin
          .from("questions")
          .select("id, content")
          .in("id", ids as any);

        if (!error && data) {
          for (const q of data as any[]) questionMap.set(Number(q.id), String(q.content ?? ""));
        }
      }

      // 3-2) 부족하면 exam_questions도
      if (questionMap.size === 0) {
        const { data, error } = await supabaseAdmin
          .from("exam_questions")
          .select("id, content")
          .in("id", ids as any);

        if (!error && data) {
          for (const q of data as any[]) questionMap.set(Number(q.id), String(q.content ?? ""));
        }
      }
    }

    const rows = ids.map((qid) => ({
      emp_id: attempt.emp_id ?? "",
      submitted_at: attempt.submitted_at ?? "",
      question: questionMap.get(Number(qid)) ?? `question_id:${qid}`,
    }));

    const csv = toCsv(rows, ["emp_id", "submitted_at", "question"]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wrong_${attemptId}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
