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
    const format = s(url.searchParams.get("format"));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const adminTeam = upperTeam(teamCookie || (empId === "admin_gs" ? "B" : "A"));

    // ✅ 팀 강제 + 유효 응시만
    const r = await sb
      .from("exam_attempts")
      .select(
        "id, emp_id, team, status, score, total_points, total_questions, wrong_count, started_at, submitted_at",
        { count: "exact" }
      )
      .eq("team", adminTeam)
      .not("emp_id", "is", null)
      .neq("emp_id", "")
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (r.error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", detail: String(r.error?.message ?? r.error) },
        { status: 500 }
      );
    }

    const rows = r.data ?? [];
    const total = r.count ?? rows.length;

    // ✅ 응답 정규화(프론트 키 불일치 대비: camelCase + snake_case 둘 다 제공)
    const items = rows.map((x: any) => {
      const tq = Number(x?.total_questions ?? 0);
      const tpRaw = Number(x?.total_points ?? 0);
      const tp = tpRaw || tq; // total_points가 0이면 일단 total_questions로 대체(화면 0/0 방지)

      const base = {
        id: String(x?.id),
        team: s(x?.team),
        status: s(x?.status),
        score: Number(x?.score ?? 0),
        totalPoints: tp,
        totalQuestions: tq,
        wrongCount: Number(x?.wrong_count ?? 0),
        startedAt: x?.started_at ?? null,
        submittedAt: x?.submitted_at ?? null,
      };

      return {
        // camelCase
        ...base,
        empId: s(x?.emp_id),

        // snake_case (기존 프론트가 이 키를 쓰는 경우 대비)
        emp_id: s(x?.emp_id),
        total_points: tp,
        total_questions: tq,
        wrong_count: Number(x?.wrong_count ?? 0),
        started_at: x?.started_at ?? null,
        submitted_at: x?.submitted_at ?? null,
      };
    });

    // ✅ CSV
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
            toCsvCell(x?.emp_id ?? x?.empId),
            toCsvCell(x?.team),
            toCsvCell(x?.status),
            toCsvCell(x?.score),
            toCsvCell(x?.total_points ?? x?.totalPoints),
            toCsvCell(x?.wrong_count ?? x?.wrongCount),
            toCsvCell(x?.total_questions ?? x?.totalQuestions),
            toCsvCell(x?.started_at ?? x?.startedAt),
            toCsvCell(x?.submitted_at ?? x?.submittedAt),
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
        // 프론트 호환용으로 둘 다 유지
        id: x.id,
        idType: "num",

        empId: x.empId,
        emp_id: x.emp_id,

        team: x.team,
        status: x.status,

        score: x.score,

        totalPoints: x.totalPoints,
        total_points: x.total_points,

        totalQuestions: x.totalQuestions,
        total_questions: x.total_questions,

        wrongCount: x.wrongCount,
        wrong_count: x.wrong_count,

        startedAt: x.startedAt,
        started_at: x.started_at,

        submittedAt: x.submittedAt,
        submitted_at: x.submitted_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
