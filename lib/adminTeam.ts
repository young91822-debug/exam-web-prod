// lib/adminTeam.ts
import { supabaseAdmin } from "./supabaseAdmin";

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

export async function requireAdminAndGetTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) {
    return { ok: false as const, status: 401, error: "NO_SESSION" };
  }
  if (role !== "admin") {
    return { ok: false as const, status: 403, error: "NOT_ADMIN" };
  }

  // accounts에서 team 조회
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  }
  if (!data) {
    return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  }
  if (data.is_active === false) {
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };
  }

  const team = String(data.team || "").trim() || "A";
  return { ok: true as const, empId, team };
}

export async function getUserTeamFromCookie(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  if (!data) return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  if (data.is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = String(data.team || "").trim() || "A";
  return { ok: true as const, empId, team };
}
