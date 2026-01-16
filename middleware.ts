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

  // 로그인 쿠키 없으면 login
  if (!empId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 관리자만 /admin
  if (pathname.startsWith("/admin")) {
    if (role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 관리자는 exam 접근 금지
  if (pathname.startsWith("/exam")) {
    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}
