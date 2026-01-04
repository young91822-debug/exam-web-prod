// app/api/admin/results/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// ✅ API 라우트에서는 JSX/React 코드 절대 금지 (return <div ...> 같은 거 X)
// ✅ 여기서는 JSON(또는 CSV)만 반환해야 빌드가 통과함

export const dynamic = "force-dynamic";

type Row = {
  attempt_id?: number | string;
  emp_id?: string | number;
  score?: number | null;
  submitted_at?: string | null;
  started_at?: string | null;
  total_questions?: number | null;
};

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function GET(req: NextRequest) {
  try {
    // 예: /api/admin/results/accounts?limit=200
    // 예: /api/admin/results/accounts?emp_id=201978
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "200") || 200, 1000);
    const empId = searchParams.get("emp_id")?.trim();

    // 1) 가장 안전한 기본: exam_attempts에서 emp_id별 응시 기록을 가져옴
    //    (테이블/컬럼명이 다르면 에러 메시지로 바로 잡을 수 있게 detail을 내려줌)
    let q = supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, submitted_at, started_at, total_questions")
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (empId) q = q.eq("emp_id", empId as any);

    const { data, error } = await q;

    if (error) {
      // ✅ 스키마가 다르거나 컬럼명이 다르면 여기로 떨어짐
      return jsonError(500, "QUERY_FAILED", {
        message: error.message,
        hint:
          "exam_attempts 테이블/컬럼(id, emp_id, score, submitted_at 등)이 실제 DB와 다르면 이름을 맞춰야 함",
      });
    }

    const rows: Row[] =
      (data ?? []).map((r: any) => ({
        attempt_id: r.id,
        emp_id: r.emp_id,
        score: r.score ?? null,
        submitted_at: r.submitted_at ?? null,
        started_at: r.started_at ?? null,
        total_questions: r.total_questions ?? null,
      })) ?? [];

    // 2) 프론트에서 바로 쓰기 좋게 최소 형태로 반환
    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows,
    });
  } catch (e: any) {
    return jsonError(500, "UNEXPECTED_ERROR", String(e?.message ?? e));
  }
}
