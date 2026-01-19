"use client";

import React, { useEffect, useMemo, useState } from "react";
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

function toNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function shortId(id: string) {
  if (!id) return "-";
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
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
    (!/[가-힣]/.test(head) && /(문항|문제|보기|정답|배점|사용)/.test(head));

  if (!looksBroken) return t;

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

  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 4) return n - 1;
    if (n >= 0 && n <= 3) return n;
  }

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

  const norm = (x: string) =>
    String(x ?? "")
      .replace(/\uFEFF/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();

  const idx = (...names: string[]) => {
    const set = new Set(names.map(norm));
    return header.findIndex((h) => set.has(norm(h)));
  };

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

  const iC1 = idx("choice1", "보기1", "option1", "선택지1");
  const iC2 = idx("choice2", "보기2", "option2", "선택지2");
  const iC3 = idx("choice3", "보기3", "option3", "선택지3");
  const iC4 = idx("choice4", "보기4", "option4", "선택지4");
  const iChoices = idx("choices", "보기", "선택지", "options", "보기목록");

  const iCorrect = idx("correct_index", "정답", "정답번호", "answer", "답", "정답(번호)", "correct");

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

    let choices = [iC1, iC2, iC3, iC4]
      .filter((i) => i >= 0)
      .map((i) => String(r[i] ?? "").trim())
      .filter((s) => s !== "");

    if (choices.length === 0 && iChoices >= 0) {
      const raw = String(r[iChoices] ?? "").trim();
      if (raw) {
        const parts = raw
          .split(/\r?\n|\||;|\/|,/g)
          .map((x) => x.trim())
          .filter((x) => x);
        choices = parts.slice(0, 4);
      }
    }

    if (choices.length === 0) continue;

    const correct_index = iCorrect >= 0 ? parseAnswerToIndex(String(r[iCorrect] ?? "")) : null;

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
      const text = await readCsvTextSmart(file);
      const { out: rows, header } = csvToRowsForUpload(text);

      if (!rows.length) {
        setErr(`CSV에 업로드할 문항이 없어요. (헤더: ${header.join(" | ")})`);
        return;
      }

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
        return;
      }

      router.push(`/admin/questions?page=1`);
      await fetchList(1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        background: "#f7f8fb",
        color: "#111827",
      }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -0.3 }}>시험문항 관리</div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip label={`총 ${total}건`} />
              <Chip label={`현재 ${items.length}건`} />
              <Chip label={`페이지당 ${PAGE_SIZE}건`} />
              <Chip label={`${page}/${totalPages} 페이지`} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={btn("primary", loading)}>
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

            <button onClick={onClearAll} disabled={loading} style={btn("danger", loading)}>
              전체 삭제
            </button>

            <button onClick={() => fetchList(page)} disabled={loading} style={btn("ghost", loading)}>
              새로고침
            </button>
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 14,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#9f1239",
              fontWeight: 800,
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        ) : null}

        {/* Table Card */}
        <div
          style={{
            marginTop: 16,
            borderRadius: 18,
            border: "1px solid #e5e7eb",
            background: "white",
            overflow: "hidden",
            boxShadow: "0 18px 60px rgba(17,24,39,0.08)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 980 }}>
              <thead>
                <tr
                  style={{
                    background: "#fbfbfd",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <Th w={160}>ID</Th>
                  <Th>문항</Th>
                  <Th w={90} center>
                    배점
                  </Th>
                  <Th w={110} center>
                    상태
                  </Th>
                  <Th w={110} center>
                    관리
                  </Th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 18, textAlign: "center", color: "#6b7280" }}>
                      {loading ? "불러오는 중..." : "표시할 문항이 없어요."}
                    </td>
                  </tr>
                ) : (
                  items.map((q) => {
                    const id = String(q.id ?? "");
                    const on = q.is_active !== false;

                    return (
                      <tr
                        key={id}
                        style={{
                          borderTop: "1px solid #f3f4f6",
                        }}
                      >
                        <Td mono title={id}>
                          {shortId(id)}
                        </Td>

                        <Td>
                          <div
                            style={{
                              fontWeight: 800,
                              color: "#111827",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              lineHeight: 1.35,
                            }}
                          >
                            {q.content || ""}
                          </div>
                        </Td>

                        <Td center>
                          <span style={{ fontWeight: 900 }}>{toNum(q.points, 0)}</span>
                        </Td>

                        <Td center>
                          <StatusPill on={on} />
                        </Td>

                        <Td center>
                          <button
                            onClick={() => router.push(`/admin/questions/edit?id=${encodeURIComponent(id)}`)}
                            style={miniBtn()}
                          >
                            수정
                          </button>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer pagination */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: 14,
              borderTop: "1px solid #eef2f7",
              background: "#fcfdff",
            }}
          >
            <button disabled={loading || page <= 1} onClick={() => goPage(1)} style={pagerBtn(loading || page <= 1)}>
              처음
            </button>
            <button disabled={loading || page <= 1} onClick={() => goPage(page - 1)} style={pagerBtn(loading || page <= 1)}>
              이전
            </button>

            <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 800 }}>
              {page} / {totalPages}
            </span>

            <button
              disabled={loading || page >= totalPages}
              onClick={() => goPage(page + 1)}
              style={pagerBtn(loading || page >= totalPages)}
            >
              다음
            </button>
            <button
              disabled={loading || page >= totalPages}
              onClick={() => goPage(totalPages)}
              style={pagerBtn(loading || page >= totalPages)}
            >
              마지막
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------- UI primitives --------- */

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "white",
        color: "#111827",
        fontSize: 12,
        fontWeight: 900,
        boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
      }}
    >
      {label}
    </span>
  );
}

function Th({ children, w, center }: { children: any; w?: number; center?: boolean }) {
  return (
    <th
      style={{
        textAlign: center ? "center" : "left",
        padding: "12px 14px",
        borderBottom: "1px solid #eef2f7",
        fontSize: 12,
        fontWeight: 950,
        color: "#374151",
        width: w ? `${w}px` : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  mono,
  title,
}: {
  children: any;
  center?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <td
      title={title}
      style={{
        padding: "14px 14px",
        borderBottom: "1px solid #f3f4f6",
        textAlign: center ? "center" : "left",
        verticalAlign: "top",
        fontSize: 13,
        color: "#111827",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
      }}
    >
      {children}
    </td>
  );
}

function StatusPill({ on }: { on: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 950,
        border: `1px solid ${on ? "#86efac" : "#fecaca"}`,
        background: on ? "#ecfdf5" : "#fff1f2",
        color: on ? "#065f46" : "#9f1239",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: on ? "#22c55e" : "#fb7185",
        }}
      />
      {on ? "ON" : "OFF"}
    </span>
  );
}

function btn(variant: "primary" | "danger" | "ghost", disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    fontWeight: 950,
    fontSize: 13,
    userSelect: "none",
  };

  if (variant === "primary") {
    return { ...base, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#1e3a8a" };
  }
  if (variant === "danger") {
    return { ...base, border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239" };
  }
  return { ...base, background: "white", color: "#111827" };
}

function miniBtn(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "white",
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 13,
  };
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontWeight: 950,
    fontSize: 13,
  };
}
