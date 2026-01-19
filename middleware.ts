// middleware.ts
import { NextRequest, NextResponse } from "next/server";

function getCookie(req: NextRequest, name: string) {
  return req.cookies.get(name)?.value || "";
}

function pickEmpId(req: NextRequest) {
  return (
    getCookie(req, "empId") ||
    getCookie(req, "emp_id") ||
    getCookie(req, "userId") ||
    getCookie(req, "username") ||
    getCookie(req, "emp") ||
    ""
  );
}

function pickRole(req: NextRequest) {
  const r =
    getCookie(req, "role") ||
    getCookie(req, "userRole") ||
    getCookie(req, "isAdmin") ||
    "";
  if (r === "admin" || r === "user") return r;

  const low = String(r).toLowerCase();
  if (low === "true" || low === "1" || low === "yes") return "admin";
  return "";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ 항상 허용
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const empId = pickEmpId(req);
  const role = pickRole(req);

  // ✅ 로그인 쿠키 없으면 login
  if (!empId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  /* -------------------- ADMIN 영역 -------------------- */

  // ✅ 관리자만 /admin
  if (pathname.startsWith("/admin")) {
    if (role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ✅ /result 는 관리자만 (오답/결과는 관리자만 본다)
  if (pathname.startsWith("/result")) {
    if (role !== "admin") {
      // 응시자는 결과 페이지 금지 → done으로 보냄(또는 exam으로)
      return NextResponse.redirect(new URL("/exam/done", req.url));
    }
    // 관리자는 결과 라우트 쓰더라도 결국 관리자 화면으로 보내는 게 안전
    return NextResponse.redirect(new URL("/admin/results", req.url));
  }

  /* -------------------- USER(응시자) 영역 -------------------- */

  // ✅ 관리자는 /exam 접근 금지
  if (pathname.startsWith("/exam")) {
    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin/results", req.url));
    }
    return NextResponse.next();
  }

  // ✅ 그 외 일반 페이지는 로그인만 되어 있으면 통과
  return NextResponse.next();
}

// ✅ 미들웨어 적용 범위(성능/예외 줄이기)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
