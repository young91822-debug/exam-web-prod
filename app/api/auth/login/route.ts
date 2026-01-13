// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "accounts";

/** 문자열 정리 helper (1회 정의) */
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

    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** 🔥 Vercel에서도 절대 안 씹히는 바디 파서 */
async function readBodyAny(req: Request) {
  // 1) JSON
  try {
    const j = await req.json();
    if (j && Object.keys(j).length) return j;
  } catch {}

  // 2) text → JSON
  try {
    const t = await req.text();
    if (t) {
      const j = JSON.parse(t);
      if (j && Object.keys(j).length) return j;
    }
  } catch {}

  // 3) formData
  try {
    const fd = await req.formData();
    const obj = Object.fromEntries(fd.entries());
    if (obj && Object.keys(obj).length) return obj;
  } catch {}

  return {};
}

// 관리자 계정
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
    return NextResponse.json(
    { ok: false, error: "HIT_AUTH_LOGIN_ROUTE" },
    { status: 418 }
  );

  try {
    const body = await readBodyAny(req);

    const id = s(
      body?.id ??
      body?.loginId ??
      body?.user_id ??
      body?.empId ??
      body?.emp_id
    );

    const pw = s(
      body?.pw ??
      body?.password ??
      body?.loginPw ??
      body?.passwd
    );

    if (!id || !pw) {
      // 🔥 여기까지 왔는데도 비면 진짜 요청 자체가 문제
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS", debug: body },
        { status: 400 }
      );
    }

    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", detail: String(error.message ?? error) },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const stored = s((row as any)?.password_hash);
    const ok = verifyPasswordHash(pw, stored);

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const roleFromDb = s((row as any)?.role);
    const role = roleFromDb || (ADMIN_IDS.has(id) ? "admin" : "user");

    const res = NextResponse.json({ ok: true, empId: id, role });

    res.cookies.set("empId", id, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    res.cookies.set("role", role, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
