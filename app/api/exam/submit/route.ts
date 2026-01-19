// app/api/exam/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ✅ TS 폭발 방지
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function isNumericId(x: any) {
  return /^\d+$/.test(s(x));
}
function isUuid(x: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s(x));
}

async function readBody(req: Request) {
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

async function safeUpdateAttempt(attemptId: number, patch: Record<string, any>) {
  let keys = Object.keys(patch);

  for (let i = 0; i < 12; i++) {
    const cur: any = {};
    for (const k of keys) cur[k] = patch[k];

    const r = await sb.from("exam_attempts").update(cur).eq("id", attemptId);
    if (!r.error) return { ok: true as const };

    if (isMissingColumn(r.error)) {
      const msg = String(r.error?.message ?? "");
      const m = msg.match(/exam_attempts\.([a-zA-Z0-9_]+)/);
      const bad = m?.[1];

      if (bad && keys.includes(bad)) {
        keys = keys.filter((x) => x !== bad);
        continue;
      }

      const fallback = ["wrong_count", "status", "team", "answers", "total_questions", "score", "submitted_at", "total_points"];
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
  try {
    const body = await readBody(req);
    const isAuto = !!body?.isAuto;

    // ✅ attemptId (bigint) 는 필수
    const attemptIdRaw = body?.attemptId ?? body?.attempt_id ?? body?.id ?? null;
    if (!isNumericId(attemptIdRaw)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { attemptIdRaw } },
        { status: 400 }
      );
    }
    const attemptId = Number(attemptIdRaw);

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

    // 1) attempt 조회 (uuid 포함)
    const { data: attempt, error: aErr } = await sb
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });

    // 2) attemptUuid 확보 (없으면 생성해서 exam_attempts.uuid에 저장)
    let attemptUuid =
      s(body?.attemptUuid ?? body?.attempt_uuid ?? "") ||
      s(req.cookies.get("attemptUuid")?.value) ||
      s((attempt as any)?.uuid);

    if (!isUuid(attemptUuid)) {
      attemptUuid = crypto.randomUUID();
      const { error: uErr } = await sb.from("exam_attempts").update({ uuid: attemptUuid }).eq("id", attemptId);
      if (uErr) {
        return NextResponse.json(
          { ok: false, error: "ATTEMPT_UUID_UPDATE_FAILED", detail: uErr },
          { status: 500 }
        );
      }
    }

    // 3) team 결정(기존 로직 유지)
    const empIdCookie = s(req.cookies.get("empId")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);
    const team = s((attempt as any)?.team) || teamCookie || (empIdCookie === "admin_gs" ? "B" : "A");

    // 4) question_ids (uuid 배열)
    const questionIds: string[] = Array.isArray((attempt as any)?.question_ids)
      ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    const uniqQids = Array.from(new Set(questionIds)).filter(Boolean);

    // 5) questions 조회 (id가 uuid라고 가정)
    const { data: questions, error: qErr } = uniqQids.length
      ? await sb.from("questions").select("*").in("id", uniqQids as any)
      : { data: [], error: null as any };

    if (qErr) return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    // 6) 채점 + attempt_answers insert rows 구성
    let score = 0;
    let totalPoints = 0;
    let wrongCount = 0;

    const rowsToInsert: any[] = [];

    for (const qid of uniqQids) {
      const q = qById.get(String(qid));
      const pts = n(q?.points, null);
      const point = pts === null ? 1 : (pts ?? 0);
      totalPoints += point;

      // ✅ answersMap 키는 questionId(uuid) 여야 함
      const selectedIndex = Object.prototype.hasOwnProperty.call(answersMap, qid) ? Number(answersMap[qid]) : null;
      if (selectedIndex === null || selectedIndex === undefined) continue;

      const correctIndex = pickCorrectIndex(q);
      const isCorrect =
        correctIndex !== null && Number.isFinite(Number(correctIndex))
          ? Number(selectedIndex) === Number(correctIndex)
          : false;

      if (isCorrect) score += point;
      else wrongCount += 1;

      // ✅ 핵심: attempt_answers는 attempt_id(uuid), question_id(uuid)
      rowsToInsert.push({
        attempt_id: attemptUuid,
        question_id: qid,
        selected_index: Number(selectedIndex),
        is_correct: isCorrect,
        points: Number(point),
      });
    }

    // 7) attempt_answers 저장 (uuid 기반)
    const { error: delErr } = await sb.from("attempt_answers").delete().eq("attempt_id", attemptUuid);
    if (delErr) return NextResponse.json({ ok: false, error: "ANSWERS_DELETE_FAILED", detail: delErr }, { status: 500 });

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await sb.from("attempt_answers").insert(rowsToInsert);
      if (insErr) {
        return NextResponse.json(
          { ok: false, error: "ANSWERS_INSERT_FAILED", detail: insErr, detail2: { attemptUuid, sample: rowsToInsert?.[0] } },
          { status: 500 }
        );
      }
    }

    // 8) attempt 업데이트
    const nowIso = new Date().toISOString();
    const patch: any = {
      submitted_at: nowIso,
      status: "SUBMITTED",
      team,
      score,
      total_points: totalPoints,
      total_questions: uniqQids.length,
      wrong_count: wrongCount,
      // ✅ 프론트/관리자 상세 fallback용
      answers: { map: answersMap, attemptUuid },
    };

    const up = await safeUpdateAttempt(attemptId, patch);
    if (!up.ok) return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: up.error }, { status: 500 });

    // ✅ attemptUuid도 같이 내려주면 디버깅/추후 프론트 개선에 도움
    return NextResponse.json({
      ok: true,
      attemptId,
      attemptUuid,
      score,
      totalPoints,
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
