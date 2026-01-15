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
function isNumericId(x: any) {
  return /^\d+$/.test(s(x));
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
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);

    const isAuto = !!body?.isAuto;

    // ✅ attemptId (숫자)
    const attemptIdRaw = body?.attemptId ?? body?.attempt_id ?? body?.id ?? null;
    if (!isNumericId(attemptIdRaw)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID", detail: { attemptIdRaw } }, { status: 400 });
    }
    const attemptId = Number(attemptIdRaw);

    // ✅ answers: { [questionId]: selectedIndex }
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

    // ✅ 수동 제출인데 답이 0개면 막기 (자동제출은 허용)
    if (!isAuto && Object.keys(answersMap).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ANSWERS" }, { status: 400 });
    }

    // 1) attempt 가져오기
    const { data: attempt, error: aErr } = await client
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

    // 2) 문제 id 목록: exam_attempts.question_ids 를 1순위로 사용
    const questionIds: string[] = Array.isArray((attempt as any)?.question_ids)
      ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    const uniqQids = Array.from(new Set(questionIds)).filter(Boolean);

    // 문제 목록이 없다면(비정상) 그래도 제출은 처리
    // -> score 0, wrongCount = 0 처리
    if (uniqQids.length === 0) {
      const nowIso = new Date().toISOString();
      const { error: upErr } = await client
        .from("exam_attempts")
        .update({
          submitted_at: nowIso,
          status: "SUBMITTED",
          score: 0,
          correct_count: 0,
          wrong_count: 0,
          total_points: Number((attempt as any)?.total_points ?? 0),
          total_questions: Number((attempt as any)?.total_questions ?? 0),
          answers: answersMap,
        })
        .eq("id", attemptId);

      if (upErr) {
        return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: upErr }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        attemptId,
        score: 0,
        totalPoints: Number((attempt as any)?.total_points ?? 0),
        correctCount: 0,
        wrongQuestionIds: [],
        savedAnswers: 0,
        note: "question_ids empty; submitted with minimal update",
      });
    }

    // 3) questions 조회
    const { data: questions, error: qErr } = await client
      .from("questions")
      .select("*")
      .in("id", uniqQids as any);

    if (qErr) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    // 4) 채점 (✅ 못 푼 문제도 오답 처리)
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    const wrongQuestionIds: string[] = [];

    // exam_answers에 넣을 rows (선택한 것만 저장)
    const rowsToInsert: any[] = [];

    for (const qid of uniqQids) {
      const q = qById.get(String(qid));
      const pts = n(q?.points, 0) ?? 0;
      totalPoints += pts;

      const selectedIndex = Object.prototype.hasOwnProperty.call(answersMap, qid)
        ? Number(answersMap[qid])
        : null;

      const correctIndex = pickCorrectIndex(q);

      // 미선택(자동제출 등) => 오답 처리
      if (selectedIndex === null || selectedIndex === undefined) {
        wrongCount += 1;
        wrongQuestionIds.push(String(qid));
        continue;
      }

      const isCorrect =
        correctIndex !== null && Number.isFinite(Number(correctIndex))
          ? Number(selectedIndex) === Number(correctIndex)
          : false;

      if (isCorrect) {
        correctCount += 1;
        score += pts;
      } else {
        wrongCount += 1;
        wrongQuestionIds.push(String(qid));
      }

      // ✅ 선택한 것만 답안 테이블에 저장
      rowsToInsert.push({
        attempt_id: attemptId,
        question_id: qid,
        selected_index: Number(selectedIndex),
        is_correct: isCorrect,
      });
    }

    // 5) 기존 답안 삭제 후 재저장
    // ✅ 테이블명 수정: exam_attempt_answers ❌ -> exam_answers ✅
    const { error: delErr } = await client
      .from("exam_answers")
      .delete()
      .eq("attempt_id", attemptId);

    if (delErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_DELETE_FAILED", detail: delErr },
        { status: 500 }
      );
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await client
        .from("exam_answers")
        .insert(rowsToInsert);

      if (insErr) {
        return NextResponse.json(
          { ok: false, error: "ANSWERS_INSERT_FAILED", detail: insErr },
          { status: 500 }
        );
      }
    }

    // 6) attempt 업데이트
    const nowIso = new Date().toISOString();
    const { error: upErr } = await client
      .from("exam_attempts")
      .update({
        submitted_at: nowIso,
        status: "SUBMITTED",
        score,
        correct_count: correctCount,
        wrong_count: wrongCount,
        total_points: totalPoints,
        total_questions: uniqQids.length,
        answers: answersMap, // ✅ 결과/관리자 상세에서 "내 선택" 보여주려고 저장
      })
      .eq("id", attemptId);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: upErr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
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
