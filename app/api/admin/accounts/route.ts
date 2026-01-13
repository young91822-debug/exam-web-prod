// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function b(v: any, d = true) {
  if (v === undefined || v === null || v === "") return d;
  if (typeof v === "boolean") return v;
  const t = s(v).toLowerCase();
  if (["1", "true", "y", "yes", "on", "사용"].includes(t)) return true;
  if (["0", "false", "n", "no", "off", "미사용"].includes(t)) return false;
  return d;
}
async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      if (!t) return {};
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
}
function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

async function getAccountSafe(empId: string) {
  const tries = [
    { cols: "emp_id,team,username,is_active,role" },
    { cols: "emp_id,team,is_active,role" },
    { cols: "emp_id,team,username" },
    { cols: "emp_id,team,password" },
    { cols: "emp_id,team" },
  ];

  for (const t of tries) {
    const res = await sb
      .from("accounts")
      .select(t.cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!res.error) return { data: res.data, error: null };
    const msg = String(res.error?.message || res.error);
    if (msg.includes("does not exist") || msg.includes("column")) continue;
    return { data: null, error: res.error };
  }
  return { data: null, error: null };
}

/** ✅ 관리자 팀 조회 (username/is_active 없어도 동작) */
async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await getAccountSafe(empId);
  if (error) return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: String(error.message || error) };

  const team = String((data as any)?.team ?? "").trim() || "A";
  const isActiveVal =
    (data as any)?.is_active ?? (data as any)?.active ?? (data as any)?.enabled ?? null;
  if (isActiveVal === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  return { ok: true as const, team, empId };
}

/**
 * password hash (scrypt)
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** insert/update 시 password 컬럼명이 환경마다 달라서(password_hash vs password) 재시도 */
async function writePassword(row: any, passwordHash: string) {
  // 1) password_hash 시도
  let res = await sb.from("accounts").insert({ ...row, password_hash: passwordHash }).select("*").maybeSingle();
  if (!res.error) return res;

  const msg1 = String(res.error?.message || res.error);
  if (!(msg1.includes("does not exist") || msg1.includes("column"))) return res;

  // 2) password로 재시도
  res = await sb.from("accounts").insert({ ...row, password: passwordHash }).select("*").maybeSingle();
  return res;
}

async function updatePassword(id: any, passwordHash: string) {
  // 1) password_hash
  let res = await sb.from("accounts").update({ password_hash: passwordHash }).eq("id", id).select("*").maybeSingle();
  if (!res.error) return res;

  const msg1 = String(res.error?.message || res.error);
  if (!(msg1.includes("does not exist") || msg1.includes("column"))) return res;

  // 2) password
  res = await sb.from("accounts").update({ password: passwordHash }).eq("id", id).select("*").maybeSingle();
  return res;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    // ✅ 컬럼이 없을 수 있으니 안전한 select 조합으로 재시도
    const tries = [
      "id, emp_id, username, name, team, is_active, created_at",
      "id, emp_id, username, team, is_active, created_at",
      "id, emp_id, team, is_active, created_at",
      "id, emp_id, team, created_at",
    ];

    let data: any[] | null = null;
    let lastErr: any = null;

    for (const cols of tries) {
      const res = await sb.from("accounts").select(cols).eq("team", auth.team).order("created_at", { ascending: false });
      if (!res.error) {
        data = res.data ?? [];
        lastErr = null;
        break;
      }
      const msg = String(res.error?.message || res.error);
      lastErr = res.error;
      if (msg.includes("does not exist") || msg.includes("column")) continue;
      break;
    }

    if (lastErr) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: String(lastErr.message || lastErr) },
        { status: 500 }
      );
    }

    // 화면에서 기대하는 필드로 normalize
    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      emp_id: r.emp_id ?? r.empId ?? r.user_id ?? "-",
      username: r.username ?? r.name ?? r.emp_id ?? "",
      name: r.name ?? r.username ?? "",
      team: r.team ?? auth.team,
      is_active: r.is_active ?? true,
      created_at: r.created_at ?? null,
    }));

    return NextResponse.json({
      ok: true,
      team: auth.team,
      items,
      marker: "ACCOUNTS_TEAM_FILTER_v2_SCHEMA_SAFE",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    const body = await readBody(req);

    const empId = s(body.empId ?? body.emp_id ?? body.employeeId ?? body.employee_id);
    const name = s(body.name ?? body.displayName ?? body.koreanName ?? body.fullname);
    const isActive = b(body.isActive ?? body.is_active ?? body.active ?? body.use, true);
    const username = s(body.username) || name || empId;

    if (!empId) return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });

    const myTeam = auth.team;
    const plainPassword = s(body.password ?? body.pw ?? body.passwordPlain) || "1234";
    const passwordHash = makePasswordHash(plainPassword);

    // 기존 계정 확인(팀 분리 위해 emp_id로 고정)
    const ex = await sb.from("accounts").select("id, emp_id, team").eq("emp_id", empId).maybeSingle();
    if (ex.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_EXIST_CHECK_FAILED", detail: String(ex.error.message || ex.error) },
        { status: 500 }
      );
    }

    if (ex.data?.id) {
      const existingTeam = String((ex.data as any).team ?? "").trim() || "A";
      if (existingTeam !== myTeam) {
        return NextResponse.json(
          { ok: false, error: "CROSS_TEAM_ACCOUNT_FORBIDDEN", detail: { empId, existingTeam, myTeam } },
          { status: 403 }
        );
      }

      // update 가능한 컬럼만 업데이트(없는 컬럼이면 그냥 무시되도록 최소화)
      const updateRow: any = { team: myTeam };

      // username/name/is_active 컬럼이 있을 수도 있으니 "시도"만 한다(없으면 에러 → 그때는 빼고 재시도)
      // 1차 시도
      let up = await sb.from("accounts").update({ ...updateRow, username, name: name || null, is_active: isActive }).eq("id", ex.data.id).select("*").maybeSingle();
      if (up.error) {
        const msg = String(up.error.message || up.error);
        if (msg.includes("does not exist") || msg.includes("column")) {
          // 2차: 더 최소로
          up = await sb.from("accounts").update(updateRow).eq("id", ex.data.id).select("*").maybeSingle();
        }
      }
      if (up.error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: String(up.error.message || up.error) },
          { status: 500 }
        );
      }

      // 비밀번호 변경도 반영(컬럼명 password_hash / password 둘 중 하나)
      const pwRes = await updatePassword(ex.data.id, passwordHash);
      if (pwRes.error) {
        return NextResponse.json(
          { ok: false, error: "PASSWORD_UPDATE_FAILED", detail: String(pwRes.error.message || pwRes.error) },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, team: myTeam, item: up.data, mode: "UPDATED", tempPassword: plainPassword });
    }

    // 새로 생성: team/emp_id는 확정
    // username/name/is_active는 있을 때만 들어가면 되니까 "시도" 방식
    const baseRow: any = {
      emp_id: empId,
      team: myTeam,
    };

    // 1차: 컬럼 있을지도 몰라서 최대 넣고 시도
    let ins = await writePassword(
      { ...baseRow, username, name: name || null, is_active: isActive },
      passwordHash
    );

    if (ins.error) {
      const msg = String(ins.error.message || ins.error);
      if (msg.includes("does not exist") || msg.includes("column")) {
        // 2차: 최소 컬럼으로 재시도
        ins = await writePassword(baseRow, passwordHash);
      }
    }

    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: String(ins.error.message || ins.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, team: myTeam, item: ins.data, mode: "CREATED", tempPassword: plainPassword });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_CREATE_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
