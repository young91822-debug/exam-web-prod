// app/api/admin/accounts/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
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

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: "ACCOUNTS_LIST_FAILED", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "ACCOUNTS_LIST_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    // 화면/프론트가 어떤 키로 보내도 다 받게
    const empId = s(body.empId ?? body.emp_id ?? body.employeeId ?? body.employee_id);
    const name = s(body.name ?? body.displayName ?? body.koreanName ?? body.fullname); // "이름(선택)" 값
    const isActive = b(body.isActive ?? body.is_active ?? body.active ?? body.use, true);

    // ✅ 핵심: accounts.username NOT NULL 대응
    // 우선순위: body.username -> body.name -> empId
    const username = s(body.username) || name || empId;

    if (!empId) {
      return NextResponse.json({ ok: false, error: "MISSING_EMP_ID" }, { status: 400 });
    }
    if (!username) {
      // empId도 없고 name도 없으면 여기로 오는데, empId 체크에서 이미 걸러짐
      return NextResponse.json({ ok: false, error: "MISSING_USERNAME" }, { status: 400 });
    }

    // 1) username/emp_id/is_active 처럼 "거의 확실히 존재하는 컬럼만"으로 안전하게 upsert
    const baseRow: any = {
      emp_id: empId,
      username,            // ✅ NOT NULL 채움
      is_active: isActive, // ✅ 사용여부
    };

    const { data: upserted, error: upErr } = await supabaseAdmin
      .from("accounts")
      .upsert(baseRow, { onConflict: "emp_id" })
      .select("*")
      .maybeSingle();

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNTS_UPSERT_FAILED", detail: upErr.message, sent: baseRow },
        { status: 500 }
      );
    }

    // 2) name 컬럼이 테이블에 있으면 업데이트(없으면 에러 나는데 그건 무시하고 진행)
    //    -> username NOT NULL 문제는 이미 해결됐으니, 부가정보만 "있으면" 저장
    if (name && upserted?.id) {
      const tryCols = [
        { col: "name", val: name },
        { col: "display_name", val: name },
        { col: "fullname", val: name },
      ];

      for (const t of tryCols) {
        const { error: nameErr } = await supabaseAdmin
          .from("accounts")
          .update({ [t.col]: t.val })
          .eq("id", upserted.id);

        if (!nameErr) break; // 하나라도 성공하면 종료
      }
    }

    return NextResponse.json({
      ok: true,
      item: upserted,
      saved: { empId, username, isActive, name: name || null },
      marker: "ACCOUNTS_CREATED_OR_UPDATED_WITH_USERNAME_NOT_NULL",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "ACCOUNTS_CREATE_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
