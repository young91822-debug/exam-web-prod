import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("attempts")
      .select("emp_id, score, submitted_at");

    if (error) return NextResponse.json({ data: [], error: error.message }, { status: 200 });

    const map = new Map<
      string,
      { emp_id: string; attempts: number; max_score: number; sum_score: number; latest_submitted_at: string | null }
    >();

    for (const r of rows || []) {
      const empId = String((r as any).emp_id ?? "");
      if (!empId) continue;

      const row =
        map.get(empId) || { emp_id: empId, attempts: 0, max_score: 0, sum_score: 0, latest_submitted_at: null };

      const score = Number((r as any).score ?? 0);
      row.attempts += 1;
      row.sum_score += score;
      row.max_score = Math.max(row.max_score, score);

      const t = (r as any).submitted_at ? new Date((r as any).submitted_at).toISOString() : null;
      if (t && (!row.latest_submitted_at || t > row.latest_submitted_at)) row.latest_submitted_at = t;

      map.set(empId, row);
    }

    const out = Array.from(map.values())
      .map((r) => ({
        account_id: r.emp_id, // 프론트 키 맞추기용
        attempts: r.attempts,
        max_score: r.max_score,
        avg_score: r.attempts ? Math.round((r.sum_score / r.attempts) * 10) / 10 : 0,
        latest_submitted_at: r.latest_submitted_at,
      }))
      .sort((a, b) => a.account_id.localeCompare(b.account_id));

    return NextResponse.json({ data: out }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ data: [], error: e?.message || "SERVER_ERROR" }, { status: 200 });
  }
}
