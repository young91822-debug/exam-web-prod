// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "accounts";

// 관리자 아이디 목록(원하면 추가)
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

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

    // timing safe compare
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const id = s(body?.id ?? body?.user_id ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // 계정 조회
    const { data: row, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", detail: String(error.message ?? error) },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    // 활성 컬럼 있으면 체크(없어도 터지지 않게)
    const isActive =
      row?.is_active === undefined || row?.is_active === null
        ? true
        : Boolean(row.is_active);

    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_INACTIVE" },
        { status: 403 }
      );
    }

    const stored = s(row?.password_hash ?? row?.pw_hash ?? row?.password);
    const ok = verifyPasswordHash(pw, stored);

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    const isAdmin =
      Boolean(row?.is_admin) ||
      Boolean(row?.admin) ||
      ADMIN_IDS.has(String(row?.id ?? id));

    // ✅ 응답(쿠키/세션은 지금 구조에 맞춰 필요하면 추가)
    return NextResponse.json(
      {
        ok: true,
        user: {
          id: String(row?.id ?? id),
          name: row?.name ?? null,
          isAdmin,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
