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

async function safeUpdateAttempt(client: any, attemptId: number, patch: Record<string, any>) {
  let keys = Object.keys(patch);

  // 최대 12번 정도 컬럼 제거하며 재시도
  for (let i = 0; i < 12; i++) {
    const cur: any = {};
    for (const k of keys) cur[k] = patch[k];

    const r = await client.from("exam_attempts").update(cur).eq("id", attemptId);
    if (!r.error) return { ok: true as const };

    if (isMissingColumn(r.error)) {
      const msg = String(r.error?.message ?? "");
      const m = msg.match(/exam_attempts\.([a-zA-Z0-9_]+)/);
      const bad = m?.[1];

      if (bad && keys.includes(bad)) {
        keys = keys.filter((x) => x !== bad);
        continue;
      }

      // 못뽑으면 흔한 후보부터 제거
      const fallback = ["total_points", "correct_count", "wrong_count", "status", "team", "answers"];
      const rm = fallback.find((x) => keys.includes(x));
      if (rm) {
        keys = keys.filter((x) => x !== rm);
        continue;
      }
    }

    return { ok: false as const, error: r.error };
  }
  return { ok: false as const, error: "UPDATE_TRIES_EXCEEDED" as any };
}

export async function POST(req: NextRequest) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error },
      { status: 500 }
    );
  }

  try {
    const body = await readBody(req);
    const isAuto = !!body?.isAuto;

    const attemptIdRaw = body?.attemptId ?? body?.attempt_id ?? body?.id ?? null;
    if (!isNumericId(attemptIdRaw)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { attemptIdRaw } },
        { status: 400 }
      );
    }
    const attemptId = Number(attemptIdRaw);

    const answersObj =
      body?.answers ??
      body?.answerMap ??
      body?.selected ??
      body?.items ??
      {};

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

    // 1) attempt 조회
    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });

    // ✅ team 결정
    const empIdCookie = s(req.cookies.get("empId")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);
    const team = s((attempt as any)?.team) || teamCookie || (empIdCookie === "admin_gs" ? "B" : "A");

    // 2) qids
    const questionIds: string[] = Array.isArray((attempt as any)?.question_ids)
      ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    const uniqQids = Array.from(new Set(questionIds)).filter(Boolean);

    // 3) questions 조회
    const { data: questions, error: qErr } = uniqQids.length
      ? await client.from("questions").select("*").in("id", uniqQids as any)
      : { data: [], error: null as any };

    if (qErr) return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    // 4) 채점 + 통계
    let score = 0;
    let totalPoints = 0;
    let correctCount = 0;
    let wrongCount = 0;

    const rowsToInsert: any[] = [];

    for (const qid of uniqQids) {
      const q = qById.get(String(qid));
      const pts = n(q?.points, 0) ?? 0;
      totalPoints += pts;

      const selectedIndex = Object.prototype.hasOwnProperty.call(answersMap, qid)
        ? Number(answersMap[qid])
        : null;

      const correctIndex = pickCorrectIndex(q);

      // 미응답은 rowsToInsert에 안 넣어도 됨
      if (selectedIndex === null || selectedIndex === undefined) continue;

      const isCorrect =
        correctIndex !== null && Number.isFinite(Number(correctIndex))
          ? Number(selectedIndex) === Number(correctIndex)
          : false;

      if (isCorrect) {
        score += pts;
        correctCount += 1;
      } else {
        wrongCount += 1;
      }

      rowsToInsert.push({
        attempt_id: attemptId,
        question_id: qid,
        selected_index: Number(selectedIndex),
      });
    }

    // 5) 답안 테이블 저장(기존 유지)
    const { error: delErr } = await client.from("exam_answers").delete().eq("attempt_id", attemptId);
    if (delErr) return NextResponse.json({ ok: false, error: "ANSWERS_DELETE_FAILED", detail: delErr }, { status: 500 });

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await client.from("exam_answers").insert(rowsToInsert);
      if (insErr) return NextResponse.json({ ok: false, error: "ANSWERS_INSERT_FAILED", detail: insErr }, { status: 500 });
    }

    // ✅ 핵심: exam_attempts.answers에도 map 저장 (관리자 상세가 이걸로 채점/오답 생성함)
    const nowIso = new Date().toISOString();

    const patch: any = {
      submitted_at: nowIso,
      status: "SUBMITTED",
      score,
      team,
      answers: { map: answersMap }, // ✅ 이거 없어서 오답이 안 나왔던 거
      total_points: totalPoints,
      correct_count: correctCount,
      wrong_count: wrongCount,
    };

    const up = await safeUpdateAttempt(client, attemptId, patch);
    if (!up.ok) return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: up.error }, { status: 500 });

    return NextResponse.json({
      ok: true,
      attemptId,
      score,
      totalPoints,
      correctCount,
      wrongCount,
      savedAnswers: rowsToInsert.length,
      isAuto,
      redirectUrl: `/exam/result/${attemptId}`,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
