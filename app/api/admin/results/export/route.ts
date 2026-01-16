// app/api/admin/results/export/route.ts
import { NextRequest } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}

function requireAdmin(req: NextRequest) {
  const empId = s(req.cookies.get("empId")?.value);
  const role = s(req.cookies.get("role")?.value);
  const team = s(req.cookies.get("team")?.value) || null;

  if (!empId || role !== "admin") {
    return { ok: false as const };
  }
  return { ok: true as const, team };
}

function csvEscape(x: any) {
  const t = String(x ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const url = new URL(req.url);
    const page = n(url.searchParams.get("page"), 1);
    const pageSize = n(url.searchParams.get("pageSize"), 500); // CSV는 넉넉히
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = sb
      .from("exam_attempts")
      .select("id, emp_id, team, status, score, total_questions, started_at, submitted_at", { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);

    // ✅ 팀쿠키 있으면 그 팀만 다운로드
    if (auth.team) q = q.eq("team", auth.team);

    const { data, error } = await q;
    if (error) throw error;

    const header = ["id", "emp_id", "team", "status", "score", "total_questions", "started_at", "submitted_at"];
    const lines = [header.join(",")];

    for (const r of data ?? []) {
      const row = [
        r.id,
        r.emp_id,
        r.team,
        r.status,
        r.score,
        r.total_questions,
        r.started_at,
        r.submitted_at,
      ].map(csvEscape);
      lines.push(row.join(","));
    }

    // ✅ 엑셀 한글 깨짐 방지: UTF-8 BOM
    const csv = "\ufeff" + lines.join("\n");
    const filename = auth.team ? `results_team_${auth.team}.csv` : "results_all.csv";

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
