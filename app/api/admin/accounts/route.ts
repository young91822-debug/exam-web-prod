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

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
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

/** ✅ 로그인 쿠키에서 관리자 empId/role/team 읽기 */
function getAdminCtx(req: NextRequest) {
  const empId = s(req.cookies.get("empId")?.value || req.cookies.get("emp_id")?.value);
  const role = s(req.cookies.get("role")?.value);
  const team = s(req.cookies.get("team")?.value);

  if (!empId) return { ok: false as const, error: "UNAUTHORIZED" };
  if (role && role !== "admin") return { ok: false as const, error: "FORBIDDEN_NOT_ADMIN" };

  // team 쿠키가 없으면 기본값(B)로 방어 (team NOT NULL 대응)
  return { ok: true as const, empId, role: role || "admin", team: team || "B" };
}

/** owner_admin 컬럼 관련 "없음" 에러 캐치 */
function isMissingOwnerAdminColumn(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("owner_admin") &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("not find") ||
      msg.includes("column"))
  );
}

/** team 컬럼 관련 "없음" 에러 캐치 (혹시나) */
function isMissingTeamColumn(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("team") &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("not find") ||
      msg.includes("column"))
  );
}

/** username 컬럼 관련 "없음" 에러 캐치 (혹시나) */
function isMissingUsernameColumn(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("username") &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("not find") ||
      msg.includes("column"))
  );
}

/* ---------------- GET ---------------- */
/** ✅ 내(owner_admin = 내 empId) 계정만 조회 */
export async function GET(req: NextRequest) {
  const ctx = getAdminCtx(req);
  if (!ctx.ok) return NextResponse.json({ ok: false, error: ctx.error }, { status: 401 });

  try {
    // 1) owner_admin/team/username 포함 시도
    let q1 = sb
      .from(TABLE)
      .select("id, emp_id, username, name, is_active, created_at, team, role, owner_admin")
      .eq("owner_admin", ctx.empId)
      .order("created_at", { ascending: false });

    let { data, error } = await q1;

    // 2) 컬럼 없으면 점진적 fallback
    if (error && (isMissingOwnerAdminColumn(error) || isMissingTeamColumn(error) || isMissingUsernameColumn(error))) {
      // owner_admin이 없으면 "내 것만" 필터링 불가 -> 안전하게 빈 배열 반환(권한 누수 방지)
      if (isMissingOwnerAdminColumn(error)) {
        return NextResponse.json({
          ok: true,
          items: [],
          rows: [],
          warn: "owner_admin column missing; cannot scope safely",
        });
      }

      // owner_admin은 있는데 team/username만 없을 때
      const r2 = await sb
        .from(TABLE)
        .select("id, emp_id, name, is_active, created_at, role, owner_admin")
        .eq("owner_admin", ctx.empId)
        .order("created_at", { ascending: false });

      data = r2.data;
      error = r2.error;
    }

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
/**
 * ✅ 생성/갱신(중복 emp_id면 update로 전환)
 * 규칙:
 * - username NOT NULL: username = emp_id
 * - team NOT NULL: team = 쿠키 team 우선 (없으면 body.team, 그래도 없으면 "B")
 * - owner_admin: 항상 현재 로그인한 admin(empId)
 * - 다른 owner_admin 소유 계정은 생성/수정 금지(403)
 */
export async function POST(req: NextRequest) {
  const ctx = getAdminCtx(req);
  if (!ctx.ok) return NextResponse.json({ ok: false, error: ctx.error }, { status: 401 });

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

    // ✅ username NOT NULL 대응
    const username = emp_id;

    // ✅ team NOT NULL 대응 (쿠키 우선)
    const team = s(ctx.team) || s(body?.team) || "B";

    // ✅ 임시 비번
    const tempPassword = "1234";
    const password_hash = makePasswordHash(tempPassword);

    // 0) 기존 존재 여부 확인 (emp_id 기준)
    const ex = await sb.from(TABLE).select("id, emp_id, owner_admin").eq("emp_id", emp_id).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(ex.error?.message ?? ex.error) },
        { status: 500 }
      );
    }

    // 1) 이미 있으면: owner_admin 체크 후 update
    if (ex.data) {
      const owner = s(ex.data.owner_admin);

      // ✅ 다른 owner면 금지
      if (owner && owner !== ctx.empId) {
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN_OTHER_OWNER", detail: `owner_admin=${owner}` },
          { status: 403 }
        );
      }

      // ✅ 내 소유(또는 owner_admin이 null)면 update + owner_admin 내 것으로 정리
      let up = await sb
        .from(TABLE)
        .update({
          username, // ✅ NOT NULL
          name: name || null,
          is_active,
          role: allowedRole,
          password_hash, // ✅ 로그인과 동일
          team, // ✅ NOT NULL
          owner_admin: ctx.empId, // ✅ 정리
        })
        .eq("emp_id", emp_id)
        .select("*")
        .single();

      // (fallback) owner_admin 컬럼이 없다면: 보안상 업데이트 자체를 막는 게 안전
      if (up.error && isMissingOwnerAdminColumn(up.error)) {
        return NextResponse.json(
          { ok: false, error: "OWNER_ADMIN_COLUMN_MISSING", detail: "cannot enforce ownership" },
          { status: 500 }
        );
      }

      // (fallback) team/username 컬럼이 없다면: DB 스키마 문제 -> 에러를 그대로 반환
      if (up.error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up.error?.message ?? up.error) },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, item: up.data, mode: "UPDATED_EXISTING", tempPassword });
    }

    // 2) 신규 insert (내 소유로만 생성)
    const row: any = {
      emp_id,
      username, // ✅ NOT NULL
      name: name || null,
      is_active,
      role: allowedRole,
      password_hash, // ✅ 로그인과 동일
      team, // ✅ NOT NULL
      owner_admin: ctx.empId,
    };

    let ins = await sb.from(TABLE).insert(row).select("*").single();

    // owner_admin 컬럼이 없다면: 안전상 insert 중단
    if (ins.error && isMissingOwnerAdminColumn(ins.error)) {
      return NextResponse.json(
        { ok: false, error: "OWNER_ADMIN_COLUMN_MISSING", detail: "cannot enforce ownership" },
        { status: 500 }
      );
    }

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
/**
 * ✅ 수정(이름/활성만)
 * - 다른 owner_admin 소유 계정 수정 금지
 */
export async function PATCH(req: NextRequest) {
  const ctx = getAdminCtx(req);
  if (!ctx.ok) return NextResponse.json({ ok: false, error: ctx.error }, { status: 401 });

  try {
    const body = await readBody(req);
    const id = body?.id;

    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    // 0) 대상 row owner 확인
    const ex = await sb.from(TABLE).select("id, owner_admin").eq("id", id).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String(ex.error?.message ?? ex.error) },
        { status: 500 }
      );
    }

    const owner = s(ex.data?.owner_admin);
    if (owner && owner !== ctx.empId) {
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

    // owner_admin이 null인 레거시 데이터면, 내가 수정하는 순간 내 소유로 귀속
    patch.owner_admin = ctx.empId;

    const up = await sb.from(TABLE).update(patch).eq("id", id).select("*");
    if (up.error) {
      if (isMissingOwnerAdminColumn(up.error)) {
        return NextResponse.json(
          { ok: false, error: "OWNER_ADMIN_COLUMN_MISSING", detail: "cannot enforce ownership" },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up.error?.message ?? up.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: up.data ?? [], items: up.data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
