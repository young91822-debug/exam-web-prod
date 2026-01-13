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

async function readBodyAny(req: Request) {
  try {
    const j = await req.json();
    if (j && Object.keys(j).length) return j;
  } catch {}
  try {
    const t = await req.text();
    if (t) return JSON.parse(t);
  } catch {}
  return {};
}

const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBodyAny(req);

    const id = s(body?.loginId ?? body?.id ?? body?.empId);
    const pw = s(body?.password ?? body?.pw);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("emp_id", id)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    if (!verifyPasswordHash(pw, s((row as any).password_hash))) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const role = s((row as any).role) || (ADMIN_IDS.has(id) ? "admin" : "user");

    const isProd = process.env.NODE_ENV === "production";

    const res = NextResponse.json({ ok: true, empId: id, role });

    const cookieBase = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isProd,   // ✅ 핵심
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    };

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
