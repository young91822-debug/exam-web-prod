// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
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

function pickTeam(empId: string, bodyTeam: any) {
  const t = s(bodyTeam);
  if (t) return t;
  // admin_gs는 B로, 그 외는 A 기본 (원하면 나중에 변경)
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

/* ---------------- handlers ---------------- */

export async function GET() {
  try {
    const { data, error } = await sb
      .from("accounts")
      .select("*")
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

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const emp_id = s(body?.emp_id ?? body?.empId ?? body?.id ?? body?.user_id);
    const name = s(body?.name ?? "");
    const is_active = toBool(body?.is_active ?? body?.active ?? body?.use, true) ?? true;
    const team = pickTeam(emp_id, body?.team);

    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

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

    // ✅ 이미 있으면: password_hash가 비어있을 때만 채워주고 반환
    if (exists) {
      const ph = s((exists as any).password_hash ?? "");
      if (!ph) {
        await sb
          .from("accounts")
          .update({ password_hash })
          .eq("id", (exists as any).id);
        // 업데이트된 row 다시 읽기
        const { data: reread } = await sb.from("accounts").select("*").eq("id", (exists as any).id).single();
        return NextResponse.json({ ok: true, row: reread ?? exists, tempPassword });
      }
      return NextResponse.json({ ok: true, row: exists, tempPassword });
    }

    // 2) 새로 INSERT (필수 컬럼들 함께)
    const payload: any = {
      user_id: emp_id,
      emp_id,
      password_hash,
      role: "user",
      is_active,
      team,
    };
    if (name) payload.name = name;

    const { data, error } = await sb.from("accounts").insert([payload]).select("*").single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    // ✅ 프론트에서 바로 보여주도록 tempPassword 같이 내려줌
    return NextResponse.json({ ok: true, row: data, tempPassword });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
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

    const patch: any = {};
    if (active !== null) patch.is_active = active;

    // (옵션) 비번 초기화 지원: body.resetPassword=true면 password_hash 재발급
    const resetPw = toBool(body?.resetPassword ?? body?.reset_pw, false) ?? false;
    if (resetPw) {
      const newPw = s(body?.newPassword ?? body?.tempPassword ?? "1234");
      patch.password_hash = makePasswordHash(newPw);
    }

    let res = await sb.from("accounts").update(patch).match(match).select("*");
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
