// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
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

// ✅ 관리자 아이디 목록(원하면 더 추가)
const ADMIN_IDS = new Set(["admin", "admin_gs"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const id = s(body?.id ?? body?.user_id ?? body?.empId ?? body?.emp_id);
    const pw = s(body?.pw ?? body?.password);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const { data: row, error } = await supabaseAdmin
      .from("accounts")
      .select("id, user_id, emp_id, password, team")
      .or(`user_id.eq.${id},emp_id.eq.${id}`)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_QUERY_FAILED", detail: String((error as any)?.message ?? error) },
        { status: 500 }
      );
    }
    if (!row) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    if (s(row.password) !== pw) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const empId = s(row.emp_id || row.user_id || id);
    const team = s(row.team || "A");
    const role = ADMIN_IDS.has(empId) || ADMIN_IDS.has(s(row.user_id)) ? "admin" : "user";

    const res = NextResponse.json({
      ok: true,
      empId,
      team,
      role,
      marker: "LOGIN_OK_PLAINTEXT_PASSWORD",
    });

    const maxAge = 60 * 60 * 24 * 7;
    res.cookies.set("empId", empId, { path: "/", maxAge });
    res.cookies.set("team", team, { path: "/", maxAge });
    res.cookies.set("role", role, { path: "/", maxAge });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
