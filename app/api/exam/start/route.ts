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

// ✅ 지금 DB가 team 분리 컬럼이 없을 수도 있으니 “있으면 쓰고, 없으면 무시” 전략
const QUESTION_TABLE = "questions";

// ⚠️ 주의: 너 프로젝트에서 결과 조회는 exam_attempts를 쓰고 있음.
// start도 exam_attempts로 맞추는 게 제일 안전함.
const ATTEMPT_TABLE = "exam_attempts";

// 에러를 안전하게 JSON 문자열로
function errToJson(e: any) {
  try {
    if (e?.message) return { message: e.message, ...e };
    return e;
  } catch {
    return { message: String(e) };
  }
}

async function pickTeamFromAccounts(client: any, empId: string) {
  // 1) team/username 컬럼이 있을 수도, 없을 수도 → 2단계로 시도
  // (a) username+team 있는 버전 시도
  const r1 = await client
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (!r1.error && r1.data) {
    const isActive = r1.data.is_active !== false;
    return { team: String(r1.data.team || "A"), isActive, found: true };
  }

  // (b) 컬럼 없어서 실패하면 emp_id만으로 최소 조회
  const r2 = await client
    .from("accounts")
    .select("emp_id, is_active") // ✅ 최소 컬럼
    .eq("emp_id", empId)
    .maybeSingle();

  if (r2.error) {
    // accounts 자체가 이상하면 여기서 에러로 처리
    throw { where: "accounts_min_select", error: r2.error };
  }
  if (!r2.data) return { team: "A", isActive: true, found: false };

  if (r2.data.is_active === false) {
    return { team: "A", isActive: false, found: true };
  }
  return { team: "A", isActive: true, found: true };
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

    // ✅ accounts에서 team 읽기(없으면 A로)
    const teamInfo = await pickTeamFromAccounts(client, empId);
    if (!teamInfo.isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }
    const team = (teamInfo.team || "A").trim() || "A";

    // 1) questions 조회: team/is_active가 있으면 필터, 없으면 fallback
    let qrows: any[] = [];

    // (a) team + is_active 필터 시도
    const q1 = await client
      .from(QUESTION_TABLE)
      .select("id, content, choices, points, is_active, team")
      .eq("team", team)
      .eq("is_active", true)
      .limit(5000);

    if (!q1.error) {
      qrows = q1.data || [];
    } else {
      // (b) is_active/team 컬럼 없을 수 있음 → 최소 컬럼로 fallback
      const q2 = await client
        .from(QUESTION_TABLE)
        .select("id, content, choices, points")
        .limit(5000);

      if (q2.error) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: q2.error },
          { status: 500 }
        );
      }
      qrows = q2.data || [];
    }

    if (!qrows.length) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: `questions returned 0 rows (team=${team})` },
        { status: 500 }
      );
    }

    // 2) 랜덤 20문제
    const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
    const pickedIds = picked.map((q) => String(q.id));
    const totalPoints = picked.reduce((sum, q) => sum + num(q.points, 5), 0);

    const nowIso = new Date().toISOString();

    /**
     * 3) attempt 생성: exam_attempts 기준(기존 코드들과 호환)
     * - NOT NULL 많이 걸리는 컬럼들 꼭 채움
     * - question_ids는 json/array 컬럼일 수도 있고 text일 수도 있으니 그대로 넣고, 실패하면 문자열로 재시도
     */
    let attemptId: any = null;

    const payloadBase: any = {
      emp_id: empId,
      started_at: nowIso,
      submitted_at: null,
      duration_sec: 900,
      total_questions: pickedIds.length,
      total_points: totalPoints,
      score: 0,
      wrong_count: 0,
      // ✅ team 컬럼이 있으면 저장되고, 없으면 insert 에러날 수 있으니 1차에는 넣지 않음(안전)
      // team,
    };

    // 1차: question_ids를 배열로
    let ins = await client
      .from(ATTEMPT_TABLE)
      .insert({ ...payloadBase, question_ids: pickedIds, answers: [] })
      .select("id")
      .single();

    // 실패하면 2차: question_ids를 문자열로(컬럼이 text일 때)
    if (ins.error) {
      ins = await client
        .from(ATTEMPT_TABLE)
        .insert({ ...payloadBase, question_ids: JSON.stringify(pickedIds), answers: JSON.stringify([]) })
        .select("id")
        .single();
    }

    if (ins.error || !ins.data?.id) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: ins.error ?? "no id" },
        { status: 500 }
      );
    }

    attemptId = String(ins.data.id);

    // 4) 응답
    const outQuestions = picked.map((q) => ({
      id: String(q.id),
      content: String(q.content ?? ""),
      choices: Array.isArray(q.choices)
        ? q.choices
        : typeof q.choices === "string"
        ? q.choices.split("\n").map((x: string) => x.trim()).filter(Boolean)
        : [],
      points: num(q.points, 5),
    }));

    return NextResponse.json({
      ok: true,
      attemptId,
      questions: outQuestions,
      debug: { empId, team, picked: outQuestions.length, accountFound: teamInfo.found },
    });
  } catch (e: any) {
    // ✅ 이제 [object Object] 안 나오게 자세히 내려줌
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: errToJson(e) },
      { status: 500 }
    );
  }
}
