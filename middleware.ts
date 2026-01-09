// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ 항상 허용
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  // ✅ 로그인 API에서 실제로 쓰는 쿠키 기준
  const empId = req.cookies.get("empId")?.value || "";
  const role = req.cookies.get("role")?.value || "";

  // ✅ 관리자만
  if (pathname.startsWith("/admin")) {
    if (!empId || role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ✅ 시험/결과는 로그인만 하면 OK
  if (pathname.startsWith("/exam") || pathname.startsWith("/result")) {
    if (!empId) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
