// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * stored 포맷: scrypt$<saltB64>$<hashB64>
 */
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
      expected.length === derived.length &&
      crypto.timingSafeEqual(expected, derived)
    );
  } catch {
    return false;
  }
}

/**
 * ✅ 관리자 판별 규칙
 * - DB 계정 username 또는 emp_id가 'admin'으로 시작하면 관리자
 *   (admin, admin_gs, admin_xxx 등)
 */
function isAdminAccount(account: any) {
  const u = String(account?.username ?? "").toLowerCase();
  const e = String(account?.emp_id ?? "").toLowerCase();
  return u.startsWith("admin") || e.startsWith("admin");
}

/**
 * ✅ 쿠키는 NextResponse.cookies.set() 말고
 * ✅ Set-Cookie 헤더를 직접 append 해서 "브라우저에 확실히" 저장되게 한다.
 */
function setLoginCookies(
  res: NextResponse,
  empId: string,
  role: "admin" | "user"
) {
  const isProd = process.env.NODE_ENV === "production";

  const base = [
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
    isProd ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  res.headers.append(
    "Set-Cookie",
    `empId=${encodeURIComponent(empId)}; ${base}`
  );
  res.headers.append("Set-Cookie", `role=${role}; ${base}`);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const loginId = s(body.loginId);
    const password = s(body.password);

    if (!loginId || !password) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CREDENTIALS" },
        { status: 400 }
      );
    }

    // ✅ 1) accounts에서 먼저 찾는다 (관리자도 여기로 통합)
    let account: any = null;

    // username 우선
    {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("id, username, emp_id, team, is_active, password_hash")
        .eq("username", loginId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "DB_QUERY_FAILED",
            detail: String((error as any)?.message ?? error),
          },
          { status: 500 }
        );
      }
      account = data || null;
    }

    // emp_id fallback
    if (!account) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("id, username, emp_id, team, is_active, password_hash")
        .eq("emp_id", loginId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "DB_QUERY_FAILED",
            detail: String((error as any)?.message ?? error),
          },
          { status: 500 }
        );
      }
      account = data || null;
    }

    // ✅ 2) accounts에 없으면 (기존 하드코딩 admin 유지)
    //    - DB에 admin 계정이 아직 없거나 급할 때만 쓰기
    if (!account) {
      if (loginId === "admin" && password === "1234") {
        const res = NextResponse.json({ ok: true, empId: "admin", role: "admin" });
        setLoginCookies(res, "admin", "admin");
        return res;
      }

      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    if (account.is_active === false) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_DISABLED" },
        { status: 403 }
      );
    }

    const ok = verifyPasswordHash(password, account.password_hash);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const empId = account.emp_id || account.username;

    // ✅ 여기서 관리자/사용자 역할 결정
    const role: "admin" | "user" = isAdminAccount(account) ? "admin" : "user";

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      team: account.team ?? null,
      username: account.username ?? null,
    });
    setLoginCookies(res, empId, role);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
