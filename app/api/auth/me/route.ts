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

/** supabase 에러 메시지에서 "컬럼 없음" 케이스 판정 */
function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  const c = String(col).toLowerCase();
  const t = String(TABLE).toLowerCase();

  // 다양한 형태 대응
  return (
    msg.includes(`column ${TABLE}.${col} does not exist`) ||
    msg.includes(`Could not find the '${col}' column`) ||
    low.includes(`column ${t}.${c} does not exist`) ||
    (low.includes(c) && low.includes("does not exist")) ||
    (low.includes(c) && low.includes("schema cache")) ||
    (low.includes("could not find") && low.includes(c))
  );
}

/** row에서 안전하게 컬럼을 읽고(컬럼 없으면 undefined), 문자열로 반환 */
function readStr(row: any, ...keys: string[]) {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return s(v);
  }
  return "";
}

/** is_active가 없으면 true로 간주 */
function readIsActive(row: any) {
  const v = row?.is_active;
  if (v === undefined || v === null) return true;
  return Boolean(v);
}

/** team이 없을 수 있어 여러 키로 시도 */
function readTeam(row: any) {
  return readStr(row, "team", "team_name", "group", "org_team");
}

/** role이 없을 수 있어 여러 키로 시도 */
function readRole(row: any) {
  return readStr(row, "role", "user_role", "account_role");
}

/** 컬럼이 없는 경우를 대비해서: emp_id/user_id/username 순으로 조회 */
async function fetchAccountRow(loginId: string) {
  // 1) emp_id
  const r1 = await sb.from(TABLE).select("*").eq("emp_id", loginId).maybeSingle();
  if (r1.error) throw r1.error;
  if (r1.data) return { row: r1.data, matchedBy: "emp_id" as const };

  // 2) user_id (없을 수 있음)
  const r2 = await sb.from(TABLE).select("*").eq("user_id", loginId).maybeSingle();
  if (r2.error) {
    if (!isMissingColumn(r2.error, "user_id")) throw r2.error;
  } else if (r2.data) {
    return { row: r2.data, matchedBy: "user_id" as const };
  }

  // 3) username (없을 수 있음)
  const r3 = await sb.from(TABLE).select("*").eq("username", loginId).maybeSingle();
  if (r3.error) {
    if (!isMissingColumn(r3.error, "username")) throw r3.error;
  } else if (r3.data) {
    return { row: r3.data, matchedBy: "username" as const };
  }

  return { row: null, matchedBy: "none" as const };
}

function jsonNoStore(payload: any, init?: number | ResponseInit) {
  const resInit: ResponseInit =
    typeof init === "number" ? { status: init } : (init ?? { status: 200 });

  const headers = new Headers(resInit.headers);
  // ✅ 캐시 금지(실서버/엣지/프록시에서 me 캐시되면 로그인 꼬임)
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Pragma", "no-cache");

  return NextResponse.json(payload, { ...resInit, headers });
}

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const loginId = pickEmpId(cookieHeader);

    // ✅ 세션 없으면 401
    if (!loginId) {
      return jsonNoStore(
        {
          ok: false,
          error: "NO_SESSION",
          marker: "ME_NO_SESSION",
          hasCookieHeader: Boolean(cookieHeader),
        },
        401
      );
    }

    // ✅ DB 기준으로 계정 읽어서 role/team/is_active 확정
    const { row, matchedBy } = await fetchAccountRow(loginId);

    if (!row) {
      return jsonNoStore(
        {
          ok: false,
          error: "ACCOUNT_NOT_FOUND",
          detail: { loginId, matchedBy },
          marker: "ME_ACCOUNT_NOT_FOUND",
        },
        401
      );
    }

    // emp_id가 없을 수도 있어 loginId로 대체
    const empId = readStr(row, "emp_id", "empId", "user_id", "username") || s(loginId);
    const team = readTeam(row) || "";
    const isActive = readIsActive(row);

    if (!isActive) {
      return jsonNoStore(
        { ok: false, error: "ACCOUNT_DISABLED", detail: { empId }, marker: "ME_DISABLED" },
        403
      );
    }

    // role 컬럼이 있으면 DB 우선, 없으면 쿠키/ADMIN_IDS로 fallback
    let role = readRole(row);
    if (!role) role = pickRoleFromCookie(cookieHeader);
    if (!role) role = ADMIN_IDS.has(empId) || ADMIN_IDS.has(loginId) ? "admin" : "user";

    return jsonNoStore({
      ok: true,
      empId,
      role,
      team: team || null,
      isAdmin: role === "admin",
      matchedBy,
      marker: "ME_OK_DB",
    });
  } catch (e: any) {
    return jsonNoStore(
      { ok: false, error: "ME_CRASH", detail: String(e?.message || e), marker: "ME_CRASH" },
      500
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
