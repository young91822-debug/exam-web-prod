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
  if (!saltB64 || !hashB64) return null;
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
      derived.length === expected.length && crypto.timingSafeEqual(derived, expected);

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

/** 쿠키 세팅 헬퍼 */
function setAuthCookies(res: NextResponse, empId: string, role: string, team: string | null) {
  const secure = process.env.NODE_ENV === "production";

  // ✅ middleware / 서버 컴포넌트에서 안정적으로 쓰려면 httpOnly=true가 정상
  // (client에서 JS로 읽을 필요 없음)
  res.cookies.set("empId", empId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7d
  });

  res.cookies.set("role", role, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  if (team) {
    res.cookies.set("team", team, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  } else {
    res.cookies.delete("team");
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    // 프론트에서 {id, pw} / {username, password} 등 어떤 조합이 와도 처리
    const id = s(body?.id ?? body?.username ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);
    const next = s(body?.next);

    if (!id || !pw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS", marker: "LOGIN_MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // 1) emp_id 우선 조회
    let r = await sb.from(TABLE).select("*").eq("emp_id", id).maybeSingle();
    if (r.error) throw r.error;

    let matchedBy: "emp_id" | "username" = "emp_id";
    let row = r.data;

    // 2) username fallback
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

    // 활성 체크
    const isActive =
      row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active);
    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_DISABLED", marker: "LOGIN_DISABLED" },
        { status: 403 }
      );
    }

    // 비밀번호 검증
    const storedHash = s(row.password_hash);
    const storedPlain = row.password ? String(row.password) : "";
 // (있으면) 구버전 평문

    if (storedHash && storedHash.startsWith("scrypt$")) {
  const v = verifyScrypt(pw, storedHash);
  if (!v.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_CREDENTIALS",
        marker: "LOGIN_BAD_PASSWORD",
        matchedBy,
        verify: v,
      },
      { status: 401 }
    );
  }
}
// 👇 이 분기는 진짜 legacy 계정만
else if (storedPlain.length > 0) {
  if (pw !== storedPlain) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_CREDENTIALS",
        marker: "LOGIN_BAD_PASSWORD_PLAIN",
        matchedBy,
      },
      { status: 401 }
    );
  }
}
else {
  return NextResponse.json(
    {
      ok: false,
      error: "INVALID_CREDENTIALS",
      marker: "LOGIN_NO_PASSWORD",
      matchedBy,
    },
    { status: 401 }
  );
}

    // ✅ 여기서부터: 관리자 판별 (id/username 둘 다 체크)
    const empId = s(row.emp_id || id);
    const username = s(row.username);
    const team = s(row.team) || null;

    const isAdminId =
      empId === "admin" ||
      empId === "admin_gs" ||
      username === "admin" ||
      username === "admin_gs";

    const dbRole = s(row.role);
    const role = isAdminId ? "admin" : (dbRole || "user");

    // ✅ next 우선, 없으면 role 기준
    const redirect = next || (role === "admin" ? "/admin" : "/exam");

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      team,
      isAdmin: role === "admin", // ✅ 여기 따옴표/문법 오류 수정
      matchedBy,
      marker: "LOGIN_OK",
      redirect,
    });

    setAuthCookies(res, empId, role, team);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_CRASH", marker: "LOGIN_CRASH", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
