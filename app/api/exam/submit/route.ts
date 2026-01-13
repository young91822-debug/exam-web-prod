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
 * ✅ UUID가 와도 제출되게:
 * - empId의 미제출 attempt를 pick
 * - 없으면 새 attempt INSERT (total_questions NOT NULL 채움)
 */
async function getOrCreateAttemptIdByEmpId(client: any, empId: string, totalQuestions: number) {
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
    .select("id, emp_id, status, started_at, submitted_at, total_questions, total_points")
    .maybeSingle();

  if (insErr) {
    return {
      attemptId: null as number | null,
      mode: "CREATE_FAILED",
      error: String((insErr as any)?.message ?? insErr),
      sent: insertRow,
    };
  }

  const createdId = n(created?.id, null);
  if (createdId === null) {
    return { attemptId: null as number | null, mode: "CREATE_FAILED", error: "CREATED_ID_NOT_NUMERIC", created };
  }

  return { attemptId: createdId, mode: "CREATED", created };
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

      const oc = await getOrCreateAttemptIdByEmpId(client, empId, Math.max(items.length, 20));
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

    // 시간 안 지났는데 답이 0개면 제출 막기
    if (!isTimeOver && items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { keys: Object.keys(body ?? {}), isTimeOver, limitMin } },
        { status: 400 }
      );
    }

    // ✅ 답변은 UUID만 취급 (questions.id가 UUID)
    const answeredMap = new Map<string, number>();
    for (const it of items) {
      const qid = s(it.questionId);
      if (!isUUID(qid)) continue; // ✅ "0" 같은 쓰레기 자동 제거
      const sel = n(it.selectedIndex, null);
      if (sel === null) continue;
      answeredMap.set(qid, Number(sel));
    }

    // ✅ 채점 대상 qids: attempt에 UUID 목록이 있으면 우선, 없으면 answered만
    const attemptQids = pickAttemptQuestionUuids(attempt);
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

    // ✅ 점수 계산
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

    // ✅ 저장: exam_answers (attempt_id + question_id(uuid) + selected_index)
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

    // total_questions는 기존 유지 우선
    const finalTotalQuestions =
      n(attempt?.total_questions, null) ??
      (attemptQids.length ? attemptQids.length : null) ??
      (qidsToGrade.length ? qidsToGrade.length : null) ??
      20;

    // answers json (디버깅용) — 키는 UUID
    const answerMapForAttempt: Record<string, number> = {};
    for (const [qid, sel] of answeredMap.entries()) answerMapForAttempt[qid] = Number(sel);

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
      marker: "SUBMIT_PATCH_SAVE_TO_exam_answers_question_id_UUID",
      redirectUrl: `/exam/result/${attemptId}`,
      debug: {
        ...resolveDetail,
        isTimeOver,
        limitMin,
        attemptHasQids: attemptQids.length > 0,
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
