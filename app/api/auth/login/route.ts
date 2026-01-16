// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "accounts";
const sb: any = supabaseAdmin;

const ADMIN_IDS = new Set(["admin", "admin_gs"]);

function s(v: any) {
  return String(v ?? "").trim();
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      return t ? JSON.parse(t) : {};
    } catch {
      return {};
    }
  }
}

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
function verifyPasswordHash(plain: string, stored: string) {
  try {
    const [algo, saltB64, hashB64] = String(stored || "").split("$");
    if (algo !== "scrypt" || !saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = crypto.scryptSync(plain, salt, expected.length);

    return (
      derived.length === expected.length &&
      crypto.timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}

function cookieStr(name: string, value: string, opt?: { maxAgeSec?: number }) {
  const maxAge = opt?.maxAgeSec ?? 60 * 60 * 24 * 7;
  const isProd = process.env.NODE_ENV === "production";
  const base = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAge}`,
    `SameSite=Lax`,
    `HttpOnly`,
  ];
  if (isProd) base.push("Secure");
  return base.join("; ");
}

async function fetchAccount(loginId: string) {
  // 1) emp_id 우선
  const r1 = await sb.from(TABLE).select("*").eq("emp_id", loginId).maybeSingle();
  if (r1.error) throw r1.error;
  if (r1.data) return { row: r1.data, matchedBy: "emp_id" as const };

  // 2) username fallback (너 테이블은 username NOT NULL임)
  const r2 = await sb.from(TABLE).select("*").eq("username", loginId).maybeSingle();
  if (r2.error) throw r2.error;
  if (r2.data) return { row: r2.data, matchedBy: "username" as const };

  return { row: null, matchedBy: "none" as const };
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.empId ?? body?.emp_id ?? body?.user_id ?? body?.username);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const { row, matchedBy } = await fetchAccount(id);

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_NO_ACCOUNT", matchedBy },
        { status: 401 }
      );
    }

    const isActive = row.is_active === undefined || row.is_active === null ? true : Boolean(row.is_active);
    if (!isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED", marker: "LOGIN_DISABLED", matchedBy }, { status: 403 });
    }

    const stored = s(row.password_hash || "");
    if (!stored || !verifyPasswordHash(pw, stored)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_BAD_PASSWORD", matchedBy },
        { status: 401 }
      );
    }

    const empId = s(row.emp_id) || s(row.username) || id;
    const team = s(row.team) || "";

    let role = s(row.role);
    if (!role) role = ADMIN_IDS.has(empId) || ADMIN_IDS.has(id) ? "admin" : "user";
    if (role !== "admin" && role !== "user") role = "user";

    const redirect = role === "admin" ? "/admin" : "/exam";

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      team: team || null,
      isAdmin: role === "admin",
      redirect,
      matchedBy,
      marker: "LOGIN_OK_V3",
    });

    res.headers.append("Set-Cookie", cookieStr("empId", empId));
    res.headers.append("Set-Cookie", cookieStr("role", role));
    res.headers.append("Set-Cookie", cookieStr("team", team));
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_CRASH", detail: String(e?.message || e), marker: "LOGIN_CRASH" },
      { status: 500 }
    );
  }
}
