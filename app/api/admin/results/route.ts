import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function getAdmin() {
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// GET /api/admin/results?format=csv
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "json").toLowerCase();

    const supabaseAdmin = getAdmin();

    // ✅ exam_attempts 테이블에서 가져옴
    // 컬럼: id, emp_id, score, submitted_at (너가 쓰던 구성 기준)
    const { data, error } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, emp_id, score, submitted_at")
      .order("submitted_at", { ascending: false });

    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data || []).map((r: any) => ({
      attempt_id: Number(r.id),
      emp_id: String(r.emp_id ?? ""),
      score: Number(r.score ?? 0),
      submitted_at: r.submitted_at ?? null,
    }));

    // ✅ CSV 다운로드
    if (format === "csv") {
      const header = ["응시자ID", "점수", "응시일시", "attemptId"];
      const lines = [
        header.join(","),
        ...rows.map((r) =>
          [
            csvEscape(r.emp_id),
            csvEscape(r.score),
            csvEscape(r.submitted_at),
            csvEscape(r.attempt_id),
          ].join(",")
        ),
      ];

      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="results.csv"`,
        },
      });
    }

    return json({ ok: true, data: rows });
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message || "UNKNOWN_ERROR", detail: String(e) },
      500
    );
  }
}
