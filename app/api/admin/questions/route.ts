// app/api/admin/questions/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ✅ TS 타입 폭발 방지
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function num(v: string | null, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function boolParam(v: string | null, d = false) {
  if (v == null) return d;
  const x = String(v).toLowerCase().trim();
  return x === "1" || x === "true" || x === "on" || x === "yes";
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

function isMissingColumnMsg(msg: string, col: string) {
  const low = msg.toLowerCase();
  return (low.includes(col.toLowerCase()) && low.includes("does not exist")) || msg.includes(`Could not find the '${col}' column`);
}

/**
 * ✅ accounts 스키마가 환경마다 달라도 동작하게:
 * - username / is_active 없어도 OK
 * - emp_id / team만 있어도 team 판별 가능
 */
async function getAccountSafe(empId: string) {
  const tries = [
    { cols: "emp_id,team,username,is_active,role" },
    { cols: "emp_id,team,username,role" },
    { cols: "emp_id,team,is_active,role" },
    { cols: "emp_id,team,password" },
    { cols: "emp_id,team" },
  ];

  for (const t of tries) {
    const res = await sb
      .from("accounts")
      .select(t.cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!res.error) return { data: res.data, error: null };

    const msg = String(res.error?.message || res.error);
    if (msg.includes("does not exist") || msg.includes("column")) continue;
    return { data: null, error: res.error };
  }
  return { data: null, error: null };
}

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await getAccountSafe(empId);
  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "DB_QUERY_FAILED",
      detail: String(error.message || error),
    };
  }

  // accounts에 관리자 row가 없어도 기본 A
  const team = String((data as any)?.team ?? "").trim() || (empId === "admin_gs" ? "B" : "A");

  const isActiveVal = (data as any)?.is_active ?? (data as any)?.active ?? (data as any)?.enabled ?? null;
  if (isActiveVal === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  return { ok: true as const, team, empId };
}

const TABLE = "questions";
const COL_ID = "id";
const COL_CONTENT = "content";
const COL_POINTS = "points";
const COL_ACTIVE = "is_active";
const COL_TEAM = "team";

function applyActiveOnlyFilter(q: any) {
  // is_active=true OR null(미세팅은 ON 취급)
  return q.or(`${COL_ACTIVE}.eq.true,${COL_ACTIVE}.is.null`);
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      return t ? JSON.parse(t) : {};
    } catch {
      return {};
    }
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    const url = new URL(req.url);
    const page = Math.max(1, num(url.searchParams.get("page"), 1));
    const pageSize = Math.min(200, Math.max(1, num(url.searchParams.get("pageSize"), 20)));
    const includeOff = boolParam(url.searchParams.get("includeOff"), true);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 1) 총 개수 (내 팀만) - team 컬럼 없을 수도 있어 fallback
    let countQuery = sb.from(TABLE).select(COL_ID, { count: "exact", head: true });
    try {
      countQuery = countQuery.eq(COL_TEAM, auth.team);
    } catch {}
    if (!includeOff) countQuery = applyActiveOnlyFilter(countQuery);

    let countRes = await countQuery;
    if (countRes.error) {
      const msg = String(countRes.error?.message || countRes.error);
      // team 컬럼 없으면 team 필터 제거하고 재시도
      if (isMissingColumnMsg(msg, COL_TEAM)) {
        let cq2 = sb.from(TABLE).select(COL_ID, { count: "exact", head: true });
        if (!includeOff) cq2 = applyActiveOnlyFilter(cq2);
        countRes = await cq2;
      }
    }

    if (countRes.error) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_COUNT_FAILED", detail: String(countRes.error.message || countRes.error) },
        { status: 500 }
      );
    }

    // 2) 리스트 (내 팀만) - team 컬럼 없을 수도 있어 fallback
    const selectCols = [COL_ID, COL_CONTENT, COL_POINTS, COL_ACTIVE].join(",");

    let listQuery = sb.from(TABLE).select(selectCols);
    try {
      listQuery = listQuery.eq(COL_TEAM, auth.team);
    } catch {}
    if (!includeOff) listQuery = applyActiveOnlyFilter(listQuery);

    let listRes = await listQuery.order(COL_ID, { ascending: false }).range(from, to);

    if (listRes.error) {
      const msg = String(listRes.error?.message || listRes.error);
      if (isMissingColumnMsg(msg, COL_TEAM)) {
        let lq2 = sb.from(TABLE).select(selectCols);
        if (!includeOff) lq2 = applyActiveOnlyFilter(lq2);
        listRes = await lq2.order(COL_ID, { ascending: false }).range(from, to);
      }
    }

    if (listRes.error) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String(listRes.error.message || listRes.error) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      team: auth.team,
      page,
      pageSize,
      includeOff,
      total: countRes.count ?? 0,
      items: listRes.data ?? [],
      marker: "ADMIN_QUESTIONS_LIST_TEAM_v3_WITH_DELETE_ALL",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "QUESTIONS_API_ERROR", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    const body = await readBody(req);
    const content = s(body.content);
    const points = Number(body.points);
    const is_active = body.is_active === false ? false : true;

    const choices = Array.isArray(body.choices) ? body.choices.map((x: any) => s(x)).filter((x: string) => x !== "") : [];

    if (!content) return NextResponse.json({ ok: false, error: "MISSING_CONTENT" }, { status: 400 });
    if (choices.length < 2) return NextResponse.json({ ok: false, error: "MISSING_CHOICES" }, { status: 400 });

    const idxRaw = body.correct_index ?? body.answer_index ?? body.answerIndex ?? body.correctIndex;
    const idxNum = idxRaw === undefined || idxRaw === null || idxRaw === "" ? null : Number(idxRaw);
    const idx = Number.isFinite(idxNum) ? Math.trunc(idxNum) : null;

    const insertRow: any = {
      content,
      choices,
      points: Number.isFinite(points) && points > 0 ? Math.trunc(points) : 1,
      is_active,
      team: auth.team,
      correct_index: idx,
      answer_index: idx,
    };

    const { data, error } = await sb.from(TABLE).insert(insertRow).select("id, content, points, is_active").maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: "QUESTION_INSERT_FAILED", detail: String(error.message || error) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, team: auth.team, item: data, marker: "ADMIN_QUESTIONS_CREATE_TEAM_v3" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "QUESTION_CREATE_FATAL", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    const body = await readBody(req);
    const id = body.id;
    if (id === undefined || id === null || id === "") {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const updateRow: any = {};
    if (body.content !== undefined) updateRow.content = s(body.content);
    if (body.points !== undefined) {
      const p = Number(body.points);
      updateRow.points = Number.isFinite(p) && p > 0 ? Math.trunc(p) : 1;
    }
    if (body.is_active !== undefined) updateRow.is_active = body.is_active === false ? false : true;

    if (body.choices !== undefined) {
      const choices = Array.isArray(body.choices) ? body.choices.map((x: any) => s(x)).filter((x: string) => x !== "") : [];
      updateRow.choices = choices;
    }

    if (
      body.correct_index !== undefined ||
      body.answer_index !== undefined ||
      body.answerIndex !== undefined ||
      body.correctIndex !== undefined
    ) {
      const idxRaw = body.correct_index ?? body.answer_index ?? body.answerIndex ?? body.correctIndex;
      const idxNum = idxRaw === undefined || idxRaw === null || idxRaw === "" ? null : Number(idxRaw);
      const idx = Number.isFinite(idxNum) ? Math.trunc(idxNum) : null;
      updateRow.correct_index = idx;
      updateRow.answer_index = idx;
    }

    if (Object.keys(updateRow).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });
    }

    // team 컬럼 없을 수도 있어서 2단계로 시도
    let r = await sb.from(TABLE).update(updateRow).eq("id", id).eq(COL_TEAM, auth.team).select("id, content, points, is_active").maybeSingle();
    if (r.error) {
      const msg = String(r.error?.message || r.error);
      if (isMissingColumnMsg(msg, COL_TEAM)) {
        r = await sb.from(TABLE).update(updateRow).eq("id", id).select("id, content, points, is_active").maybeSingle();
      }
    }

    if (r.error) {
      return NextResponse.json({ ok: false, error: "QUESTION_UPDATE_FAILED", detail: String(r.error.message || r.error) }, { status: 500 });
    }
    if (!r.data) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ ok: true, team: auth.team, item: r.data, marker: "ADMIN_QUESTIONS_UPDATE_TEAM_v3" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "QUESTION_UPDATE_FATAL", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    const url = new URL(req.url);

    // ✅✅✅ 전체삭제: /api/admin/questions?all=1 (&hard=1)
    const all = boolParam(url.searchParams.get("all"), false);
    const hard = boolParam(url.searchParams.get("hard"), false);

    if (all) {
      // 1) team 컬럼 있는 경우: 내 팀만
      if (!hard) {
        // 비활성화 전체
        let r = await sb.from(TABLE).update({ is_active: false }).eq(COL_TEAM, auth.team);
        if (r.error) {
          const msg = String(r.error?.message || r.error);
          if (isMissingColumnMsg(msg, COL_TEAM)) {
            // team 컬럼 없으면 전부 비활성화(최후수단)
            r = await sb.from(TABLE).update({ is_active: false });
          }
        }
        if (r.error) {
          return NextResponse.json({ ok: false, error: "DELETE_ALL_FAILED", detail: String(r.error.message || r.error) }, { status: 500 });
        }
        return NextResponse.json({ ok: true, mode: "soft", team: auth.team, marker: "ADMIN_QUESTIONS_DELETE_ALL_v3" });
      } else {
        // 실제 삭제 전체
        let r = await sb.from(TABLE).delete().eq(COL_TEAM, auth.team);
        if (r.error) {
          const msg = String(r.error?.message || r.error);
          if (isMissingColumnMsg(msg, COL_TEAM)) {
            r = await sb.from(TABLE).delete();
          }
        }
        if (r.error) {
          return NextResponse.json({ ok: false, error: "HARD_DELETE_ALL_FAILED", detail: String(r.error.message || r.error) }, { status: 500 });
        }
        return NextResponse.json({ ok: true, mode: "hard", team: auth.team, marker: "ADMIN_QUESTIONS_HARD_DELETE_ALL_v3" });
      }
    }

    // ✅ 단일 삭제(비활성화)
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    let r = await sb.from(TABLE).update({ is_active: false }).eq("id", id).eq(COL_TEAM, auth.team).select("id, is_active").maybeSingle();
    if (r.error) {
      const msg = String(r.error?.message || r.error);
      if (isMissingColumnMsg(msg, COL_TEAM)) {
        r = await sb.from(TABLE).update({ is_active: false }).eq("id", id).select("id, is_active").maybeSingle();
      }
    }

    if (r.error) {
      return NextResponse.json({ ok: false, error: "QUESTION_DELETE_FAILED", detail: String(r.error.message || r.error) }, { status: 500 });
    }
    if (!r.data) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ ok: true, team: auth.team, item: r.data, marker: "ADMIN_QUESTIONS_DELETE_ONE_v3" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "QUESTION_DELETE_FATAL", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
