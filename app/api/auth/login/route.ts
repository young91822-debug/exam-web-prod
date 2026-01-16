// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const TABLE = "accounts";
const MARKER = "LOGIN_EMP_ID_ONLY_v2026-01-16_01";

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

async function readBodyAny(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {}

  try {
    const fd = await req.formData();
    const obj: any = {};
    fd.forEach((v, k) => (obj[k] = v));
    if (Object.keys(obj).length) return obj;
  } catch {}

  try {
    const t = await req.text();
    if (!t) return {};
    try {
      return JSON.parse(t);
    } catch {}
    const params = new URLSearchParams(t);
    const obj: any = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  } catch {
    return {};
  }
}

const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: NextRequest) {
  try {
    const body = await readBodyAny(req);

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
        { ok: false, error: "MISSING_FIELDS", marker: MARKER },
        { status: 400 }
      );
    }

    const sb: any = supabaseAdmin;

    // ✅✅✅ accounts는 emp_id로만 조회
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", detail: String(error?.message ?? error), marker: MARKER },
        { status: 500 }
      );
    }

    if (!data) {
      // ✅ 반영 확인용(민감정보 없음)
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", marker: MARKER, detail: { found: false } },
        { status: 401 }
      );
    }

    const isActive =
      data?.is_active === undefined || data?.is_active === null ? true : Boolean(data.is_active);
    if (!isActive) {
      return NextResponse.json({ ok: false, error: "INACTIVE_ACCOUNT", marker: MARKER }, { status: 403 });
    }

    const storedHash = s(data?.password_hash);
    const storedPlain = s(data?.password);

    const ok =
      (storedHash && verifyPasswordHash(pw, storedHash)) ||
      (!!storedPlain && pw === storedPlain);

    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_CREDENTIALS",
          marker: MARKER,
          detail: { found: true, hasHash: !!storedHash, hasPlain: !!storedPlain, pwLen: pw.length },
        },
        { status: 401 }
      );
    }

    const role = ADMIN_IDS.has(id) ? "admin" : "user";
    const team = s(data?.team ?? "");

    const res = NextResponse.json({ ok: true, role, empId: id, team, marker: MARKER });

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 12,
    };

    res.cookies.set("empId", id, cookieOpts);
    res.cookies.set("role", role, cookieOpts);
    if (team) res.cookies.set("team", team, cookieOpts);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e), marker: MARKER },
      { status: 500 }
    );
  }
}
