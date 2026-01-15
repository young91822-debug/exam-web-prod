// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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

/**
 * 바디를 JSON/text 어떤 형태로 오든 최대한 안전하게 파싱
 */
async function readBodyAny(req: Request) {
  // 1) JSON
  try {
    const j = await req.json();
    if (j && typeof j === "object" && Object.keys(j).length) return j;
  } catch {}

  // 2) text -> JSON
  try {
    const t = await req.text();
    if (t) return JSON.parse(t);
  } catch {}

  return {} as any;
}

// ✅ 관리자 아이디는 emp_id 기준으로 판별
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBodyAny(req);

    // ✅ 프론트에서 어떤 키로 보내도 받아주기
    const id = s(body?.loginId ?? body?.id ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.password ?? body?.pw ?? body?.pass);

    if (!id || !pw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // ✅ accounts 조회 (스키마 흔들려도 최대한 안전하게)
    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    // ✅ (선택) is_active가 있을 때만 체크 — 없으면 그냥 통과
    //  - supabase가 컬럼 없으면 row.is_active가 undefined
    if ((row as any).is_active === false) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_INACTIVE" },
        { status: 403 }
      );
    }

    // ✅ 비밀번호 검증: password_hash(scrypt) 우선
    const storedHash = s((row as any).password_hash);

    let ok = false;

    if (storedHash) {
      ok = verifyPasswordHash(pw, storedHash);
    }

    // ✅ (레거시/임시 대응) 혹시 password 컬럼(평문/임시비번)이 남아있으면 허용
    // - 운영 안정화되면 이 블록은 지우는 걸 추천
    if (!ok) {
      const legacyPlain = s((row as any).password);
      if (legacyPlain && pw === legacyPlain) ok = true;
    }

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    // ✅ role 결정
    const role = ADMIN_IDS.has(id) ? "admin" : s((row as any).role) || "user";

    const isProd = process.env.NODE_ENV === "production";

    const res = NextResponse.json({ ok: true, empId: id, role });

    const cookieBase = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isProd, // ✅ Vercel/https에서만 true
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7일
    };

    // ✅ middleware.ts에서 읽는 키(empId/role)와 반드시 일치
    res.cookies.set("empId", id, cookieBase);
    res.cookies.set("role", role, cookieBase);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
