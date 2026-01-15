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
    // ✅ 권한
    const empId = s(req.cookies.get("empId")?.value);
    const role = s(req.cookies.get("role")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);

    if (!empId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    // ✅ paging
    const url = new URL(req.url);
    const page = Math.max(1, n(url.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, n(url.searchParams.get("pageSize"), 50)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 팀 추정(원하면 여기 규칙 바꿔도 됨)
    const team = teamCookie || (empId === "admin_gs" ? "B" : "A");

    // ✅ 기본 select 컬럼 (네 UI에 필요한 것들)
    const BASE_SELECT =
      "id, emp_id, score, started_at, submitted_at, total_questions";

    // 1) owner_admin 컬럼이 있으면 owner_admin 기준으로 분리
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
      // owner_admin 컬럼이 없으면 다음 전략으로
      if (!looksMissingColumn(error, "owner_admin")) {
        // 컬럼은 있는데 다른 오류면 그대로 리턴 (DB 문제)
        return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error) }, { status: 500 });
      }
    }

    // 2) team 컬럼이 exam_attempts에 있으면 team 기준으로 분리
    {
      const q = sb
        .from("exam_attempts")
        .select(BASE_SELECT + ", team", { count: "exact" })
        .eq("team", team)
        .order("submitted_at", { ascending: false })
        .range(from, to);

      const { data, error, count } = await q;
      if (!error) {
        return NextResponse.json({
          ok: true,
          mode: "FILTER_TEAM_COLUMN",
          page,
          pageSize,
          total: count ?? (data?.length ?? 0),
          items: data ?? [],
        });
      }
      if (!looksMissingColumn(error, "team")) {
        return NextResponse.json({ ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error) }, { status: 500 });
      }
    }

    // 3) 둘 다 없으면: 관리자 전체 조회라도 보여주기(안 뜨는 문제 종결)
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
