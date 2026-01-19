// app/api/admin/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs"; // ✅ crypto 사용 안정화 (Vercel Edge 방지)
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

/** stored 포맷: scrypt$<saltB64>$<hashB64> (✅ 로그인 API와 동일 포맷) */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
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

/** 중복(유니크 위반) 판단 */
function isUniqueViolation(err: any) {
  // Postgres unique_violation = 23505
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return code === "23505" || msg.includes("duplicate key value") || msg.includes("unique constraint");
}

/** ✅ 관리자 스코프: empId 쿠키가 곧 owner_admin */
function getAdminEmpId(req: NextRequest) {
  const empId = s(req.cookies.get("empId")?.value || req.cookies.get("emp_id")?.value);
  const role = s(req.cookies.get("role")?.value);
  if (!empId) return { ok: false as const, error: "UNAUTHORIZED" };
  // 필요하면 role 강제
  // if (role !== "admin") return { ok: false as const, error: "FORBIDDEN" };
  return { ok: true as const, empId, role };
}

/* ---------------- GET ---------------- */
/** ✅ 목록: 내(owner_admin=empId) 것만 */
export async function GET(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });
  }

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("id, emp_id, name, is_active, created_at, role, owner_admin, team")
      .eq("owner_admin", scope.empId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(error?.message ?? error) },
        { status: 500 }
      );
    }

    // 프론트 호환: items로 내려줌
    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

/* ---------------- POST ---------------- */
/**
 * ✅ 생성(혹은 내 소유 계정이면 업데이트)
 * - emp_id 중복인데 owner_admin이 다르면: 403 (수정/생성 금지)
 * - emp_id 중복인데 owner_admin이 나면: 업데이트 + 비번 1234로 리셋
 */
export async function POST(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });
  }

  try {
    const body = await readBody(req);

    const emp_id = s(body?.empId ?? body?.emp_id);
    const name = s(body?.name);
    const is_active = toBool(body?.isActive ?? body?.is_active, true) ?? true;

    const role = s(body?.role) || "user";
    const allowedRole = ["user", "admin"].includes(role) ? role : "user";

    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

    // ✅ 임시 비번 (원하면 여기만 바꾸면 됨)
    const tempPassword = "1234";
    const password_hash = makePasswordHash(tempPassword);

    // 0) emp_id 존재 여부 + 소유자 확인 (✅ 핵심: 다른 owner_admin이면 차단)
    const existing = await sb
      .from(TABLE)
      .select("id, emp_id, owner_admin")
      .eq("emp_id", emp_id)
      .maybeSingle();

    if (existing?.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(existing.error?.message ?? existing.error) },
        { status: 500 }
      );
    }

    if (existing?.data) {
      const owner = s(existing.data.owner_admin);
      if (owner && owner !== scope.empId) {
        // ✅ 다른 관리자가 만든 emp_id는 수정/생성 금지
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN_OTHER_OWNER", detail: `owner_admin=${owner}` },
          { status: 403 }
        );
      }

      // ✅ 내 소유(or owner_admin 비어있으면) → 업데이트 + 비번 리셋
      const patch: any = {
        name: name || null,
        is_active,
        role: allowedRole,
        password_hash,
        owner_admin: scope.empId, // 비어있던 데이터도 내 소유로 정리
      };

      const up = await sb.from(TABLE).update(patch).eq("emp_id", emp_id).select("*").single();

      if (up.error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up.error?.message ?? up.error) },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        item: up.data,
        mode: "UPDATED_EXISTING",
        tempPassword,
      });
    }

    // 1) 신규 insert (✅ owner_admin 강제 + password_hash만 사용)
    const row: any = {
      emp_id,
      name: name || null,
      is_active,
      role: allowedRole,
      password_hash,
      owner_admin: scope.empId,
    };

    const ins = await sb.from(TABLE).insert(row).select("*").single();

    if (ins.error) {
      // 혹시 레이스로 중복이 터지면 위 로직처럼 다시 확인해서 차단/업데이트
      if (isUniqueViolation(ins.error)) {
        // 다시 조회 후 owner 확인
        const ex2 = await sb
          .from(TABLE)
          .select("id, emp_id, owner_admin")
          .eq("emp_id", emp_id)
          .maybeSingle();

        const owner2 = s(ex2?.data?.owner_admin);
        if (owner2 && owner2 !== scope.empId) {
          return NextResponse.json(
            { ok: false, error: "FORBIDDEN_OTHER_OWNER", detail: `owner_admin=${owner2}` },
            { status: 403 }
          );
        }

        const up2 = await sb
          .from(TABLE)
          .update({
            name: name || null,
            is_active,
            role: allowedRole,
            password_hash,
            owner_admin: scope.empId,
          })
          .eq("emp_id", emp_id)
          .select("*")
          .single();

        if (up2.error) {
          return NextResponse.json(
            { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up2.error?.message ?? up2.error) },
            { status: 500 }
          );
        }

        return NextResponse.json({
          ok: true,
          item: up2.data,
          mode: "UPDATED_EXISTING",
          tempPassword,
        });
      }

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
/**
 * ✅ 수정(이름/활성만)
 * - 내(owner_admin=empId) 계정만 수정 가능
 */
export async function PATCH(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });
  }

  try {
    const body = await readBody(req);
    const id = body?.id;

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    // ✅ 대상 소유권 체크 (남 소유면 차단)
    const ex = await sb.from(TABLE).select("id, owner_admin").eq("id", id).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(ex.error?.message ?? ex.error) },
        { status: 500 }
      );
    }

    const owner = s(ex?.data?.owner_admin);
    if (owner && owner !== scope.empId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN_OTHER_OWNER", detail: `owner_admin=${owner}` },
        { status: 403 }
      );
    }

    const patch: any = {};
    if (body?.name !== undefined) patch.name = s(body.name) || null;

    if (body?.is_active !== undefined || body?.isActive !== undefined) {
      const b = toBool(body?.is_active ?? body?.isActive, null);
      if (b !== null) patch.is_active = b;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });
    }

    // ✅ owner_admin이 비어있던 레거시 데이터면 내 소유로 고정(원치 않으면 삭제 가능)
    patch.owner_admin = scope.empId;

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
