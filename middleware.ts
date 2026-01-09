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

  const empId = req.cookies.get("empId")?.value || "";
  const isAdmin = req.cookies.get("isAdmin")?.value === "1";

  // ✅ 관리자만
  if (pathname.startsWith("/admin")) {
    if (!empId || !isAdmin) {
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
