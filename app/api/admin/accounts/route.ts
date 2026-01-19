// app/api/admin/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
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

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
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

/** ✅ 스코프: 쿠키 empId가 곧 owner_admin */
function getAdminEmpId(req: NextRequest) {
  const empId = s(req.cookies.get("empId")?.value || req.cookies.get("emp_id")?.value);
  if (!empId) return { ok: false as const, error: "UNAUTHORIZED" };
  return { ok: true as const, empId };
}

/* ---------------- GET ---------------- */
export async function GET(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("id, emp_id, username, name, is_active, created_at, team, role, owner_admin")
      .eq("owner_admin", scope.empId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(error?.message ?? error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, items: data ?? [], rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

/* ---------------- POST ---------------- */
export async function POST(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });

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

    // ✅ username NOT NULL 대응: emp_id를 그대로 username으로 사용
    const username = emp_id;

    const tempPassword = "1234";
    const password_hash = makePasswordHash(tempPassword);

    // 0) emp_id 존재 확인
    const ex = await sb.from(TABLE).select("id, emp_id, owner_admin").eq("emp_id", emp_id).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(ex.error?.message ?? ex.error) },
        { status: 500 }
      );
    }

    // ✅ 이미 존재하면: 다른 owner면 403 / 내 소유면 업데이트(+비번리셋)
    if (ex.data) {
      const owner = s(ex.data.owner_admin);

      if (owner && owner !== scope.empId) {
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN_OTHER_OWNER", detail: `owner_admin=${owner}` },
          { status: 403 }
        );
      }

      const { data, error } = await sb
        .from(TABLE)
        .update({
          username, // ✅ 필수
          name: name || null,
          is_active,
          role: allowedRole,
          password_hash, // ✅ 필수(로그인용)
          owner_admin: scope.empId,
        })
        .eq("emp_id", emp_id)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(error?.message ?? error) },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, item: data, mode: "UPDATED_EXISTING", tempPassword });
    }

    // 1) 신규 insert
    const row: any = {
      emp_id,
      username, // ✅ 핵심: NOT NULL 충족
      name: name || null,
      is_active,
      role: allowedRole,
      password_hash, // ✅ 로그인과 동일
      owner_admin: scope.empId,
      team: s(body?.team) || null,
    };

    const ins = await sb.from(TABLE).insert(row).select("*").single();
    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: String(ins.error?.message ?? ins.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, item: ins.data, mode: "CREATED", tempPassword });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

/* ---------------- PATCH ---------------- */
export async function PATCH(req: NextRequest) {
  const scope = getAdminEmpId(req);
  if (!scope.ok) return NextResponse.json({ ok: false, error: scope.error }, { status: 401 });

  try {
    const body = await readBody(req);
    const id = body?.id;

    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const ex = await sb.from(TABLE).select("id, owner_admin").eq("id", id).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(ex.error?.message ?? ex.error) },
        { status: 500 }
      );
    }

    const owner = s(ex.data?.owner_admin);
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

    // 레거시 owner_admin 비어있으면 내 소유로 정리
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
