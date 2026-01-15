// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function num(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

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

const QUESTION_TABLE = "questions";
const ATTEMPT_TABLE = "exam_attempts"; // ✅ results 쪽이 exam_attempts를 쓰니까 통일

function toChoices(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? ""));
  if (typeof v === "string") return v.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function errMsg(e: any) {
  return String(e?.message ?? e ?? "");
}

/** 'Could not find the xxx column' 에서 컬럼명 추출 */
function extractMissingColumn(message: string) {
  // ex) Could not find the 'duration_sec' column of 'exam_attempts' in the schema cache
  const m = message.match(/Could not find the '([^']+)' column/i);
  return m?.[1] ?? null;
}

/** payload에서 특정 키 제거 */
function dropKey(obj: any, key: string) {
  const { [key]: _, ...rest } = obj;
  return rest;
}

export async function POST(req: Request) {
  try {
    const { client, error: envErr } = getSupabaseAdmin();
    if (envErr) {
      return NextResponse.json({ ok: false, error: "ENV_ERROR", detail: envErr }, { status: 500 });
    }

    const cookieHeader = req.headers.get("cookie") || "";
    const empId = getCookie(cookieHeader, "empId");
    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_SESSION" }, { status: 401 });
    }

    // ✅ team은 일단 안 쓰고(컬럼 없어서 터질 수 있음), 나중에 DB 정리 후 붙이자
    const nowIso = new Date().toISOString();

    // 1) questions 조회 (team/is_active 있으면 쓰고, 없으면 fallback)
    let qrows: any[] = [];
    const r1 = await client
      .from(QUESTION_TABLE)
      .select("id, content, choices, points, is_active, team")
      .eq("is_active", true)
      .limit(5000);

    if (!r1.error) qrows = r1.data || [];
    else {
      const r2 = await client
        .from(QUESTION_TABLE)
        .select("id, content, choices, points")
        .limit(5000);

      if (r2.error) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: r2.error },
          { status: 500 }
        );
      }
      qrows = r2.data || [];
    }

    if (!qrows.length) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: "questions returned 0 rows" },
        { status: 500 }
      );
    }

    // 2) 랜덤 20문제
    const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
    const pickedIds = picked.map((q) => String(q.id));
    const totalPoints = picked.reduce((sum, q) => sum + num(q.points, 5), 0);

    /**
     * 3) attempt 생성
     * - duration_sec 같은 “없을 수 있는 컬럼”은 처음부터 넣지 않음
     * - 그래도 컬럼 없다고 터지면, 에러 메시지에서 컬럼명을 뽑아서 payload에서 제거하고 재시도
     */
    let payload: any = {
      emp_id: empId,
      started_at: nowIso,
      submitted_at: null,
      total_questions: pickedIds.length,
      total_points: totalPoints,
      score: 0,
      wrong_count: 0,
      // question_ids / answers 컬럼도 타입이 다를 수 있어 2단계로 처리
      question_ids: pickedIds,
      answers: [],
    };

    // 최대 5번까지 "없는 컬럼 제거" 재시도
    let lastErr: any = null;
    let attemptId: string | null = null;

    for (let i = 0; i < 5; i++) {
      const ins = await client.from(ATTEMPT_TABLE).insert(payload).select("id").single();
      if (!ins.error && ins.data?.id !== undefined && ins.data?.id !== null) {
        attemptId = String(ins.data.id);
        lastErr = null;
        break;
      }

      lastErr = ins.error;

      const msg = errMsg(ins.error);
      const missingCol = extractMissingColumn(msg);
      if (missingCol) {
        payload = dropKey(payload, missingCol);
        continue;
      }

      // question_ids/answers 타입 불일치일 수 있음 → JSON string으로 한번 바꿔 재시도
      if (i === 0) {
        payload = {
          ...payload,
          question_ids: typeof payload.question_ids === "string" ? payload.question_ids : JSON.stringify(pickedIds),
          answers: typeof payload.answers === "string" ? payload.answers : JSON.stringify([]),
        };
        continue;
      }

      break;
    }

    if (!attemptId) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: lastErr },
        { status: 500 }
      );
    }

    // 4) 응답(문항 내려주기)
    const outQuestions = picked.map((q) => ({
      id: String(q.id),
      content: String(q.content ?? ""),
      choices: toChoices(q.choices),
      points: num(q.points, 5),
    }));

    return NextResponse.json({
      ok: true,
      attemptId,
      questions: outQuestions,
      debug: { empId, picked: outQuestions.length },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: e },
      { status: 500 }
    );
  }
}
