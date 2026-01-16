// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
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

/**
 * body를 "뭐로 보내든" 최대한 읽어준다:
 * - JSON
 * - text(JSON 문자열)
 * - x-www-form-urlencoded
 * - multipart/form-data
 */
async function readBodyAny(req: NextRequest): Promise<any> {
  // 1) JSON 우선
  try {
    return await req.json();
  } catch {}

  // 2) form-data
  try {
    const fd = await req.formData();
    const obj: any = {};
    fd.forEach((v, k) => (obj[k] = v));
    if (Object.keys(obj).length) return obj;
  } catch {}

  // 3) text / urlencoded
  try {
    const t = await req.text();
    if (!t) return {};
    // JSON string
    try {
      return JSON.parse(t);
    } catch {}
    // x-www-form-urlencoded
    const params = new URLSearchParams(t);
    const obj: any = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  } catch {
    return {};
  }
}

// ✅ 관리자 아이디 목록(요구사항: admin, admin_gs)
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: NextRequest) {
  try {
    const body = await readBodyAny(req);

    // ✅ 여러 키 형태 전부 허용 (프론트가 id/pw로 보내는 것 유지)
    const id = s(
      body?.id ??
        body?.empId ??
        body?.emp_id ??
        body?.user_id ??
        body?.username ??
        body?.loginId
    );
    const pw = s(body?.pw ?? body?.password ?? body?.pass ?? body?.pwd);

    if (!id || !pw) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          detail: {
            gotKeys: Object.keys(body || {}),
            idPreview: id ? id.slice(0, 2) + "***" : "",
            pwLength: pw ? pw.length : 0,
          },
        },
        { status: 400 }
      );
    }

    const sb: any = supabaseAdmin;

    // ✅✅✅ 핵심: accounts는 emp_id로만 조회 (username/user_id 사용 금지)
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error) },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // ✅ 활성 체크
    const isActive =
      data?.is_active === undefined || data?.is_active === null ? true : Boolean(data.is_active);
    if (!isActive) {
      return NextResponse.json({ ok: false, error: "INACTIVE_ACCOUNT" }, { status: 403 });
    }

    // ✅ 비번 검증: password_hash 우선(scrypt), 없으면 password(평문) fallback
    const storedHash = s(data?.password_hash);
    const storedPlain = s(data?.password);

    const ok =
      (storedHash && verifyPasswordHash(pw, storedHash)) ||
      (!!storedPlain && pw === storedPlain);

    if (!ok) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // ✅ role/team
    const role = ADMIN_IDS.has(id) ? "admin" : "user";
    const team = s(data?.team ?? "");

    const res = NextResponse.json({ ok: true, role, empId: id, team });

    // ✅ 쿠키(실서버 https 기준 secure=true)
    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 12, // 12h
    };

    res.cookies.set("empId", id, cookieOpts);
    res.cookies.set("role", role, cookieOpts);
    if (team) res.cookies.set("team", team, cookieOpts);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
