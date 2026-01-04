import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ATTEMPTS_TABLE = "attempts";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * GET /api/admin/attempts
 *  - empId 없으면: 계정별 요약 리스트 반환
 *  - empId 있으면: 해당 계정의 응시내역 리스트 반환
 *
 * 반환 형식:
 *  - { ok:true, mode:"summary", accounts:[{empId, attempts, bestScore, avgScore, lastSubmittedAt}] }
 *  - { ok:true, mode:"detail", empId, attempts:[{id, submitted_at, score, total_points}] }
 */
export async function GET(req: Request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);
    const empId = searchParams.get("empId");

    // ✅ 1) empId가 있으면: 해당 계정 응시내역
    if (empId) {
      const { data, error } = await supabase
        .from(ATTEMPTS_TABLE)
        .select("id, emp_id, submitted_at, score, total_points")
        .eq("emp_id", empId)
        .not("submitted_at", "is", null)
        .order("id", { ascending: false });

      if (error) {
        return NextResponse.json(
          { ok: false, message: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "detail",
        empId,
        attempts:
          (data || []).map((r: any) => ({
            id: r.id,
            submitted_at: r.submitted_at,
            score: r.score ?? 0,
            total_points: r.total_points ?? null,
          })) ?? [],
      });
    }

    // ✅ 2) empId 없으면: 계정별 요약
    const { data, error } = await supabase
      .from(ATTEMPTS_TABLE)
      .select("emp_id, submitted_at, score")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 500 }
      );
    }

    const map = new Map<
      string,
      { empId: string; attempts: number; bestScore: number; sumScore: number; lastSubmittedAt: string }
    >();

    for (const row of data || []) {
      const id = String((row as any).emp_id || "").trim();
      if (!id) continue;

      const score = Number((row as any).score ?? 0);
      const submittedAt = String((row as any).submitted_at ?? "");

      const cur = map.get(id);
      if (!cur) {
        map.set(id, {
          empId: id,
          attempts: 1,
          bestScore: score,
          sumScore: score,
          lastSubmittedAt: submittedAt,
        });
      } else {
        cur.attempts += 1;
        cur.bestScore = Math.max(cur.bestScore, score);
        cur.sumScore += score;
        // data가 submitted_at desc로 정렬되어 있어서 첫 번째가 최신이지만,
        // 안전하게 최신 비교도 해줌
        if (!cur.lastSubmittedAt || submittedAt > cur.lastSubmittedAt) {
          cur.lastSubmittedAt = submittedAt;
        }
      }
    }

    const accounts = Array.from(map.values())
      .map((a) => ({
        empId: a.empId,
        attempts: a.attempts,
        bestScore: a.bestScore,
        avgScore: a.attempts ? Math.round((a.sumScore / a.attempts) * 10) / 10 : 0,
        lastSubmittedAt: a.lastSubmittedAt || null,
      }))
      // 최신 응시가 있는 계정이 위로
      .sort((x, y) => String(y.lastSubmittedAt || "").localeCompare(String(x.lastSubmittedAt || "")));

    return NextResponse.json({ ok: true, mode: "summary", accounts });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
