import { NextResponse, NextRequest } from "next/server";

function getCookie(req: NextRequest, key: string) {
  return req.cookies.get(key)?.value || "";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminArea = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (!isAdminArea && !isAdminApi) return NextResponse.next();

  const admin = getCookie(req, "admin");
  const isAdmin = admin === "1";

  if (isAdmin) return NextResponse.next();

  // ✅ API는 JSON으로 401
  if (isAdminApi) {
    return NextResponse.json({ error: "Unauthorized (admin cookie required)" }, { status: 401 });
  }

  // ✅ /admin 페이지는 /login으로 보냄
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
