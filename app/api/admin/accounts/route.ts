// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function b(v: any, d = true) {
  if (v === undefined || v === null || v === "") return d;
  if (typeof v === "boolean") return v;
  const t = s(v).toLowerCase();
  if (["1", "true", "y", "yes", "on", "사용"].includes(t)) return true;
  if (["0", "false", "n", "no", "off", "미사용"].includes(t)) return false;
  return d;
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      if (!t) return {};
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
}

/**
 * password_hash 생성 (crypto.scrypt)
 * 저장 포맷: scrypt$<saltB64>$<hashB64>
 */
function makePasswordHash(plain: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_LIST_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const empId = s(body.empId ?? body.emp_id ?? body.employeeId ?? body.employee_id);
    const name = s(body.name ?? body.displayName ?? body.koreanName ?? body.fullname);
    const isActive = b(body.isActive ?? body.is_active ?? body.active ?? body.use, true);

    // accounts.username NOT NULL 대응
    const username = s(body.username) || name || empId;

    if (!empId) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }
    if (!username) {
      return NextResponse.json({ ok: false, error: "MISSING_USERNAME" }, { status: 400 });
    }

    // 1) 먼저 기존 계정 있는지 확인 (있으면 비번 건드리지 말 것)
    const { data: exists, error: exErr } = await supabaseAdmin
      .from("accounts")
      .select("id, emp_id")
      .eq("emp_id", empId)
      .maybeSingle();

    if (exErr) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_EXIST_CHECK_FAILED", detail: exErr.message },
        { status: 500 }
      );
    }

    // ✅ 신규 생성 시 기본 비밀번호
    // - body.password / body.pw / body.passwordPlain 보내면 그걸로 생성 가능
    // - 없으면 기본값 1234
    const plainPassword = s(body.password ?? body.pw ?? body.passwordPlain) || "1234";

    if (exists?.id) {
      // ====== UPDATE (기존 계정) ======
      const updateRow: any = { username, is_active: isActive };

      const { data: updated, error: upErr } = await supabaseAdmin
        .from("accounts")
        .update(updateRow)
        .eq("id", exists.id)
        .select("*")
        .maybeSingle();

      if (upErr) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_UPDATE_FAILED", detail: upErr.message, sent: updateRow },
          { status: 500 }
        );
      }

      // name 컬럼이 있으면 저장 시도(없으면 실패해도 무시)
      if (name) {
        const tryCols = ["name", "display_name", "fullname"];
        for (const col of tryCols) {
          const { error: nameErr } = await supabaseAdmin
            .from("accounts")
            .update({ [col]: name })
            .eq("id", exists.id);
          if (!nameErr) break;
        }
      }

      return NextResponse.json({
        ok: true,
        item: updated,
        mode: "UPDATED",
        marker: "ACCOUNTS_UPDATED_PASSWORD_UNCHANGED",
      });
    } else {
      // ====== INSERT (신규 계정) ======
      const password_hash = makePasswordHash(plainPassword);

      const insertRow: any = {
        emp_id: empId,
        username,
        is_active: isActive,
        password_hash, // ✅ NOT NULL 충족
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("accounts")
        .insert(insertRow)
        .select("*")
        .maybeSingle();

      if (insErr) {
        return NextResponse.json(
          { ok: false, error: "ACCOUNTS_INSERT_FAILED", detail: insErr.message, sent: { ...insertRow, password_hash: "****" } },
          { status: 500 }
        );
      }

      // name 컬럼 있으면 저장 시도(없으면 무시)
      if (name && inserted?.id) {
        const tryCols = ["name", "display_name", "fullname"];
        for (const col of tryCols) {
          const { error: nameErr } = await supabaseAdmin
            .from("accounts")
            .update({ [col]: name })
            .eq("id", inserted.id);
          if (!nameErr) break;
        }
      }

      return NextResponse.json({
        ok: true,
        item: inserted,
        mode: "CREATED",
        tempPassword: plainPassword, // ✅ 화면에서 "기본 비번" 안내 가능
        marker: "ACCOUNTS_CREATED_WITH_PASSWORD_HASH",
      });
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_CREATE_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
