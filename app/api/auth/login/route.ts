// app/api/auth/login/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const loginId = s(body.loginId ?? body.empId ?? body.id);
    const password = s(body.password ?? body.pw);

    const marker = "LOGIN_V4_NO_COOKIES";

    if (loginId === "admin" && password === "1234") {
      return NextResponse.json({
        ok: true,
        marker,
        mode: "HARDCODE_ADMIN",
        empId: "admin",
      });
    }

    return NextResponse.json({ ok: false, marker, error: "UNAUTHORIZED" }, { status: 401 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
