import { NextResponse } from "next/server";
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

/* ---------------- internal utils ---------------- */

async function insertAccountSafe(emp_id: string) {
  // 1️⃣ 최소 컬럼
  let res = await sb.from("accounts").insert([{ emp_id }]).select("*").single();
  if (!res.error) return res;

  const msg = String(res.error?.message ?? "");

  // 2️⃣ role / password_hash NOT NULL 방어
  if (/role|password_hash|null value/i.test(msg)) {
    return await sb
      .from("accounts")
      .insert([{ emp_id, role: "user", password_hash: "" }])
      .select("*")
      .single();
  }

  return res;
}

/* ---------------- handlers ---------------- */

export async function GET() {
  try {
    const { data, error } = await sb.from("accounts").select("*").order("id", { ascending: true });
    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      _active: Boolean(
        r?.is_active ??
          r?.active ??
          r?.enabled ??
          r?.use_yn ??
          r?.useYn ??
          true
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
    const emp_id = s(body?.emp_id ?? body?.empId ?? body?.id);

    if (!emp_id) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }

    const { data, error } = await insertAccountSafe(emp_id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, row: data });
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

    let patch: any = {};
    if (active !== null) {
      patch = { is_active: active };
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
