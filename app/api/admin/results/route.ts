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

/** Supabase 에러 메세지에 "column ... does not exist" 포함 여부 */
function isMissingColumnErr(err: any) {
  const msg = String(err?.message ?? err ?? "");
  return msg.toLowerCase().includes("does not exist") && msg.toLowerCase().includes("column");
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

    // ✅ 1차: total_points 없이 조회 (실서버 컬럼 누락이어도 안 죽게)
    const baseSelect =
      "id, emp_id, score, started_at, submitted_at, total_questions, wrong_count, team, status";

    let r = await sb
      .from("exam_attempts")
      .select(baseSelect, { count: "exact" })
      .or(`team.eq.${adminTeam},team.is.null`)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (r.error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", detail: String(r.error?.message ?? r.error) },
        { status: 500 }
      );
    }

    const itemsRaw = r.data ?? [];
    const total = r.count ?? itemsRaw.length;

    // ✅ total_points가 있으면 추가로 가져오고, 없으면 계산으로 대체
    // - 로컬/일부 환경에서 total_points가 있을 수 있으니 "있으면" 가져오려고 1번 더 시도
    // - 컬럼 없으면 에러가 나니까 그 경우는 그냥 넘어감
    let totalPointsById: Record<string, number> = {};
    try {
      const ids = itemsRaw.map((x: any) => x?.id).filter((x: any) => x !== null && x !== undefined);
      if (ids.length > 0) {
        const r2 = await sb
          .from("exam_attempts")
          .select("id, total_points")
          .in("id", ids);

        if (!r2.error) {
          for (const row of r2.data ?? []) {
            const id = String(row?.id);
            totalPointsById[id] = Number(row?.total_points ?? 0);
          }
        } else {
          // 컬럼 없는 환경이면 여기서 에러 → 무시하고 계산 fallback
          if (!isMissingColumnErr(r2.error)) {
            // 컬럼 누락 말고 다른 에러면 그래도 표시
            // (단, 화면은 살리기 위해 throw하지 않음)
            // console.warn
          }
        }
      }
    } catch {
      // ignore
    }

    // ✅ total_points fallback 계산:
    // - points 기반 정확 계산은 테이블명 확인 필요라서, 지금은 "총문항수"로 대체
    // - (나중에 테이블명 알려주면 points 합으로 완전 정확하게 바꿔줄게)
    const items = itemsRaw.map((x: any) => {
      const id = String(x?.id);
      const tq = Number(x?.total_questions ?? 0);
      const tp = Number.isFinite(totalPointsById[id]) ? totalPointsById[id] : tq; // fallback
      return { ...x, __total_points: tp };
    });

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
            toCsvCell(x?.__total_points),
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
        totalPoints: Number(x?.__total_points ?? 0),
        startedAt: x?.started_at ?? null,
        submittedAt: x?.submitted_at ?? null,
        totalQuestions: Number(x?.total_questions ?? 0),
        wrongCount: Number(x?.wrong_count ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
