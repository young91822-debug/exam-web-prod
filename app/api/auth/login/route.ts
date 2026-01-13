// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/** DB에 이상하게 들어간 해시 정규화: <scrypt$...> / "scrypt$..." 같은거 제거 */
function normalizeHash(raw: any) {
  let h = String(raw ?? "").trim();

  // 앞뒤 < >, 따옴표 제거
  h = h.replace(/^[<"'`\s]+/, "").replace(/[>"'`\s]+$/, "");

  // 중간에 scrypt$가 있으면 그 위치부터 잘라오기 (앞에 이상한 접두어가 붙는 케이스 방어)
  const idx = h.indexOf("scrypt$");
  if (idx >= 0) h = h.slice(idx);

  return h;
}

/**
 * stored 포맷: scrypt$<saltB64>$<hashB64>
 */
function verifyPasswordHash(plain: string, storedRaw: string) {
  try {
    const stored = normalizeHash(storedRaw);
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
 */
function isAdminAccount(account: any) {
  const u = String(account?.username ?? "").toLowerCase();
  const e = String(account?.emp_id ?? "").toLowerCase();
  return u.startsWith("admin") || e.startsWith("admin");
}

/**
 * ✅ 쿠키 Set-Cookie 헤더 append
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

    // ✅ 프론트 키가 뭐든 다 받기
    const loginId = s(
      body.loginId ?? body.username ?? body.userId ?? body.empId ?? body.id
    );
    const password = s(body.password ?? body.pw ?? body.pass ?? body.pwd);

    if (!loginId || !password) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CREDENTIALS" },
        { status: 400 }
      );
    }

    // ✅ 1) accounts에서 먼저 찾는다
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

    // ✅ (핵심) admin/1234는 account가 있어도/없어도 무조건 통과
    if (loginId.toLowerCase() === "admin" && password === "1234") {
      const res = NextResponse.json({
        ok: true,
        empId: "admin",
        role: "admin",
        bypass: "admin_1234",
      });
      setLoginCookies(res, "admin", "admin");
      return res;
    }

    // accounts에 없으면 실패
    if (!account) {
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

    // ✅ 해시 정규화 + 검증
    const storedNorm = normalizeHash(account.password_hash);
    if (!storedNorm.startsWith("scrypt$")) {
      return NextResponse.json(
        {
          ok: false,
          error: "PASSWORD_HASH_FORMAT_UNSUPPORTED",
          detail: {
            expected: "scrypt$<saltB64>$<hashB64>",
            gotPrefix: String(account.password_hash ?? "").slice(0, 40),
            normalizedPrefix: storedNorm.slice(0, 40),
          },
        },
        { status: 401 }
      );
    }

    const ok = verifyPasswordHash(password, storedNorm);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const empId = account.emp_id || account.username;
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
