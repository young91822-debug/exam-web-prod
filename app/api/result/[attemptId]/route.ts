// app/api/result/[attemptId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function isNumericId(x: string) {
  return /^\d+$/.test(x);
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choice_texts ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string")
    return c.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

/** attempt.answers를 최대한 다양한 형태로 Map으로 변환 */
function buildAnswersMapFromAttempt(attempt: any): Record<string, any> {
  const a = attempt?.answers;

  // 1) object map: { "<qid>": 2, ... }
  if (a && typeof a === "object" && !Array.isArray(a)) return a as any;

  // 2) array: [{questionId, selectedIndex}, ...] 같은 형태도 방어
  if (Array.isArray(a)) {
    const m: Record<string, any> = {};
    for (const it of a) {
      const qid = String(it?.questionId ?? it?.question_id ?? it?.qid ?? it?.id ?? "");
      if (!qid) continue;
      const sel =
        it?.selectedIndex ??
        it?.selected_index ??
        it?.choice_index ??
        it?.answer_index ??
        it?.picked_index ??
        it?.value ??
        null;
      if (sel !== null && sel !== undefined) m[qid] = sel;
    }
    return m;
  }

  return {};
}

/**
 * ✅ exam_answers 테이블에서 attempt_id로 답안 불러오기 (없어도 안전하게 패스)
 * - 컬럼명은 프로젝트마다 달라서 가능한 후보 다 처리
 */
async function buildAnswersMapFromExamAnswers(attemptPk: number) {
  // 테이블이 없거나 컬럼명이 다르면 에러 날 수 있으니 try-catch로 감싼다.
  try {
    const { data, error } = await supabaseAdmin
      .from("exam_answers")
      .select("*")
      .eq("attempt_id", attemptPk);

    if (error) {
      return { ok: false as const, map: {} as Record<string, any>, detail: String(error.message || error) };
    }

    const map: Record<string, any> = {};
    for (const row of data ?? []) {
      const qid = String(row?.question_id ?? row?.questionId ?? row?.qid ?? row?.question_uuid ?? "");
      if (!qid) continue;

      const sel =
        row?.selected_index ??
        row?.selectedIndex ??
        row?.choice_index ??
        row?.answer_index ??
        row?.picked_index ??
        row?.chosen_index ??
        row?.value ??
        null;

      if (sel !== null && sel !== undefined) map[qid] = sel;
    }

    return { ok: true as const, map, detail: null as string | null };
  } catch (e: any) {
    return { ok: false as const, map: {} as Record<string, any>, detail: String(e?.message ?? e) };
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const { attemptId: raw } = await context.params;
    const attemptId = s(raw);

    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }
    if (!isNumericId(attemptId)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // 1) attempt
    const { data: attempt, error: e1 } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (e1) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String(e1.message || e1) }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // 2) question ids
    const questionIds: string[] = Array.isArray(attempt?.question_ids)
      ? attempt.question_ids.map((x: any) => String(x))
      : [];

    // 3) answersMap: attempt.answers 우선 → 비면 exam_answers에서 가져오기
    let answersMap: Record<string, any> = buildAnswersMapFromAttempt(attempt);

    if (!Object.keys(answersMap || {}).length) {
      const fallback = await buildAnswersMapFromExamAnswers(Number(attempt.id));
      if (fallback.ok && Object.keys(fallback.map).length) {
        answersMap = fallback.map;
      }
    }

    // question_ids가 비었으면 answers 키로라도 시도
    const qids = questionIds.length
      ? questionIds
      : Object.keys(answersMap || {}).map((k) => String(k));

    if (!qids.length) {
      return NextResponse.json({
        ok: true,
        attempt,
        graded: [],
        totalQuestions: 0,
        hint: { message: "No question_ids and no answers found." },
      });
    }

    // 4) questions 조회
    const { data: questions, error: e2 } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qids);

    if (e2) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String(e2.message || e2) }, { status: 500 });
    }

    const qMap = new Map<string, any>();
    for (const q of questions ?? []) qMap.set(String(q?.id), q);

    // 5) graded 구성 + 점수 계산
    const order = questionIds.length ? questionIds : qids;

    let computedScore = 0;
    let computedCorrect = 0;

    const graded = order.map((qid: string) => {
      const q = qMap.get(String(qid));

      const correctIndex =
        q?.correct_index ?? q?.correctIndex ?? q?.answer_index ?? q?.answerIndex ?? null;

      // ✅ 핵심: answersMap에서 chosen 가져오기 (qid 그대로 / 문자열키 둘 다)
      const chosenRaw =
        answersMap?.[qid] ?? answersMap?.[String(qid)] ?? null;

      const chosenIndex =
        chosenRaw === null || chosenRaw === undefined ? null : n(chosenRaw, null);

      const ok =
        correctIndex !== null &&
        chosenIndex !== null &&
        Number.isFinite(Number(correctIndex)) &&
        Number.isFinite(Number(chosenIndex)) &&
        Number(correctIndex) === Number(chosenIndex);

      const pts = n(q?.points, 0) ?? 0;
      if (ok) {
        computedCorrect += 1;
        computedScore += pts;
      }

      return {
        questionId: qid,
        content: q?.content ?? q?.question ?? q?.title ?? "",
        choices: pickChoices(q),
        correctIndex: correctIndex === null ? null : Number(correctIndex),
        selectedIndex: chosenIndex === null ? null : Number(chosenIndex),
        isCorrect: !!ok,
        points: pts,
      };
    });

    // attempt.score가 0인데 실제 computed가 있으면 응답에 computed를 우선 보여줌
    const attemptScore = n(attempt?.score, 0) ?? 0;
    const attemptCorrect = n(attempt?.correct_count, 0) ?? 0;

    const outScore =
      attemptScore > 0 ? attemptScore : computedScore;

    const outCorrect =
      attemptCorrect > 0 ? attemptCorrect : computedCorrect;

    return NextResponse.json({
      ok: true,
      attempt: {
        id: attempt.id,
        emp_id: attempt.emp_id,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        total_questions: attempt.total_questions,
        total_points: attempt.total_points,
        score: outScore,
        correct_count: outCorrect,
        status: attempt.status,
        // 디버그용: 어디서 답을 가져왔는지 힌트
        answers_source: Object.keys(buildAnswersMapFromAttempt(attempt)).length ? "exam_attempts.answers" : "exam_answers(attempt_id)",
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
