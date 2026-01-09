// app/api/admin/results/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function pickEmpId(row: any) {
  return (
    row?.emp_id ??
    row?.empId ??
    row?.user_id ??
    row?.userId ??
    row?.account_id ??
    row?.accountId ??
    "-"
  );
}
function pickScore(row: any) {
  return row?.score ?? row?.total_score ?? row?.result_score ?? 0;
}
function pickSubmittedAt(row: any) {
  return (
    row?.submitted_at ??
    row?.submittedAt ??
    row?.ended_at ??
    row?.endedAt ??
    row?.created_at ??
    row?.started_at ??
    null
  );
}
function pickStartedAt(row: any) {
  return row?.started_at ?? row?.startedAt ?? row?.created_at ?? null;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const page = Math.max(1, n(u.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, n(u.searchParams.get("pageSize"), 50)));
    const offset = (page - 1) * pageSize;

    // ✅ 신형 attempts(UUID)
    const newRes = await supabaseAdmin
      .from("attempts")
      .select("id, user_id, started_at, submitted_at, score, total_points, questions, wrongs")
      .order("started_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    // ✅ 구형 exam_attempts(숫자)
    const oldRes = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, started_at, submitted_at, score, total_points, question_ids, answers")
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const items: any[] = [];

    if (!newRes.error) {
      for (const r of newRes.data || []) {
        items.push({
          id: String(r.id),               // ✅ UUID
          idType: "uuid",
          empId: pickEmpId(r),
          score: pickScore(r),
          totalPoints: r.total_points ?? 0,
          startedAt: pickStartedAt(r),
          submittedAt: pickSubmittedAt(r),
          totalQuestions: Array.isArray((r as any).questions) ? (r as any).questions.length : 0,
          wrongCount: Array.isArray((r as any).wrongs) ? (r as any).wrongs.length : 0,
        });
      }
    }

    if (!oldRes.error) {
      for (const r of oldRes.data || []) {
        const qids = Array.isArray((r as any).question_ids) ? (r as any).question_ids : [];
        items.push({
          id: String(r.id),               // ✅ 숫자도 문자열로 통일
          idType: "num",
          empId: pickEmpId(r),
          score: pickScore(r),
          totalPoints: r.total_points ?? 0,
          startedAt: pickStartedAt(r),
          submittedAt: pickSubmittedAt(r),
          totalQuestions: qids.length,
          // 구형은 wrongCount가 없을 수 있으니 0으로
          wrongCount: 0,
        });
      }
    }

    // 최신순 정렬(제출시각 우선, 없으면 시작시각)
    items.sort((a, b) => {
      const ta = new Date(a.submittedAt ?? a.startedAt ?? 0).getTime();
      const tb = new Date(b.submittedAt ?? b.startedAt ?? 0).getTime();
      return tb - ta;
    });

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      items,
      debug: {
        newErr: newRes.error ?? null,
        oldErr: oldRes.error ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
