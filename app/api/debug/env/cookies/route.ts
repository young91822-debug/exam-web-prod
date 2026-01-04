import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseCookies(cookieHeader: string) {
  const out: Record<string, string> = {};
  cookieHeader.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const parsed = parseCookies(cookie);

  return NextResponse.json({
    cookieHeader: cookie,
    has_user_id: !!parsed["user_id"],
    has_user_uuid: !!parsed["user_uuid"],
    user_id: parsed["user_id"] || null,
    user_uuid: parsed["user_uuid"] || null,
    allKeys: Object.keys(parsed),
  });
}
