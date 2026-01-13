// app/api/admin/questions/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * ✅ 업로드 입력은 2가지 모두 지원
 * 1) JSON: { rows: [{content, points, is_active, choices, correct_index}] }  ← 너 프론트가 현재 이 방식
 * 2) FormData: file(csv) ← 예전 긴 CSV 업로드 방식
 */

type ParsedRow = {
  external_id?: string; // 문항ID (옵션)
  qtype?: string; // 문제유형 (옵션)
  content: string; // 문제내용
  choices: string[]; // 보기1~4
  correct_index?: number | null; // 0~3 (프로젝트에 따라)
  answer_index?: number | null; // 0~3 (프로젝트에 따라)
  points: number; // 배점
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

function pickEmpIdFromCookie(cookieHeader: string) {
  return (
    getCookie(cookieHeader, "empId") ||
    getCookie(cookieHeader, "emp_id") ||
    getCookie(cookieHeader, "userId") ||
    getCookie(cookieHeader, "employeeId") ||
    getCookie(cookieHeader, "emp") ||
    ""
  );
}

function pickRoleFromCookie(cookieHeader: string) {
  return getCookie(cookieHeader, "role") || "";
}

/** ✅ 관리자(team) 조회: accounts.username = empId 우선, 없으면 accounts.emp_id = empId */
async function getMyTeam(empId: string) {
  if (!empId) return { team: null as string | null, detail: "NO_EMPID" };

  // username 우선
  {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("team, username, emp_id")
      .eq("username", empId)
      .maybeSingle();

    if (!error && data) return { team: (data as any).team ?? null, detail: "BY_USERNAME" };
  }

  // emp_id fallback
  {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("team, username, emp_id")
      .eq("emp_id", empId)
      .maybeSingle();

    if (!error && data) return { team: (data as any).team ?? null, detail: "BY_EMP_ID" };
  }

  return { team: null as string | null, detail: "NOT_FOUND" };
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
      // "" 이스케이프 처리
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
      // \r\n 처리
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => s(c) !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  // 마지막 라인
  row.push(cur);
  if (row.some((c) => s(c) !== "")) rows.push(row);

  return rows;
}

function normalizeHeader(h: string) {
  return s(h)
    .replace(/\uFEFF/g, "") // BOM
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * ✅ EUC-KR(한글 CSV)도 읽히게 디코딩
 * - 1) utf-8로 먼저 시도
 * - 2) 깨져 보이면(e.g. � 많음) euc-kr 재시도
 */
function decodeSmart(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);

  // utf-8 우선
  let t = "";
  try {
    t = new TextDecoder("utf-8", { fatal: false }).decode(u8);
  } catch {
    t = "";
  }

  const looksBroken =
    !t ||
    t.includes("�") ||
    (!/[가-힣]/.test(t.slice(0, 200)) && /문항|문제|보기|정답|배점/.test(t));

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

  const n = Number(raw);
  if (Number.isFinite(n)) {
    const ni = Math.trunc(n);
    if (ni >= 1 && ni <= 4) return ni - 1; // 1~4 -> 0~3
    if (ni >= 0 && ni <= 3) return ni; // 0~3
  }
  return -1;
}

function parsePoints(v: string) {
  const raw = s(v);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return 1;
}

/**
 * ✅ “네 파일 그대로” 헤더 매핑
 * - 문항ID / 문제유형 / 문제내용 / 보기1~4 / 정답 / 배점
 */
function buildRowFromObject(obj: Record<string, string>): ParsedRow | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined) return s(v);
    }
    return "";
  };

  const external_id = get("문항id", "id", "qid", "questionid", "question_id");
  const qtype = get("문제유형", "type", "qtype");
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

  // ✅ 프로젝트마다 정답 컬럼명이 달라서 둘 다 채워두고,
  // 실제 insert할 때 컬럼 존재 여부로 자동 fallback 처리
  return {
    external_id,
    qtype,
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

    const choices = Array.isArray(r?.choices) ? r.choices.map((x: any) => s(x)).filter((x: string) => x !== "") : [];
    if (!content || choices.length === 0) continue;

    // 프론트는 correct_index로 보내는 중
    const ciRaw = r?.correct_index ?? r?.answer_index ?? r?.answerIndex ?? r?.correctIndex;
    let idx: number | null = null;
    if (ciRaw !== undefined && ciRaw !== null && ciRaw !== "") {
      const n = Number(ciRaw);
      if (Number.isFinite(n)) idx = Math.trunc(n);
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
  let payload = payloadBase.map((p) => ({ ...p }));

  let r = await supabaseAdmin.from("questions").insert(payload);
  if (!r.error) return { ok: true, mode: "team+correct_index" as const };

  const msg1 = String(r.error.message || r.error);

  // 2) team 컬럼 없으면 team 제거하고 재시도
  if (msg1.toLowerCase().includes("column") && msg1.toLowerCase().includes("team") && msg1.toLowerCase().includes("does not exist")) {
    payload = payloadBase.map((p) => {
      const { team, ...rest } = p;
      return rest;
    });
    r = await supabaseAdmin.from("questions").insert(payload);
    if (!r.error) return { ok: true, mode: "no-team+correct_index" as const };

    const msg2 = String(r.error.message || r.error);

    // 3) correct_index 컬럼 없으면 answer_index로 재시도
    if (msg2.toLowerCase().includes("column") && msg2.toLowerCase().includes("correct_index") && msg2.toLowerCase().includes("does not exist")) {
      const payload3 = payload.map((p: any) => {
        const { correct_index, ...rest } = p;
        return { ...rest, answer_index: p.answer_index ?? null };
      });
      const r3 = await supabaseAdmin.from("questions").insert(payload3);
      if (!r3.error) return { ok: true, mode: "no-team+answer_index" as const };
      return { ok: false, error: "DB_INSERT_FAILED", detail: String(r3.error.message || r3.error) };
    }

    return { ok: false, error: "DB_INSERT_FAILED", detail: msg2 };
  }

  // 3) correct_index 컬럼 없으면 answer_index로 재시도 (team 유지)
  if (msg1.toLowerCase().includes("column") && msg1.toLowerCase().includes("correct_index") && msg1.toLowerCase().includes("does not exist")) {
    const payload2 = payloadBase.map((p: any) => {
      const { correct_index, ...rest } = p;
      return { ...rest, answer_index: p.answer_index ?? null };
    });
    const r2 = await supabaseAdmin.from("questions").insert(payload2);
    if (!r2.error) return { ok: true, mode: "team+answer_index" as const };
    return { ok: false, error: "DB_INSERT_FAILED", detail: String(r2.error.message || r2.error) };
  }

  return { ok: false, error: "DB_INSERT_FAILED", detail: msg1 };
}

export async function POST(req: Request) {
  try {
    // ✅ 0) 관리자/팀 정보
    const cookieHeader = req.headers.get("cookie") || "";
    const empId = pickEmpIdFromCookie(cookieHeader);
    const role = pickRoleFromCookie(cookieHeader);

    if (!empId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED", detail: "NO_COOKIE_EMPID" }, { status: 401 });
    }
    if (role !== "admin") {
      // ⚠️ 지금 너 시스템은 admin_gs가 role=user로 떨어지는 문제가 있어서,
      // 이 체크를 켜면 admin_gs 업로드가 막힐 수 있음.
      // 일단 보안상은 admin만 허용이 맞아.
      return NextResponse.json({ ok: false, error: "FORBIDDEN", detail: `ROLE_NOT_ADMIN(${role})` }, { status: 403 });
    }

    const my = await getMyTeam(empId);
    const team = my.team; // "A" or "B" 기대

    if (!team) {
      return NextResponse.json(
        { ok: false, error: "TEAM_NOT_FOUND", detail: { empId, lookup: my.detail } },
        { status: 400 }
      );
    }

    // ✅ 1) JSON 업로드 먼저 시도 (프론트가 보내는 방식)
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      const parsed = normalizeIncomingRows(rows);

      if (!parsed.length) {
        return NextResponse.json({ ok: false, error: "NO_VALID_ROWS" }, { status: 400 });
      }

      // ✅ 저장 payload (team 포함)
      const payloadBase = parsed.map((r) => ({
        content: r.content,
        choices: r.choices,
        points: r.points,
        is_active: r.is_active,
        team, // ✅ 핵심: 내 팀으로만 저장
        // correct_index/answer_index는 fallback insert에서 처리
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
      });
    }

    // ✅ 2) FormData 업로드(원래 긴 방식)
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
    const body = rows.slice(1);

    const parsed: ParsedRow[] = [];
    const rejected: { line: number; reason: string }[] = [];

    for (let i = 0; i < body.length; i++) {
      const cols = body[i];
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
          detail: "CSV는 읽었지만 유효한 문항이 0건입니다. (문제내용/보기/정답/배점 형식 확인 필요)",
          rejected_preview: rejected.slice(0, 10),
        },
        { status: 400 }
      );
    }

    const payloadBase = parsed.map((r) => ({
      // external_id/qtype 저장하려면 questions 테이블에 컬럼 만들고 주석 해제
      // external_id: r.external_id || null,
      // qtype: r.qtype || null,
      content: r.content,
      choices: r.choices,
      points: r.points,
      is_active: r.is_active,
      team, // ✅ 핵심: 내 팀으로만 저장
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
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UPLOAD_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
