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
function verifyScryptHash(plain: string, stored: string) {
  try {
    const [algo, saltB64, hashB64] = String(stored || "").split("$");
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

function makeScryptHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
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

function setCookie(res: any, name: string, value: string, maxAgeSec = 60 * 60 * 24 * 7) {
  // Vercel/https 환경 고려: SameSite=Lax, Secure
  const v = encodeURIComponent(value);
  res.headers.append(
    "Set-Cookie",
    `${name}=${v}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax; Secure`
  );
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    // 프론트가 id/pw 또는 empId/password 등으로 보낼 수 있어서 다 수용
    const id = s(body?.id ?? body?.empId ?? body?.emp_id ?? body?.user_id ?? body?.userId);
    const pw = s(body?.pw ?? body?.password ?? body?.pass);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // 1) 계정 조회: emp_id 우선, 없으면 user_id로도 시도
    let row: any = null;

    const q1 = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (q1.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_QUERY_FAILED", detail: q1.error },
        { status: 500 }
      );
    }
    row = q1.data;

    if (!row) {
      const q2 = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("user_id", id)
        .maybeSingle();

      if (q2.error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_QUERY_FAILED", detail: q2.error },
          { status: 500 }
        );
      }
      row = q2.data;
    }

    if (!row) {
      // ✅ 여기서 INVALID_CREDENTIALS 대신 명확히
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 401 });
    }

    // 2) 활성여부(컬럼명이 여러 버전일 수 있어서 유연하게)
    const isActive =
      row?.is_active ?? row?.active ?? row?.enabled ?? true;

    if (isActive === false) {
      return NextResponse.json({ ok: false, error: "USER_INACTIVE" }, { status: 401 });
    }

    // 3) 저장된 비번 찾기 (여러 컬럼 후보)
    const stored =
      s(row?.password_hash) ||
      s(row?.password) ||
      s(row?.pw_hash) ||
      s(row?.pw) ||
      "";

    if (!stored) {
      return NextResponse.json({ ok: false, error: "PASSWORD_NOT_SET" }, { status: 401 });
    }

    // 4) 검증 로직
    // - scrypt$...면 해시검증
    // - 아니면 "평문/레거시"로 보고 직접 비교
    let ok = false;
    let needsUpgrade = false;

    if (stored.startsWith("scrypt$")) {
      ok = verifyScryptHash(pw, stored);
    } else {
      // ✅ 레거시/평문 호환
      ok = crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(stored));
      if (ok) needsUpgrade = true;
    }

    if (!ok) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // 5) 레거시면 자동 업그레이드(가능한 컬럼에 해시로 저장)
    if (needsUpgrade) {
      const newHash = makeScryptHash(pw);

      // 업데이트 시도: password_hash가 있으면 거기, 아니면 password에 저장
      // (컬럼이 없으면 실패할 수 있으니 실패해도 로그인은 통과시키고 넘어감)
      const patch: any = {};
      if (row?.password_hash !== undefined) patch.password_hash = newHash;
      else if (row?.password !== undefined) patch.password = newHash;
      else patch.password = newHash;

      if (Object.keys(patch).length) {
        await supabaseAdmin.from(TABLE).update(patch).eq("id", row.id);
      }
    }

    // 6) role 결정 (없으면 admin_gs/admin은 admin으로 강제)
    const empId = s(row?.emp_id ?? row?.user_id ?? id);
    let role = s(row?.role) || "user";
    if (empId === "admin" || empId === "admin_gs") role = "admin";

    const res = NextResponse.json({
      ok: true,
      empId,
      role,
      name: s(row?.name),
      redirect: role === "admin" ? "/admin" : "/exam",
    });

    setCookie(res, "empId", empId);
    setCookie(res, "role", role);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
