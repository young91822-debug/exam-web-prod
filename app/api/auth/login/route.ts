// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ✅ ENV / cookies 안정적으로 읽게 강제 (Vercel/Next에서 edge로 꼬이는 경우 방지)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * ✅ ENV 기반 관리자 로그인 (DB에 admin 계정 없어도 로그인)
 * Vercel Env:
 *  - ADMIN_LOGIN_ID=admin
 *  - ADMIN_PASSWORD=1234
 */
const TABLE_CANDIDATES = ["admins", "accounts", "users", "emp_ids"]; // 우선순위
const ID_COLS = ["login_id", "username", "email", "emp_id", "user_id", "account_id", "id"];
const PW_COLS = ["password", "pw", "pass", "passwd"];

type Tried = { table: string; idCol: string; error?: string };

async function findAccount(loginId: string) {
  const tried: Tried[] = [];

  const idNum = Number(loginId);
  const hasNum = !Number.isNaN(idNum);

  for (const table of TABLE_CANDIDATES) {
    for (const idCol of ID_COLS) {
      // 1) 문자열 eq
      {
        const { data, error } = await supabaseAdmin
          .from(table as any)
          .select("*")
          .eq(idCol as any, loginId as any)
          .maybeSingle();

        if (error) {
          tried.push({ table, idCol, error: error.message });
        } else if (data) {
          for (const pwCol of PW_COLS) {
            if ((data as any)[pwCol] != null) {
              return { account: data, table, idCol, pwCol, tried };
            }
          }
          return { account: data, table, idCol, pwCol: null as any, tried };
        }
      }

      // 2) 숫자 eq (id 류)
      if (hasNum && ["id", "user_id", "account_id"].includes(idCol)) {
        const { data, error } = await supabaseAdmin
          .from(table as any)
          .select("*")
          .eq(idCol as any, idNum as any)
          .maybeSingle();

        if (error) {
          tried.push({ table, idCol, error: error.message });
        } else if (data) {
          for (const pwCol of PW_COLS) {
            if ((data as any)[pwCol] != null) {
              return { account: data, table, idCol, pwCol, tried };
            }
          }
          return { account: data, table, idCol, pwCol: null as any, tried };
        }
      }
    }
  }

  return { account: null as any, table: null as any, idCol: null as any, pwCol: null as any, tried };
}

function setLoginCookies(opts: { empId: string; userId?: string | number | null; userUuid?: string | null }) {
  const isProd = process.env.NODE_ENV === "production";
  const ck = cookies();

  ck.set("empId", String(opts.empId), {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  ck.set("login_ok", "1", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  if (opts.userId != null) {
    ck.set("user_id", String(opts.userId), {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  if (opts.userUuid) {
    ck.set("user_uuid", String(opts.userUuid), {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const loginId = s(
      (body as any).loginId ??
        (body as any).empId ??
        (body as any).id ??
        (body as any).username ??
        (body as any).email
    );
    const password = s((body as any).password ?? (body as any).pw);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ✅ ENV 관리자 fallback
    const envAdminId = s(process.env.ADMIN_LOGIN_ID);
    const envAdminPw = s(process.env.ADMIN_PASSWORD);

    // ✅ 디버그: env가 서버에서 읽히는지(값 노출 X)
    const envDebug = {
      nodeEnv: process.env.NODE_ENV ?? null,
      runtime: "nodejs",
      hasAdminId: !!envAdminId,
      hasAdminPw: !!envAdminPw,
      adminIdLen: envAdminId.length,
      adminPwLen: envAdminPw.length,
      loginIdReceived: loginId,
    };

    if (envAdminId && envAdminPw && loginId === envAdminId && password === envAdminPw) {
      setLoginCookies({ empId: loginId, userId: "env_admin" });
      return NextResponse.json({
        ok: true,
        empId: loginId,
        table: "env_admin",
        idCol: "ADMIN_LOGIN_ID",
        pwCol: "ADMIN_PASSWORD",
        debug: envDebug,
      });
    }

    // ✅ DB에서 계정 찾기
    const found = await findAccount(loginId);

    if (!found.account) {
      // ✅ 여기서 envDebug가 핵심: hasAdminId/hasAdminPw가 false면 Vercel env가 안 먹는 거임
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", loginId, debug: envDebug, tried: found.tried },
        { status: 401 }
      );
    }

    if (!found.pwCol) {
      return NextResponse.json(
        { ok: false, error: "NO_PASSWORD_COLUMN", table: found.table, idCol: found.idCol, tried: found.tried },
        { status: 500 }
      );
    }

    if (s((found.account as any)[found.pwCol]) !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 401 });
    }

    const userId =
      (found.account as any).id ?? (found.account as any).user_id ?? (found.account as any).account_id ?? null;
    const userUuid = (found.account as any).uuid ?? (found.account as any).user_uuid ?? null;

    setLoginCookies({ empId: loginId, userId, userUuid });

    return NextResponse.json({
      ok: true,
      empId: loginId,
      table: found.table,
      idCol: found.idCol,
      pwCol: found.pwCol,
      user_id: userId,
      user_uuid: userUuid,
      debug: envDebug,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
