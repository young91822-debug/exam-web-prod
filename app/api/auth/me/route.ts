// app/api/auth/me/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

function pickEmpId(cookieHeader: string) {
  return (
    getCookie(cookieHeader, "empId") ||
    getCookie(cookieHeader, "emp_id") ||
    getCookie(cookieHeader, "userId") ||
    getCookie(cookieHeader, "employeeId") ||
    getCookie(cookieHeader, "emp") ||
    ""
  );
}

function pickRole(cookieHeader: string) {
  const r =
    getCookie(cookieHeader, "role") ||
    getCookie(cookieHeader, "userRole") ||
    getCookie(cookieHeader, "isAdmin") ||
    "";

  if (r === "admin" || r === "user") return r;

  const low = String(r).toLowerCase();
  if (low === "true" || low === "1" || low === "yes") return "admin";

  return "";
}

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const empId = pickEmpId(cookieHeader);
    const role = pickRole(cookieHeader);

    return NextResponse.json({
      ok: true,
      empId: empId || null,
      role: role || null,
      isAdmin: role === "admin",
      marker: "ME_OK_WITH_ROLE",
      hasCookieHeader: Boolean(cookieHeader),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ME_CRASH", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
