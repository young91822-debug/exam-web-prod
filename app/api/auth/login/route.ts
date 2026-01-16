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

async function readBodyAny(req: NextRequest): Promise<any> {
  try { return await req.json(); } catch {}
  try {
    const fd = await req.formData();
    const obj: any = {};
    fd.forEach((v, k) => (obj[k] = v));
    if (Object.keys(obj).length) return obj;
  } catch {}
  try {
    const t = await req.text();
    if (!t) return {};
    try { return JSON.parse(t); } catch {}
    const params = new URLSearchParams(t);
    const obj: any = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  } catch {
    return {};
  }
}

const ADMIN_IDS = new Set(["admin", "admin_gs"]);

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  // https://xxxx.supabase.co -> xxxx
  const m = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] || "(no_url)";
}

export async function POST(req: NextRequest) {
  const projectRef = getProjectRef();

  try {
    const body = await readBodyAny(req);

    const id = s(body?.id ?? body?.emp_id ?? body?.empId ?? body?.username ?? body?.loginId);
    const pw = s(body?.pw ?? body?.password ?? body?.pass ?? body?.pwd);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS", projectRef }, { status: 400 });
    }

    const sb: any = supabaseAdmin;

    // 1) emp_id로 조회
    let matchedBy: "emp_id" | "username" | null = "emp_id";
    let r1 = await sb.from(TABLE).select("*").eq("emp_id", id).maybeSingle();

    if (r1.error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", projectRef, detail: r1.error.message },
        { status: 500 }
      );
    }

    let data = r1.data;

    // 2) 없으면 username으로 조회 (OR 금지!)
    if (!data) {
      matchedBy = "username";
      const r2 = await sb.from(TABLE).select("*").eq("username", id).maybeSingle();

      if (r2.error) {
        return NextResponse.json(
          { ok: false, error: "DB_READ_FAILED", projectRef, detail: r2.error.message },
          { status: 500 }
        );
      }
      data = r2.data;
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", projectRef, detail: { found: false } },
        { status: 401 }
      );
    }

    const isActive = data.is_active === null || data.is_active === undefined ? true : Boolean(data.is_active);
    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "INACTIVE_ACCOUNT", projectRef, detail: { matchedBy } },
        { status: 403 }
      );
    }

    const storedHash = s(data.password_hash);
    const storedPlain = s(data.password);

    const matchHash = storedHash ? verifyPasswordHash(pw, storedHash) : false;
    const matchPlain = storedPlain ? pw === storedPlain : false;

    const ok = matchHash || matchPlain;

    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_CREDENTIALS",
          projectRef,
          detail: {
            matchedBy,
            found: true,
            hasHash: !!storedHash,
            hasPlain: !!storedPlain,
            pwLen: pw.length,
            plainLen: storedPlain.length,
            matchHash,
            matchPlain,
          },
        },
        { status: 401 }
      );
    }

    const role = ADMIN_IDS.has(id) ? "admin" : "user";
    const team = s(data.team);

    const res = NextResponse.json({ ok: true, role, empId: data.emp_id, team, projectRef });

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 12,
    };

    res.cookies.set("empId", data.emp_id, cookieOpts);
    res.cookies.set("role", role, cookieOpts);
    if (team) res.cookies.set("team", team, cookieOpts);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", projectRef, detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
