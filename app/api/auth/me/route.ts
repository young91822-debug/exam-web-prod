// app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "accounts";
const sb: any = supabaseAdmin;

// ✅ DB에 role 컬럼이 없거나, 쿠키가 비정상일 때도 관리자 판정 fallback
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

function s(v: any) {
  return String(v ?? "").trim();
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

function pickEmpId(cookieHeader: string) {
  return (
    getCookie(cookieHeader, "empId") ||
    getCookie(cookieHeader, "emp_id") ||
    getCookie(cookieHeader, "userId") ||
    getCookie(cookieHeader, "employeeId") ||
    getCookie(cookieHeader, "emp") ||
    ""
  );
}

function pickRoleFromCookie(cookieHeader: string) {
  const r =
    getCookie(cookieHeader, "role") ||
    getCookie(cookieHeader, "userRole") ||
    getCookie(cookieHeader, "isAdmin") ||
    "";

  if (r === "admin" || r === "user") return r;

  const low = String(r).toLowerCase();
  if (low === "true" || low === "1" || low === "yes") return "admin";

  return "";
}

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes(`column ${TABLE}.${col} does not exist`) ||
    msg.includes(`Could not find the '${col}' column`) ||
    (msg.toLowerCase().includes(col) && msg.toLowerCase().includes("does not exist"))
  );
}

async function fetchAccountRow(loginId: string) {
  // 1) emp_id로 먼저
  let r1 = await sb
    .from(TABLE)
    .select("*")
    .eq("emp_id", loginId)
    .maybeSingle();

  if (r1.error) throw r1.error;
  if (r1.data) return { row: r1.data, matchedBy: "emp_id" as const };

  // 2) user_id 컬럼이 있을 수도 있으니 fallback
  const r2 = await sb
    .from(TABLE)
    .select("*")
    .eq("user_id", loginId)
    .maybeSingle();

  if (r2.error) {
    // user_id 컬럼이 없으면 그냥 패스
    if (!isMissingColumn(r2.error, "user_id")) throw r2.error;
  } else if (r2.data) {
    return { row: r2.data, matchedBy: "user_id" as const };
  }

  // 3) username 컬럼도 있을 수도(없으면 스킵)
  const r3 = await sb
    .from(TABLE)
    .select("*")
    .eq("username", loginId)
    .maybeSingle();

  if (r3.error) {
    if (!isMissingColumn(r3.error, "username")) throw r3.error;
  } else if (r3.data) {
    return { row: r3.data, matchedBy: "username" as const };
  }

  return { row: null, matchedBy: "none" as const };
}

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const loginId = pickEmpId(cookieHeader);

    // ✅ 세션 없으면 ok:false + 401 (중요)
    if (!loginId) {
      return NextResponse.json(
        { ok: false, error: "NO_SESSION", marker: "ME_NO_SESSION", hasCookieHeader: Boolean(cookieHeader) },
        { status: 401 }
      );
    }

    // ✅ DB 기준으로 계정 읽어서 role/team/is_active 확정
    const { row, matchedBy } = await fetchAccountRow(loginId);

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_NOT_FOUND", detail: { loginId, matchedBy }, marker: "ME_ACCOUNT_NOT_FOUND" },
        { status: 401 }
      );
    }

    const empId = s(row.emp_id || loginId);
    const team = s(row.team) || "";
    const isActive = row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active);

    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_DISABLED", detail: { empId }, marker: "ME_DISABLED" },
        { status: 403 }
      );
    }

    // role 컬럼이 있으면 DB 우선, 없으면 쿠키/ADMIN_IDS로 fallback
    let role = s(row.role);
    if (!role) role = pickRoleFromCookie(cookieHeader);
    if (!role) role = ADMIN_IDS.has(empId) || ADMIN_IDS.has(loginId) ? "admin" : "user";

    return NextResponse.json({
      ok: true,
      empId,
      role,
      team: team || null,
      isAdmin: role === "admin",
      matchedBy,
      marker: "ME_OK_DB",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ME_CRASH", detail: String(e?.message || e), marker: "ME_CRASH" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
