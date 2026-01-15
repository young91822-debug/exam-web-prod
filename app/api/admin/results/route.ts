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

/** owner_admin 컬럼이 없을 때(does not exist / schema cache 포함) */
function isMissingOwnerAdminColumn(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("owner_admin") &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("not find"))
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, n(url.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, n(url.searchParams.get("pageSize"), 50)));

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // ✅ 현재 로그인한 관리자(empId) - admin / admin_gs
    const adminEmpId = s(req.cookies.get("empId")?.value);

    // 관리자 쿠키가 없으면 안전하게 0건
    if (!adminEmpId) {
      return NextResponse.json({ ok: true, page, pageSize, items: [] });
    }

    /**
     * 1) B관리자(현재 관리자)가 만든 응시자 목록 구하기
     *   accounts.owner_admin == adminEmpId 인 emp_id들
     *
     * owner_admin 컬럼이 DB에 없으면 => 요구사항대로 0건 반환
     */
    const acc = await sb
      .from("accounts")
      .select("emp_id, owner_admin")
      .eq("owner_admin", adminEmpId);

    if (acc.error) {
      if (isMissingOwnerAdminColumn(acc.error)) {
        // ✅ 분리 기준 컬럼이 없으면: 이 페이지는 아무것도 보이면 안됨
        return NextResponse.json({ ok: true, page, pageSize, items: [] });
      }
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_LOOKUP_FAILED", detail: acc.error.message },
        { status: 500 }
      );
    }

    const ownedEmpIds = (acc.data ?? [])
      .map((r: any) => s(r?.emp_id))
      .filter(Boolean);

    // B관리자가 만든 계정이 없으면 0건
    if (ownedEmpIds.length === 0) {
      return NextResponse.json({ ok: true, page, pageSize, items: [] });
    }

    /**
     * 2) exam_attempts에서 ownedEmpIds에 해당하는 응시만 조회
     */
    const { data, error } = await sb
      .from("exam_attempts")
      .select("*")
      .in("emp_id", ownedEmpIds)
      .order("started_at", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    // ✅ 너 원래 형식 그대로 items 매핑 유지
    const items = (data ?? []).map((r: any) => ({
      id: String(r.id),
      idType: typeof r.id === "string" && String(r.id).includes("-") ? "uuid" : "num",
      empId: r.emp_id,
      score: Number(r.score ?? 0),
      totalPoints: Number(r.total_points ?? 0),
      startedAt: r.started_at,
      submittedAt: r.submitted_at,
      totalQuestions: Number(r.total_questions ?? 0),
      wrongCount: Number(r.wrong_count ?? 0),
    }));

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
