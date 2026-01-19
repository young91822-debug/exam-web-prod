// app/api/exam/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
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
function isNumericId(x: any) {
  return /^\d+$/.test(s(x));
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      return t ? JSON.parse(t) : {};
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
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function isMissingColumn(err: any) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("does not exist") || msg.includes("Could not find") || msg.includes("schema cache");
}

/** exam_attempts 업데이트: 컬럼 없으면 자동으로 빼면서 재시도 */
async function safeUpdateAttempt(client: any, by: { id?: number; uuid?: string }, patch: Record<string, any>) {
  let keys = Object.keys(patch);

  for (let i = 0; i < 12; i++) {
    const cur: any = {};
    for (const k of keys) cur[k] = patch[k];

    let q = client.from("exam_attempts").update(cur);
    if (by.uuid) q = q.eq("uuid", by.uuid);
    else q = q.eq("id", by.id);

    const r = await q;
    if (!r.error) return { ok: true as const };

    if (isMissingColumn(r.error)) {
      const msg = String(r.error?.message ?? "");
      const m = msg.match(/exam_attempts\.([a-zA-Z0-9_]+)/);
      const bad = m?.[1];
      if (bad && keys.includes(bad)) {
        keys = keys.filter((x) => x !== bad);
        continue;
      }
      // 그래도 못 찾으면 하나씩 빼기
      const rm = keys[0];
      keys = keys.filter((x) => x !== rm);
      continue;
    }

    return { ok: false as const, error: r.error };
  }

  return { ok: false as const, error: "UPDATE_TRIES_EXCEEDED" as any };
}

export async function POST(req: NextRequest) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);
    const isAuto = !!body?.isAuto;

    // ✅ attempt 식별자: id(bigint) 또는 uuid 둘 다 받기
    const attemptIdRaw = body?.attemptId ?? body?.attempt_id ?? body?.id ?? null;
    const attemptUuidRaw =
      body?.attemptUuid ??
      body?.attempt_uuid ??
      req.cookies.get("attemptUuid")?.value ??
      req.cookies.get("attempt_uuid")?.value ??
      null;

    const attemptUuidIn = s(attemptUuidRaw);
    const attemptIdIn = isNumericId(attemptIdRaw) ? Number(attemptIdRaw) : null;

    if (!attemptUuidIn && attemptIdIn === null) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ATTEMPT_ID", detail: { attemptIdRaw, attemptUuidRaw } },
        { status: 400 }
      );
    }

    // ✅ answers map
    const answersObj = body?.answers ?? body?.answerMap ?? body?.selected ?? body?.items ?? {};
    const answersMap: Record<string, number> = {};
    if (answersObj && typeof answersObj === "object" && !Array.isArray(answersObj)) {
      for (const [k, v] of Object.entries(answersObj)) {
        const qid = s(k);
        const idx = n(v, null);
        if (!qid) continue;
        if (idx === null) continue;
        answersMap[qid] = Number(idx);
      }
    }

    if (!isAuto && Object.keys(answersMap).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ANSWERS" }, { status: 400 });
    }

    // 1) attempt 조회: uuid 우선, 없으면 id로
    let attempt: any = null;

    if (attemptUuidIn) {
      const r = await client.from("exam_attempts").select("*").eq("uuid", attemptUuidIn).maybeSingle();
      if (r.error) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: r.error }, { status: 500 });
      attempt = r.data;
    } else if (attemptIdIn !== null) {
      const r = await client.from("exam_attempts").select("*").eq("id", attemptIdIn).maybeSingle();
      if (r.error) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: r.error }, { status: 500 });
      attempt = r.data;
    }

    if (!attempt) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptIdIn, attemptUuidIn } },
        { status: 404 }
      );
    }

    const attemptUuid = s(attempt.uuid);
    const attemptId = n(attempt.id, null);

    if (!attemptUuid) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ATTEMPT_UUID", detail: { attemptId, attemptUuidIn } },
        { status: 500 }
      );
    }

    // 2) team 결정
    const empIdCookie = s(req.cookies.get("empId")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);
    const team = s(attempt?.team) || teamCookie || (empIdCookie === "admin_gs" ? "B" : "A");

    // 3) question_ids 가져오기 (attempt.question_ids가 있으면 그걸 쓰고, 없으면 attempt_questions에서 읽기)
    let uniqQids: string[] = [];

    const questionIds: string[] = Array.isArray(attempt?.question_ids)
      ? attempt.question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    if (questionIds.length > 0) {
      uniqQids = Array.from(new Set(questionIds)).filter(Boolean);
    } else {
      // attempt_questions 테이블이 있다면 거기서
      const aq = await client
        .from("attempt_questions")
        .select("question_id")
        .eq("attempt_uuid", attemptUuid);

      if (!aq.error && Array.isArray(aq.data)) {
        uniqQids = Array.from(new Set(aq.data.map((x: any) => s(x?.question_id)).filter(Boolean)));
      }
    }

    // 4) questions 조회 (UUID id 기준)
    const { data: questions, error: qErr } = uniqQids.length
      ? await client.from("questions").select("*").in("id", uniqQids as any)
      : { data: [], error: null as any };

    if (qErr) return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    // 5) 채점 + attempt_answers rows
    let score = 0;
    let totalPoints = 0;
    let wrongCount = 0;

    const rowsToInsert: any[] = [];

    for (const qid of uniqQids) {
      const q = qById.get(String(qid));
      const pts = n(q?.points, null);
      const point = pts === null ? 1 : (pts ?? 0);

      totalPoints += point;

      const selectedIndex = Object.prototype.hasOwnProperty.call(answersMap, qid)
        ? Number(answersMap[qid])
        : null;

      if (selectedIndex === null || selectedIndex === undefined) continue;

      const correctIndex = pickCorrectIndex(q);
      const isCorrect =
        correctIndex !== null && Number.isFinite(Number(correctIndex))
          ? Number(selectedIndex) === Number(correctIndex)
          : false;

      if (isCorrect) score += point;
      else wrongCount += 1;

      rowsToInsert.push({
        attempt_id: attemptUuid,      // ✅ uuid
        question_id: qid,             // ✅ uuid
        selected_index: Number(selectedIndex),
        is_correct: isCorrect,
        points: point,
      });
    }

    // ✅ 6) attempt_answers에 저장 (UUID 체계)
    const { error: delErr } = await client.from("attempt_answers").delete().eq("attempt_id", attemptUuid);
    if (delErr) return NextResponse.json({ ok: false, error: "ANSWERS_DELETE_FAILED", detail: delErr }, { status: 500 });

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await client.from("attempt_answers").insert(rowsToInsert);
      if (insErr) return NextResponse.json({ ok: false, error: "ANSWERS_INSERT_FAILED", detail: insErr }, { status: 500 });
    }

    // ✅ 7) exam_attempts 업데이트 (uuid로)
    const nowIso = new Date().toISOString();
    const patch: any = {
      submitted_at: nowIso,
      status: "SUBMITTED",
      team,
      score,
      total_points: totalPoints,
      total_questions: uniqQids.length,
      wrong_count: wrongCount,
      answers: { map: answersMap },
    };

    const up = await safeUpdateAttempt(client, { uuid: attemptUuid }, patch);
    if (!up.ok) return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: up.error }, { status: 500 });

    // ✅ redirect: 기존 숫자 id가 있으면 id 기반 유지, 없으면 uuid 기반
    const redirectUrl = attemptId ? `/exam/result/${attemptId}` : `/exam/result/${attemptUuid}`;

    return NextResponse.json({
      ok: true,
      attemptId: attemptId ?? null,
      attemptUuid,
      score,
      totalPoints,
      wrongCount,
      savedAnswers: rowsToInsert.length,
      isAuto,
      redirectUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
