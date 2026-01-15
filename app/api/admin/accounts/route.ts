// app/api/admin/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

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

/**
 * ✅ (유지) 팀 픽: body.team 우선, 없으면 empId가 admin_gs면 B, 아니면 A
 * - "empId"는 생성 대상(직원) emp_id 기준으로 팀 추정하는 기존 로직 유지
 * - 실제 스코프 분리는 owner_admin으로 함
 */
function pickTeam(empId: string, bodyTeam: any) {
  const t = s(bodyTeam);
  if (t) return t;
  if (empId === "admin_gs") return "B";
  return "A";
}

/**
 * password_hash 생성 (내장 crypto.scrypt 사용)
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
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

/** ✅ 로그인 관리자 스코프(쿠키) */
function getAdminScope(req: NextRequest) {
  const adminEmpId = s(req.cookies.get("empId")?.value);
  const role = s(req.cookies.get("role")?.value);
  if (!adminEmpId || role !== "admin") return null;
  return { adminEmpId };
}

/* ---------------- handlers ---------------- */

// ✅ GET은 NextRequest를 받아야 쿠키를 읽고 "내꺼만" 필터 가능
export async function GET(req: NextRequest) {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { adminEmpId } = scope;

    // ✅ 핵심: owner_admin=현재 관리자 인 것만 조회
    // + owner_admin이 null인데 자기 emp_id인 경우(초기 백필/예외)도 보이게 OR 처리
    const { data, error } = await sb
      .from("accounts")
      .select("*")
      .or(`owner_admin.eq.${adminEmpId},and(owner_admin.is.null,emp_id.eq.${adminEmpId})`)
      .order("id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      _active: Boolean(
        r?.is_active ?? r?.active ?? r?.enabled ?? r?.use_yn ?? r?.useYn ?? true
      ),
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

// ✅ POST도 NextRequest로 바꿔야 "현재 로그인 관리자"를 owner_admin으로 박을 수 있음
export async function POST(req: NextRequest) {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { adminEmpId } = scope;

    const body = await readBody(req);

    const emp_id = s(body?.emp_id ?? body?.empId ?? body?.id ?? body?.user_id);
    const name = s(body?.name ?? "");
    const is_active =
      toBool(body?.is_active ?? body?.active ?? body?.use, true) ?? true;

    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

    const team = pickTeam(emp_id, body?.team);

    // 생성 시 사용할 임시 비번 (원하면 body.tempPassword로 덮어쓰기 가능)
    const tempPassword = s(body?.tempPassword ?? body?.password ?? "1234");
    const password_hash = makePasswordHash(tempPassword);

    // 1) 이미 존재 확인 (user_id 기준 우선, 없으면 emp_id)
    const { data: exists1, error: selErr1 } = await sb
      .from("accounts")
      .select("*")
      .eq("user_id", emp_id)
      .maybeSingle();

    if (selErr1) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: selErr1.message },
        { status: 500 }
      );
    }

    let exists = exists1;
    if (!exists) {
      const { data: exists2, error: selErr2 } = await sb
        .from("accounts")
        .select("*")
        .eq("emp_id", emp_id)
        .maybeSingle();

      if (selErr2) {
        return NextResponse.json(
          { ok: false, error: "DB_QUERY_FAILED", detail: selErr2.message },
          { status: 500 }
        );
      }
      exists = exists2;
    }

    // ✅ 이미 있으면: (중요) "내 소유가 아니면" 생성/수정 막기
    if (exists) {
      const owner = s((exists as any).owner_admin ?? "");
      // owner_admin이 이미 있고, 현재 관리자랑 다르면 막기
      if (owner && owner !== adminEmpId) {
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN_OTHER_OWNER" },
          { status: 403 }
        );
      }

      // owner_admin이 비어있으면(구 데이터) 현재 관리자 소유로 먼저 귀속시켜버림
      // → 이렇게 해야 앞으로 목록에서 섞여보이지 않음
      if (!owner) {
        await sb.from("accounts").update({ owner_admin: adminEmpId }).eq("id", (exists as any).id);
      }

      const ph = s((exists as any).password_hash ?? "");
      if (!ph) {
        await sb.from("accounts").update({ password_hash }).eq("id", (exists as any).id);
      }

      const { data: reread } = await sb
        .from("accounts")
        .select("*")
        .eq("id", (exists as any).id)
        .single();

      return NextResponse.json({ ok: true, row: reread ?? exists, tempPassword });
    }

    // 2) 새로 INSERT (필수 컬럼들 함께)
    const payload: any = {
      user_id: emp_id,
      emp_id,
      password_hash,
      role: "user",
      is_active,
      team,

      // ✅ 핵심: 누가 만들었는지 박기
      owner_admin: adminEmpId,
    };
    if (name) payload.name = name;

    const { data, error } = await sb
      .from("accounts")
      .insert([payload])
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, row: data, tempPassword });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const scope = getAdminScope(req);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { adminEmpId } = scope;

    const body = await readBody(req);

    const id = body?.id ?? null;
    const emp_id = s(body?.emp_id ?? body?.empId ?? "");
    const active = toBool(body?.is_active ?? body?.active ?? body?.use, null);

    const match: any = {};
    if (id !== null && id !== "") match.id = id;
    else if (emp_id) match.emp_id = emp_id;

    if (!Object.keys(match).length) {
      return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });
    }

    // ✅ 소유자 검사: 내 owner_admin인 것만 수정 허용
    // id로 찾을 수 있으면 우선 조회해서 owner 확인
    const lookupKey = match.id ? { id: match.id } : { emp_id: match.emp_id };
    const { data: before, error: be } = await sb
      .from("accounts")
      .select("id, emp_id, owner_admin")
      .match(lookupKey)
      .maybeSingle();

    if (be || !before) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_NOT_FOUND", detail: be?.message },
        { status: 404 }
      );
    }

    const owner = s(before.owner_admin ?? "");
    if (owner && owner !== adminEmpId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    // owner_admin이 null인데 자기 emp_id도 아니면 막기
    if (!owner && s(before.emp_id) !== adminEmpId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const patch: any = {};
    if (active !== null) patch.is_active = active;

    // (옵션) 비번 초기화 지원: body.resetPassword=true면 password_hash 재발급
    const resetPw = toBool(body?.resetPassword ?? body?.reset_pw, false) ?? false;
    if (resetPw) {
      const newPw = s(body?.newPassword ?? body?.tempPassword ?? "1234");
      patch.password_hash = makePasswordHash(newPw);
    }

    // ✅ 혹시 owner_admin이 null(구 데이터)인 계정이면 수정 시점에 귀속시켜버림
    if (!owner) patch.owner_admin = adminEmpId;

    const res = await sb.from("accounts").update(patch).match(match).select("*");
    if (!res.error) {
      return NextResponse.json({ ok: true, rows: res.data ?? [] });
    }

    // fallback (is_active 없을 경우)
    const retry = await sb.from("accounts").update({ active }).match(match).select("*");
    if (retry.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: retry.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: retry.data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
