// app/api/admin/result-detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}

/** query param을 대소문자 무시하고 가져오기 */
function getParamCI(u: URL, ...keys: string[]) {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of u.searchParams.entries()) {
    if (want.has(k.toLowerCase())) return v;
  }
  return null;
}

function isNumericId(x: string) {
  return /^\d+$/.test(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choiceList ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? ""));
    } catch {}
    if (c.includes("|")) return c.split("|").map((x) => x.trim());
    if (c.includes(",")) return c.split(",").map((x) => x.trim());
    return [c];
  }
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

/** attempt.answers에서 map/ids 추출 (없어도 됨) */
function parseAttemptAnswers(attempt: any): { map: Record<string, number>; questionIds: string[] } {
  let a: any = attempt?.answers;

  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      a = null;
    }
  }

  const mapObj =
    (a?.map && typeof a.map === "object" ? a.map : null) ??
    (a && typeof a === "object" ? a : null) ??
    {};

  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries(mapObj)) {
    const idx = n(v, null);
    if (k && idx !== null) map[String(k).trim()] = idx;
  }

  const qidsRaw = a?.questionIds ?? a?.question_ids ?? a?.questions ?? null;

  let questionIds: string[] = [];
  if (Array.isArray(qidsRaw)) {
    questionIds = qidsRaw
      .map((x: any) => s(typeof x === "object" ? x?.id ?? x?.question_id ?? x?.qid : x))
      .filter(Boolean);
  } else if (typeof qidsRaw === "string") {
    questionIds = qidsRaw.split(",").map((x) => s(x)).filter(Boolean);
  }

  questionIds = Array.from(new Set(questionIds));
  return { map, questionIds };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    // ✅ 어떤 이름으로 오든 attemptId 잡아냄
    const raw =
      getParamCI(u, "attemptId", "attempt_id", "attemptID", "attemptid", "id", "AttemptId", "AttemptID") ?? "";
    const attemptKey = s(raw);

    if (!attemptKey) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { url: req.url, got: raw, allParams: Array.from(u.searchParams.entries()) } },
        { status: 400 }
      );
    }

    // =====================================================
    // ✅ 1) UUID attempt => attempts 테이블(신형)로 상세 생성
    // =====================================================
    if (isUuid(attemptKey)) {
      const { data: attempt, error: aErr } = await supabaseAdmin
        .from("attempts")
        .select("*")
        .eq("id", attemptKey)
        .maybeSingle();

      if (aErr) {
        return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
      }
      if (!attempt) {
        return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId: attemptKey, source: "attempts" } }, { status: 404 });
      }

      // questionIds: attempts.questions 배열 우선
      let questionIds: string[] = [];
      const qs = (attempt as any)?.questions;

      if (Array.isArray(qs)) {
        questionIds = qs.map((x: any) => s(typeof x === "object" ? x?.id ?? x?.question_id ?? x?.qid : x)).filter(Boolean);
      } else if (typeof qs === "string") {
        // 혹시 문자열로 저장된 케이스
        try {
          const parsed = JSON.parse(qs);
          if (Array.isArray(parsed)) questionIds = parsed.map((x: any) => s(x)).filter(Boolean);
        } catch {
          questionIds = qs.split(",").map((x) => s(x)).filter(Boolean);
        }
      }

      // selected map: attempts.answers(있으면) 또는 attempts.answer_map 류 (최대한 호환)
      const selectedByQid = new Map<string, number>();
      const parsed = parseAttemptAnswers(attempt);
      for (const [qid, idx] of Object.entries(parsed.map)) {
        selectedByQid.set(String(qid).trim(), Number(idx));
      }

      if (questionIds.length === 0) questionIds = parsed.questionIds;
      if (questionIds.length === 0) questionIds = Array.from(selectedByQid.keys());

      // wrong ids (attempts.wrongs)
      const wrongIdsRaw = (attempt as any)?.wrongs;
      const wrongIds = Array.isArray(wrongIdsRaw)
        ? wrongIdsRaw.map((x: any) => s(typeof x === "object" ? x?.id ?? x?.question_id ?? x?.qid : x)).filter(Boolean)
        : [];

      // questions 조회
      const { data: questions, error: qErr } = await supabaseAdmin
        .from("questions")
        .select("*")
        .in("id", questionIds.length ? questionIds : ["__never__"]);

      if (qErr) {
        return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });
      }

      const qById = new Map<string, any>();
      for (const q of questions ?? []) qById.set(String((q as any).id), q);

      const graded = questionIds.map((qid) => {
        const q = qById.get(String(qid)) ?? {};
        const selectedIndex = selectedByQid.has(String(qid).trim()) ? selectedByQid.get(String(qid).trim())! : null;
        const correctIndex = pickCorrectIndex(q);

        const status = selectedIndex == null ? "unsubmitted" : "submitted";
        const isCorrect =
          status === "submitted" && correctIndex != null ? Number(selectedIndex) === Number(correctIndex) : false;

        return {
          questionId: q?.id ?? qid,
          content: q?.content ?? "",
          choices: pickChoices(q),
          selectedIndex,
          correctIndex,
          status,
          isCorrect,
        };
      });

      return NextResponse.json({
        ok: true,
        attempt,
        graded,
        meta: {
          idType: "uuid",
          source: "attempts",
          attemptId: attemptKey,
          questionIdsCount: questionIds.length,
          wrongIdsCount: wrongIds.length,
          mapKeysCount: Object.keys(parsed.map).length,
        },
      });
    }

    // =====================================================
    // ✅ 2) 숫자 attempt => exam_attempts(레거시) 기존 로직 그대로
    // =====================================================
    if (!isNumericId(attemptKey)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { url: req.url, got: raw, allParams: Array.from(u.searchParams.entries()) } },
        { status: 400 }
      );
    }

    const attemptId = n(attemptKey, null);
    if (!attemptId || attemptId <= 0) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { url: req.url, got: raw, allParams: Array.from(u.searchParams.entries()) } },
        { status: 400 }
      );
    }

    // 1) attempt (legacy)
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });
    }

    // 2) answers table (legacy)
    const { data: ansRows, error: ansErr } = await supabaseAdmin
      .from("exam_attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (ansErr) {
      return NextResponse.json({ ok: false, error: "ANSWERS_QUERY_FAILED", detail: ansErr }, { status: 500 });
    }

    const selectedByQid = new Map<string, number>();
    for (const r of ansRows ?? []) {
      const qid = s((r as any)?.question_id ?? (r as any)?.questionId ?? (r as any)?.qid);
      const idx =
        n((r as any)?.selected_index, null) ??
        n((r as any)?.selectedIndex, null) ??
        n((r as any)?.answer_index, null) ??
        n((r as any)?.answerIndex, null);

      if (qid && idx !== null) selectedByQid.set(qid.trim(), idx);
    }

    // 3) fallback: attempt.answers(map)
    const parsed = parseAttemptAnswers(attempt);
    for (const [qid, idx] of Object.entries(parsed.map)) {
      const key = String(qid).trim();
      if (!selectedByQid.has(key)) selectedByQid.set(key, Number(idx));
    }

    // 4) questionIds 결정
    let questionIds = parsed.questionIds;
    if (questionIds.length === 0) questionIds = Array.from(selectedByQid.keys());

    // 5) questions
    const { data: questions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", questionIds.length ? questionIds : ["__never__"]);

    if (qErr) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    const graded = questionIds.map((qid) => {
      const q = qById.get(String(qid)) ?? {};
      const selectedIndex = selectedByQid.has(String(qid).trim()) ? selectedByQid.get(String(qid).trim())! : null;
      const correctIndex = pickCorrectIndex(q);

      const status = selectedIndex == null ? "unsubmitted" : "submitted";
      const isCorrect =
        status === "submitted" && correctIndex != null ? Number(selectedIndex) === Number(correctIndex) : false;

      return {
        questionId: q?.id ?? qid,
        content: q?.content ?? "",
        choices: pickChoices(q),
        selectedIndex,
        correctIndex,
        status,
        isCorrect,
      };
    });

    return NextResponse.json({
      ok: true,
      attempt,
      graded,
      meta: {
        idType: "num",
        source: "exam_attempts",
        attemptId,
        answersRowsCount: (ansRows ?? []).length,
        selectedKeysCount: Array.from(selectedByQid.keys()).length,
        mapKeysCount: Object.keys(parsed.map).length,
        questionIdsCount: questionIds.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULT_DETAIL_UNHANDLED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
