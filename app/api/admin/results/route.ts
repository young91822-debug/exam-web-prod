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
function looksMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes(col) && (msg.includes("does not exist") || msg.includes("schema cache"));
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
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // ✅ 팀 추정(필요하면 여기 규칙만 바꾸면 됨)
    const team = teamCookie || (empId === "admin_gs" ? "B" : "A");

    const BASE_SELECT = "id, emp_id, score, started_at, submitted_at, total_questions";

    // 1) owner_admin 있으면 최우선
    {
      const q = sb
        .from("exam_attempts")
        .select(BASE_SELECT + ", owner_admin", { count: "exact" })
        .eq("owner_admin", empId)
        .order("submitted_at", { ascending: false })
        .range(from, to);

      const { data, error, count } = await q;
      if (!error) {
        return NextResponse.json({
          ok: true,
          mode: "FILTER_OWNER_ADMIN",
          page,
          pageSize,
          total: count ?? (data?.length ?? 0),
          items: data ?? [],
        });
      }
      if (!looksMissingColumn(error, "owner_admin")) {
        return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error) }, { status: 500 });
      }
    }

    // 2) team 컬럼 있으면 team으로 필터
    // ✅ 단, 0건이면 "team IS NULL/''"도 포함해서 다시 조회 (지금 너 케이스 방지)
    {
      const q1 = sb
        .from("exam_attempts")
        .select(BASE_SELECT + ", team", { count: "exact" })
        .eq("team", team)
        .order("submitted_at", { ascending: false })
        .range(from, to);

      const r1 = await q1;
      if (!r1.error) {
        const total1 = r1.count ?? (r1.data?.length ?? 0);

        if (total1 > 0) {
          return NextResponse.json({
            ok: true,
            mode: "FILTER_TEAM_COLUMN",
            page,
            pageSize,
            total: total1,
            items: r1.data ?? [],
          });
        }

        // ✅ 0건이면: team이 비어있는 데이터도 같이 보여주기
        const q2 = sb
          .from("exam_attempts")
          .select(BASE_SELECT + ", team", { count: "exact" })
          .or(`team.eq.${team},team.is.null,team.eq.`) // team==B OR NULL OR ''(빈문자열)
          .order("submitted_at", { ascending: false })
          .range(from, to);

        const r2 = await q2;

        // team 컬럼 자체는 있으니까, 여기서 에러나면 DB 문제
        if (r2.error) {
          return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(r2.error?.message ?? r2.error) }, { status: 500 });
        }

        return NextResponse.json({
          ok: true,
          mode: "FILTER_TEAM_PLUS_EMPTY",
          page,
          pageSize,
          total: r2.count ?? (r2.data?.length ?? 0),
          items: r2.data ?? [],
          hint: "team 값이 NULL/빈문자열로 저장된 응시가 있어 team 필터만으로는 0건이었습니다.",
        });
      }

      if (!looksMissingColumn(r1.error, "team")) {
        return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(r1.error?.message ?? r1.error) }, { status: 500 });
      }
    }

    // 3) 마지막 fallback: 필터 없이 전체
    {
      const q = sb
        .from("exam_attempts")
        .select(BASE_SELECT, { count: "exact" })
        .order("submitted_at", { ascending: false })
        .range(from, to);

      const { data, error, count } = await q;
      if (error) {
        return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error) }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        mode: "NO_FILTER_FALLBACK",
        page,
        pageSize,
        total: count ?? (data?.length ?? 0),
        items: data ?? [],
      });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "RESULTS_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
