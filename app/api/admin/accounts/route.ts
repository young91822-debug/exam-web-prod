import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * password_hash 생성
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * GET : 응시자 계정 목록
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, emp_id, name, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_SELECT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST : 계정 생성
 * - emp_id 기준
 * - 초기 비밀번호 = emp_id
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const empId = s(body.empId);
    const name = body.name ? s(body.name) : null;
    const isActive = body.isActive !== false;

    if (!empId) {
      return NextResponse.json(
        { ok: false, error: "EMP_ID_REQUIRED" },
        { status: 400 }
      );
    }

    // emp_id 중복 체크
    const { data: exists, error: existsErr } = await supabaseAdmin
      .from(TABLE)
      .select("id")
      .eq("emp_id", empId)
      .maybeSingle();

    if (existsErr) {
      return NextResponse.json(
        { ok: false, error: "DB_CHECK_FAILED", detail: existsErr.message },
        { status: 500 }
      );
    }
    if (exists) {
      return NextResponse.json(
        { ok: false, error: "EMP_ID_ALREADY_EXISTS", detail: empId },
        { status: 409 }
      );
    }

    const passwordHash = makePasswordHash(empId);

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert([
        {
          emp_id: empId,
          name,
          is_active: isActive,
          password_hash: passwordHash,
        },
      ])
      .select("id, emp_id")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      id: data.id,
      emp_id: data.emp_id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e) },
      { status: 500 }
    );
  }
}

/**
 * PATCH : 사용 여부 토글
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID_REQUIRED" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update({ is_active: !!isActive })
      .eq("id", id)
      .select("id, emp_id, is_active")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_UPDATE_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e) },
      { status: 500 }
    );
  }
}
