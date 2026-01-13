// app/api/admin/results/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const empId = s(url.searchParams.get("empId"));
    const onlySubmitted = s(url.searchParams.get("onlySubmitted"));

    let q = sb
      .from("exam_attempts")
      .select("*")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("started_at", { ascending: false });

    if (empId) q = q.eq("emp_id", empId);
    if (onlySubmitted && ["1", "true", "y", "yes"].includes(onlySubmitted.toLowerCase())) {
      q = q.not("submitted_at", "is", null);
    }

    const { data: attempts, error } = await q;
    if (error) {
      return NextResponse.json({ ok: false, error: "DB_QUERY_FAILED", detail: error.message }, { status: 500 });
    }

    const empIds = Array.from(
      new Set((attempts ?? []).map((a: any) => s(a?.emp_id)).filter((x) => x))
    );

    let accountsMap = new Map<string, any>();
    if (empIds.length) {
      const { data: accRows, error: accErr } = await sb
        .from("accounts")
        .select("*") // ✅ 안전: is_active 같은 특정 컬럼을 안 찍음
        .in("emp_id", empIds);

      if (!accErr && Array.isArray(accRows)) {
        for (const r of accRows) accountsMap.set(s(r?.emp_id), r);
      }
    }

    const rows = (attempts ?? []).map((a: any) => {
      const acc = accountsMap.get(s(a?.emp_id)) ?? null;
      return {
        ...a,
        account: acc
          ? {
              id: acc?.id,
              emp_id: acc?.emp_id,
              name: acc?.name ?? acc?.emp_name ?? null,
              // 화면에서 쓰기 좋게 통일
              active: Boolean(
                acc?.is_active ??
                  acc?.active ??
                  acc?.enabled ??
                  acc?.isEnabled ??
                  acc?.use_yn ??
                  acc?.useYn ??
                  true
              ),
              created_at: acc?.created_at ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
