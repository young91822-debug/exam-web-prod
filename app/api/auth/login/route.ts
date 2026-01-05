// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * ✅ 운영에서 DB에 admin 계정이 아직 없어서 NOT_FOUND가 나는 경우가 많아서,
 *    "ENV 기반 관리자 로그인"을 추가해둠.
 *
 * Vercel 환경변수에 아래 둘 중 하나 세트로 넣으면 됨:
 *  - ADMIN_LOGIN_ID=admin
 *  - ADMIN_PASSWORD=1234
 *
 * (선택) ADMIN_USER_ID=1
 * (선택) ADMIN_USER_UUID=...
 */

const TABLE_CANDIDATES = ["admins", "accounts", "users", "emp_ids"]; // 우선순위
const ID_COLS = ["login_id", "username", "email", "emp_id", "user_id", "account_id", "id"]; // 우선순위
const PW_COLS = ["password", "pw", "pass", "passwd"];

type Tried = { table: string; idCol: string; error?: string };

async function findAccount(loginId: string) {
  const tried: Tried[] = [];

  // 숫자형 컬럼(id 등) 대응: "123" -> 123도 같이 시도
  const idNum = Number(loginId);
  const hasNum = !Number.isNaN(idNum);

  for (const table of TABLE_CANDIDATES) {
    for (const idCol of ID_COLS) {
      // 1) eq(string)
      {
        const { data, error } = await supabaseAdmin
          .from(table as any)
          .select("*")
          .eq(idCol as any, loginId as any)
          .maybeSingle();

        if (error) {
          tried.push({ table, idCol, error: error.message });
        } else if (data) {
          // 비번 컬럼 찾기
          for (const pwCol of PW_COLS) {
            if ((data as any)[pwCol] != null) {
              return { account: data, table, idCol, pwCol, tried };
            }
          }
          return { account: data, table, idCol, pwCol: null as any, tried };
        }
      }

      // 2) eq(number) (id/user_id/account_id가 numeric인 케이스)
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

      // 3) ilike(대소문자 무시) (username/email 같은 텍스트일 때만)
      if (["username", "email", "login_id", "emp_id"].includes(idCol)) {
        const { data, error } = await supabaseAdmin
          .from(table as any)
          .select("*")
          .ilike(idCol as any, loginId)
          .maybeSingle();

        if (error) {
          // ilike 지원/컬럼 문제 등도 후보로 넘김
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

function setLoginCookies(opts: {
  empId: string;
  userId?: string | number | null;
  userUuid?: string | null;
}) {
  const isProd = process.env.NODE_ENV === "production";
  const ck = cookies();

  // 프론트에서 읽을 empId
  ck.set("empId", String(opts.empId), {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  // 서버에서만 확인용
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

    // ✅ 프론트에서 loginId로 오고 있으니 그거 우선
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

    // ✅ 0) ENV 기반 관리자 로그인 (DB에 계정이 없어도 로그인 되게)
    const envAdminId = s(process.env.ADMIN_LOGIN_ID);
    const envAdminPw = s(process.env.ADMIN_PASSWORD);

    if (envAdminId && envAdminPw && loginId === envAdminId && password === envAdminPw) {
      const envUserId = s(process.env.ADMIN_USER_ID || "") || null;
      const envUserUuid = s(process.env.ADMIN_USER_UUID || "") || null;

      setLoginCookies({
        empId: loginId,
        userId: envUserId,
        userUuid: envUserUuid,
      });

      return NextResponse.json({
        ok: true,
        empId: loginId,
        table: "env_admin",
        idCol: "ADMIN_LOGIN_ID",
        pwCol: "ADMIN_PASSWORD",
        user_id: envUserId,
        user_uuid: envUserUuid,
      });
    }

    // ✅ 1) DB에서 계정 찾기
    const found = await findAccount(loginId);

    if (!found.account) {
      // ✅ tried 포함해서 뭐가 있는지 바로 보이게
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", loginId, tried: found.tried },
        { status: 401 }
      );
    }

    if (!found.pwCol) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_PASSWORD_COLUMN",
          table: found.table,
          idCol: found.idCol,
          tried: found.tried,
        },
        { status: 500 }
      );
    }

    if (s((found.account as any)[found.pwCol]) !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 401 });
    }

    const userId =
      (found.account as any).id ??
      (found.account as any).user_id ??
      (found.account as any).account_id ??
      null;

    const userUuid = (found.account as any).uuid ?? (found.account as any).user_uuid ?? null;

    setLoginCookies({
      empId: loginId,
      userId,
      userUuid,
    });

    return NextResponse.json({
      ok: true,
      empId: loginId,
      table: found.table,
      idCol: found.idCol,
      pwCol: found.pwCol,
      user_id: userId,
      user_uuid: userUuid,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
