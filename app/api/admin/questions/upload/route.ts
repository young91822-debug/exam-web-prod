// app/api/admin/questions/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin"; // ✅ 너 프로젝트 경로에 맞게만 조정

type ParsedRow = {
  external_id?: string; // 문항ID
  qtype?: string;       // 문제유형
  content: string;      // 문제내용
  choices: string[];    // 보기1~4
  answer_index: number; // 0~3
  points: number;       // 배점
  is_active: boolean;
};

function s(v: any) {
  return String(v ?? "").trim();
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
      // 빈 줄 스킵
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
    // 헤더 후보가 한글인데 한글이 거의 안 보이면 깨졌다고 판단
    (!/[가-힣]/.test(t.slice(0, 200)) && /문항|문제|보기|정답|배점/.test(t));

  if (!looksBroken) return t;

  // euc-kr 재시도
  try {
    return new TextDecoder("euc-kr", { fatal: false }).decode(u8);
  } catch {
    // 최후: 그냥 utf-8 리턴
    return t;
  }
}

function parseAnswerToIndex(v: string) {
  // CSV에 2.0, 3.0 이런 식으로 들어있어서 처리
  const raw = s(v);
  if (!raw) return -1;

  // 1) 숫자면 1~4 기준으로 변환
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const ni = Math.trunc(n);
    if (ni >= 1 && ni <= 4) return ni - 1;
    if (ni >= 0 && ni <= 3) return ni; // 혹시 0~3로 올 수도 있음
  }

  // 2) 보기 텍스트로 들어온 경우는 여기선 못 맞추니 실패 처리
  return -1;
}

function parsePoints(v: string) {
  const raw = s(v);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return 1; // 기본 1점
}

/**
 * ✅ “네 파일 그대로”를 지원하는 헤더 매핑
 * - 문항ID / 문제유형 / 문제내용 / 보기1~4 / 정답 / 배점
 * + 혹시 영어 헤더도 섞여도 처리
 */
function buildRowFromObject(obj: Record<string, string>): ParsedRow | null {
  // 헤더 후보들 (한글/영어 혼용 대응)
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
  // 보기 4개 중 빈칸이 섞여도 업로드는 하되, 전부 비어있으면 무효 처리
  const hasAnyChoice = choices.some((x) => x !== "");
  if (!hasAnyChoice) return null;

  const answer_index = parseAnswerToIndex(answerRaw);
  // 정답이 없으면 무효 처리 (원하면 -1 허용도 가능)
  if (answer_index < 0) return null;

  const points = parsePoints(pointsRaw);

  return {
    external_id,
    qtype,
    content,
    choices,
    answer_index,
    points,
    is_active: true,
  };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "NO_FILE" },
        { status: 400 }
      );
    }

    const buf = await file.arrayBuffer();
    const text = decodeSmart(buf);

    const rows = parseCSV(text);
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "NO_ROWS" },
        { status: 400 }
      );
    }

    // 헤더 → normalize
    const header = rows[0].map((h) => normalizeHeader(h));
    const body = rows.slice(1);

    const parsed: ParsedRow[] = [];
    const rejected: { line: number; reason: string }[] = [];

    for (let i = 0; i < body.length; i++) {
      const cols = body[i];
      const obj: Record<string, string> = {};

      for (let c = 0; c < header.length; c++) {
        obj[header[c]] = cols[c] ?? "";
      }

      const pr = buildRowFromObject(obj);
      if (!pr) {
        rejected.push({ line: i + 2, reason: "INVALID_ROW" }); // 1-based + header
        continue;
      }
      parsed.push(pr);
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_VALID_ROWS",
          detail:
            "CSV는 읽었지만 유효한 문항이 0건입니다. (문제내용/보기/정답/배점 형식 확인 필요)",
          rejected_preview: rejected.slice(0, 10),
        },
        { status: 400 }
      );
    }

    // ✅ DB 저장 (테이블/컬럼명은 너 프로젝트 스키마에 맞게 조정)
    // 보통 questions 테이블에 content/choices/answer_index/points/is_active 정도 있을 것
    // external_id(문항ID)를 저장하고 싶으면 테이블에 external_id 컬럼을 만들고 아래 주석 해제
    const payload = parsed.map((r) => ({
      // external_id: r.external_id || null,
      // qtype: r.qtype || null,
      content: r.content,
      choices: r.choices,
      answer_index: r.answer_index,
      points: r.points,
      is_active: r.is_active,
    }));

    const { error } = await supabaseAdmin.from("questions").insert(payload);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      inserted: parsed.length,
      rejected: rejected.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UPLOAD_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
