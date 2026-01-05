// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

export const dynamic = "force-dynamic";

function cookieStr(name: string, value: string) {
  const isProd = process.env.NODE_ENV === "production";
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    isProd ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 7}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const loginId = s(body.loginId ?? body.empId ?? body.id ?? body.username);
    const password = s(body.password ?? body.pw ?? body.pass);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_CREDENTIALS" }, { status: 400 });
    }

    // ✅ 너 DB 구조에 맞게 기존 로직 쓰면 되는데,
    // 일단 지금은 "로그인 성공"이 200이라서 여기까지는 통과한다고 보고,
    // 아래는 예시: accounts에서 emp_id/pw로 찾는 형태
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("*")
      .eq("emp_id", loginId)
      .maybeSingle();

    if (error || !data) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    if (s(data.password) !== password) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

    const res = NextResponse.json({ ok: true, empId: loginId });

    // ✅ 핵심: 쿠키를 2개로 심기 (admin/middleware가 뭐를 보든 통과)
    res.headers.append("Set-Cookie", cookieStr("empId", loginId));
    res.headers.append("Set-Cookie", cookieStr("emp_id", loginId));

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
