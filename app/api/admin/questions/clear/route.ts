// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BATCH = 500;

// ✅ TS 타입 폭발 방지
const sb: any = supabaseAdmin;

// 질문 참조 FK 컬럼 후보 (프로젝트마다 달라서 넉넉히)
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

function s(v: any) {
  return String(v ?? "").trim();
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

function isMissingColumn(err: any) {
  const msg = String(err?.message ?? err ?? "");
  const low = msg.toLowerCase();
  return low.includes("does not exist") || low.includes("could not find") || low.includes("schema cache");
}

function isMissingTable(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("could not find the table") || msg.includes("relation") || msg.includes("does not exist");
}

function isTypeMismatch(err: any) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  // bigint 컬럼에 uuid 문자열 넣을 때 흔히 뜨는 메시지들
  return msg.includes("invalid input syntax") || msg.includes("cannot cast") || msg.includes("operator does not exist");
}

async function getAccountSafe(empId: string) {
  const tries = [
    { cols: "emp_id,team,username,is_active,role" },
    { cols: "emp_id,team,username,role" },
    { cols: "emp_id,team,is_active,role" },
    { cols: "emp_id,team,role" },
    { cols: "emp_id,team" },
  ];

  for (const t of tries) {
    const r = await sb
      .from("accounts")
      .select(t.cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!r.error) return { data: r.data, error: null };
    if (isMissingColumn(r.error)) continue;
    return { data: null, error: r.error };
  }
  return { data: null, error: null };
}

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId") || getCookie(cookieHeader, "userId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await getAccountSafe(empId);
  if (error) {
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: String(error.message || error) };
  }

  const isActiveVal = (data as any)?.is_active ?? (data as any)?.active ?? (data as any)?.enabled ?? null;
  if (isActiveVal === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  // team 없거나 비어도 절대 터지지 않게 fallback
  const team = s((data as any)?.team) || (empId === "admin_gs" ? "B" : "A");
  return { ok: true as const, team, empId };
}

async function tableExists(table: string) {
  const r = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!r.error) return true;
  if (isMissingTable(r.error)) return false;
  // 권한 문제 등은 "테이블은 있다"로 보고 계속 (delete 시도 후 결과로 판단)
  return true;
}

async function deleteByQuestionIds(table: string, idsRaw: string[], idsNum: number[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    // 1) 문자열(= uuid)로 먼저 시도
    let r1: any = await sb.from(table).delete().in(col, idsRaw);
    if (!r1.error) return { table, ok: true, by: col, mode: "raw" as const };

    // 컬럼 없으면 다음 후보
    if (isMissingColumn(r1.error)) continue;

    // 타입 미스매치(예: bigint 컬럼인데 uuid 문자열)면 숫자 id가 있으면 숫자로 재시도
    if (isTypeMismatch(r1.error) && idsNum.length > 0) {
      const r2: any = await sb.from(table).delete().in(col, idsNum);
      if (!r2.error) return { table, ok: true, by: col, mode: "num" as const };

      if (isMissingColumn(r2.error)) continue;
      // 또 다른 에러면 반환
      return { table, ok: false, by: col, mode: "num" as const, detail: String(r2.error?.message || r2.error) };
    }

    // 그 외 에러면 반환 (RLS, 권한, 제약 등)
    return { table, ok: false, by: col, mode: "raw" as const, detail: String(r1.error?.message || r1.error) };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    // questions 최소 체크 (team 컬럼 없으면 여기서 바로 걸리게 함)
    const test = await sb.from("questions").select("id, team").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    // 하위 테이블 후보
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

    const childResults: any[] = [];
    let deletedQuestions = 0;

    // ✅ “삭제하면 당겨지니까” 항상 0부터 뽑는 방식 유지
    while (true) {
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team)
        .range(0, BATCH - 1);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT questions failed: ${String(selErr.message || selErr)}`, team: auth.team },
          { status: 500 }
        );
      }

      const idsRaw = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);

      if (idsRaw.length === 0) break;

      // 숫자형 id도 같이 준비(있는 경우에만)
      const idsNum = idsRaw
        .map((x) => {
          const n = Number(x);
          return Number.isFinite(n) ? n : null;
        })
        .filter((x: any) => x !== null) as number[];

      // 1) FK 하위테이블 먼저 삭제(가능한 것만)
      for (const t of childTables) {
        const r = await deleteByQuestionIds(t, idsRaw, idsNum);
        childResults.push({ team: auth.team, batch: `0-${idsRaw.length - 1}`, ...r });
      }

      // 2) questions 하드 삭제 (UUID/숫자 모두 OK)
      const delQ = await sb.from("questions").delete().in("id", idsRaw).eq("team", auth.team);
      if (delQ.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `DELETE questions failed: ${String(delQ.error.message || delQ.error)}`,
            team: auth.team,
            childResults,
          },
          { status: 500 }
        );
      }

      deletedQuestions += idsRaw.length;
    }

    return NextResponse.json({
      ok: true,
      cleared: true,
      team: auth.team,
      deletedQuestions,
      childResults,
      marker: "ADMIN_QUESTIONS_CLEAR_HARD_v2_UUID_OK",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
