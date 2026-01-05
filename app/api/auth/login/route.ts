// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

function setLoginCookies(empId: string) {
  const isProd = process.env.NODE_ENV === "production";
  const ck = cookies();

  ck.set("empId", empId, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  ck.set("login_ok", "1", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  ck.set("user_id", "admin", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const loginId = s(body.loginId);
    const password = s(body.password);

    // 🚨🚨🚨 무조건 통과 분기 (강제)
    if (loginId === "admin" && password === "1234") {
      setLoginCookies("admin");

      return NextResponse.json({
        ok: true,
        mode: "HARDCODE_ADMIN",
        empId: "admin",
      });
    }

    // 여기까지 오면 전부 실패
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
