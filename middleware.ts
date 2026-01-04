import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function hasUserCookie(req: NextRequest) {
  // ✅ 로그인 API가 심는 쿠키들 (둘 중 하나만 있어도 OK)
  const emp1 = req.cookies.get("emp_id")?.value;
  const emp2 = req.cookies.get("empId")?.value;
  return !!(emp1 && emp1.trim()) || !!(emp2 && emp2.trim());
}

function hasAdminCookie(req: NextRequest) {
  return req.cookies.get("admin")?.value === "1";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ 정적/내부/로그인 관련은 무조건 통과
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/login")
  ) {
    return NextResponse.next();
  }

  // ✅ 관리자 영역 보호
  if (pathname.startsWith("/admin")) {
    if (!hasAdminCookie(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ✅ 시험/결과 영역 보호 (직원 로그인 필요)
  if (pathname.startsWith("/exam") || pathname.startsWith("/result")) {
    if (!hasUserCookie(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 그 외는 통과
  return NextResponse.next();
}

// ✅ 이 matcher가 핵심: 필요한 경로만 미들웨어가 탄다 (괜히 전체 막지 않게)
export const config = {
  matcher: ["/admin/:path*", "/exam/:path*", "/result/:path*", "/login", "/api/auth/login"],
};
