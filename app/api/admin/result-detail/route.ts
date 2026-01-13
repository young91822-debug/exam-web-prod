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
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choiceList ?? q?.choice_texts ?? q?.choiceTexts ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? ""));
    } catch {}
    if (c.includes("|")) return c.split("|").map((x) => x.trim()).filter(Boolean);
    if (c.includes("\n")) return c.split("\n").map((x) => x.trim()).filter(Boolean);
    if (c.includes(",")) return c.split(",").map((x) => x.trim()).filter(Boolean);
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

/** attempt.answers에서 map/ids 추출 */
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

  // questionIds는 legacy에선 attempt.question_ids(ARRAY)가 더 정확하니까 여기선 보조만
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

/** legacy(exam_attempts)에서 graded 만들기: question_ids + answers(map) 기반 */
async function buildLegacyDetailFromExamAttempts(attempt: any) {
  // question_ids(ARRAY)가 1순위
  let questionIds: string[] = Array.isArray(attempt?.question_ids)
    ? attempt.question_ids.map((x: any) => s(x)).filter(Boolean)
    : [];

  const parsed = parseAttemptAnswers(attempt);

  // fallback: parseAttemptAnswers.questionIds or map keys
  if (questionIds.length === 0) questionIds = parsed.questionIds;
  if (questionIds.length === 0) questionIds = Object.keys(parsed.map || {}).map((k) => s(k)).filter(Boolean);

  const selectedByQid = new Map<string, number>();
  for (const [qid, idx] of Object.entries(parsed.map)) selectedByQid.set(String(qid).trim(), Number(idx));

  // questions fetch
  const { data: questions, error: qErr } = await supabaseAdmin
    .from("questions")
    .select("*")
    .in("id", questionIds.length ? questionIds : ["__never__"]);

  if (qErr) {
    return { ok: false as const, error: "QUESTIONS_QUERY_FAILED", detail: qErr };
  }

  const qById = new Map<string, any>();
  for (const q of questions ?? []) qById.set(String((q as any).id), q);

  const graded = questionIds.map((qid) => {
    const q = qById.get(String(qid)) ?? {};
    const key = String(qid).trim();
    const selectedIndex = selectedByQid.has(key) ? selectedByQid.get(key)! : null;
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

  return {
    ok: true as const,
    attempt,
    graded,
    meta: {
      idType: "num",
      source: "exam_attempts",
      attemptId: attempt?.id,
      questionIdsCount: questionIds.length,
      mapKeysCount: Object.keys(parsed.map).length,
    },
  };
}

/** UUID attempt를 legacy(exam_attempts)로 매칭: started_at 기준(±2분) */
async function resolveLegacyByStartedAt(attemptUuidRow: any) {
  const startedAt = attemptUuidRow?.started_at ?? attemptUuidRow?.startedAt ?? null;
  if (!startedAt) return { ok: false as const, error: "UUID_ATTEMPT_NO_STARTED_AT" };

  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return { ok: false as const, error: "UUID_ATTEMPT_BAD_STARTED_AT", detail: startedAt };

  // ±2분 window
  const t0 = new Date(d.getTime() - 2 * 60 * 1000).toISOString();
  const t1 = new Date(d.getTime() + 2 * 60 * 1000).toISOString();

  // 같은 시간대 attempt가 여러 개면 submitted_at 있는 것/score 있는 것 우선
  const { data: rows, error } = await supabaseAdmin
    .from("exam_attempts")
    .select("*")
    .gte("started_at", t0)
    .lte("started_at", t1)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (error) return { ok: false as const, error: "LEGACY_MATCH_QUERY_FAILED", detail: error };
  if (!rows || rows.length === 0) return { ok: false as const, error: "LEGACY_MATCH_NOT_FOUND", detail: { t0, t1 } };

  // best pick: emp_id 있거나 score/total_points 있는 행
  const best =
    rows.find((r: any) => !!r?.emp_id) ??
    rows.find((r: any) => r?.score != null && r?.total_points != null) ??
    rows[0];

  return { ok: true as const, attempt: best, candidates: rows.map((r: any) => r?.id) };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const raw =
      getParamCI(u, "attemptId", "attempt_id", "attemptID", "attemptid", "id", "AttemptId", "AttemptID") ?? "";
    const attemptKey = s(raw);

    if (!attemptKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_ATTEMPT_ID",
          detail: { url: req.url, got: raw, allParams: Array.from(u.searchParams.entries()) },
        },
        { status: 400 }
      );
    }

    // =====================================================
    // ✅ 1) UUID attempt 처리
    // - 시도 1: attempts 테이블에서 uuid row 조회(기존 유지)
    // - 시도 2: started_at 기반으로 exam_attempts(legacy) 매칭 후 legacy 상세 반환
    // =====================================================
    if (isUuid(attemptKey)) {
      const { data: uuidAttempt, error: aErr } = await supabaseAdmin
        .from("attempts")
        .select("*")
        .eq("id", attemptKey)
        .maybeSingle();

      if (aErr) {
        return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
      }
      if (!uuidAttempt) {
        return NextResponse.json(
          { ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId: attemptKey, source: "attempts" } },
          { status: 404 }
        );
      }

      // ✅ 핵심: UUID row를 legacy(exam_attempts)로 매칭해서 “응시자ID/점수/내 선택” 살린다
      const resolved = await resolveLegacyByStartedAt(uuidAttempt);
      if (resolved.ok) {
        const legacyDetail = await buildLegacyDetailFromExamAttempts(resolved.attempt);
        if (!legacyDetail.ok) {
          return NextResponse.json({ ok: false, error: legacyDetail.error, detail: legacyDetail.detail }, { status: 500 });
        }

        return NextResponse.json({
          ok: true,
          attempt: legacyDetail.attempt, // ✅ emp_id/score/submitted_at 포함
          graded: legacyDetail.graded,
          meta: {
            ...legacyDetail.meta,
            idType: "uuid->num",
            source: "attempts + exam_attempts",
            originalUuid: attemptKey,
            matchedBy: "started_at_window_±2m",
            legacyCandidates: resolved.candidates,
          },
        });
      }

      // 매칭 실패하면(극히 드뭄) 기존 UUID 응답(제한적)이라도 반환
      // -> 여기서는 “정답만” 정도는 보이게 유지
      let questionIds: string[] = [];
      const qs = (uuidAttempt as any)?.questions;

      if (Array.isArray(qs)) {
        questionIds = qs.map((x: any) => s(typeof x === "object" ? x?.id ?? x?.question_id ?? x?.qid : x)).filter(Boolean);
      } else if (typeof qs === "string") {
        try {
          const parsed = JSON.parse(qs);
          if (Array.isArray(parsed)) questionIds = parsed.map((x: any) => s(x)).filter(Boolean);
        } catch {
          questionIds = qs.split(",").map((x) => s(x)).filter(Boolean);
        }
      }

      const parsed = parseAttemptAnswers(uuidAttempt);
      const selectedByQid = new Map<string, number>();
      for (const [qid, idx] of Object.entries(parsed.map)) selectedByQid.set(String(qid).trim(), Number(idx));

      if (questionIds.length === 0) questionIds = parsed.questionIds;
      if (questionIds.length === 0) questionIds = Array.from(selectedByQid.keys());

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
        const isCorrect = status === "submitted" && correctIndex != null ? Number(selectedIndex) === Number(correctIndex) : false;
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
        attempt: uuidAttempt,
        graded,
        meta: {
          idType: "uuid",
          source: "attempts",
          originalUuid: attemptKey,
          note: "Legacy match failed; returning UUID-only attempt (may lack emp_id/score).",
          matchFail: resolved,
        },
      });
    }

    // =====================================================
    // ✅ 2) 숫자 attempt => exam_attempts(레거시)
    // (A팀 영향 X: A팀은 /api/result/[attemptId] 쓰고, 이건 admin 전용)
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

    const { data: attempt, error: aErr } = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });

    const legacyDetail = await buildLegacyDetailFromExamAttempts(attempt);
    if (!legacyDetail.ok) return NextResponse.json({ ok: false, error: legacyDetail.error, detail: legacyDetail.detail }, { status: 500 });

    return NextResponse.json({
      ok: true,
      attempt: legacyDetail.attempt,
      graded: legacyDetail.graded,
      meta: legacyDetail.meta,
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
