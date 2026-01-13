// app/api/admin/results/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

/** ✅ 관리자 팀 조회 (쿠키 empId → accounts.team) */
async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  }
  if (!data) return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  if (data.is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = String((data as any).team ?? "").trim() || "A";
  return { ok: true as const, team, empId };
}

function pickEmpId(row: any) {
  return (
    row?.emp_id ??
    row?.empId ??
    row?.user_id ??
    row?.userId ??
    row?.account_id ??
    row?.accountId ??
    "-"
  );
}
function pickScore(row: any) {
  return row?.score ?? row?.total_score ?? row?.result_score ?? 0;
}
function pickSubmittedAt(row: any) {
  return (
    row?.submitted_at ??
    row?.submittedAt ??
    row?.ended_at ??
    row?.endedAt ??
    row?.created_at ??
    row?.started_at ??
    null
  );
}
function pickStartedAt(row: any) {
  return row?.started_at ?? row?.startedAt ?? row?.created_at ?? null;
}

export async function GET(req: Request) {
  try {
    // ✅ 관리자/팀 확인
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    const u = new URL(req.url);
    const page = Math.max(1, n(u.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, n(u.searchParams.get("pageSize"), 50)));
    const offset = (page - 1) * pageSize;

    // ✅ 신형 attempts(UUID) - 팀 필터 적용
    const newRes = await supabaseAdmin
      .from("attempts")
      .select("id, user_id, team, started_at, submitted_at, score, total_points, questions, wrongs")
      .eq("team", auth.team) // ✅ 핵심: 팀 분리
      .order("started_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const items: any[] = [];

    if (!newRes.error) {
      for (const r of newRes.data || []) {
        items.push({
          id: String(r.id), // ✅ UUID
          idType: "uuid",
          empId: pickEmpId(r),
          score: pickScore(r),
          totalPoints: (r as any).total_points ?? 0,
          startedAt: pickStartedAt(r),
          submittedAt: pickSubmittedAt(r),
          totalQuestions: Array.isArray((r as any).questions) ? (r as any).questions.length : 0,
          wrongCount: Array.isArray((r as any).wrongs) ? (r as any).wrongs.length : 0,
        });
      }
    }

    // ✅ 구형 exam_attempts는 팀 분리 불가(기본 제외)
    // 필요하면 나중에 A팀 관리자만 includeLegacy=true로 보이게 옵션 추가 가능

    // 최신순 정렬(제출시각 우선, 없으면 시작시각)
    items.sort((a, b) => {
      const ta = new Date(a.submittedAt ?? a.startedAt ?? 0).getTime();
      const tb = new Date(b.submittedAt ?? b.startedAt ?? 0).getTime();
      return tb - ta;
    });

    return NextResponse.json({
      ok: true,
      team: auth.team, // ✅ 확인용
      page,
      pageSize,
      items,
      debug: {
        newErr: newRes.error ?? null,
        legacyExcluded: true,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
