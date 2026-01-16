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
  return msg.includes("does not exist") || msg.includes("Could not find") || msg.includes("schema cache");
}

/** ✅ 팀 → 소유 관리자 고정 매핑 */
function mapOwnerAdminByTeam(team: string) {
  const t = s(team).toUpperCase();
  return t === "B" ? "admin_gs" : "admin";
}

/**
 * ✅ 시도1: owner_admin 필터(가능하면) + team 보조필터
 * ✅ owner_admin 컬럼이 없으면 자동으로 제외하고 재시도할 수 있도록
 *    여기서는 "필터를 옵션으로" 받는다.
 */
async function trySelect(opts: {
  teamFilter: string | null;
  ownerAdminFilter: string | null;
  from: number;
  to: number;
  selectExpr: string;
}) {
  const { teamFilter, ownerAdminFilter, from, to, selectExpr } = opts;

  let q = sb
    .from("exam_attempts")
    .select(selectExpr, { count: "exact" })
    .order("submitted_at", { ascending: false })
    .range(from, to);

  // ✅ 1순위: owner_admin으로 관리자 분리
  if (ownerAdminFilter) {
    q = q.eq("owner_admin", ownerAdminFilter);
  }

  // ✅ 2순위(보조): team도 포함 + empty/null도 포함(기존 동작 유지)
  if (teamFilter !== null) {
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
    const team = (teamCookie || (empId === "admin_gs" ? "B" : "A")).toUpperCase();

    // ✅ 고정 매핑: 내 팀의 소유 관리자
    // - 팀/쿠키가 꼬여도 "이 관리자"가 보는 건 "이 관리자 소유(owner_admin=empId)"가 1순위.
    // - 단, 혹시 너가 관리자 계정을 늘리거나 바꿀 수 있으니: 1순위는 그냥 empId로.
    const ownerAdmin = empId || mapOwnerAdminByTeam(team);

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
      // ✅ 새 컬럼 후보로 포함 (없으면 자동 제거됨)
      "owner_admin",
    ];

    let cols = [...selectCandidates];
    let lastErr: any = null;

    // owner_admin 필터는 기본 ON, 컬럼 없으면 OFF로 자동 전환
    let useOwnerAdminFilter = true;

    for (let tries = 0; tries < 12; tries++) {
      const selectExpr = cols.join(",");
      const r = await trySelect({
        teamFilter: team, // 보조
        ownerAdminFilter: useOwnerAdminFilter ? ownerAdmin : null, // 1순위
        from,
        to,
        selectExpr,
      });

      if (!r.error) {
        return NextResponse.json({
          ok: true,
          mode: useOwnerAdminFilter ? "OWNER_ADMIN_FILTERED" : "TEAM_ONLY_FALLBACK",
          page,
          pageSize,
          total: r.count ?? (r.data?.length ?? 0),
          selectExpr,
          filters: {
            owner_admin: useOwnerAdminFilter ? ownerAdmin : null,
            team,
          },
          items: r.data ?? [],
        });
      }

      lastErr = r.error;

      if (isMissingColumn(r.error)) {
        const msg = String(r.error?.message ?? "");

        // ✅ 에러에서 컬럼명을 뽑아 제거
        const m = msg.match(/exam_attempts\.([a-zA-Z0-9_]+)/);
        const badCol = m?.[1];

        // 1) owner_admin 컬럼/필터가 원인일 수 있음
        // - selectExpr에 owner_admin이 포함되어 있거나
        // - 필터(eq owner_admin)가 걸려서 터질 수 있음
        // PostgREST는 필터 컬럼이 없으면 에러가 나니,
        // 이 경우 "owner_admin 필터를 끈다"가 맞음.
        if (msg.toLowerCase().includes("owner_admin")) {
          // select에서 제거
          if (cols.includes("owner_admin")) cols = cols.filter((c) => c !== "owner_admin");
          // 필터도 끔
          useOwnerAdminFilter = false;
          continue;
        }

        if (badCol && cols.includes(badCol)) {
          cols = cols.filter((c) => c !== badCol);
          continue;
        }

        // 2) 못 뽑았으면 “잘 터질만한 애들” 우선 제거
        const fallbackRemoveOrder = [
          "total_points",
          "correct_count",
          "wrong_count",
          "status",
          "team",
          "started_at",
        ];
        const remove = fallbackRemoveOrder.find((c) => cols.includes(c));
        if (remove) {
          cols = cols.filter((c) => c !== remove);
          continue;
        }

        // 3) 그래도 안 되면 마지막으로 owner_admin 필터 OFF 한번 시도
        if (useOwnerAdminFilter) {
          useOwnerAdminFilter = false;
          continue;
        }
      }

      // 컬럼 없음이 아닌 에러면 바로 반환
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
