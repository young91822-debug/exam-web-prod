// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BATCH = 500;

// 질문을 참조하는 컬럼명이 프로젝트마다 달라서 후보를 넉넉히 둠
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

async function tableExists(table: string) {
  // head + count로 존재 여부만 가볍게 체크
  const { error } = await supabaseAdmin.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;

  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("could not find the table") || msg.includes("relation")) return false;

  // 다른 에러(권한 등)면 존재는 하는데 접근문제일 수 있어서 true 취급
  return true;
}

async function deleteByQuestionIds(table: string, ids: any[]) {
  // table이 없으면 스킵
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  // FK 컬럼 후보들로 하나씩 시도
  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const { error } = await supabaseAdmin.from(table).delete().in(col as any, ids as any);

    if (!error) return { table, ok: true, by: col };

    const msg = String(error.message || "");

    // 컬럼 없음이면 다음 후보로 계속
    if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("does not exist")) {
      continue;
    }

    // WHERE required면(설정) -> 그래도 우리는 IN을 썼으니 보통 안 뜸. 뜨면 에러 반환
    return { table, ok: false, by: col, detail: msg };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

export async function POST() {
  try {
    // 1) questions의 id 전체를 배치로 긁어서 삭제
    //    PostgREST는 DELETE requires WHERE라서, 반드시 in(id, [...]) 방식으로 지워야 함.

    // ✅ 먼저 questions 테이블에서 id 컬럼 조회가 되는지 확인
    const test = await supabaseAdmin.from("questions").select("id").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    const childTables = [
      "attempt_answers",         // 네 로그에 실제로 존재
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

    // supabase-js는 offset 기반이 가능(range). id 전체를 큰 리스트로 한 번에 받지 말고 배치로 처리
    let offset = 0;

    while (true) {
      const { data: rows, error: selErr } = await supabaseAdmin
        .from("questions")
        .select("id")
        .range(offset, offset + BATCH - 1);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT questions failed: ${String(selErr.message || selErr)}` },
          { status: 500 }
        );
      }

      const ids = (rows || []).map((r: any) => r.id).filter((v: any) => v !== null && v !== undefined);
      if (ids.length === 0) break;

      // 2) FK 하위테이블 먼저 지우기 (가능한 것만 best-effort)
      for (const t of childTables) {
        const r = await deleteByQuestionIds(t, ids);
        childResults.push({ batch: `${offset}-${offset + ids.length - 1}`, ...r });
      }

      // 3) questions 삭제 (반드시 WHERE)
      const { error: delErr } = await supabaseAdmin.from("questions").delete().in("id" as any, ids as any);
      if (delErr) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `DELETE questions failed: ${String(delErr.message || delErr)}`,
            childResults,
          },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;
      offset += BATCH;
    }

    return NextResponse.json({
      ok: true,
      cleared: true,
      deletedQuestions,
      childResults,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
