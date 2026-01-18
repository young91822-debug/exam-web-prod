// app/api/admin/results/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function upperTeam(v: any) {
  const t = s(v).toUpperCase();
  return t === "B" ? "B" : "A";
}
function toCsvCell(v: any) {
  const t = String(v ?? "");
  if (t.includes('"') || t.includes(",") || t.includes("\n")) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export async function GET(req: NextRequest) {
  try {
    const empId = s(req.cookies.get("empId")?.value);
    const role = s(req.cookies.get("role")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);

    if (!empId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, n(url.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, n(url.searchParams.get("pageSize"), 50)));
    const format = s(url.searchParams.get("format")); // "csv"면 csv
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const adminTeam = upperTeam(teamCookie || (empId === "admin_gs" ? "B" : "A"));

    // ✅ 최대한 안전: team 기준으로만 보여줌 (owner_admin 없더라도 교차노출 방지)
    // 레거시 team null도 있을 수 있으니 "내 팀 또는 null"만 허용
    const r = await sb
      .from("exam_attempts")
      .select("id, emp_id, score, total_points, started_at, submitted_at, total_questions, wrong_count, team, status", { count: "exact" })
      .or(`team.eq.${adminTeam},team.is.null,team.eq.`)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (r.error) {
      return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(r.error?.message ?? r.error) }, { status: 500 });
    }

    const items = r.data ?? [];
    const total = r.count ?? items.length;

    // ✅ CSV 응답
    if (format.toLowerCase() === "csv") {
      const header = [
        "attempt_id",
        "emp_id",
        "team",
        "status",
        "score",
        "total_points",
        "wrong_count",
        "total_questions",
        "started_at",
        "submitted_at",
      ];

      const lines = [
        header.join(","),
        ...items.map((x: any) =>
          [
            toCsvCell(x?.id),
            toCsvCell(x?.emp_id),
            toCsvCell(x?.team),
            toCsvCell(x?.status),
            toCsvCell(x?.score),
            toCsvCell(x?.total_points),
            toCsvCell(x?.wrong_count),
            toCsvCell(x?.total_questions),
            toCsvCell(x?.started_at),
            toCsvCell(x?.submitted_at),
          ].join(",")
        ),
      ].join("\n");

      return new NextResponse(lines, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="results_${adminTeam}_p${page}.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      filters: { adminTeam },
      items: items.map((x: any) => ({
        id: String(x?.id),
        idType: "num",
        empId: s(x?.emp_id),
        score: Number(x?.score ?? 0),
        totalPoints: Number(x?.total_points ?? 0),
        startedAt: x?.started_at ?? null,
        submittedAt: x?.submitted_at ?? null,
        totalQuestions: Number(x?.total_questions ?? 0),
        wrongCount: Number(x?.wrong_count ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "RESULTS_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
