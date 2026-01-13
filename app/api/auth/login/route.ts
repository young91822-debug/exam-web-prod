// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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
    if (parts.length !== 3) return { ok: false, reason: "FORMAT_NOT_3PARTS" };
    const [algo, saltB64, hashB64] = parts;
    if (algo !== "scrypt") return { ok: false, reason: "ALGO_NOT_SCRYPT" };

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = crypto.scryptSync(plain, salt, expected.length);

    const same =
      expected.length === derived.length && crypto.timingSafeEqual(expected, derived);

    return { ok: same, reason: same ? "MATCH" : "MISMATCH" };
  } catch (e: any) {
    return { ok: false, reason: `EXCEPTION:${String(e?.message ?? e)}` };
  }
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

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.username ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ✅ username / emp_id 둘 다로 찾기
    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, username, emp_id, role, team, is_active, password_hash")
      .or(`username.eq.${id},emp_id.eq.${id}`)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String((error as any)?.message ?? error) },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_CREDENTIALS",
          debug: { found: false, lookup: "username OR emp_id", id },
        },
        { status: 401 }
      );
    }

    if (row.is_active === false) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_DISABLED", debug: { id, username: row.username, emp_id: row.emp_id } },
        { status: 403 }
      );
    }

    const stored = String((row as any).password_hash ?? "");
    const looksScrypt = stored.startsWith("scrypt$");
    const v = verifyPasswordHash(pw, stored);

    if (!v.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_CREDENTIALS",
          debug: {
            found: true,
            id,
            username: row.username,
            emp_id: row.emp_id,
            is_active: row.is_active,
            looksScrypt,
            verifyReason: v.reason,
            // ⚠️ 해시 원문은 절대 노출 안함
            hashPrefix: stored ? stored.slice(0, 20) : "",
          },
        },
        { status: 401 }
      );
    }

    // ✅ 로그인 성공: 쿠키 세팅
    const res = NextResponse.json({
      ok: true,
      empId: row.emp_id ?? row.username ?? id,
      role: row.role ?? "user",
      team: row.team ?? "A",
      marker: "LOGIN_OK_DEBUG_SAFE",
    });

    // 쿠키 (7일)
    const maxAge = 60 * 60 * 24 * 7;
    res.cookies.set("empId", String(row.emp_id ?? row.username ?? id), { path: "/", maxAge });
    res.cookies.set("role", String(row.role ?? "user"), { path: "/", maxAge });
    res.cookies.set("team", String(row.team ?? "A"), { path: "/", maxAge });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
