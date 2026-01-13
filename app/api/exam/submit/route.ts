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
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function isNumericStr(v: any) {
  return /^\d+$/.test(s(v));
}
function isUUID(v: any) {
  const t = s(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
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

/** body에서 answers 형태 다 받아주기 */
function normalizeAnswers(body: any): AnswerItem[] {
  const raw =
    body?.answers ??
    body?.selected ??
    body?.answerMap ??
    body?.items ??
    body?.payload?.answers ??
    body?.payload?.selected ??
    body?.payload?.answerMap ??
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
      const qNum = n(qs, null);
      if (qNum !== null && qNum > 0) return { attemptIdRaw: qNum as string | number, resolvedBy: "QUERY_NUMBER" };
      if (isUUID(qs)) return { attemptIdRaw: qs as string | number, resolvedBy: "QUERY_UUID" };
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
    const bodyNum = n(bs, null);
    if (bodyNum !== null && bodyNum > 0) return { attemptIdRaw: bodyNum as string | number, resolvedBy: "BODY_NUMBER" };
    if (isUUID(bs)) return { attemptIdRaw: bs as string | number, resolvedBy: "BODY_UUID" };
  }

  const cAttemptRaw = getCookie(req, "attemptId") || getCookie(req, "attempt_id");
  if (cAttemptRaw) {
    const cs = s(cAttemptRaw);
    const cNum = n(cs, null);
    if (cNum !== null && cNum > 0) return { attemptIdRaw: cNum as string | number, resolvedBy: "COOKIE_NUMBER" };
    if (isUUID(cs)) return { attemptIdRaw: cs as string | number, resolvedBy: "COOKIE_UUID" };
  }

  return { attemptIdRaw: null as any, resolvedBy: "NONE", detail: { url: req.url, keys: Object.keys(body ?? {}) } };
}

/**
 * ✅ “오늘 시험” 보장:
 * - UUID로 들어오는 제출은 기존 미제출 attempt를 PICK 하지 않고 무조건 새 attempt 생성
 */
async function createAttempt(client: any, empId: string, totalQuestions: number) {
  const nowIso = new Date().toISOString();
  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    total_questions: Math.max(1, totalQuestions || 20),
    total_points: 0,
    score: 0,
    correct_count: 0,
  };

  const { data: created, error: insErr } = await client
    .from("exam_attempts")
    .insert(insertRow)
    .select("id, emp_id, status, started_at, submitted_at, total_questions, total_points, question_ids")
    .maybeSingle();

  if (insErr) {
    return { ok: false as const, attemptId: null as number | null, error: String((insErr as any)?.message ?? insErr), sent: insertRow };
  }

  const createdId = n(created?.id, null);
  if (createdId === null) {
    return { ok: false as const, attemptId: null as number | null, error: "CREATED_ID_NOT_NUMERIC", created };
  }

  return { ok: true as const, attemptId: createdId, created };
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

/** attempt에 question_ids 같은 게 있으면 UUID 배열로 뽑음 */
function pickAttemptQuestionUuids(attempt: any): string[] {
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
      const out = v.map((x) => s(x)).filter((x) => isUUID(x));
      if (out.length) return out;
    }

    if (typeof v === "string") {
      const t = v.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) {
          const out = parsed.map((x) => s(x)).filter((x) => isUUID(x));
          if (out.length) return out;
        }
      } catch {}
      if (t.includes(",")) {
        const out = t.split(",").map((x) => s(x)).filter((x) => isUUID(x));
        if (out.length) return out;
      }
    }

    if (typeof v === "object") {
      const out = Object.keys(v).map((k) => s(k)).filter((x) => isUUID(x));
      if (out.length) return out;
    }
  }

  return [];
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

    if (!empId) {
      return NextResponse.json({ ok: false, error: "MISSING_EMPID" }, { status: 400 });
    }
    if (!attemptIdRaw) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { resolvedBy: r0.resolvedBy, ...(r0.detail ?? {}) } },
        { status: 400 }
      );
    }

    const items = normalizeAnswers(body);

    // ✅ 최종 attemptId(bigint)
    let attemptId: number | null = null;
    let resolvedBy = r0.resolvedBy;
    const resolveDetail: any = { empId };

    // 숫자로 온 attemptId면 그대로 사용 (정상 케이스)
    if (typeof attemptIdRaw === "number") {
      attemptId = attemptIdRaw;
    } else {
      // UUID로 온 경우: 예전 미제출 재사용 금지 → 무조건 새 attempt 생성
      const uuid = s(attemptIdRaw);
      if (!isUUID(uuid)) {
        return NextResponse.json(
          { ok: false, error: "INVALID_ATTEMPT_ID_FORMAT", detail: { attemptIdRaw, resolvedBy } },
          { status: 400 }
        );
      }

      const created = await createAttempt(client, empId, Math.max(items.length, 20));
      if (!created.ok || !created.attemptId) {
        return NextResponse.json(
          { ok: false, error: "ATTEMPT_CREATE_FAILED_FOR_UUID", detail: { uuid, resolvedBy, ...created } },
          { status: 500 }
        );
      }

      attemptId = created.attemptId;
      resolvedBy = `${resolvedBy}=>CREATED_NEW_FOR_UUID`;
      resolveDetail.clientAttemptUuid = uuid;
      resolveDetail.created = created.created;
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

    if (!isTimeOver && items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { keys: Object.keys(body ?? {}), isTimeOver, limitMin } },
        { status: 400 }
      );
    }

    // ✅ attempt에 있는 UUID 문제목록
    const attemptQids = pickAttemptQuestionUuids(attempt);

    /**
     * ✅ 답변 매핑 규칙
     * 1) questionId가 UUID면 그대로 사용
     * 2) questionId가 "0/1/2..." 같은 숫자면 → attemptQids[index]로 변환 (0-based 우선, 1-based도 fallback)
     */
    const answeredMap = new Map<string, number>();
    for (const it of items) {
      const rawQ = s(it.questionId);
      const sel = n(it.selectedIndex, null);
      if (sel === null) continue;

      if (isUUID(rawQ)) {
        answeredMap.set(rawQ, Number(sel));
        continue;
      }

      // 숫자 인덱스 기반 답안 대응
      if (isNumericStr(rawQ) && attemptQids.length > 0) {
        const idx = Number(rawQ);

        // 0-based
        if (idx >= 0 && idx < attemptQids.length) {
          answeredMap.set(attemptQids[idx], Number(sel));
          continue;
        }
        // 1-based fallback
        const idx1 = idx - 1;
        if (idx1 >= 0 && idx1 < attemptQids.length) {
          answeredMap.set(attemptQids[idx1], Number(sel));
          continue;
        }
      }
    }

    // ✅ 채점 대상 qids: attemptQids 우선(전체문항 채점), 없으면 answered만
    const qidsToGrade = (attemptQids.length ? attemptQids : Array.from(answeredMap.keys()))
      .filter((x) => isUUID(x))
      .filter((x, i, arr) => arr.indexOf(x) === i);

    // 질문 조회
    const qById = new Map<string, any>();
    if (qidsToGrade.length > 0) {
      const { data: qs, error: qErr } = await client.from("questions").select("*").in("id", qidsToGrade as any);
      if (qErr) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((qErr as any)?.message ?? qErr) },
          { status: 500 }
        );
      }
      for (const q of qs ?? []) qById.set(String(q.id), q);
    }

    // 점수 계산
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    const wrongQuestionIds: string[] = [];

    for (const qid of qidsToGrade) {
      const q = qById.get(qid);
      if (!q) continue;

      const pts = n(q?.points, 0) ?? 0;
      totalPoints += pts;

      const correctIndex = pickCorrectIndex(q);
      const selected = answeredMap.has(qid) ? answeredMap.get(qid)! : null;

      const isCorrect = selected !== null && correctIndex !== null && Number(selected) === Number(correctIndex);

      if (isCorrect) {
        score += pts;
        correctCount += 1;
      } else {
        wrongQuestionIds.push(qid);
      }
    }

    // ✅ 저장: exam_answers (attempt_id + question_id(UUID) + selected_index)
    const { error: delErr } = await client.from("exam_answers").delete().eq("attempt_id", attemptId);
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_DELETE_FAILED", detail: String((delErr as any)?.message ?? delErr) },
        { status: 500 }
      );
    }

    const rows = Array.from(answeredMap.entries()).map(([qid, sel]) => ({
      attempt_id: attemptId,
      question_id: qid, // ✅ UUID
      selected_index: Number(sel),
    }));

    if (rows.length > 0) {
      const { error: insErr } = await client.from("exam_answers").insert(rows as any);
      if (insErr) {
        return NextResponse.json(
          {
            ok: false,
            error: "ANSWERS_INSERT_FAILED",
            detail: String((insErr as any)?.message ?? insErr),
            hint: "exam_answers.question_id 는 UUID 여야 함",
          },
          { status: 500 }
        );
      }
    }

    const finalTotalQuestions =
      n(attempt?.total_questions, null) ??
      (attemptQids.length ? attemptQids.length : null) ??
      (qidsToGrade.length ? qidsToGrade.length : null) ??
      20;

    const answerMapForAttempt: Record<string, number> = {};
    for (const [qid, sel] of answeredMap.entries()) answerMapForAttempt[qid] = Number(sel);

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
      marker: "SUBMIT_FIXED_NEW_ATTEMPT_FOR_UUID_AND_INDEX_MAPPING",
      redirectUrl: `/exam/result/${attemptId}`,
      debug: {
        ...resolveDetail,
        isTimeOver,
        limitMin,
        attemptQids: attemptQids.length,
        items: items.length,
        answeredMap: answeredMap.size,
        savedRows: rows.length,
        qidsToGrade: qidsToGrade.length,
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
