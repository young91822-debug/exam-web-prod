import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function b(v: any, d = true) {
  if (v === undefined || v === null) return d;
  return ["1", "true", "yes", "on", "사용"].includes(String(v).toLowerCase());
}
function getCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.split("=")[1] ?? "";
}

function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** ✅ 관리자 + 팀 확인 */
async function requireAdminTeam(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const empId = getCookie(cookie, "empId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("emp_id, team, is_active")
    .eq("emp_id", empId)
    .maybeSingle();

  if (error)
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  if (!data)
    return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };

  return { ok: true as const, empId, team: data.team || "A" };
}

export async function GET(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok)
    return NextResponse.json(auth, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id, emp_id, name, team, is_active, created_at")
    .eq("team", auth.team)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: error.message },
      { status: 500 }
    );

  return NextResponse.json({ ok: true, team: auth.team, items: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok)
    return NextResponse.json(auth, { status: auth.status });

  const body = await req.json();
  const empId = s(body.emp_id ?? body.empId);
  const name = s(body.name);
  const isActive = b(body.is_active ?? body.isActive, true);
  const password = s(body.password) || "1234";

  if (!empId)
    return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });

  const { data: exists } = await supabaseAdmin
    .from("accounts")
    .select("id, team")
    .eq("emp_id", empId)
    .maybeSingle();

  if (exists)
    return NextResponse.json(
      { ok: false, error: "ACCOUNT_ALREADY_EXISTS" },
      { status: 409 }
    );

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .insert({
      emp_id: empId,
      name: name || null,
      team: auth.team,
      is_active: isActive,
      password_hash: makePasswordHash(password),
    })
    .select("id, emp_id, name, team, is_active, created_at")
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message },
      { status: 500 }
    );

  return NextResponse.json({
    ok: true,
    item: data,
    tempPassword: password,
  });
}
