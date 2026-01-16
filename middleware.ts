// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const empId = req.cookies.get("empId")?.value;
  const role = req.cookies.get("role")?.value;

  if (!empId) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // ✅ 관리자만 /admin
  if (pathname.startsWith("/admin")) {
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  // ❌ 관리자는 exam 접근 금지
  if (pathname.startsWith("/exam")) {
    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}
