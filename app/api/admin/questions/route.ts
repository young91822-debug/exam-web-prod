// app/api/admin/questions/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

function num(v: string | null, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: string | null, d = false) {
  if (v == null) return d;
  const s = String(v).toLowerCase().trim();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

const TABLE = "questions";
const COL_ID = "id";
const COL_CONTENT = "content";
const COL_POINTS = "points";
const COL_ACTIVE = "is_active";

function applyActiveOnlyFilter(q: any) {
  // is_active=true OR null (미세팅은 ON 취급)
  return q.or(`${COL_ACTIVE}.eq.true,${COL_ACTIVE}.is.null`);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const page = Math.max(1, num(url.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, num(url.searchParams.get("pageSize"), 20)));

    // ✅ 기본 "전체(ON/OFF 포함)" 표시
    const includeOff = bool(url.searchParams.get("includeOff"), true);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 1) 총 개수
    let countQuery = supabaseAdmin.from(TABLE).select(COL_ID, { count: "exact", head: true });
    if (!includeOff) countQuery = applyActiveOnlyFilter(countQuery);

    const { count, error: countErr } = await countQuery;
    if (countErr) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_COUNT_FAILED", detail: countErr.message },
        { status: 500 }
      );
    }

    // 2) 페이지 데이터
    const selectCols = [COL_ID, COL_CONTENT, COL_POINTS, COL_ACTIVE].join(",");

    let listQuery = supabaseAdmin.from(TABLE).select(selectCols as any);
    if (!includeOff) listQuery = applyActiveOnlyFilter(listQuery);

    const { data, error } = await listQuery
      .order(COL_ID as any, { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      includeOff,
      total: count ?? 0,
      items: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "QUESTIONS_API_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
