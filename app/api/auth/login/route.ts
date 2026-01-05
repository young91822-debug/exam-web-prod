// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

const TABLE_CANDIDATES = ["accounts", "emp_ids", "admins", "users"];
const ID_COLS = ["emp_id", "login_id", "username", "email", "user_id", "account_id", "id"];
const PW_COLS = ["password", "pw", "pass", "passwd"];

async function findAccount(loginId: string) {
  const tried: Array<{ table: string; idCol: string; error?: string }> = [];

  for (const table of TABLE_CANDIDATES) {
    for (const idCol of ID_COLS) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq(idCol as any, loginId as any)
        .maybeSingle();

      if (error) {
        tried.push({ table, idCol, error: error.message });
        continue; // 컬럼/테이블 없으면 다음 후보로
      }
      if (!data) continue;

      // 비번 컬럼 찾기
      for (const pwCol of PW_COLS) {
        if (data[pwCol] != null) {
          return { account: data, table, idCol, pwCol, tried };
        }
      }

      // 계정은 찾았는데 비번 컬럼이 후보에 없음
      return { account: data, table, idCol, pwCol: null, tried };
    }
  }

  return { account: null, table: null, idCol: null, pwCol: null, tried };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const loginId = s(body.loginId ?? body.empId ?? body.id);
    const password = s(body.password ?? body.pw);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const found = await findAccount(loginId);

    if (!found.account) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", tried: found.tried }, { status: 401 });
    }

    if (!found.pwCol) {
      return NextResponse.json(
        { ok: false, error: "NO_PASSWORD_COLUMN", table: found.table, idCol: found.idCol, tried: found.tried },
        { status: 500 }
      );
    }

    if (s(found.account[found.pwCol]) !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 401 });
    }

    const isProd = process.env.NODE_ENV === "production";
    const ck = cookies();

    ck.set("empId", loginId, {
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

    const userId = found.account.id ?? found.account.user_id ?? found.account.account_id ?? null;
    const userUuid = found.account.uuid ?? found.account.user_uuid ?? null;

    if (userId != null) {
      ck.set("user_id", String(userId), {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    if (userUuid) {
      ck.set("user_uuid", String(userUuid), {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

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
