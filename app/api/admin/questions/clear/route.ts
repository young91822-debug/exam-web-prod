// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sb: any = supabaseAdmin;
const BATCH = 500;

function s(v: any) {
  return String(v ?? "").trim();
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((x) => x.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

function isMissingColumn(err: any, table: string, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (
    low.includes(`column ${table.toLowerCase()}.${col.toLowerCase()} does not exist`) ||
    low.includes(`could not find the '${col.toLowerCase()}' column`) ||
    (low.includes(col.toLowerCase()) && low.includes("does not exist"))
  );
}

function isMissingTable(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("could not find the table") ||
    msg.includes("relation") && msg.includes("does not exist") ||
    msg.includes("not found")
  );
}

function isFkViolation(err: any) {
  // Postgres FK violation code: 23503
  const code = String((err as any)?.code || "");
  const msg = String((err as any)?.message || err || "").toLowerCase();
  return code === "23503" || msg.includes("foreign key") || msg.includes("violates foreign key");
}

async function requireAdminTeam(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const empId = getCookie(cookie, "empId") || getCookie(cookie, "userId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  // accounts 스키마가 환경마다 달라서 안전하게 조회
  const tries = [
    "emp_id,team,role,is_active,username",
    "emp_id,team,role,is_active",
    "emp_id,team,role",
    "emp_id,team",
  ];

  let row: any = null;

  for (const cols of tries) {
    const r = await sb
      .from("accounts")
      .select(cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!r.error) {
      row = r.data;
      break;
    }

    // 컬럼 차이로 실패 → 다음 시도
    const msg = String(r.error?.message || r.error || "");
    if (msg.includes("does not exist") || msg.toLowerCase().includes("column")) continue;

    return {
      ok: false as const,
      status: 500,
      error: "DB_QUERY_FAILED",
      detail: String(r.error?.message || r.error),
    };
  }

  // team이 비었으면 admin_gs만 B, 나머지 A
  const team = s(row?.team) || (empId === "admin_gs" ? "B" : "A");

  // is_active 컬럼이 있으면 비활성 체크
  if (row && row.is_active === false) {
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };
  }

  return { ok: true as const, empId, team };
}

/** GET으로 열었을 때 405 대신 안내용 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json({
    ok: true,
    marker: "CLEAR_ROUTE_PING_v2",
    method: "Use POST to clear questions",
    path: u.pathname,
  });
}

/** 테이블 존재 여부(없으면 스킵) */
async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (isMissingTable(error)) return false;
  // 권한/기타면 존재는 할 수 있으니 true 취급
  return true;
}

const QUESTION_FK_COL_CANDIDATES = [
  "question_id",
  "questionId",
  "question_uuid",
  "questionUuid",
  "qid",
  "question",
  "question_no",
  "questionNo",
];

async function deleteByQuestionIds(table: string, ids: string[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const r = await sb.from(table).delete().in(col, ids);
    if (!r.error) return { table, ok: true, by: col };

    if (isMissingColumn(r.error, table, col)) continue;

    return {
      table,
      ok: false,
      by: col,
      detail: String((r.error as any).message || r.error),
      fk: isFkViolation(r.error),
    };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

/** questions에서 "내 팀" id를 가져오기 (team 컬럼 없으면 전체) */
async function selectQuestionIds(team: string) {
  // 1) team 컬럼 있는 케이스
  let r = await sb.from("questions").select("id,team").eq("team", team).limit(BATCH);
  if (!r.error) {
    const ids = (r.data || []).map((x: any) => s(x?.id)).filter(Boolean);
    return { ids, mode: "team_filtered" as const, err: null };
  }

  // team 컬럼이 없으면 fallback (전체에서 삭제 — 최후수단)
  if (isMissingColumn(r.error, "questions", "team")) {
    const r2 = await sb.from("questions").select("id").limit(BATCH);
    if (r2.error) return { ids: [] as string[], mode: "fallback_failed" as const, err: r2.error };
    const ids = (r2.data || []).map((x: any) => s(x?.id)).filter(Boolean);
    return { ids, mode: "no_team_column_all_rows" as const, err: null };
  }

  return { ids: [] as string[], mode: "select_failed" as const, err: r.error };
}

/** questions를 하드삭제 (team 컬럼 있으면 team도 같이) */
async function deleteQuestions(ids: string[], team: string) {
  // 1) team 컬럼 있는 케이스
  let r = await sb.from("questions").delete().in("id", ids).eq("team", team);
  if (!r.error) return { ok: true, mode: "team_filtered" as const, err: null };

  // team 컬럼이 없으면 fallback
  if (isMissingColumn(r.error, "questions", "team")) {
    const r2 = await sb.from("questions").delete().in("id", ids);
    if (r2.error) return { ok: false, mode: "no_team_column_all_rows" as const, err: r2.error };
    return { ok: true, mode: "no_team_column_all_rows" as const, err: null };
  }

  return { ok: false, mode: "delete_failed" as const, err: r.error };
}

/** POST: 진짜 하드 삭제 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    // 자식 테이블(프로젝트별 이름 다양해서 넉넉히)
    const childTables = [
      "exam_answers",
      "attempt_answers",
      "exam_attempt_answers",
      "attempt_questions",
      "exam_attempt_questions",
      "question_answers",
      "question_options",
      "question_choices",
      "choices",
      "answers",
    ];

    let deletedQuestions = 0;
    const childResults: any[] = [];
    let loop = 0;

    while (true) {
      loop++;

      const sel = await selectQuestionIds(auth.team);
      if (sel.err) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `SELECT questions failed: ${String(sel.err?.message || sel.err)}`,
            team: auth.team,
          },
          { status: 500 }
        );
      }

      const ids = sel.ids;
      if (ids.length === 0) break;

      // 1) 자식 테이블 먼저 삭제
      for (const t of childTables) {
        const rr = await deleteByQuestionIds(t, ids);
        childResults.push({
          team: auth.team,
          batchSize: ids.length,
          selectMode: sel.mode,
          ...rr,
        });
      }

      // 2) questions 하드삭제
      const del = await deleteQuestions(ids, auth.team);
      if (!del.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `DELETE questions failed: ${String(del.err?.message || del.err)}`,
            team: auth.team,
            selectMode: sel.mode,
            childResultsPreview: childResults.slice(0, 30),
          },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;

      // 무한루프 방지(이론상 ids가 줄어야 정상)
      if (loop > 2000) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_ABORTED",
            detail: "too many loops (safety stop)",
            team: auth.team,
            deletedQuestions,
            childResultsPreview: childResults.slice(0, 30),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      marker: "QUESTIONS_HARD_CLEAR_OK_v3",
      team: auth.team,
      deletedQuestions,
      childResultsPreview: childResults.slice(0, 30),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
