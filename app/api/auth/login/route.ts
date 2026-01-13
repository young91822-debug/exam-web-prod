console.log("ENV URL =", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("ENV KEY prefix =", (process.env.SUPABASE_SERVICE_ROLE_KEY || "").slice(0, 20));

// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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
    const actual = crypto.scryptSync(plain, salt, expected.length);

    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const id = String(body?.id ?? body?.user_id ?? body?.empId ?? body?.emp_id).trim();
    const pw = String(body?.pw ?? body?.password).trim();   

    if (!id || !pw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    const { data: row, error } = await supabaseAdmin
      .from("accounts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", detail: error.message },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const stored = s(row.password_hash ?? row.pw_hash ?? "");
    const ok = verifyPasswordHash(pw, stored);

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: row.id,
        name: row.name ?? null,
        isAdmin: Boolean(row.is_admin),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
