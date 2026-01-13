// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

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

/** ✅ 관리자 팀 조회 (쿠키 empId → accounts.team) */
async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  if (!data) return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  if ((data as any).is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = String((data as any).team ?? "").trim() || "A";
  return { ok: true as const, team, empId };
}

/**
 * password_hash 생성 (crypto.scrypt)
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
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

    // ✅ 민감정보(password_hash 등) 제외하고 필요한 컬럼만
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("id, emp_id, username, name, team, is_active, created_at")
      .eq("team", auth.team)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      team: auth.team,
      items: data ?? [],
      marker: "ACCOUNTS_TEAM_FILTER_v1_NO_HASH",
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
    if (!username) return NextResponse.json({ ok: false, error: "MISSING_USERNAME" }, { status: 400 });

    const myTeam = auth.team;
    const plainPassword = s(body.password ?? body.pw ?? body.passwordPlain) || "1234";

    // 기존 계정 확인
    const { data: exists, error: exErr } = await supabaseAdmin
      .from("accounts")
      .select("id, emp_id, team")
      .eq("emp_id", empId)
      .maybeSingle();

    if (exErr) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_EXIST_CHECK_FAILED", detail: exErr.message },
        { status: 500 }
      );
    }

    if (exists?.id) {
      const existingTeam = String((exists as any).team ?? "").trim() || "A";
      if (existingTeam !== myTeam) {
        return NextResponse.json(
          { ok: false, error: "CROSS_TEAM_ACCOUNT_FORBIDDEN", detail: { empId, existingTeam, myTeam } },
          { status: 403 }
        );
      }

      const updateRow: any = { username, is_active: isActive, team: myTeam };

      const { data: updated, error: upErr } = await supabaseAdmin
        .from("accounts")
        .update(updateRow)
        .eq("id", exists.id)
        .select("id, emp_id, username, name, team, is_active, created_at")
        .maybeSingle();

      if (upErr) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: upErr.message },
          { status: 500 }
        );
      }

      // name 컬럼 있으면 저장 시도
      if (name) {
        const tryCols = ["name", "display_name", "fullname"];
        for (const col of tryCols) {
          const { error: nameErr } = await supabaseAdmin.from("accounts").update({ [col]: name }).eq("id", exists.id);
          if (!nameErr) break;
        }
      }

      return NextResponse.json({ ok: true, team: myTeam, item: updated, mode: "UPDATED" });
    } else {
      const password_hash = makePasswordHash(plainPassword);

      const insertRow: any = {
        emp_id: empId,
        username,
        name: name || null,
        is_active: isActive,
        team: myTeam,
        password_hash,
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("accounts")
        .insert(insertRow)
        .select("id, emp_id, username, name, team, is_active, created_at")
        .maybeSingle();

      if (insErr) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: insErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, team: myTeam, item: inserted, mode: "CREATED", tempPassword: plainPassword });
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_CREATE_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
