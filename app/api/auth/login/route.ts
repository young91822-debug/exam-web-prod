import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

// 너 DB가 어떤 구조든 찾게 “후보”를 넓게 잡음
const TABLE_CANDIDATES = ["accounts", "emp_ids", "admins", "users"];
const ID_COLS = ["emp_id", "login_id", "username", "user_id", "account_id", "id"];
const PW_COLS = ["password", "pw", "pass", "passwd"];

async function tryFindAccount(loginId: string) {
  const tried: Array<{ table: string; idCol: string; pwCol: string; error?: string }> = [];

  for (const table of TABLE_CANDIDATES) {
    for (const idCol of ID_COLS) {
      // 1) 우선 row를 “idCol 기준”으로 찾고
      let row: any = null;

      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq(idCol as any, loginId as any)
        .maybeSingle();

      if (error) {
        // 테이블/컬럼이 없으면 그냥 다음 후보로 넘어감
        tried.push({ table, idCol, pwCol: "(unknown)", error: error.message });
        continue;
      }
      if (!data) continue;

      row = data;

      // 2) 비번 컬럼 후보를 돌면서 실제 비번 컬럼을 찾음
      for (const pwCol of PW_COLS) {
        if (row[pwCol] == null) continue;
        return { table, idCol, pwCol, row, tried };
      }

      // row는 찾았는데 비번 컬럼 후보가 하나도 안 맞으면 기록
      tried.push({ table, idCol, pwCol: "(no pw col match)" });
    }
  }

  return { table: null, idCol: null, pwCol: null, row: null, tried };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const loginId = s(body.loginId ?? body.empId ?? body.id);
    const password = s(body.password ?? body.pw);

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const found = await tryFindAccount(loginId);

    if (!found.row) {
      // 어떤 테이블/컬럼을 시도했는지까지 같이 내려줘서 디버깅 쉬움
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", tried: found.tried },
        { status: 401 }
      );
    }

    // 비번 체크
    if (s(found.row[found.pwCol!]) !== password) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PASSWORD" },
        { status: 401 }
      );
    }

    // 쿠키 세팅
    const isProd = process.env.NODE_ENV === "production";
    const ck = cookies();

    ck.set("empId", loginId, {
      httpOnly: false,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // 로그인 성공 표시용 쿠키(서버에서만 읽게 httpOnly)
    ck.set("login_ok", "1", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // id/uuid도 있으면 같이 세팅
    const userId = found.row.id ?? found.row.user_id ?? found.row.account_id ?? null;
    const userUuid = found.row.uuid ?? found.row.user_uuid ?? null;

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
