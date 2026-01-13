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
  // JSON 먼저
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}

  // text로 받고 JSON/urlencoded 둘 다 시도
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

function s(v: any) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const id = s(
      body?.id ??
        body?.loginId ??
        body?.username ??
        body?.user_id ??
        body?.empId ??
        body?.emp_id
    );

    const pw = s(
      body?.pw ??
        body?.password ??
        body?.pass ??
        body?.passwd
    );

    if (!id || !pw) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          debug: {
            contentType: req.headers.get("content-type"),
            keys: Object.keys(body || {}),
            sample: {
              id: body?.id,
              loginId: body?.loginId,
              username: body?.username,
              pw: body?.pw,
              password: body?.password,
            },
          },
        },
        { status: 400 }
      );
    }

    // ✅ 여기 아래부터는 기존 DB 로직 그대로
    // ...


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
