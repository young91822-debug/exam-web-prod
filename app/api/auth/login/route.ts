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
  return { saltB64, hashB64 };
}

function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
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

    return { ok: equal, reason: equal ? ("OK" as const) : ("MISMATCH" as const) };
  } catch (e: any) {
    return { ok: false, reason: "CRASH" as const, detail: String(e?.message || e) };
  }
}

/** 쿠키 세팅 헬퍼 */
function setAuthCookies(res: NextResponse, empId: string, role: string, team: string | null) {
  const secure = process.env.NODE_ENV === "production";

  res.cookies.set("empId", empId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
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

/** ✅ password_hash / password 둘 다에서 "실제 저장값"을 찾아옴 */
function pickStoredPassword(row: any) {
  const a = s(row?.password_hash);
  const b = s(row?.password);
  // 우선순위: password_hash → password
  return a || b;
}

/** ✅ 저장값이 scrypt인지 판별 */
function isScryptStored(stored: string) {
  return s(stored).startsWith("scrypt$") && !!parseScrypt(stored);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

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

    // ✅ 비밀번호 검증 (중요: password_hash / password 둘 다 지원)
    const stored = pickStoredPassword(row);

    if (!stored) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_NO_PASSWORD", matchedBy },
        { status: 401 }
      );
    }

    if (isScryptStored(stored)) {
      const v = verifyScrypt(pw, stored);
      if (!v.ok) {
        return NextResponse.json(
          { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_BAD_PASSWORD_SCRYPT", matchedBy, verify: v },
          { status: 401 }
        );
      }
    } else {
      // ✅ legacy 평문 계정: 맞으면 통과 + 즉시 scrypt로 업그레이드
      if (pw !== stored) {
        return NextResponse.json(
          { ok: false, error: "INVALID_CREDENTIALS", marker: "LOGIN_BAD_PASSWORD_PLAIN", matchedBy },
          { status: 401 }
        );
      }

      const upgraded = makePasswordHash(pw);

      // password_hash 컬럼이 있으면 거기에, 없으면 password에 저장
      // (둘 다 있는 스키마도 고려해서 둘 다 갱신해도 됨)
      const patch: any = {};
      if (row.password_hash !== undefined && row.password_hash !== null) patch.password_hash = upgraded;
      else patch.password = upgraded;

      // 둘 다 존재하면 둘 다 넣어주자(안전)
      if (row.password_hash !== undefined) patch.password_hash = upgraded;
      if (row.password !== undefined) patch.password = upgraded;

      await sb.from(TABLE).update(patch).eq("id", row.id);
    }

    // ✅ 관리자 판별
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

    const redirect = next || (role === "admin" ? "/admin" : "/exam");

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      team,
      isAdmin: role === "admin",
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
