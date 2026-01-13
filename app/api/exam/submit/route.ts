// app/api/exam/submit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) return { client: null as any, error: "Missing env: NEXT_PUBLIC_SUPABASE_URL" };
  if (!service) return { client: null as any, error: "Missing env: SUPABASE_SERVICE_ROLE_KEY" };

  const client = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { client, error: null as string | null };
}

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function isNumericId(v: any) {
  const t = s(v);
  return /^\d+$/.test(t);
}
function isUUID(v: any) {
  const t = s(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}

/** questions.id 정규화 */
function normalizeQid(v: any): number | string | null {
  const t = s(v);
  if (!t) return null;
  if (isNumericId(t)) return Number(t);
  return t;
}

function getCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") || "";
  const parts = raw.split(";").map((x) => x.trim());
  for (const p of parts) {
    if (!p) continue;
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      if (!t) return {};
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.correct_choice,
    q?.correctChoice,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

type AnswerItem = { questionId: string; selectedIndex: number };

function normalizeAnswers(body: any): AnswerItem[] {
  const raw =
    body?.answers ??
    body?.selected ??
    body?.answerMap ??
    body?.items ??
    body?.payload?.answers ??
    null;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((x) => ({
        questionId: s(x?.questionId ?? x?.question_id ?? x?.qid ?? x?.id),
        selectedIndex: n(x?.selectedIndex ?? x?.selected_index ?? x?.value, null) as any,
      }))
      .filter((x) => x.questionId && x.selectedIndex !== null);
  }

  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([qid, idx]) => ({
        questionId: s(qid),
        selectedIndex: n(idx, null) as any,
      }))
      .filter((x) => x.questionId && x.selectedIndex !== null);
  }

  return [];
}

/** attemptId 원본 받기 (숫자 or UUID) */
function resolveAttemptIdRaw(req: Request, body: any) {
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("attemptId") ||
      u.searchParams.get("attempt_id") ||
      u.searchParams.get("attemptID");
    if (q) {
      const qs = s(q);
      if (isUUID(qs)) return { attemptIdRaw: qs as string | number, resolvedBy: "QUERY_UUID" };
      const qNum = n(qs, null);
      if (qNum !== null && qNum > 0) return { attemptIdRaw: qNum as string | number, resolvedBy: "QUERY_NUMBER" };
    }
  } catch {}

  const fromBody =
    body?.attemptId ??
    body?.attempt_id ??
    body?.attemptID ??
    body?.AttemptId ??
    body?.AttemptID ??
    body?.id ??
    body?.attempt?.id;

  if (fromBody !== undefined && fromBody !== null && fromBody !== "") {
    const bs = s(fromBody);
    if (isUUID(bs)) return { attemptIdRaw: bs as string | number, resolvedBy: "BODY_UUID" };
    const bodyNum = n(bs, null);
    if (bodyNum !== null && bodyNum > 0) return { attemptIdRaw: bodyNum as string | number, resolvedBy: "BODY_NUMBER" };
  }

  const cAttemptRaw = getCookie(req, "attemptId") || getCookie(req, "attempt_id");
  if (cAttemptRaw) {
    const cs = s(cAttemptRaw);
    if (isUUID(cs)) return { attemptIdRaw: cs as string | number, resolvedBy: "COOKIE_UUID" };
    const cNum = n(cs, null);
    if (cNum !== null && cNum > 0) return { attemptIdRaw: cNum as string | number, resolvedBy: "COOKIE_NUMBER" };
  }

  return { attemptIdRaw: null as any, resolvedBy: "NONE", detail: { url: req.url, keys: Object.keys(body ?? {}) } };
}

/**
 * ✅ UUID가 와도 제출되게:
 * - empId의 미제출 attempt를 pick
 * - 없으면 새 attempt INSERT (여기서 total_questions NOT NULL 반드시 채움)
 */
async function getOrCreateAttemptIdByEmpId(
  client: any,
  empId: string,
  totalQuestions: number,
  totalPointsGuess: number
) {
  // 1) 미제출 attempt pick
  const { data: picked, error: pickErr } = await client
    .from("exam_attempts")
    .select("id, emp_id, status, started_at, submitted_at, total_questions, total_points")
    .eq("emp_id", empId)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pickErr && picked?.id != null) {
    const idNum = n(picked.id, null);
    if (idNum !== null) return { attemptId: idNum, mode: "PICKED", picked };
  }

  // 2) 없으면 생성
  const nowIso = new Date().toISOString();

  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    total_questions: totalQuestions,   // ✅ NOT NULL
    total_points: totalPointsGuess,    // (있으면 좋음)
    score: 0,
    correct_count: 0,
  };

  const { data: created, error: insErr } = await client
    .from("exam_attempts")
    .insert(insertRow)
    .select("id, emp_id, status, started_at, submitted_at, total_questions, total_points")
    .maybeSingle();

  if (insErr) {
    return {
      attemptId: null as number | null,
      mode: "CREATE_FAILED",
      error: String((insErr as any)?.message ?? insErr),
      sent: { ...insertRow, answers: undefined },
    };
  }

  const createdId = n(created?.id, null);
  if (createdId === null) {
    return { attemptId: null as number | null, mode: "CREATE_FAILED", error: "CREATED_ID_NOT_NUMERIC", created };
  }

  return { attemptId: createdId, mode: "CREATED", created };
}

/** attempt에 “문제목록”이 저장돼 있을 수도 있어서 최대한 찾아봄 */
function pickAttemptQuestionIds(attempt: any): Array<number | string> {
  const cands = [
    attempt?.question_ids,
    attempt?.questionIds,
    attempt?.questions,         // array거나 object일 수 있음
    attempt?.question_list,
    attempt?.questionList,
    attempt?.qids,
  ];

  for (const v of cands) {
    if (!v) continue;

    // 배열이면 그대로
    if (Array.isArray(v)) {
      const out = v.map((x) => normalizeQid(x)).filter((x) => x !== null) as any[];
      if (out.length) return out;
    }

    // string(JSON)일 수 있음
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
          const out = parsed.map((x) => normalizeQid(x)).filter((x) => x !== null) as any[];
          if (out.length) return out;
        }
      } catch {}
      // 콤마 문자열일 수도
      if (t.includes(",")) {
        const out = t.split(",").map((x) => normalizeQid(x)).filter((x) => x !== null) as any[];
        if (out.length) return out;
      }
    }

    // object(map)면 key들을 qid로
    if (typeof v === "object") {
      const out = Object.keys(v).map((k) => normalizeQid(k)).filter((x) => x !== null) as any[];
      if (out.length) return out;
    }
  }

  return [];
}

/** 시험 제한시간(분): attempt값 우선, 없으면 ENV, 없으면 15 */
function pickTimeLimitMinutes(attempt: any) {
  const fromAttempt =
    n(attempt?.time_limit_minutes, null) ??
    n(attempt?.timeLimitMinutes, null) ??
    n(attempt?.limit_minutes, null) ??
    n(attempt?.limitMinutes, null) ??
    n(attempt?.duration_minutes, null) ??
    n(attempt?.durationMinutes, null);

  if (fromAttempt !== null && fromAttempt > 0) return fromAttempt;

  const fromEnv = n(process.env.EXAM_TIME_LIMIT_MINUTES, null);
  if (fromEnv !== null && fromEnv > 0) return fromEnv;

  return 15;
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);

    const r0 = resolveAttemptIdRaw(req, body);
    const attemptIdRaw = r0.attemptIdRaw;

    const empId =
      s(body?.empId ?? body?.emp_id) ||
      s(getCookie(req, "empId")) ||
      s(getCookie(req, "emp_id")) ||
      "";

    if (!attemptIdRaw) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { resolvedBy: r0.resolvedBy, ...(r0.detail ?? {}) } },
        { status: 400 }
      );
    }
    if (!empId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_EMPID", detail: { note: "empId cookie/body required for UUID fallback" } },
        { status: 400 }
      );
    }

    // ✅ answers는 "나중에" 판단 (시간초과 자동제출 위해)
    const items = normalizeAnswers(body);

    // ✅ 최종 attemptId(bigint)
    let attemptId: number | null = null;
    let resolvedBy = r0.resolvedBy;
    const resolveDetail: any = { empId };

    // 우선 questions 조회 전에 attempt를 확정해야 함
    if (typeof attemptIdRaw === "number") {
      attemptId = attemptIdRaw;
    } else {
      const uuid = s(attemptIdRaw);
      if (!isUUID(uuid)) {
        return NextResponse.json(
          { ok: false, error: "INVALID_ATTEMPT_ID_FORMAT", detail: { attemptIdRaw, resolvedBy } },
          { status: 400 }
        );
      }

      // UUID fallback: 제출 들어오면 empId의 진행중 attempt를 pick/create
      // totalQuestions/pointsGuess는 임시값(답이 없을 수도 있음)
      const oc = await getOrCreateAttemptIdByEmpId(client, empId, Math.max(items.length, 20), 0);
      if (!oc.attemptId) {
        return NextResponse.json(
          {
            ok: false,
            error: "ATTEMPT_CREATE_OR_PICK_FAILED",
            detail: { empId, clientAttemptUuid: uuid, resolvedBy, ...oc },
          },
          { status: 500 }
        );
      }

      attemptId = oc.attemptId;
      resolvedBy = `${resolvedBy}=>${oc.mode}_BY_EMPID`;
      resolveDetail.clientAttemptUuid = uuid;
      resolveDetail.pickCreate = oc;
    }

    // attempt 조회
    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String((aErr as any)?.message ?? aErr) },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId, resolvedBy, ...resolveDetail } },
        { status: 404 }
      );
    }

    // 이미 제출된 attempt면 중복 제출 방지
    if (attempt.submitted_at) {
      return NextResponse.json({
        ok: true,
        attemptId,
        resolvedBy,
        marker: "ALREADY_SUBMITTED",
        redirectUrl: `/exam/result/${attemptId}`,
      });
    }

    // ✅ 시간 초과 여부(서버 기준)
    const limitMin = pickTimeLimitMinutes(attempt);
    const startedAtMs = attempt?.started_at ? new Date(attempt.started_at).getTime() : NaN;
    const nowMs = Date.now();
    const isTimeOver = Number.isFinite(startedAtMs) ? nowMs - startedAtMs >= limitMin * 60 * 1000 : false;

    // ✅ 시간 안 지났는데 답이 0개면 제출 막기 (기존 로직 유지)
    if (!isTimeOver && items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { keys: Object.keys(body ?? {}), isTimeOver, limitMin } },
        { status: 400 }
      );
    }

    // ✅ attempt에 문제목록이 있으면 그걸 “전체 문제”로 사용
    // 없으면: 제출된 답변들만이라도 채점(완전한 미응답 오답처리는 여기선 한계)
    const attemptQids = pickAttemptQuestionIds(attempt);
    const answeredQids = items
      .map((x) => normalizeQid(x.questionId))
      .filter((x) => x !== null) as Array<number | string>;

    const fullQids =
      attemptQids.length > 0
        ? attemptQids
        : answeredQids;

    // fullQids가 비었는데 시간초과면(=아예 한문제도 못 풀고 자동제출)
    // 최소한 total_questions를 attempt.total_questions(있으면)로 유지하고 점수 0 처리
    const declaredTotalQuestions =
      n(attempt?.total_questions, null) ??
      n(attempt?.totalQuestions, null) ??
      (attemptQids.length > 0 ? attemptQids.length : null) ??
      null;

    // questions 조회 (fullQids가 있을 때만)
    const uniqueQids = Array.from(new Set(fullQids.map((x) => String(x))));
    const allNumeric = uniqueQids.length > 0 && uniqueQids.every((x) => /^\d+$/.test(x));
    const qidsForQuery = allNumeric ? uniqueQids.map((x) => Number(x)) : uniqueQids;

    let questions: any[] = [];
    const qById = new Map<string, any>();

    if (uniqueQids.length > 0) {
      const { data: qs, error: qErr } = await client
        .from("questions")
        .select("*")
        .in("id", qidsForQuery as any);

      if (qErr) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((qErr as any)?.message ?? qErr) },
          { status: 500 }
        );
      }
      questions = qs ?? [];
      for (const q of questions) qById.set(String(q.id), q);
    }

    // 답변 map
    const answeredMap = new Map<string, number>();
    for (const it of items) {
      const qid = normalizeQid(it.questionId);
      if (qid === null) continue;
      answeredMap.set(String(qid), Number(it.selectedIndex));
    }

    // ✅ 채점: "전체 문제" 기준(있으면), 없으면 "제출된 답" 기준
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    const wrongQuestionIds: string[] = [];
    const answerMapForAttempt: Record<string, number> = {};

    // 저장 rows: answered만 저장(미응답은 selected_index null 못 넣는 경우 많음)
    const rows: any[] = [];

    if (uniqueQids.length > 0) {
      // fullQids 기반 채점
      for (const qidStr of uniqueQids) {
        const q = qById.get(qidStr);
        if (!q) {
          // 문제를 못 찾는 경우는 스킵(데이터 이상)
          continue;
        }

        const points = n(q?.points, 0) ?? 0;
        totalPoints += points;

        const correctIndex = pickCorrectIndex(q);
        const selected = answeredMap.has(qidStr) ? answeredMap.get(qidStr)! : null;

        // ✅ 미응답이면 무조건 오답
        const isCorrect =
          selected === null || correctIndex === null
            ? false
            : Number(selected) === Number(correctIndex);

        if (selected !== null) {
          // answered row 저장
          rows.push({
            attempt_id: attemptId,
            question_id: allNumeric ? Number(qidStr) : q.id,
            selected_index: Number(selected),
            is_correct: isCorrect,
          });
          answerMapForAttempt[qidStr] = Number(selected);
        }

        if (isCorrect) {
          correctCount += 1;
          score += points;
        } else {
          wrongQuestionIds.push(qidStr);
        }
      }
    } else {
      // fullQids가 없으면(=attempt에 문제목록도 없고, 답도 거의 없음)
      // 최소한 answered만 채점
      for (const [qidStr, selected] of answeredMap.entries()) {
        const q = qById.get(qidStr); // 보통은 없을 수 있음
        const points = n(q?.points, 0) ?? 0;
        totalPoints += points;

        const correctIndex = pickCorrectIndex(q);
        const isCorrect = correctIndex !== null ? Number(selected) === Number(correctIndex) : false;

        rows.push({
          attempt_id: attemptId,
          question_id: isNumericId(qidStr) ? Number(qidStr) : qidStr,
          selected_index: Number(selected),
          is_correct: isCorrect,
        });

        answerMapForAttempt[qidStr] = Number(selected);

        if (isCorrect) {
          correctCount += 1;
          score += points;
        } else {
          wrongQuestionIds.push(qidStr);
        }
      }
    }

    // ✅ 저장: 기존 삭제 후 insert(답이 하나도 없으면 insert 생략)
    const { error: delErr } = await client.from("exam_attempt_answers").delete().eq("attempt_id", attemptId);
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_DELETE_FAILED", detail: String((delErr as any)?.message ?? delErr) },
        { status: 500 }
      );
    }

    if (rows.length > 0) {
      const { error: insErr } = await client.from("exam_attempt_answers").insert(rows);
      if (insErr) {
        return NextResponse.json(
          { ok: false, error: "ANSWERS_INSERT_FAILED", detail: String((insErr as any)?.message ?? insErr) },
          { status: 500 }
        );
      }
    }

    // ✅ total_questions는 "푼 문제 수"로 덮어쓰면 안 됨
    const finalTotalQuestions =
      (attemptQids.length > 0 ? attemptQids.length : null) ??
      declaredTotalQuestions ??
      (uniqueQids.length > 0 ? uniqueQids.length : null) ??
      (attempt?.total_questions ?? null) ??
      20;

    // ✅ 제출 처리
    const nowIso = new Date().toISOString();
    const { error: upErr } = await client
      .from("exam_attempts")
      .update({
        submitted_at: nowIso,
        status: "SUBMITTED",
        score,
        correct_count: correctCount,
        total_points: totalPoints,
        total_questions: finalTotalQuestions,
        answers: answerMapForAttempt,
        // time_over 같은 컬럼이 있으면 저장하고 싶다면 여기 추가 가능
      })
      .eq("id", attemptId);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: String((upErr as any)?.message ?? upErr) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      resolvedBy,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      savedAnswers: rows.length,
      marker: "SUBMIT_PATCH_2026-01-13_AUTO_SUBMIT_AND_UNANSWERED_WRONG",
      redirectUrl: `/exam/result/${attemptId}`,
      debug: {
        ...resolveDetail,
        isTimeOver,
        limitMin,
        attemptHasQids: attemptQids.length > 0,
        fullQidsCount: uniqueQids.length,
        declaredTotalQuestions,
        finalTotalQuestions,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
