// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/** ✅ 관리자 판별: user_id 또는 emp_id가 admin으로 시작하면 admin */
function isAdminAccount(account: any) {
  const u = String(account?.user_id ?? "").toLowerCase();
  const e = String(account?.emp_id ?? "").toLowerCase();
  return u.startsWith("admin") || e.startsWith("admin");
}

/** ✅ 쿠키 세팅 (upload/route.ts에서 userId/empId 둘 다 읽을 수 있게) */
function setLoginCookies(
  res: NextResponse,
  userId: string,
  empId: string,
  role: "admin" | "user",
  team: string
) {
  const isProd = process.env.NODE_ENV === "production";
  const base = ["Path=/", "SameSite=Lax", "HttpOnly", isProd ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");

  res.headers.append("Set-Cookie", `userId=${encodeURIComponent(userId)}; ${base}`);
  res.headers.append("Set-Cookie", `empId=${encodeURIComponent(empId)}; ${base}`);
  res.headers.append("Set-Cookie", `role=${role}; ${base}`);
  res.headers.append("Set-Cookie", `team=${encodeURIComponent(team)}; ${base}`);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const loginId = s(body.loginId ?? body.username ?? body.userId ?? body.empId ?? body.id);
    const password = s(body.password ?? body.pw ?? body.pass ?? body.pwd);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_CREDENTIALS" }, { status: 400 });
    }

    // ✅ (유지) admin/1234 우회
    if (loginId.toLowerCase() === "admin" && password === "1234") {
      const res = NextResponse.json({
        ok: true,
        userId: "admin",
        empId: "admin",
        role: "admin",
        team: "A",
        bypass: "admin_1234",
      });
      setLoginCookies(res, "admin", "admin", "admin", "A");
      return res;
    }

    // ✅ accounts 조회: user_id 우선, emp_id fallback
    let account: any = null;

    {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("id, user_id, emp_id, team, password")
        .eq("user_id", loginId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { ok: false, error: "DB_QUERY_FAILED", detail: String((error as any)?.message ?? error) },
          { status: 500 }
        );
      }
      account = data || null;
    }

    if (!account) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("id, user_id, emp_id, team, password")
        .eq("emp_id", loginId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { ok: false, error: "DB_QUERY_FAILED", detail: String((error as any)?.message ?? error) },
          { status: 500 }
        );
      }
      account = data || null;
    }

    if (!account) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // ✅ 현재 DB는 password 컬럼(평문/간이) 기준
    const stored = s(account.password);
    if (!stored || stored !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const userId = s(account.user_id) || loginId;
    const empId = s(account.emp_id) || userId;
    const team = s(account.team) || "A";
    const role: "admin" | "user" = isAdminAccount(account) ? "admin" : "user";

    const res = NextResponse.json({
      ok: true,
      userId,
      empId,
      role,
      team,
    });
    setLoginCookies(res, userId, empId, role, team);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
