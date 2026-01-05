import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const loginId = s(body.loginId ?? body.empId ?? body.id);
    const password = s(body.password ?? body.pw);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const { data: account, error } = await supabaseAdmin
      .from("accounts")
      .select("*")
      .eq("emp_id", loginId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", detail: error.message }, { status: 500 });
    }
    if (!account) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 401 });
    }
    if (s(account.password) !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 401 });
    }

    const isProd = process.env.NODE_ENV === "production";

    const res = NextResponse.json({
      ok: true,
      empId: loginId,
      role: account.role ?? "user",
    });

    // ✅ 기존 호환용
    res.cookies.set("empId", loginId, {
      httpOnly: false,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    res.cookies.set("emp_id", loginId, {
      httpOnly: false,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // 🔥 핵심 로그인 판별 쿠키 (이게 없어서 지금까지 안 됐던 것)
    res.cookies.set("login_ok", "1", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // (선택) 관리자 여부
    if (account.role === "admin") {
      res.cookies.set("is_admin", "1", {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
