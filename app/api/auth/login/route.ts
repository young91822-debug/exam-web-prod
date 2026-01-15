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

    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * ✅ 어떤 형태로 오든 body 파싱:
 * - application/json
 * - application/x-www-form-urlencoded
 * - multipart/form-data (FormData)
 * - plain text(JSON 문자열)
 */
async function readBodyAny(req: Request): Promise<any> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // 1) multipart/form-data
  if (ct.includes("multipart/form-data")) {
    try {
      const fd = await req.formData();
      const obj: any = {};
      for (const [k, v] of fd.entries()) obj[k] = typeof v === "string" ? v : String(v);
      return obj;
    } catch {
      // fallback below
    }
  }

  // 2) x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    try {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const obj: any = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    } catch {
      // fallback below
    }
  }

  // 3) json
  if (ct.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      // fallback below
    }
  }

  // 4) 마지막: 텍스트로 읽어서 JSON 시도
  try {
    const t = await req.text();
    if (!t) return {};
    try {
      return JSON.parse(t);
    } catch {
      // 혹시 key=value 형태면 이것도 처리
      const params = new URLSearchParams(t);
      if ([...params.keys()].length > 0) {
        const obj: any = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        return obj;
      }
      return {};
    }
  } catch {
    return {};
  }
}

// 관리자 계정
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBodyAny(req);

    // ✅ 프론트가 뭐라고 보내든 최대한 다 받아주기
    const id = s(
      body?.id ??
        body?.empId ??
        body?.emp_id ??
        body?.user_id ??
        body?.username ??
        body?.loginId ??
        body?.login_id
    );
    const pw = s(
      body?.pw ??
        body?.password ??
        body?.pass ??
        body?.passwd ??
        body?.loginPw ??
        body?.login_pw
    );

    if (!id || !pw) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          detail: { gotKeys: Object.keys(body ?? {}) },
        },
        { status: 400 }
      );
    }

    // ✅ password / password_hash 둘 다 조회
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

    const stored = s((row as any).password_hash) || s((row as any).password);
    if (!stored) {
      return NextResponse.json({ ok: false, error: "PASSWORD_NOT_SET" }, { status: 500 });
    }

    if (!verifyPasswordHash(pw, stored)) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const role = ADMIN_IDS.has(id) || s((row as any).role) === "admin" ? "admin" : "user";

    const res = NextResponse.json({ ok: true, empId: id, role });

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
