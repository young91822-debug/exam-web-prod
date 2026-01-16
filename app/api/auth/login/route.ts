// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const TABLE = "accounts";

function s(v: any) {
  return String(v ?? "").trim();
}

/** scrypt 저장 포맷: scrypt$<saltB64>$<hashB64> */
function verifyScrypt(plain: string, stored: string) {
  try {
    const [algo, saltB64, hashB64] = String(stored || "").split("$");
    if (algo !== "scrypt" || !saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = crypto.scryptSync(plain, salt, expected.length);

    return (
      derived.length === expected.length &&
      crypto.timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}

async function readBodyAny(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {}
  try {
    const fd = await req.formData();
    const obj: any = {};
    fd.forEach((v, k) => (obj[k] = v));
    if (Object.keys(obj).length) return obj;
  } catch {}
  try {
    const t = await req.text();
    if (!t) return {};
    try {
      return JSON.parse(t);
    } catch {}
    const params = new URLSearchParams(t);
    const obj: any = {};
    params.forEach((v, k) => (obj[k] = v));
    return obj;
  } catch {
    return {};
  }
}

const ADMIN_IDS = new Set(["admin", "admin_gs"]);

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const m = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] || "(no_url)";
}

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes(`column ${TABLE}.${col} does not exist`) ||
    msg.includes(`Could not find the '${col}' column`) ||
    (msg.toLowerCase().includes(col) && msg.toLowerCase().includes("does not exist"))
  );
}

/**
 * ✅ 핵심: password_hash가 비어있어도,
 * password 컬럼에 scrypt$... 해시가 들어간 경우 자동으로 해시로 검증
 */
function pickStoredForVerify(password_hash: any, password: any) {
  const ph = s(password_hash);
  const pw = s(password);

  // 해시는 둘 중 어디에 있어도 OK
  const isScryptHash = (x: string) => x.startsWith("scrypt$");

  if (isScryptHash(ph)) return { mode: "scrypt" as const, hash: ph, plain: "" };
  if (isScryptHash(pw)) return { mode: "scrypt" as const, hash: pw, plain: "" };

  // 해시가 없으면 평문 비교(기존 호환)
  return { mode: "plain" as const, hash: "", plain: pw };
}

export async function POST(req: NextRequest) {
  const projectRef = getProjectRef();

  try {
    const body = await readBodyAny(req);

    const id = s(
      body?.id ??
        body?.emp_id ??
        body?.empId ??
        body?.username ??
        body?.loginId ??
        body?.user_id
    );
    const pw = s(body?.pw ?? body?.password ?? body?.pass ?? body?.pwd);

    if (!id || !pw) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS", projectRef }, { status: 400 });
    }

    const sb: any = supabaseAdmin;

    // 1) emp_id로 조회
    let matchedBy: "emp_id" | "username" = "emp_id";
    const r1 = await sb.from(TABLE).select("*").eq("emp_id", id).maybeSingle();

    if (r1.error) {
      return NextResponse.json(
        { ok: false, error: "DB_READ_FAILED", projectRef, detail: r1.error.message },
        { status: 500 }
      );
    }

    let row: any = r1.data;

    // 2) 없으면 username fallback (컬럼 없으면 스킵)
    if (!row) {
      matchedBy = "username";
      const r2 = await sb.from(TABLE).select("*").eq("username", id).maybeSingle();

      if (r2.error) {
        if (!isMissingColumn(r2.error, "username")) {
          return NextResponse.json(
            { ok: false, error: "DB_READ_FAILED", projectRef, detail: r2.error.message },
            { status: 500 }
          );
        }
      } else {
        row = r2.data;
      }
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CREDENTIALS", projectRef, detail: { matchedBy, found: false } },
        { status: 401 }
      );
    }

    const isActive =
      row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active);

    if (!isActive) {
      return NextResponse.json(
        { ok: false, error: "INACTIVE_ACCOUNT", projectRef, detail: { matchedBy } },
        { status: 403 }
      );
    }

    const picked = pickStoredForVerify(row.password_hash, row.password);

    let matchHash = false;
    let matchPlain = false;

    if (picked.mode === "scrypt") {
      matchHash = verifyScrypt(pw, picked.hash);
    } else {
      matchPlain = picked.plain ? pw === picked.plain : false;
    }

    if (!(matchHash || matchPlain)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_CREDENTIALS",
          projectRef,
          detail: {
            matchedBy,
            found: true,
            hasHash: !!s(row.password_hash),
            hasPlain: !!s(row.password),
            pwLen: pw.length,
            plainLen: s(row.password).length,
            pickedMode: picked.mode,
            matchHash,
            matchPlain,
          },
        },
        { status: 401 }
      );
    }

    // ✅ 권장: role은 DB 우선, 없으면 관리자ID 기준 fallback
    const dbRole = s(row.role);
    const role = dbRole || (ADMIN_IDS.has(id) ? "admin" : "user");
    const team = s(row.team);

    const res = NextResponse.json({ ok: true, role, empId: row.emp_id, team, projectRef });

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 12,
    };

    res.cookies.set("empId", row.emp_id, cookieOpts);
    res.cookies.set("role", role, cookieOpts);
    if (team) res.cookies.set("team", team, cookieOpts);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "LOGIN_FAILED", projectRef, detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
