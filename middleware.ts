// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인/정적/API는 여기까지 오지 않음 (matcher에서 제외됨)

  const empId = req.cookies.get("empId")?.value || "";
  const role = req.cookies.get("role")?.value || "";

  // 관리자
  if (pathname.startsWith("/admin")) {
    if (!empId || role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 시험/결과
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
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
