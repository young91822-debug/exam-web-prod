// app/api/admin/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;
const TABLE = "accounts";

/* ---------------- helpers ---------------- */

function s(v: any) {
  return String(v ?? "").trim();
}
function toBool(v: any, d: boolean | null = null) {
  if (v === undefined || v === null || v === "") return d;
  if (typeof v === "boolean") return v;
  const t = String(v).toLowerCase().trim();
  if (["1", "true", "y", "yes", "사용", "use", "on"].includes(t)) return true;
  if (["0", "false", "n", "no", "미사용", "off"].includes(t)) return false;
  return d;
}

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** 요청 body 안전 파싱 */
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

/** "column ... does not exist" 류 판단 */
function isMissingColumnErr(err: any) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("does not exist") && msg.includes("column");
}

/**
 * owner_admin 컬럼이 없는 DB에서도 동작하게:
 * - 먼저 owner_admin 포함 select/insert 시도
 * - 없다고 나오면 자동으로 owner_admin 제거해서 재시도
 */

/* ---------------- GET ---------------- */
/** 목록 */
export async function GET(req: NextRequest) {
  try {
    // ✅ (선택) 관리자 empId를 쿠키에서 읽어둠 - 나중에 분리 시 사용 가능
    const adminEmpId = s(req.cookies.get("empId")?.value);

    // 1) owner_admin 포함해서 먼저 시도
    let q1 = sb
      .from(TABLE)
      .select(
        "id, emp_id, name, is_active, created_at, role, owner_admin",
        { count: "exact" }
      )
      .order("id", { ascending: false });

    // ✅ 나중에 “내가 만든 계정만” 보이게 하고 싶으면 여기서 필터 걸면 됨
    // q1 = q1.eq("owner_admin", adminEmpId);

    let { data, error } = await q1;

    // 2) owner_admin 컬럼이 없으면 fallback
    if (error && isMissingColumnErr(error)) {
      const q2 = sb
        .from(TABLE)
        .select("id, emp_id, name, is_active, created_at, role", { count: "exact" })
        .order("id", { ascending: false });

      const r2 = await q2;
      data = r2.data;
      error = r2.error;
    }

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(error?.message ?? error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

/* ---------------- POST ---------------- */
/** 생성 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);

    const emp_id = s(body?.empId ?? body?.emp_id);
    const name = s(body?.name);
    const is_active = toBool(body?.isActive ?? body?.is_active, true) ?? true;

    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

    // ✅ 기본 비번: 1234 (필요하면 바꿔)
    const tempPassword = "1234";
    const password_hash = makePasswordHash(tempPassword);

    // ✅ 쿠키에서 현재 관리자 empId 읽음 (있으면 owner_admin으로 저장 시도)
    const adminEmpId = s(req.cookies.get("empId")?.value);

    const baseRow: any = {
      emp_id,
      name: name || null,
      is_active,
      role: "user",
      password: password_hash, // 네 DB가 password 컬럼이면 이거
      // password_hash: password_hash, // 네 DB가 password_hash 컬럼이면 이걸로 바꿔야 함
    };

    // 1) owner_admin 포함 insert 시도
    const rowWithOwner = adminEmpId ? { ...baseRow, owner_admin: adminEmpId } : baseRow;

    let ins = await sb.from(TABLE).insert(rowWithOwner).select("*").single();

    // 2) owner_admin 없다고 나오면 제거하고 재시도
    if (ins.error && isMissingColumnErr(ins.error)) {
      const { owner_admin, ...rowNoOwner } = rowWithOwner;
      ins = await sb.from(TABLE).insert(rowNoOwner).select("*").single();
    }

    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: String(ins.error?.message ?? ins.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      item: ins.data,
      mode: "CREATED",
      tempPassword,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

/* ---------------- PATCH ---------------- */
/** 활성/이름 수정 (필요한 것만) */
export async function PATCH(req: NextRequest) {
  try {
    const body = await readBody(req);

    const id = body?.id;
    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const patch: any = {};
    if (body?.name !== undefined) patch.name = s(body.name) || null;
    if (body?.is_active !== undefined || body?.isActive !== undefined) {
      patch.is_active = toBool(body?.is_active ?? body?.isActive, null);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });
    }

    const up = await sb.from(TABLE).update(patch).eq("id", id).select("*");
    if (up.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up.error?.message ?? up.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: up.data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
