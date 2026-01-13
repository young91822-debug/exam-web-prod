// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/** stored 포맷: scrypt$<saltB64>$<hashB64> */
function verifyPasswordHash(plain: string, stored: string) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3) return false;
    const [algo, saltB64, hashB64] = parts;
    if (algo !== "scrypt") return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(plain, salt, expected.length);

    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * ✅ 핵심: JSON만 보지 말고 formData / text(urlencoded 포함)도 모두 파싱
 */
async function readBody(req: Request): Promise<any> {
  // 1) JSON
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}

  // 2) formData (multipart / x-www-form-urlencoded)
  try {
    const fd = await req.formData();
    const obj: Record<string, any> = {};
    for (const [k, v] of fd.entries()) obj[k] = typeof v === "string" ? v : String(v);
    if (Object.keys(obj).length) return obj;
  } catch {}

  // 3) text → JSON 시도 → urlencoded 시도
  try {
    const t = await req.text();
    if (!t) return {};
    try {
      const j = JSON.parse(t);
      if (j && typeof j === "object") return j;
    } catch {}
    try {
      const sp = new URLSearchParams(t);
      const obj: Record<string, any> = {};
      sp.forEach((v, k) => (obj[k] = v));
      return obj;
    } catch {}
    return {};
  } catch {
    return {};
  }
}

function pickFirst(body: any, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    const sv = s(v);
    if (sv) return sv;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    // ✅ 어떤 키로 오든 다 받아먹기
    const id = pickFirst(body, ["id", "loginId", "username", "user_id", "empId", "emp_id"]);
    const pw = pickFirst(body, ["pw", "password", "pass", "passwd"]);

    // ✅ 실서버에서 확인 가능한 로그 (Vercel Functions Logs에서 확인)
    console.log("LOGIN content-type =", req.headers.get("content-type"));
    console.log("LOGIN body keys =", Object.keys(body || {}));
    console.log("LOGIN parsed id/pw =", id ? "[OK]" : "[EMPTY]", pw ? "[OK]" : "[EMPTY]");

    if (!id || !pw) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          debug: {
            contentType: req.headers.get("content-type"),
            keys: Object.keys(body || {}),
          },
        },
        { status: 400 }
      );
    }

    // ✅ 계정 조회
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("id, role, password_hash, is_active")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("LOGIN DB error:", error);
      return NextResponse.json({ ok: false, error: "DB_ERROR", detail: String(error.message || error) }, { status: 500 });
    }

    if (!data || !data.is_active) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const ok = verifyPasswordHash(pw, data.password_hash);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // ✅ 성공 응답 (기존 흐름 유지)
    return NextResponse.json({ ok: true, id: data.id, role: data.role ?? "user" });
  } catch (e: any) {
    console.error("LOGIN SERVER_ERROR:", e);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
