// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function isNumericId(x: string) {
  return /^\d+$/.test(x);
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choice_texts ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") return c.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/** attempt에 저장돼 있을 수 있는 문제목록을 최대한 찾아봄 */
function pickAttemptQuestionIds(attempt: any): string[] {
  const cands = [
    attempt?.question_ids,
    attempt?.questionIds,
    attempt?.questions,
    attempt?.question_list,
    attempt?.questionList,
    attempt?.qids,
  ];

  for (const v of cands) {
    if (!v) continue;

    if (Array.isArray(v)) {
      const out = v.map((x) => s(x)).filter(Boolean);
      if (out.length) return out;
    }

    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;

      // JSON 배열 가능
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
          const out = parsed.map((x) => s(x)).filter(Boolean);
          if (out.length) return out;
        }
      } catch {}

      // 콤마 문자열 가능
      if (t.includes(",")) {
        const out = t.split(",").map((x) => s(x)).filter(Boolean);
        if (out.length) return out;
      }
    }

    if (typeof v === "object") {
      const out = Object.keys(v).map((k) => s(k)).filter(Boolean);
      if (out.length) return out;
    }
  }

  return [];
}

/** attempt.answers(맵 형태)에서 qids/선택값 뽑기 */
function pickAttemptAnswersMap(attempt: any): Map<string, number> {
  const m = new Map<string, number>();
  const raw = attempt?.answers;
  if (!raw) return m;

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          const key = s(k);
          const val = n(v, null);
          if (key && val !== null) m.set(key, val);
        }
      }
    } catch {
      return m;
    }
    return m;
  }

  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const key = s(k);
      const val = n(v, null);
      if (key && val !== null) m.set(key, val);
    }
  }

  return m;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const { attemptId: raw } = await context.params;
    const attemptIdStr = s(raw);

    if (!attemptIdStr) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }
    if (!isNumericId(attemptIdStr)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const attemptId = Number(attemptIdStr);

    // 1) attempt
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String((e1 as any)?.message ?? e1) },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    /**
     * 2) 답변 소스 우선순위
     *  - exam_answers(attempt_id)에서 question_uuid/selected_index 읽기
     *  - 없으면 attempt.answers(JSON) fallback
     */
    const ansMap = new Map<string, number>();

    const { data: answers, error: eAns } = await supabaseAdmin
      .from("exam_answers")
      .select("question_uuid, selected_index")
      .eq("attempt_id", attemptId);

    if (eAns) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_QUERY_FAILED", detail: String((eAns as any)?.message ?? eAns) },
        { status: 500 }
      );
    }

    for (const a of answers ?? []) {
      const qid = s(a?.question_uuid);
      const sel = a?.selected_index;
      if (!qid) continue;
      if (sel === null || sel === undefined) continue;
      ansMap.set(qid, Number(sel));
    }

    let answersSource = "exam_answers(attempt_id)";
    if (ansMap.size === 0) {
      const fallback = pickAttemptAnswersMap(attempt);
      if (fallback.size > 0) {
        for (const [k, v] of fallback.entries()) ansMap.set(k, v);
        answersSource = "attempt.answers(JSON)";
      }
    }

    /**
     * 3) 문제 목록(qids) 만들기
     *  - attempt에 저장된 문제목록이 있으면 그걸 사용(전체 20문항 표시 가능)
     *  - 없으면 "답이 있는 문제만"이라도 표시
     */
    const attemptQids = pickAttemptQuestionIds(attempt);
    const qids = attemptQids.length > 0 ? attemptQids : Array.from(ansMap.keys());

    if (!qids.length) {
      // 문제목록도 없고 답도 없으면(진짜 데이터 없음)
      return NextResponse.json({
        ok: true,
        attempt: {
          id: attempt.id,
          emp_id: attempt.emp_id,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
          total_questions: attempt.total_questions,
          total_points: attempt.total_points,
          score: attempt.score ?? 0,
          correct_count: attempt.correct_count ?? 0,
          status: attempt.status,
          answers_source: answersSource,
        },
        graded: [],
        totalQuestions: 0,
        wrongCount: 0,
      });
    }

    // 4) questions 조회
    // - 보통 questions.id가 uuid라서 그대로 in("id", qids) 하면 됨
    // - 혹시 numeric도 섞이면 대비
    const uniqQids = Array.from(new Set(qids.map((x) => s(x)).filter(Boolean)));
    const allNumeric = uniqQids.every((x) => /^\d+$/.test(x));
    const qidsForQuery = allNumeric ? uniqQids.map((x) => Number(x)) : uniqQids;

    const { data: questions, error: eQ } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qidsForQuery as any);

    if (eQ) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((eQ as any)?.message ?? eQ) },
        { status: 500 }
      );
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(s(q?.id), q);

    // 5) graded를 "qids 순서"대로 구성 (중요: 화면에서 20문제 유지)
    let score = 0;
    let correctCount = 0;

    const graded = uniqQids
      .map((qid) => {
        const q = qById.get(qid);
        if (!q) return null;

        const correctIndex = pickCorrectIndex(q);
        const chosen = ansMap.has(qid) ? ansMap.get(qid)! : null;

        const isCorrect =
          correctIndex !== null &&
          chosen !== null &&
          Number.isFinite(Number(correctIndex)) &&
          Number.isFinite(Number(chosen)) &&
          Number(correctIndex) === Number(chosen);

        const pts = n(q?.points, 0) ?? 0;
        if (isCorrect) {
          score += pts;
          correctCount += 1;
        }

        return {
          questionId: q?.id,
          content: q?.content ?? q?.question ?? q?.title ?? "",
          choices: pickChoices(q),
          correctIndex: correctIndex === null ? null : Number(correctIndex),
          selectedIndex: chosen === null ? null : Number(chosen),
          isCorrect,
          points: pts,
        };
      })
      .filter(Boolean) as any[];

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        emp_id: attempt.emp_id,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        total_questions: attempt.total_questions,
        total_points: attempt.total_points,
        score,
        correct_count: correctCount,
        status: attempt.status,
        answers_source: answersSource,
      },
      graded,
      totalQuestions: graded.length,
      wrongCount: graded.filter((g: any) => g?.isCorrect === false).length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED_ERROR", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
