// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function getCookie(h: string, n: string) {
  return h.split(";").map(v => v.trim()).find(v => v.startsWith(n + "="))?.split("=")[1] ?? "";
}

async function requireAdminTeam(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const empId = getCookie(cookie, "empId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("emp_id, team, is_active")
    .eq("emp_id", empId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  if (!data) return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };

  return { ok: true as const, empId, team: data.team ?? "A" };
}

function makePasswordHash(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function GET(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok) return NextResponse.json(auth, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id, emp_id, name, team, is_active, created_at")
    .eq("team", auth.team)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: "ACCOUNTS_LIST_FAILED", detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, team: auth.team, items: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok) return NextResponse.json(auth, { status: auth.status });

  const body = await req.json();
  const empId = s(body.emp_id ?? body.empId);
  const name = s(body.name);
  const password = s(body.password) || "1234";

  if (!empId) return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });

  const { data: exists } = await supabaseAdmin.from("accounts").select("id").eq("emp_id", empId).maybeSingle();
  if (exists) return NextResponse.json({ ok: false, error: "ALREADY_EXISTS" }, { status: 409 });

  const { data, error } = await supabaseAdmin.from("accounts").insert({
    emp_id: empId,
    name,
    team: auth.team,
    is_active: true,
    password_hash: makePasswordHash(password),
  }).select().maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, item: data, tempPassword: password });
}
