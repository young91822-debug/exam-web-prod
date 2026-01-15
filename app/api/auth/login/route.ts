// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;
const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
function verifyPasswordHash(plain: string, stored: string) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3) return false;

    const [algo, saltB64, hashB64] = parts;
    if (algo !== "scrypt") return false;

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

// 관리자 계정(필요한 것만)
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.user_id ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ✅ password / password_hash 둘 다 select
    const { data: row, error } = await sb
      .from(TABLE)
      .select("emp_id, name, role, is_active, password, password_hash")
      .eq("emp_id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    if (row.is_active === false) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }

    // ✅ 핵심: stored 비번을 password_hash 우선, 없으면 password
    const stored = s((row as any).password_hash) || s((row as any).password);
    if (!stored) {
      return NextResponse.json(
        { ok: false, error: "PASSWORD_NOT_SET" },
        { status: 500 }
      );
    }

    const ok = verifyPasswordHash(pw, stored);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // role 결정
    const role = ADMIN_IDS.has(id) || s((row as any).role) === "admin" ? "admin" : "user";

    // ✅ 쿠키 세팅 (NextResponse)
    const res = NextResponse.json({ ok: true, empId: id, role });

    // httpOnly로 안전하게
    res.cookies.set("empId", id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 60 * 60 * 24 * 7,
    });
    res.cookies.set("role", role, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
