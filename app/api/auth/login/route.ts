// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "accounts";
const sb: any = supabaseAdmin;

// ✅ 관리자 fallback
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

function s(v: any) {
  return String(v ?? "").trim();
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

function cookieStr(name: string, value: string, opt?: { maxAgeSec?: number }) {
  const maxAge = opt?.maxAgeSec ?? 60 * 60 * 24 * 7; // 7일
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

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.user_id ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // emp_id 기준 조회(너 시스템 기준)
    const r = await sb.from(TABLE).select("*").eq("emp_id", id).maybeSingle();
    if (r.error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", detail: String(r.error.message || r.error) }, { status: 500 });
    }
    const row = r.data;
    if (!row) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const isActive = row.is_active === undefined || row.is_active === null ? true : Boolean(row.is_active);
    if (!isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }

    const stored = s(row.password_hash ?? row.password ?? "");
    if (!stored || !verifyPasswordHash(pw, stored)) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const empId = s(row.emp_id) || id;
    const team = s(row.team) || null;

    // ✅ role 결정: DB role 우선 → ADMIN fallback
    let role = s(row.role);
    if (!role) role = ADMIN_IDS.has(empId) || ADMIN_IDS.has(id) ? "admin" : "user";
    if (role !== "admin" && role !== "user") role = "user";

    // ✅ redirect 결정: 관리자는 무조건 /admin
    const redirect = role === "admin" ? "/admin" : "/exam";

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      team,
      isAdmin: role === "admin",
      redirect,
      marker: "LOGIN_OK_V2",
    });

    // ✅ 쿠키 세팅 (middleware/me가 이걸로 판정)
    res.headers.append("Set-Cookie", cookieStr("empId", empId));
    res.headers.append("Set-Cookie", cookieStr("role", role));
    res.headers.append("Set-Cookie", cookieStr("team", team ?? ""));
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_CRASH", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
