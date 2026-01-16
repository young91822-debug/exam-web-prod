// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "accounts";
const sb: any = supabaseAdmin;

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

/** stored: scrypt$<saltB64>$<hashB64> */
function parseScrypt(stored: string) {
  const raw = s(stored);
  const parts = raw.split("$");
  if (parts.length !== 3) return null;
  const [algo, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return null;
  return { algo, saltB64, hashB64 };
}

function verifyScrypt(plain: string, stored: string) {
  try {
    const p = parseScrypt(stored);
    if (!p) return { ok: false, reason: "BAD_FORMAT" as const };

    const salt = Buffer.from(p.saltB64, "base64");
    const expected = Buffer.from(p.hashB64, "base64");
    if (!salt.length || !expected.length) return { ok: false, reason: "BAD_B64" as const };

    const derived = crypto.scryptSync(plain, salt, expected.length);

    const equal =
      derived.length === expected.length &&
      crypto.timingSafeEqual(derived, expected);

    return {
      ok: equal,
      reason: equal ? ("OK" as const) : ("MISMATCH" as const),
      debug: {
        expectedLen: expected.length,
        derivedLen: derived.length,
        dollarCnt: (s(stored).match(/\$/g) || []).length,
        headExpected: expected.toString("base64").slice(0, 12),
        headDerived: derived.toString("base64").slice(0, 12),
        saltHead: salt.toString("base64").slice(0, 12),
      },
    };
  } catch (e: any) {
    return { ok: false, reason: "CRASH" as const, detail: String(e?.message || e) };
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.username ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS", marker: "LOGIN_MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // emp_id 우선
    let r = await sb.from(TABLE).select("*").eq("emp_id", id).maybeSingle();
    if (r.error) throw r.error;

    let matchedBy = "emp_id";
    let row = r.data;

    // username fallback
    if (!row) {
      matchedBy = "username";
      const r2 = await sb.from(TABLE).select("*").eq("username", id).maybeSingle();
      if (r2.error) throw r2.error;
      row = r2.data;
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_NO_ACCOUNT", matchedBy },
        { status: 401 }
      );
    }

    const isActive =
      row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active);
    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_DISABLED", marker: "LOGIN_DISABLED" },
        { status: 403 }
      );
    }

    const storedHash = s(row.password_hash);
    const storedPlain = s(row.password);

    // ✅ hash 우선
    if (storedHash && storedHash.startsWith("scrypt$")) {
      const v = verifyScrypt(pw, storedHash);
      if (!v.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "INVALID_CREDENTIALS",
            marker: "LOGIN_BAD_PASSWORD",
            matchedBy,
            verify: v, // ✅ 여기 디버그가 핵심
          },
          { status: 401 }
        );
      }
    } else if (storedPlain) {
      if (pw !== storedPlain) {
        return NextResponse.json(
          { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_BAD_PASSWORD_PLAIN", matchedBy },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_NO_PASSWORD", matchedBy },
        { status: 401 }
      );
    }

    const empId = s(row.emp_id || id);
    const role = s(row.role) || (empId === "admin" || empId === "admin_gs" ? "admin" : "user");
    const team = s(row.team) || null;

    return NextResponse.json({
      ok: true,
      empId,
      role,
      team,
      isAdmin: role === "admin",
      matchedBy,
      marker: "LOGIN_OK_DEBUG",
      redirect: role === "admin" ? "/admin" : "/exam",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_CRASH", marker: "LOGIN_CRASH", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
