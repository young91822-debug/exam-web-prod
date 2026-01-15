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

function isMissingColumn(err: any) {
  const msg = String(err?.message ?? err ?? "");
  // PostgREST / Supabase에서 컬럼 없을 때 나오는 패턴들
  return (
    msg.includes("does not exist") ||
    msg.includes("Could not find") ||
    msg.includes("schema cache")
  );
}

async function trySelect(
  teamFilter: string | null,
  from: number,
  to: number,
  selectExpr: string
) {
  let q = sb
    .from("exam_attempts")
    .select(selectExpr, { count: "exact" })
    .order("submitted_at", { ascending: false })
    .range(from, to);

  if (teamFilter !== null) {
    // team 포함 + empty/null도 포함 (너가 원래 원했던 동작)
    q = q.or(`team.eq.${teamFilter},team.is.null,team.eq.`);
  }

  return await q;
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

    // ✅ 기본 팀 (admin_gs는 B, 그 외 A)
    const team = teamCookie || (empId === "admin_gs" ? "B" : "A");

    // ✅ “있을 수도 있는 컬럼들”을 후보로 둔다
    // - total_points 가 없어서 지금 터진 상태라, 여기서는 후보로만 두고
    // - 실제 select에서 실패하면 자동으로 빼고 재시도한다
    const selectCandidates = [
      "id",
      "emp_id",
      "score",
      "started_at",
      "submitted_at",
      "total_questions",
      "team",
      "status",
      "total_points",
      "correct_count",
      "wrong_count",
    ];

    // 1차: 최대한 많이 포함해서 시도
    let cols = [...selectCandidates];
    let lastErr: any = null;

    for (let tries = 0; tries < 12; tries++) {
      const selectExpr = cols.join(",");
      const r = await trySelect(team, from, to, selectExpr);

      if (!r.error) {
        return NextResponse.json({
          ok: true,
          mode: "SAFE_SELECT_TEAM_PLUS_EMPTY",
          page,
          pageSize,
          total: r.count ?? (r.data?.length ?? 0),
          selectExpr,
          items: r.data ?? [],
        });
      }

      lastErr = r.error;

      // 컬럼 없음이면, 에러 메시지에서 컬럼명을 대충 뽑아서 빼준다
      if (isMissingColumn(r.error)) {
        const msg = String(r.error?.message ?? "");
        // 예: 'column exam_attempts.total_points does not exist'
        const m = msg.match(/exam_attempts\.([a-zA-Z0-9_]+)/);
        const badCol = m?.[1];

        if (badCol && cols.includes(badCol)) {
          cols = cols.filter((c) => c !== badCol);
          continue;
        }

        // 못뽑았으면 “잘 터질만한 애들”을 우선 제거
        const fallbackRemoveOrder = ["total_points", "correct_count", "wrong_count", "status", "team"];
        const remove = fallbackRemoveOrder.find((c) => cols.includes(c));
        if (remove) {
          cols = cols.filter((c) => c !== remove);
          continue;
        }
      }

      // 컬럼 없음이 아닌 DB 에러면 바로 반환
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", detail: String(r.error?.message ?? r.error) },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "DB_READ_FAILED", detail: String(lastErr?.message ?? lastErr) },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
