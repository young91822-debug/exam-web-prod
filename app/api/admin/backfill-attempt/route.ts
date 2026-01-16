// app/api/admin/backfill-attempt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

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

export async function POST(req: NextRequest) {
  try {
    // ✅ 관리자 체크
    const empId = s(req.cookies.get("empId")?.value);
    const role = s(req.cookies.get("role")?.value);
    if (!empId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await readBody(req);
    const idsRaw = body?.attemptIds ?? body?.ids ?? body?.attemptId ?? body?.id;

    let attemptIds: number[] = [];
    if (Array.isArray(idsRaw)) attemptIds = idsRaw.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x));
    else if (isNumericId(idsRaw)) attemptIds = [Number(idsRaw)];
    else {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_IDS" }, { status: 400 });
    }

    const teamCookie = s(req.cookies.get("team")?.value);
    const defaultTeam = teamCookie || (empId === "admin_gs" ? "B" : "A");

    const results: any[] = [];

    for (const attemptId of attemptIds) {
      // 1) attempt
      const { data: attempt, error: eA } = await sb
        .from("exam_attempts")
        .select("id, emp_id, question_ids, team, status, submitted_at")
        .eq("id", attemptId)
        .maybeSingle();

      if (eA || !attempt) {
        results.push({ attemptId, ok: false, error: "ATTEMPT_NOT_FOUND", detail: eA ?? null });
        continue;
      }

      const team = s((attempt as any)?.team) || defaultTeam;

      // 2) answers
      const { data: answers, error: eAns } = await sb
        .from("exam_answers")
        .select("question_id, selected_index")
        .eq("attempt_id", attemptId);

      if (eAns) {
        results.push({ attemptId, ok: false, error: "ANSWERS_QUERY_FAILED", detail: eAns });
        continue;
      }

      const ansMap = new Map<string, number>();
      for (const a of answers ?? []) {
        const qid = s((a as any)?.question_id);
        const sel = (a as any)?.selected_index;
        if (!qid) continue;
        if (sel === null || sel === undefined) continue;
        ansMap.set(qid, Number(sel));
      }

      // 3) qids
      const qids: string[] = Array.isArray((attempt as any)?.question_ids)
        ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
        : Array.from(ansMap.keys());

      const uniqQids = Array.from(new Set(qids)).filter(Boolean);

      // 4) questions
      const { data: questions, error: eQ } = uniqQids.length
        ? await sb.from("questions").select("id, points, correct_index, answer_index, correct_answer, answer").in("id", uniqQids as any)
        : { data: [], error: null as any };

      if (eQ) {
        results.push({ attemptId, ok: false, error: "QUESTIONS_QUERY_FAILED", detail: eQ });
        continue;
      }

      const qById = new Map<string, any>();
      for (const q of questions ?? []) qById.set(s((q as any)?.id), q);

      // 5) grade
      let score = 0;
      for (const qid of uniqQids) {
        const q = qById.get(s(qid));
        if (!q) continue;
        const pts = n(q?.points, 0) ?? 0;
        const correct = pickCorrectIndex(q);
        const chosen = ansMap.has(qid) ? ansMap.get(qid)! : null;
        if (correct !== null && chosen !== null && Number(correct) === Number(chosen)) {
          score += pts;
        }
      }

      // 6) update attempt (너 DB에 실제로 있는 컬럼만)
      const nowIso = new Date().toISOString();
      const { error: eUp } = await sb
        .from("exam_attempts")
        .update({
          submitted_at: nowIso,
          status: "SUBMITTED",
          score,
          team,
        })
        .eq("id", attemptId);

      if (eUp) {
        results.push({ attemptId, ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: eUp });
        continue;
      }

      results.push({
        attemptId,
        ok: true,
        score,
        team,
        submitted_at: nowIso,
        note: "backfilled (submitted_at/status/score/team)",
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "BACKFILL_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
