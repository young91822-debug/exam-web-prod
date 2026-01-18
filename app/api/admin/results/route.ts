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

/** supabase error가 "column ... does not exist" 류인지 */
function isMissingColumnErr(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("does not exist") && msg.includes("column");
}

async function safeSelectAttempts(
  adminTeam: string,
  from: number,
  to: number
): Promise<{ rows: any[]; count: number | null; usedCols: Record<string, boolean> }> {
  // ✅ "가장 얇은 스키마"에서도 살아남는 최소 컬럼부터 시작
  // - id / emp_id 는 거의 반드시 있음
  // - score / started_at / submitted_at / team / status 는 있을 수도 없을 수도
  const plans: { select: string; used: Record<string, boolean> }[] = [
    {
      select: "id, emp_id",
      used: { id: true, emp_id: true },
    },
    {
      select: "id, emp_id, team",
      used: { id: true, emp_id: true, team: true },
    },
    {
      select: "id, emp_id, team, status",
      used: { id: true, emp_id: true, team: true, status: true },
    },
    {
      select: "id, emp_id, team, status, score",
      used: { id: true, emp_id: true, team: true, status: true, score: true },
    },
    {
      select: "id, emp_id, team, status, score, started_at, submitted_at",
      used: {
        id: true,
        emp_id: true,
        team: true,
        status: true,
        score: true,
        started_at: true,
        submitted_at: true,
      },
    },
    // 아래는 있으면 좋고, 없으면 바로 에러날 수 있는 컬럼들(실서버에서 지금 빠져있음)
    {
      select: "id, emp_id, team, status, score, started_at, submitted_at, total_questions, wrong_count, total_points",
      used: {
        id: true,
        emp_id: true,
        team: true,
        status: true,
        score: true,
        started_at: true,
        submitted_at: true,
        total_questions: true,
        wrong_count: true,
        total_points: true,
      },
    },
  ];

  let lastErr: any = null;

  for (const p of plans) {
    const q = sb
      .from("exam_attempts")
      .select(p.select, { count: "exact" })
      // team 컬럼이 없으면 or 필터 자체가 에러날 수 있어서,
      // team 포함 플랜에서만 or 필터 적용하고, 최소 플랜에선 필터 없이 가져옴
      // (교차노출 방지는 "team 컬럼 있을 때"만 강제)
      ;

    let r: any;
    try {
      if (p.used.team) {
        r = await q
          .eq("team", adminTeam)
          .order("submitted_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
      } else {
        r = await q
          .order("id", { ascending: false })
          .range(from, to);
      }
    } catch (e: any) {
      lastErr = e;
      continue;
    }

    if (!r?.error) {
      return { rows: r.data ?? [], count: r.count ?? null, usedCols: p.used };
    }

    lastErr = r.error;

    // 컬럼 없어서 실패면 다음 플랜(더 얇게)로
    if (isMissingColumnErr(r.error)) continue;

    // 다른 에러면 바로 반환(권한/테이블명/네트워크 등)
    break;
  }

  // 전부 실패
  throw lastErr ?? new Error("DB_READ_FAILED");
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

    const { rows, count, usedCols } = await safeSelectAttempts(adminTeam, from, to);

    const total = count ?? rows.length;

    // ✅ 응답 정규화: 없는 컬럼은 0/null로
    const norm = rows.map((x: any) => {
      const id = String(x?.id ?? "");
      const team = usedCols.team ? s(x?.team) : ""; // team 컬럼 없으면 빈값
      const status = usedCols.status ? s(x?.status) : "";
      const score = usedCols.score ? Number(x?.score ?? 0) : 0;
      const totalQuestions = usedCols.total_questions ? Number(x?.total_questions ?? 0) : 0;
      const wrongCount = usedCols.wrong_count ? Number(x?.wrong_count ?? 0) : 0;

      // total_points 없으면 일단 totalQuestions로 대체(화면 살리기)
      const totalPoints = usedCols.total_points ? Number(x?.total_points ?? 0) : totalQuestions;

      const startedAt = usedCols.started_at ? (x?.started_at ?? null) : null;
      const submittedAt = usedCols.submitted_at ? (x?.submitted_at ?? null) : null;

      return {
        raw: x,
        id,
        empId: s(x?.emp_id),
        team,
        status,
        score,
        totalPoints,
        totalQuestions,
        wrongCount,
        startedAt,
        submittedAt,
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
        ...norm.map((x: any) =>
          [
            toCsvCell(x.id),
            toCsvCell(x.empId),
            toCsvCell(x.team),
            toCsvCell(x.status),
            toCsvCell(x.score),
            toCsvCell(x.totalPoints),
            toCsvCell(x.wrongCount),
            toCsvCell(x.totalQuestions),
            toCsvCell(x.startedAt),
            toCsvCell(x.submittedAt),
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
      filters: { adminTeam, usedCols },
      items: norm.map((x: any) => ({
        id: x.id,
        idType: "num",
        empId: x.empId,
        score: x.score,
        totalPoints: x.totalPoints,
        startedAt: x.startedAt,
        submittedAt: x.submittedAt,
        totalQuestions: x.totalQuestions,
        wrongCount: x.wrongCount,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DB_READ_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
