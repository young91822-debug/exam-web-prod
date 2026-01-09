import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * password_hash 생성 (내장 crypto.scrypt 사용)
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64); // keylen 64 bytes
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * GET : 응시자 계정 목록 조회
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, username, emp_id, name, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_SELECT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    const rows = (data || []).map((r: any) => ({
      id: r.id,
      emp_id: r.emp_id ?? r.username ?? "",
      username: r.username ?? "",
      name: r.name ?? null,
      is_active: Boolean(r.is_active),
      created_at: r.created_at,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

/**
 * POST : 응시자 계정 생성
 * - username (NOT NULL) = emp_id
 * - password_hash (NOT NULL) = emp_id로 해시 생성
 * - 초기 비번 정책: "아이디와 동일"
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const empId = s(body.empId);
    const name = body.name ? s(body.name) : null;
    const isActive = Boolean(body.isActive);

    if (!empId) {
      return NextResponse.json(
        { ok: false, error: "EMP_ID_REQUIRED" },
        { status: 400 }
      );
    }

    // username 중복 체크
    const { data: exists, error: existsErr } = await supabaseAdmin
      .from(TABLE)
      .select("id")
      .eq("username", empId)
      .maybeSingle();

    if (existsErr) {
      return NextResponse.json(
        { ok: false, error: "DB_CHECK_FAILED", detail: existsErr.message },
        { status: 500 }
      );
    }
    if (exists) {
      return NextResponse.json(
        { ok: false, error: "USERNAME_ALREADY_EXISTS", detail: empId },
        { status: 409 }
      );
    }

    // ✅ password_hash 필수 채우기 (초기 비번 = empId)
    const passwordHash = makePasswordHash(empId);

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert([
        {
          username: empId,
          emp_id: empId,          // 있으면 같이 저장 (없어도 insert는 실패 안 함)
          name,
          is_active: isActive,
          password_hash: passwordHash, // ✅ NOT NULL 충족
        },
      ])
      .select("id, username, emp_id")
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
      username: data.username,
      emp_id: data.emp_id ?? data.username,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
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

    const id = body.id; // UUID일 수도 있어서 Number로 강제변환하지 않음
    const isActive = Boolean(body.isActive);

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID_REQUIRED" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update({ is_active: isActive })
      .eq("id", id)
      .select("id, username, emp_id, is_active")
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
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
