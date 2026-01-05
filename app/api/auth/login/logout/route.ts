// app/api/auth/login/logout/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const isProd = process.env.NODE_ENV === "production";

  const cookie = [
    "empId=",
    "Path=/",
    "HttpOnly",
    isProd ? "Secure" : "",
    "SameSite=Lax",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
