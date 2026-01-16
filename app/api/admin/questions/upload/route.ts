// app/api/admin/questions/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ParsedRow = {
  content: string;
  choices: string[];
  correct_index?: number | null;
  answer_index?: number | null;
  points: number;
  is_active: boolean;
};

function s(v: any) {
  return String(v ?? "").trim();
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

function isMissingColumn(err: any, table: string, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (
    low.includes(`column ${table.toLowerCase()}.${col.toLowerCase()} does not exist`) ||
    msg.includes(`Could not find the '${col}' column`) ||
    (low.includes(col.toLowerCase()) && low.includes("does not exist"))
  );
}

/**
 * ✅ 관리자 팀 조회 (절대 안 터지게)
 * - empId 쿠키 기반으로 accounts.emp_id 먼저 조회
 * - (있으면) accounts.username으로도 조회
 * - team이 없거나 비어있으면: admin_gs => B, 그외 => A 로 강제
 */
async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";

  const empId = getCookie(cookieHeader, "empId") || getCookie(cookieHeader, "userId");
  const roleCookie = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (roleCookie !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const sb: any = supabaseAdmin;

  // 1) emp_id로 조회
  let data: any = null;

  const r1 = await sb.from("accounts").select("emp_id, team, role").eq("emp_id", empId).maybeSingle();
  if (r1.error) {
    return {
      ok: false as const,
      status: 500,
      error: "DB_QUERY_FAILED",
      detail: String(r1.error?.message || r1.error),
    };
  }
  data = r1.data;

  // 2) 없으면 username으로 fallback (username 컬럼 없으면 스킵)
  if (!data) {
    const r2 = await sb.from("accounts").select("emp_id, team, role").eq("username", empId).maybeSingle();
    if (r2.error) {
      // username 컬럼이 없으면 그냥 스킵하고 아래 fallback으로 감
      if (!isMissingColumn(r2.error, "accounts", "username")) {
        return {
          ok: false as const,
          status: 500,
          error: "DB_QUERY_FAILED",
          detail: String(r2.error?.message || r2.error),
        };
      }
    } else {
      data = r2.data;
    }
  }

  // ✅ 팀 강제 결정 (accounts.team 없어도/비어도 절대 OK)
  const teamFromDb = s(data?.team);
  const team = teamFromDb || (empId === "admin_gs" ? "B" : "A");

  return { ok: true as const, team, empId };
}

/** 간단 CSV 파서 (따옴표/쉼표 기본 대응) */
function parseCSV(text: string) {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (!inQ && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }

    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => s(c) !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  if (row.some((c) => s(c) !== "")) rows.push(row);

  return rows;
}

function normalizeHeader(h: string) {
  return s(h).replace(/\uFEFF/g, "").replace(/\s+/g, "").toLowerCase();
}

function decodeSmart(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);

  let t = "";
  try {
    t = new TextDecoder("utf-8", { fatal: false }).decode(u8);
  } catch {
    t = "";
  }

  const looksBroken =
    !t || t.includes("�") || (!/[가-힣]/.test(t.slice(0, 200)) && /문항|문제|보기|정답|배점/.test(t));

  if (!looksBroken) return t;

  try {
    return new TextDecoder("euc-kr", { fatal: false }).decode(u8);
  } catch {
    return t;
  }
}

function parseAnswerToIndex(v: string) {
  const raw = s(v);
  if (!raw) return -1;

  const nn = Number(raw);
  if (Number.isFinite(nn)) {
    const ni = Math.trunc(nn);
    if (ni >= 1 && ni <= 4) return ni - 1;
    if (ni >= 0 && ni <= 3) return ni;
  }
  return -1;
}

function parsePoints(v: string) {
  const raw = s(v);
  const nn = Number(raw);
  if (Number.isFinite(nn) && nn > 0) return Math.trunc(nn);
  return 1;
}

function buildRowFromObject(obj: Record<string, string>): ParsedRow | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined) return s(v);
    }
    return "";
  };

  const content = get("문제내용", "content", "question", "문제");

  const c1 = get("보기1", "choice1", "option1");
  const c2 = get("보기2", "choice2", "option2");
  const c3 = get("보기3", "choice3", "option3");
  const c4 = get("보기4", "choice4", "option4");

  const answerRaw = get("정답", "answer", "correct", "correct_answer");
  const pointsRaw = get("배점", "points", "score", "point");

  if (!content) return null;

  const choices = [c1, c2, c3, c4].map((x) => s(x));
  if (!choices.some((x) => x !== "")) return null;

  const ans = parseAnswerToIndex(answerRaw);
  if (ans < 0) return null;

  const points = parsePoints(pointsRaw);

  return {
    content,
    choices,
    correct_index: ans,
    answer_index: ans,
    points,
    is_active: true,
  };
}

function normalizeIncomingRows(rows: any[]): ParsedRow[] {
  const out: ParsedRow[] = [];

  for (const r of rows || []) {
    const content = s(r?.content);
    const points = Number(r?.points);
    const is_active = r?.is_active === false ? false : true;

    const choices = Array.isArray(r?.choices)
      ? r.choices.map((x: any) => s(x)).filter((x: string) => x !== "")
      : [];
    if (!content || choices.length === 0) continue;

    const ciRaw = r?.correct_index ?? r?.answer_index ?? r?.answerIndex ?? r?.correctIndex;
    let idx: number | null = null;
    if (ciRaw !== undefined && ciRaw !== null && ciRaw !== "") {
      const nn = Number(ciRaw);
      if (Number.isFinite(nn)) idx = Math.trunc(nn);
    }

    out.push({
      content,
      choices,
      points: Number.isFinite(points) && points > 0 ? Math.trunc(points) : 1,
      is_active,
      correct_index: idx,
      answer_index: idx,
    });
  }

  return out;
}

async function insertWithFallback(payloadBase: any[]) {
  // 1) team + correct_index
  const r = await supabaseAdmin.from("questions").insert(payloadBase);
  if (!r.error) return { ok: true, mode: "team+correct_index" as const };

  const msg1 = String((r.error as any).message || r.error);

  // 1-1) team 컬럼 자체가 없으면 team 제거 후 재시도
  if (isMissingColumn(r.error, "questions", "team")) {
    const payloadNoTeam = payloadBase.map((p: any) => {
      const { team, ...rest } = p;
      return rest;
    });

    const rT = await supabaseAdmin.from("questions").insert(payloadNoTeam);
    if (!rT.error) return { ok: true, mode: "no_team+correct_index" as const };

    // team 제거 후에도 correct_index 없을 수 있으니 아래로 계속
    const msgT = String((rT.error as any).message || rT.error);
    // correct_index 없으면 아래 로직으로 이어가
    // (그냥 msg1 대신 msgT로 진행)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  }

  // 2) correct_index 컬럼 없으면 answer_index로 재시도 (team 유지 가능하면 유지)
  if (isMissingColumn(r.error, "questions", "correct_index")) {
    const payload2 = payloadBase.map((p: any) => {
      const { correct_index, ...rest } = p;
      return { ...rest, answer_index: p.answer_index ?? null };
    });

    const r2 = await supabaseAdmin.from("questions").insert(payload2);
    if (!r2.error) return { ok: true, mode: "team+answer_index" as const };

    // 2-1) answer_index도 없을 수 있음 → 둘 다 제거 (team은 유지/없으면 제거)
    if (isMissingColumn(r2.error, "questions", "answer_index")) {
      const payload3 = payloadBase.map((p: any) => {
        const { correct_index, answer_index, ...rest } = p;
        return rest;
      });
      const r3 = await supabaseAdmin.from("questions").insert(payload3);
      if (!r3.error) return { ok: true, mode: "no_answer_cols" as const };
      return {
        ok: false,
        error: "DB_INSERT_FAILED",
        detail: String((r3.error as any).message || r3.error),
      };
    }

    return { ok: false, error: "DB_INSERT_FAILED", detail: String((r2.error as any).message || r2.error) };
  }

  return { ok: false, error: "DB_INSERT_FAILED", detail: msg1 };
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    const team = auth.team;

    const ct = (req.headers.get("content-type") || "").toLowerCase();

    // ✅ 1) JSON 업로드
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      const parsed = normalizeIncomingRows(rows);

      if (!parsed.length) {
        return NextResponse.json({ ok: false, error: "NO_VALID_ROWS" }, { status: 400 });
      }

      const payloadBase = parsed.map((r) => ({
        content: r.content,
        choices: r.choices,
        points: r.points,
        is_active: r.is_active,
        team, // ✅ 무조건 내 팀
        correct_index: r.correct_index ?? r.answer_index ?? null,
        answer_index: r.answer_index ?? r.correct_index ?? null,
      }));

      const ins = await insertWithFallback(payloadBase);
      if (!ins.ok) {
        return NextResponse.json({ ok: false, error: ins.error, detail: ins.detail }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        mode: "json_rows",
        inserted: parsed.length,
        team,
        insertMode: ins.mode,
        marker: "ADMIN_QUESTIONS_UPLOAD_TEAM_v2",
      });
    }

    // ✅ 2) FormData CSV 업로드
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "NO_FILE" }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const text = decodeSmart(buf);

    const rows = parseCSV(text);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "NO_ROWS" }, { status: 400 });
    }

    const header = rows[0].map((h) => normalizeHeader(h));
    const bodyRows = rows.slice(1);

    const parsed: ParsedRow[] = [];
    const rejected: { line: number; reason: string }[] = [];

    for (let i = 0; i < bodyRows.length; i++) {
      const cols = bodyRows[i];
      const obj: Record<string, string> = {};
      for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";

      const pr = buildRowFromObject(obj);
      if (!pr) {
        rejected.push({ line: i + 2, reason: "INVALID_ROW" });
        continue;
      }
      parsed.push(pr);
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_VALID_ROWS",
          detail: "CSV는 읽었지만 유효한 문항이 0건입니다. (문제내용/보기/정답/배점 확인)",
          rejected_preview: rejected.slice(0, 10),
        },
        { status: 400 }
      );
    }

    const payloadBase = parsed.map((r) => ({
      content: r.content,
      choices: r.choices,
      points: r.points,
      is_active: r.is_active,
      team, // ✅ 무조건 내 팀
      correct_index: r.correct_index ?? r.answer_index ?? null,
      answer_index: r.answer_index ?? r.correct_index ?? null,
    }));

    const ins = await insertWithFallback(payloadBase);
    if (!ins.ok) {
      return NextResponse.json({ ok: false, error: ins.error, detail: ins.detail }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      mode: "csv_file",
      inserted: parsed.length,
      rejected: rejected.length,
      rejected_preview: rejected.slice(0, 10),
      team,
      insertMode: ins.mode,
      marker: "ADMIN_QUESTIONS_UPLOAD_TEAM_v2",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UPLOAD_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
