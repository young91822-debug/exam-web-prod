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
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

// ✅ Next.js 16(Turbopack)에서는 context.params가 Promise일 수 있어서 이렇게 타입을 잡는 게 안전함
type Ctx = { params: Promise<{ attemptId: string }> | { attemptId: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const p = await Promise.resolve(ctx?.params as any);
    const attemptId = String(p?.attemptId ?? "").trim();

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ emp_id / submitted_at / question CSV 다운로드
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

    // 1) 오답 question_id 목록 (후보 테이블 2개 시도)
    let wrongRows: any[] | null = null;

    {
      const { data, error } = await supabaseAdmin
        .from("exam_wrong_questions")
        .select("question_id")
        .eq("attempt_id", attemptId as any);

      if (!error && data) wrongRows = data as any[];
    }

    if (!wrongRows) {
      const { data, error } = await supabaseAdmin
        .from("wrong_questions")
        .select("question_id")
        .eq("attempt_id", attemptId as any);

      if (!error && data) wrongRows = data as any[];
    }

    const ids = (wrongRows ?? [])
      .map((r) => r.question_id ?? r.questionId ?? null)
      .filter((x) => x !== null)
      .map((x) => Number(x));

    // 2) 문항 content 맵핑 (후보 테이블 2개 시도)
    const questionMap = new Map<number, string>();

    if (ids.length > 0) {
      // questions
      {
        const { data, error } = await supabaseAdmin.from("questions").select("id, content").in("id", ids as any);
        if (!error && data) {
          for (const q of data as any[]) questionMap.set(Number(q.id), String(q.content ?? ""));
        }
      }

      // exam_questions (fallback)
      if (questionMap.size === 0) {
        const { data, error } = await supabaseAdmin.from("exam_questions").select("id, content").in("id", ids as any);
        if (!error && data) {
          for (const q of data as any[]) questionMap.set(Number(q.id), String(q.content ?? ""));
        }
      }
    }

    const rows = ids.map((qid) => ({
      emp_id: attempt.emp_id ?? "",
      submitted_at: attempt.submitted_at ?? "",
      question: questionMap.get(qid) ?? `question_id:${qid}`,
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
