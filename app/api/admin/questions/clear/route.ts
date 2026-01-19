// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BATCH = 500;

function s(v: any) {
  return String(v ?? "").trim();
}

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

function mkServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("MISSING_SUPABASE_SERVICE_ROLE_ENV");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** ✅ 배포/라우트 살아있는지 확인용 (주소창으로 바로 확인 가능) */
export async function GET(req: Request) {
  try {
    const cookie = req.headers.get("cookie") || "";
    const empId = getCookie(cookie, "empId") || getCookie(cookie, "userId");
    const role = getCookie(cookie, "role");

    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    return NextResponse.json(
      {
        ok: true,
        marker: "CLEAR_ROUTE_PING_v1",
        hasUrl,
        hasService,
        cookieSeen: { empId: !!empId, role: role || null },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, marker: "CLEAR_ROUTE_PING_v1", error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

async function requireAdminTeam(req: Request, sb: any) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId") || getCookie(cookieHeader, "userId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const tries = ["emp_id,team,is_active,username,role", "emp_id,team,is_active,role", "emp_id,team,role", "emp_id,team"];
  let data: any = null;

  for (const cols of tries) {
    const r = await sb
      .from("accounts")
      .select(cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!r.error) {
      data = r.data;
      break;
    }

    const msg = String(r.error?.message || r.error).toLowerCase();
    if (msg.includes("does not exist") || msg.includes("could not find")) continue;

    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: String(r.error?.message || r.error) };
  }

  if ((data as any)?.is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = s((data as any)?.team) || (empId === "admin_gs" ? "B" : "A");
  return { ok: true as const, team, empId };
}

export async function POST(req: Request) {
  try {
    const sb = mkServiceClient();

    const auth = await requireAdminTeam(req, sb);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    let deletedQuestions = 0;

    while (true) {
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team)
        .range(0, BATCH - 1);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT failed: ${String(selErr.message || selErr)}`, team: auth.team },
          { status: 500 }
        );
      }

      const ids = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);
      if (ids.length === 0) break;

      const { error: delErr } = await sb.from("questions").delete().in("id", ids).eq("team", auth.team);
      if (delErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `DELETE failed: ${String(delErr.message || delErr)}`, team: auth.team },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;
    }

    return NextResponse.json(
      { ok: true, team: auth.team, deletedQuestions, marker: "ADMIN_QUESTIONS_CLEAR_SERVICE_ROLE_v1" },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e), marker: "ADMIN_QUESTIONS_CLEAR_SERVICE_ROLE_v1" },
      { status: 500 }
    );
  }
}
