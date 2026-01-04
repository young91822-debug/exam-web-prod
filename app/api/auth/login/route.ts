// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

async function readAnyBody(req: Request): Promise<any> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json")) {
    const raw = await req.text().catch(() => "");
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text().catch(() => "");
    const p = new URLSearchParams(text);
    return Object.fromEntries(p.entries());
  }

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return {};
    const obj: any = {};
    fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : (v as any)?.name ?? ""));
    return obj;
  }

  const text = await req.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const p = new URLSearchParams(text);
    const obj = Object.fromEntries(p.entries());
    return Object.keys(obj).length ? obj : {};
  }
}

function pickLoginId(body: any) {
  return s(body?.loginId ?? body?.user_id ?? body?.userId ?? body?.id ?? body?.username);
}
function pickPassword(body: any) {
  return s(body?.password ?? body?.pw ?? body?.pass);
}

export async function POST(req: Request) {
  try {
    const body = await readAnyBody(req);
    const loginIdRaw = pickLoginId(body);
    const password = pickPassword(body);

    const loginId = loginIdRaw.toLowerCase();

    if (!loginId || !password) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ✅✅✅ 관리자 하드코딩 (DB랑 무관하게 무조건 관리자)
    if (loginId === "admin" && password === "1234") {
      const res = NextResponse.json({ ok: true, empId: "admin", role: "admin" });
      res.headers.append("Set-Cookie", `empId=admin; Path=/; HttpOnly; SameSite=Lax`);
      res.headers.append("Set-Cookie", `emp_id=admin; Path=/; HttpOnly; SameSite=Lax`);
      return res;
    }

    // ✅ 일반 사용자: accounts(user_id/password)
    const { data: row, error } = await supabaseAdmin
      .from("accounts")
      .select("id, user_id, password")
      .eq("user_id", loginIdRaw) // 대소문자 그대로
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", detail: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ ok: false, error: "NO_ACCOUNT" }, { status: 401 });
    }
    if (s(row.password) !== password) {
      return NextResponse.json({ ok: false, error: "INVALID_PASSWORD" }, { status: 401 });
    }

    const empId = s(row.user_id);

    const res = NextResponse.json({ ok: true, empId, role: "user" });
    res.headers.append("Set-Cookie", `empId=${encodeURIComponent(empId)}; Path=/; HttpOnly; SameSite=Lax`);
    res.headers.append("Set-Cookie", `emp_id=${encodeURIComponent(empId)}; Path=/; HttpOnly; SameSite=Lax`);
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "LOGIN_CRASH", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
