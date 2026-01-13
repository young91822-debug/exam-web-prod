import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? 1) || 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? 50) || 50;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await sb
      .from("exam_attempts")
      .select("*")
      .order("started_at", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    const items = (data ?? []).map((r: any) => ({
      id: String(r.id),
      idType: typeof r.id === "string" && r.id.includes("-") ? "uuid" : "num",
      empId: r.emp_id,
      score: Number(r.score ?? 0),
      totalPoints: Number(r.total_points ?? 0),
      startedAt: r.started_at,
      submittedAt: r.submitted_at,
      totalQuestions: Number(r.total_questions ?? 0),
      wrongCount: Number(r.wrong_count ?? 0),
    }));

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
