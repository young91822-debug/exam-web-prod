"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Question = {
  id: string | number;
  content?: string;
  points?: number;
  is_active?: boolean | null;
};

type ListRes = {
  ok: boolean;
  error?: string;
  detail?: string;
  total?: number;
  page?: number;
  pageSize?: number;
  items?: Question[];
};

const PAGE_SIZE = 20;

function qsInt(v: string | null, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** ✅ CSV 디코딩 (utf-8 우선 → 깨지면 euc-kr 재시도) */
async function readCsvTextSmart(file: File) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);

  let t = "";
  try {
    t = new TextDecoder("utf-8", { fatal: false }).decode(u8);
  } catch {
    t = "";
  }

  const head = t.slice(0, 300);
  const looksBroken =
    !t ||
    head.includes("�") ||
    // 한글이 거의 없는데, 헤더 키워드가 있을 법한 경우
    (!/[가-힣]/.test(head) && /(문항|문제|보기|정답|배점|사용)/.test(head));

  if (!looksBroken) return t;

  // euc-kr fallback
  try {
    return new TextDecoder("euc-kr", { fatal: false }).decode(u8);
  } catch {
    return t;
  }
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
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
  return rows;
}

function parseAnswerToIndex(v: string) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  // "1", "2", "3", "4"
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 4) return n - 1;
    if (n >= 0 && n <= 3) return n;
  }

  // "1번", "2번"
  const m = raw.match(/(\d+)/);
  if (m) {
    const nn = Number(m[1]);
    if (Number.isFinite(nn)) {
      if (nn >= 1 && nn <= 4) return nn - 1;
      if (nn >= 0 && nn <= 3) return nn;
    }
  }

  return null;
}

/** ✅ CSV -> 업로드 rows 변환(유연 + choices 단일컬럼도 지원) */
function csvToRowsForUpload(csvText: string) {
  const rows = parseCSV(csvText);
  if (!rows.length) return { out: [] as any[], header: [] as string[] };

  const header = rows[0].map((s) => String(s ?? "").trim());
  const body = rows.slice(1);

  const norm = (x: string) => String(x ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

  const idx = (...names: string[]) => {
    const set = new Set(names.map(norm));
    return header.findIndex((h) => set.has(norm(h)));
  };

  // ✅ 문제내용 컬럼명 확장
  const iContent = idx(
    "content",
    "문제",
    "문항",
    "question",
    "문제내용",
    "문항내용",
    "문제내용(필수)",
    "문항내용(필수)"
  );

  const iPoints = idx("points", "배점", "점수", "score", "point");
  const iActive = idx("is_active", "사용여부", "active", "사용", "미사용", "사용여부(사용)");

  // 보기 컬럼
  const iC1 = idx("choice1", "보기1", "option1", "선택지1");
  const iC2 = idx("choice2", "보기2", "option2", "선택지2");
  const iC3 = idx("choice3", "보기3", "option3", "선택지3");
  const iC4 = idx("choice4", "보기4", "option4", "선택지4");

  // ✅ 단일 choices 컬럼도 허용
  const iChoices = idx("choices", "보기", "선택지", "options", "보기목록");

  // 정답
  const iCorrect = idx(
    "correct_index",
    "정답",
    "정답번호",
    "answer",
    "답",
    "정답(번호)",
    "correct"
  );

  const out: any[] = [];

  for (const r of body) {
    const content = iContent >= 0 ? String(r[iContent] ?? "").trim() : "";
    if (!content) continue;

    const pointsRaw = iPoints >= 0 ? String(r[iPoints] ?? "").trim() : "";
    const pointsNum = Number(pointsRaw);
    const points = Number.isFinite(pointsNum) && pointsNum > 0 ? Math.trunc(pointsNum) : 1;

    const activeRaw = iActive >= 0 ? String(r[iActive] ?? "").trim().toLowerCase() : "";
    const is_active =
      activeRaw === ""
        ? true
        : activeRaw === "1" ||
          activeRaw === "true" ||
          activeRaw === "y" ||
          activeRaw === "yes" ||
          activeRaw === "on" ||
          activeRaw === "사용";

    // 보기 1~4 우선
    let choices = [iC1, iC2, iC3, iC4]
      .filter((i) => i >= 0)
      .map((i) => String(r[i] ?? "").trim())
      .filter((s) => s !== "");

    // 보기 컬럼이 없으면 choices 단일 컬럼에서 분해
    if (choices.length === 0 && iChoices >= 0) {
      const raw = String(r[iChoices] ?? "").trim();
      if (raw) {
        // 구분자: | / ; , 혹은 줄바꿈
        const parts = raw
          .split(/\r?\n|\||;|\/|,/g)
          .map((x) => x.trim())
          .filter((x) => x);
        choices = parts.slice(0, 4);
      }
    }

    if (choices.length === 0) continue; // 보기 없으면 스킵

    const correct_index = iCorrect >= 0 ? parseAnswerToIndex(String(r[iCorrect] ?? "")) : null;

    // 정답 없으면 서버가 reject할 수 있으니, 그래도 보내되(서버에서 null 허용이면 ok),
    // 아니라면 여기서 continue 처리하면 됨.
    out.push({
      content,
      points,
      is_active,
      choices,
      correct_index,
    });
  }

  return { out, header };
}

export default function QuestionsAdminPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [page, setPage] = useState(() => qsInt(sp.get("page"), 1));
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Question[]>([]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((total || 0) / PAGE_SIZE)), [total]);

  useEffect(() => {
    const p = qsInt(sp.get("page"), 1);
    setPage(p);
  }, [sp]);

  async function fetchList(p = page) {
    setErr("");
    setLoading(true);
    try {
      const url = `/api/admin/questions?page=${p}&pageSize=${PAGE_SIZE}&includeOff=1`;
      const res = await fetch(url, { cache: "no-store" });
      const json: ListRes = await res.json().catch(() => ({ ok: false } as any));

      if (!res.ok || !json?.ok) {
        setErr(`LIST_FAILED: ${json?.detail || json?.error || res.status}`);
        console.error("LIST_FAILED:", json);
        setItems([]);
        setTotal(0);
        return;
      }

      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json.total ?? 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function goPage(p: number) {
    const next = Math.min(Math.max(1, p), totalPages);
    router.push(`/admin/questions?page=${next}`);
  }

  async function onClearAll() {
    if (!confirm("정말 전체 문항을 삭제할까요?")) return;

    setErr("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/questions/clear", {
        method: "POST",
        cache: "no-store",
      });

      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        const msg = json?.detail || json?.error || (raw ? raw.slice(0, 300) : "") || `HTTP_${res.status}`;
        setErr(`CLEAR_FAILED: ${msg}`);
        console.error("CLEAR_FAILED raw:", raw);
        console.error("CLEAR_FAILED json:", json);
        return;
      }

      router.push(`/admin/questions?page=1`);
      await fetchList(1);
    } catch (e: any) {
      setErr(`CLEAR_FAILED: ${String(e?.message ?? e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function onUploadCSV(file: File) {
    setErr("");
    setLoading(true);
    try {
      // ✅ EUC-KR까지 대응해서 텍스트 읽기
      const text = await readCsvTextSmart(file);

      const { out: rows, header } = csvToRowsForUpload(text);

      if (!rows.length) {
        setErr(`CSV에 업로드할 문항이 없어요. (헤더: ${header.join(" | ")})`);
        return;
      }

      // ✅ 여기서부터 네트워크에 반드시 찍혀야 정상
      const res = await fetch("/api/admin/questions/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
        cache: "no-store",
      });

      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        setErr(`UPLOAD_FAILED: ${json?.detail || json?.error || raw?.slice(0, 300) || res.status}`);
        console.error("UPLOAD_FAILED raw:", raw);
        console.error("UPLOAD_FAILED json:", json);
        return;
      }

      router.push(`/admin/questions?page=1`);
      await fetchList(1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>시험문항 관리</h1>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
            총 <b>{total}</b>건 · 현재 <b>{items.length}</b>건 표시 · 페이지당 <b>{PAGE_SIZE}</b>건 · {page}/{totalPages}페이지
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label
            style={{
              border: "1px solid #ddd",
              padding: "8px 12px",
              borderRadius: 10,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              background: "#fff",
            }}
          >
            CSV 업로드
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onUploadCSV(f);
              }}
            />
          </label>

          <button
            onClick={onClearAll}
            disabled={loading}
            style={{
              border: "1px solid #f2b8b5",
              background: "#fff5f5",
              color: "#b42318",
              padding: "8px 12px",
              borderRadius: 10,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            전체 삭제
          </button>

          <button
            onClick={() => fetchList(page)}
            disabled={loading}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              padding: "8px 12px",
              borderRadius: 10,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            새로고침
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 10, background: "#fff3f2", border: "1px solid #f2b8b5", borderRadius: 10 }}>
          <b style={{ color: "#b42318" }}>{err}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: 110 }}>ID</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>문항</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 80 }}>배점</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>상태</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, textAlign: "center", opacity: 0.7 }}>
                  {loading ? "불러오는 중..." : "표시할 문항이 없어요."}
                </td>
              </tr>
            ) : (
              items.map((q) => (
                <tr key={String(q.id)} style={{ borderBottom: "1px solid #f3f3f3" }}>
                  <td style={{ padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                    {String(q.id)}
                  </td>
                  <td style={{ padding: 10, whiteSpace: "pre-wrap" }}>{q.content || ""}</td>
                  <td style={{ padding: 10, textAlign: "center" }}>{q.points ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "center" }}>
                    {q.is_active === false ? (
                      <span style={{ padding: "2px 8px", borderRadius: 999, background: "#fff1f1", border: "1px solid #ffd1d1" }}>
                        OFF
                      </span>
                    ) : (
                      <span style={{ padding: "2px 8px", borderRadius: 999, background: "#ecfdf3", border: "1px solid #abefc6" }}>
                        ON
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 10, textAlign: "center" }}>
                    <button
                      onClick={() => router.push(`/admin/questions/edit?id=${encodeURIComponent(String(q.id))}`)}
                      style={{
                        border: "1px solid #ddd",
                        background: "#fff",
                        padding: "6px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <button disabled={loading || page <= 1} onClick={() => goPage(1)} style={btnStyle}>
          처음
        </button>
        <button disabled={loading || page <= 1} onClick={() => goPage(page - 1)} style={btnStyle}>
          이전
        </button>
        <div style={{ fontSize: 13, opacity: 0.8, padding: "0 8px" }}>
          {page} / {totalPages}
        </div>
        <button disabled={loading || page >= totalPages} onClick={() => goPage(page + 1)} style={btnStyle}>
          다음
        </button>
        <button disabled={loading || page >= totalPages} onClick={() => goPage(totalPages)} style={btnStyle}>
          마지막
        </button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  background: "#fff",
  padding: "8px 12px",
  borderRadius: 10,
  cursor: "pointer",
};
