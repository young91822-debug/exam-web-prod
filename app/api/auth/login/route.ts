// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "accounts";

// ✅ 문자열 정리 helper (딱 1번만!)
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
    // timing-safe compare
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function readBody(req: Request) {
  // ✅ Vercel/프록시 환경에서 body 파싱 꼬일 때 대비
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

// ✅ 관리자 판별 (원하면 추가 가능)
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const id = s(
  body?.id ??
  body?.loginId ??          // ✅ 추가
  body?.user_id ??
  body?.empId ??
  body?.emp_id
);

const pw = s(
  body?.pw ??
  body?.password ??         // ✅ 이미 OK
  body?.passwd ??
  body?.loginPw
);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const stored = s((row as any)?.password_hash);
    const ok = verifyPasswordHash(pw, stored);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // role은 DB 컬럼이 있으면 그걸 우선, 없으면 ADMIN_IDS로 판별
    const roleFromDb = s((row as any)?.role);
    const role = roleFromDb || (ADMIN_IDS.has(id) ? "admin" : "user");

    const res = NextResponse.json({ ok: true, empId: id, role });

    // ✅ 쿠키 세팅 (middleware.ts가 이 쿠키를 읽는 구조였지)
    res.cookies.set("empId", id, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7일
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
