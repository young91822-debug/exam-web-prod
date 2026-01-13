// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

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

/**
 * ✅ accounts 테이블은 환경마다 컬럼명이 다를 수 있음
 * - is_active가 없을 수 있음 (현재 네 화면 상태)
 * - active / enabled / use_yn 등일 수 있음
 * 그래서: insert/update 시 상태 컬럼은 "시도->실패하면 빼고 재시도" 전략
 */
async function insertAccount(payloadBase: any, active: boolean | null) {
  // 1) is_active로 시도
  if (active !== null) {
    let { data, error } = await sb
      .from("accounts")
      .insert([{ ...payloadBase, is_active: active }])
      .select("*")
      .single();
    if (!error) return { data, error: null };
    const msg = String(error?.message ?? "");
    if (!/is_active/i.test(msg) && !/does not exist/i.test(msg)) {
      return { data: null, error };
    }
  }

  // 2) active로 시도
  if (active !== null) {
    let { data, error } = await sb
      .from("accounts")
      .insert([{ ...payloadBase, active }])
      .select("*")
      .single();
    if (!error) return { data, error: null };
    const msg = String(error?.message ?? "");
    if (!/active/i.test(msg) && !/does not exist/i.test(msg)) {
      return { data: null, error };
    }
  }

  // 3) 상태 컬럼 없이 최소 삽입
  const { data, error } = await sb
    .from("accounts")
    .insert([{ ...payloadBase }])
    .select("*")
    .single();
  return { data, error };
}

async function updateAccount(match: any, patchBase: any, active: boolean | null) {
  // 1) is_active 포함 업데이트 시도
  if (active !== null) {
    let { data, error } = await sb
      .from("accounts")
      .update({ ...patchBase, is_active: active })
      .match(match)
      .select("*");
    if (!error) return { data, error: null };
    const msg = String(error?.message ?? "");
    if (!/is_active/i.test(msg) && !/does not exist/i.test(msg)) {
      return { data: null, error };
    }
  }

  // 2) active 포함 업데이트 시도
  if (active !== null) {
    let { data, error } = await sb
      .from("accounts")
      .update({ ...patchBase, active })
      .match(match)
      .select("*");
    if (!error) return { data, error: null };
    const msg = String(error?.message ?? "");
    if (!/active/i.test(msg) && !/does not exist/i.test(msg)) {
      return { data: null, error };
    }
  }

  // 3) 상태 컬럼 없이 업데이트
  const { data, error } = await sb.from("accounts").update({ ...patchBase }).match(match).select("*");
  return { data, error };
}

export async function GET() {
  try {
    const { data, error } = await sb.from("accounts").select("*").order("id", { ascending: true });
    if (error) {
      return NextResponse.json({ ok: false, error: "DB_QUERY_FAILED", detail: error.message }, { status: 500 });
    }

    // ✅ 어떤 상태 컬럼이든 화면에서 "사용"을 잘 표시하게 통일
    const rows = (data ?? []).map((r: any) => {
      const active =
        r?.is_active ??
        r?.active ??
        r?.enabled ??
        r?.isEnabled ??
        r?.use_yn ??
        r?.useYn ??
        true; // 없으면 true로 간주(기존 화면이 다 '사용'으로 나오는 상태라)
      return {
        ...r,
        _active: Boolean(active),
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const emp_id = s(body?.emp_id ?? body?.empId ?? body?.id);
    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

    // ✅ 1단계: emp_id만으로 최소 insert
    let { data, error } = await sb
      .from("accounts")
      .insert([{ emp_id }])
      .select("*")
      .single();

    // ✅ 성공하면 바로 반환
    if (!error) {
      return NextResponse.json({ ok: true, row: data });
    }

    const msg = String(error.message ?? "");

    // ✅ 2단계: role / password_hash 필요할 경우만 보강
    if (/role|password_hash|null value/i.test(msg)) {
      const retry = await sb
        .from("accounts")
        .insert([
          {
            emp_id,
            role: "user",
            password_hash: "",
          },
        ])
        .select("*")
        .single();

      if (retry.error) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: retry.error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, row: retry.data });
    }

    // ❌ 그 외 에러
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await readBody(req);

    const id = body?.id ?? null;
    const emp_id = s(body?.emp_id ?? body?.empId ?? "");
    const name = s(body?.name ?? "");
    const active = toBool(body?.is_active ?? body?.active ?? body?.use, null);

    const match: any = {};
    if (id != null && id !== "") match.id = id;
    else if (emp_id) match.emp_id = emp_id;

    if (!Object.keys(match).length) {
      return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });
    }

    const patchBase: any = {};
    if (name !== "") patchBase.name = name;

    const { data, error } = await updateAccount(match, patchBase, active);
    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
