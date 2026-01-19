// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BATCH = 500;

// ✅ TS 타입 폭발 방지
const sb: any = supabaseAdmin;

// 질문 FK 후보(프로젝트별 편차 대응)
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

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (low.includes("column") && low.includes("does not exist") && low.includes(col.toLowerCase())) || msg.includes(`Could not find the '${col}' column`);
}

function isMissingTable(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("could not find the table") || msg.includes("relation") && msg.includes("does not exist");
}

function isTypeMismatch(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  // supabase/postgres에서 자주 보이는 타입 불일치 패턴들
  return (
    msg.includes("invalid input syntax") ||
    msg.includes("operator does not exist") ||
    msg.includes("cannot cast") ||
    msg.includes("uuid") && msg.includes("integer") ||
    msg.includes("text") && msg.includes("integer")
  );
}

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  // accounts 스키마가 다를 수 있어서 최소로 안전하게
  // username 컬럼 없을 수도 있으니 2번 시도
  let r = await sb
    .from("accounts")
    .select("emp_id, team, is_active")
    .eq("emp_id", empId)
    .maybeSingle();

  if (r.error) {
    // emp_id 컬럼도 없는 환경이면 그냥 쿠키 기반 fallback (최악 방지)
    return { ok: true as const, team: empId === "admin_gs" ? "B" : "A", empId };
  }

  let data = r.data;

  if (!data) {
    // username fallback (username 컬럼 없으면 에러 뜰 수 있음 → 무시하고 fallback)
    const r2 = await sb.from("accounts").select("emp_id, team, is_active").eq("username", empId).maybeSingle();
    if (!r2.error) data = r2.data;
  }

  if (data?.is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = s((data as any)?.team) || (empId === "admin_gs" ? "B" : "A");
  return { ok: true as const, team, empId };
}

async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (isMissingTable(error)) return false;
  // 권한 등 다른 에러면 존재는 한다고 보고 진행
  return true;
}

/**
 * child table에서 "question fk"로 지우기
 * - idsText 먼저 시도
 * - 타입 불일치나 실패 시 idsNum으로 재시도
 */
async function deleteByQuestionIds(table: string, idsText: string[], idsNum: number[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    // 1) 문자열 ids로 시도
    if (idsText.length > 0) {
      const r1 = await sb.from(table).delete().in(col, idsText);
      if (!r1.error) return { table, ok: true, by: col, mode: "text_ids" };

      // 컬럼 없음이면 다음 후보
      if (isMissingColumn(r1.error, col)) continue;

      // 타입 불일치면 숫자 ids로 재시도
      if (isTypeMismatch(r1.error) && idsNum.length > 0) {
        const r2 = await sb.from(table).delete().in(col, idsNum);
        if (!r2.error) return { table, ok: true, by: col, mode: "num_ids_fallback" };

        if (isMissingColumn(r2.error, col)) continue;
        return { table, ok: false, by: col, mode: "num_ids_fallback", detail: String(r2.error.message || r2.error) };
      }

      // 그 외 에러는 반환
      return { table, ok: false, by: col, mode: "text_ids", detail: String(r1.error.message || r1.error) };
    }

    // idsText가 없고 idsNum만 있을 때
    if (idsNum.length > 0) {
      const r3 = await sb.from(table).delete().in(col, idsNum);
      if (!r3.error) return { table, ok: true, by: col, mode: "num_ids" };
      if (isMissingColumn(r3.error, col)) continue;
      return { table, ok: false, by: col, mode: "num_ids", detail: String(r3.error.message || r3.error) };
    }
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, detail: (auth as any).detail }, { status: auth.status });
    }

    // questions 접근 확인 (team 컬럼도 있는지 확인)
    const test = await sb.from("questions").select("id, team").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    // 하위 테이블들(없어도 스킵)
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

    while (true) {
      // ✅ 삭제하면 당겨지므로 항상 0부터 BATCH만 뽑기
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

      const idsText = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);

      // 숫자로 변환 가능한 것만(있으면)
      const idsNum = idsText
        .map((v) => {
          const num = Number(v);
          return Number.isFinite(num) ? num : null;
        })
        .filter((v): v is number => v !== null);

      if (idsText.length === 0) break;

      // 1) child 먼저 정리
      for (const t of childTables) {
        const r = await deleteByQuestionIds(t, idsText, idsNum);
        childResults.push({ team: auth.team, batch: `${deletedQuestions}-${deletedQuestions + idsText.length - 1}`, ...r });
        // child 정리 실패는 전체 실패로 처리(원하면 continue로 바꿀 수 있음)
        if (r && (r as any).ok === false) {
          return NextResponse.json(
            { ok: false, error: "CLEAR_FAILED", detail: `Child delete failed on ${t}`, team: auth.team, childResults },
            { status: 500 }
          );
        }
      }

      // 2) questions 실삭제 (문자열 ids 우선)
      let del = await sb.from("questions").delete().in("id", idsText).eq("team", auth.team);
      if (del.error && isTypeMismatch(del.error) && idsNum.length > 0) {
        del = await sb.from("questions").delete().in("id", idsNum).eq("team", auth.team);
      }

      if (del.error) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `DELETE questions failed: ${String(del.error.message || del.error)}`, team: auth.team, childResults },
          { status: 500 }
        );
      }

      deletedQuestions += idsText.length;
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
