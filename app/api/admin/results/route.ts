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

/**
 * ✅ 관리자 + 팀 조회
 * 기준: emp_id (username ❌)
 */
async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) {
    return { ok: false as const, status: 401, error: "NO_SESSION" };
  }
  if (role !== "admin") {
    return { ok: false as const, status: 403, error: "NOT_ADMIN" };
  }

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("emp_id, team, is_active")
    .eq("emp_id", empId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "DB_QUERY_FAILED",
      detail: error.message,
    };
  }
  if (!data) {
    return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  }
  if ((data as any).is_active === false) {
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };
  }

  const team = String((data as any).team ?? "").trim() || "A";
  return { ok: true as const, team, empId };
}

function pickEmpId(row: any) {
  return (
    row?.emp_id ??
    row?.empId ??
    row?.user_id ??
    row?.userId ??
    "-"
  );
}
function pickScore(row: any) {
  return row?.score ?? row?.total_score ?? 0;
}
function pickStartedAt(row: any) {
  return row?.started_at ?? row?.created_at ?? null;
}
function pickSubmittedAt(row: any) {
  return row?.submitted_at ?? row?.ended_at ?? null;
}

export async function GET(req: Request) {
  try {
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

    const includeLegacy = (u.searchParams.get("includeLegacy") ?? "1") !== "0";

    const items: any[] = [];
    let newErr: any = null;
    let legacyErr: any = null;

    /**
     * 1️⃣ 신형 attempts (UUID, team 컬럼 있음)
     */
    const newRes = await supabaseAdmin
      .from("attempts")
      .select(
        "id, emp_id, team, started_at, submitted_at, score, total_points, questions, wrongs"
      )
      .eq("team", auth.team)
      .order("started_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (newRes.error) {
      newErr = newRes.error;
    } else {
      for (const r of newRes.data || []) {
        items.push({
          id: String(r.id),
          idType: "uuid",
          empId: pickEmpId(r),
          score: pickScore(r),
          totalPoints: r.total_points ?? 0,
          startedAt: pickStartedAt(r),
          submittedAt: pickSubmittedAt(r),
          totalQuestions: Array.isArray(r.questions) ? r.questions.length : 0,
          wrongCount: Array.isArray(r.wrongs) ? r.wrongs.length : 0,
          source: "attempts",
        });
      }
    }

    /**
     * 2️⃣ legacy exam_attempts (emp_id 기준, 팀은 accounts로 필터)
     */
    if (includeLegacy) {
      const accRes = await supabaseAdmin
        .from("accounts")
        .select("emp_id")
        .eq("team", auth.team)
        .limit(5000);

      if (accRes.error) {
        legacyErr = accRes.error;
      } else {
        const empIds = (accRes.data || [])
          .map((r: any) => String(r.emp_id ?? "").trim())
          .filter(Boolean);

        if (empIds.length > 0) {
          const legacyRes = await supabaseAdmin
            .from("exam_attempts")
            .select("id, emp_id, started_at, submitted_at, score, total_questions")
            .in("emp_id", empIds)
            .order("started_at", { ascending: false })
            .range(offset, offset + pageSize - 1);

          if (legacyRes.error) {
            legacyErr = legacyRes.error;
          } else {
            for (const r of legacyRes.data || []) {
              items.push({
                id: String(r.id),
                idType: "num",
                empId: String(r.emp_id ?? "-"),
                score: Number(r.score ?? 0),
                totalPoints: 0,
                startedAt: r.started_at ?? null,
                submittedAt: r.submitted_at ?? null,
                totalQuestions: Number(r.total_questions ?? 0),
                wrongCount: 0,
                source: "exam_attempts",
              });
            }
          }
        }
      }
    }

    // 최신순 정렬
    items.sort((a, b) => {
      const ta = new Date(a.submittedAt ?? a.startedAt ?? 0).getTime();
      const tb = new Date(b.submittedAt ?? b.startedAt ?? 0).getTime();
      return tb - ta;
    });

    return NextResponse.json({
      ok: true,
      team: auth.team,
      page,
      pageSize,
      items,
      debug: {
        includeLegacy,
        newErr: newErr ?? null,
        legacyErr: legacyErr ?? null,
        itemsCount: items.length,
      },
      marker: "ADMIN_RESULTS_TEAM_v1_NO_USERNAME",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULTS_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
