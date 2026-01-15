// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

// ✅ accounts에서 team 읽기 (없으면 A)
async function pickTeamFromAccounts(empId: string) {
  const { data, error } = await sb
    .from("accounts")
    .select("team, is_active")
    .or(`emp_id.eq.${empId},username.eq.${empId}`)
    .maybeSingle();

  if (error) throw error;

  const isActive = data?.is_active === false ? false : true;
  const team = s(data?.team || "A") || "A";
  return { team, isActive };
}

export async function POST(req: Request) {
  try {
    const empId = s(getCookie(req, "empId"));
    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_SESSION" }, { status: 401 });
    }

    const teamInfo = await pickTeamFromAccounts(empId);
    if (!teamInfo.isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }
    const team = teamInfo.team;

    // ✅ 내 팀 문제만 가져오기
    const q1 = await sb
      .from("questions")
      .select("id, content, choices, points, is_active, team")
      .eq("team", team)
      .eq("is_active", true)
      .limit(5000);

    if (q1.error) {
      // is_active 컬럼 없을 수도 있으니 fallback
      const q2 = await sb
        .from("questions")
        .select("id, content, choices, points, team")
        .eq("team", team)
        .limit(5000);

      if (q2.error) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: q2.error },
          { status: 500 }
        );
      }

      if (!q2.data?.length) {
        return NextResponse.json(
          { ok: false, error: "NO_QUESTIONS", detail: { team } },
          { status: 500 }
        );
      }

      return await createAttemptAndRespond(empId, team, q2.data);
    }

    if (!q1.data?.length) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: { team } },
        { status: 500 }
      );
    }

    return await createAttemptAndRespond(empId, team, q1.data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

async function createAttemptAndRespond(empId: string, team: string, qrows: any[]) {
  const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
  const pickedIds = picked.map((q: any) => String(q.id));
  const totalPoints = picked.reduce((sum: number, q: any) => sum + n(q?.points, 5), 0);

  const nowIso = new Date().toISOString();

  // ✅ exam_attempts 스키마에 맞게 INSERT (현재 DB에 있는 컬럼만 쓰는 걸 추천)
  // ⚠️ 너 DB에 total_points/correct_count/wrong_count 컬럼이 없어서 전에 터졌었음
  // -> 일단 안전하게 "확실한 컬럼"만 넣어 (필요하면 나중에 컬럼 추가해서 확장)
  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    submitted_at: null,
    total_questions: pickedIds.length,
    score: 0,
    question_ids: pickedIds,
    answers: {}, // map 형태(JSON)
    team,        // ✅ 이제 DB에 team 컬럼 추가했으니 반드시 저장
  };

  const r1 = await sb.from("exam_attempts").insert(insertRow).select("id").single();

  if (r1.error || !r1.data?.id) {
    return NextResponse.json(
      { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: r1.error ?? "no id" },
      { status: 500 }
    );
  }

  const attempt = r1.data;

  const outQuestions = picked.map((q: any) => ({
    id: String(q.id),
    content: String(q.content ?? ""),
    choices: Array.isArray(q.choices)
      ? q.choices
      : typeof q.choices === "string"
      ? safeParseChoices(q.choices)
      : [],
    points: n(q?.points, 5),
  }));

  return NextResponse.json({
    ok: true,
    attemptId: String(attempt.id), // ✅ 숫자 id
    questions: outQuestions,
    debug: { empId, team, picked: outQuestions.length },
  });
}

function safeParseChoices(v: string): string[] {
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.map((x) => String(x ?? ""));
  } catch {}
  if (v.includes("|")) return v.split("|").map((x) => x.trim()).filter(Boolean);
  if (v.includes("\n")) return v.split("\n").map((x) => x.trim()).filter(Boolean);
  if (v.includes(",")) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return v ? [v] : [];
}
