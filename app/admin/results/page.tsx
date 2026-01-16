"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiItem = {
  id: any;
  emp_id?: string | null;
  score?: number | null;
  started_at?: any;
  submitted_at?: any;
  total_questions?: number | null;
  total_points?: number | null;
  wrong_count?: number | null;
  team?: string | null;
  status?: string | null;
};

type ApiResp =
  | { ok: true; page: number; pageSize: number; total?: number; items: ApiItem[]; mode?: string; filters?: any }
  | { ok: false; error: string; detail?: any };

type Row = {
  id: string;
  idType: "uuid" | "num";
  empId: string;
  score: number;
  totalPoints: number;
  startedAt: any;
  submittedAt: any;
  totalQuestions: number;
  wrongCount: number;
  team?: string | null;
  status?: string | null;
};

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function toNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function guessIdType(id: string) {
  return id.includes("-") ? ("uuid" as const) : ("num" as const);
}

function normalize(a: ApiItem): Row {
  const id = String(a.id ?? "");
  const idType = guessIdType(id);

  const totalQuestions = toNum(a.total_questions, 0);
  const totalPoints = Number.isFinite(Number(a.total_points))
    ? toNum(a.total_points, totalQuestions)
    : totalQuestions;

  return {
    id,
    idType,
    empId: String(a.emp_id ?? "-"),
    score: toNum(a.score, 0),
    totalPoints,
    startedAt: a.started_at ?? null,
    submittedAt: a.submitted_at ?? null,
    totalQuestions,
    wrongCount: toNum(a.wrong_count, 0),
    team: a.team ?? null,
    status: a.status ?? null,
  };
}

export default function AdminResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const page = useMemo(() => Number(sp.get("page") ?? 1) || 1, [sp]);
  const pageSize = 50;

  const apiUrl = useMemo(() => `/api/admin/results?page=${page}&pageSize=${pageSize}`, [page]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResp | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      const res = await fetch(apiUrl, { cache: "no-store" });
      const json: ApiResp = await res.json().catch(() => ({} as any));
      if (!alive) return;
      setData(json);
      setLoading(false);
    }
    run();
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  const GRID_MIN_WIDTH = 1240;

  return (
    <div
      style={{
        padding: 16,
        width: "100%",
        maxWidth: 1400,
        margin: "0 auto",
        fontFamily: "system-ui",
      }}
    >
      {/* ✅ 헤더 + 버튼 */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950 }}>응시현황</div>
          <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>apiUrl: {apiUrl}</div>
          <div style={{ marginTop: 4, opacity: 0.7, fontSize: 12 }}>
            {(data as any)?.ok === true && (data as any)?.mode ? `mode: ${(data as any).mode}` : ""}
            {(data as any)?.ok === true && (data as any)?.filters?.team ? ` / team: ${(data as any).filters.team}` : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* ✅ CSV 다운로드 버튼 (여기가 너가 찾던 3-2) */}
          <button
            onClick={() => {
              // 현재 페이지/팀 기준으로 넉넉히 500개 내려받기
              window.location.href = `/api/admin/results/export?page=1&pageSize=500`;
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            CSV 다운로드
          </button>

          <button
            onClick={() => router.refresh?.()}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            새로고침
          </button>
        </div>
      </div>

      {/* 상태 */}
      {loading && <div style={{ padding: 16 }}>로딩중...</div>}

      {!loading && (!data || (data as any).ok !== true) && (
        <div style={{ padding: 16, color: "crimson" }}>에러: {JSON.stringify(data, null, 2)}</div>
      )}

      {!loading && data && (data as any).ok === true && (
        <>
          {/* ✅ 테이블 */}
          <div
            style={{
              marginTop: 12,
              border: "1px solid #eee",
              borderRadius: 14,
              overflowX: "auto",
              overflowY: "hidden",
              background: "#fff",
            }}
          >
            <div style={{ minWidth: GRID_MIN_WIDTH }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 120px 140px 220px 220px 110px 110px 90px",
                  fontWeight: 900,
                  background: "#fafafa",
                  padding: 10,
                }}
              >
                <div>attemptId</div>
                <div>응시자ID</div>
                <div>점수</div>
                <div>시작</div>
                <div>제출</div>
                <div>문항수</div>
                <div>상태</div>
                <div style={{ whiteSpace: "nowrap" }}>상세</div>
              </div>

              {(data as any).items.map((raw: ApiItem) => {
                const r = normalize(raw);
                return (
                  <div
                    key={`${r.idType}:${r.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "140px 120px 140px 220px 220px 110px 110px 90px",
                      padding: 10,
                      borderTop: "1px solid #eee",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {r.idType === "uuid" ? r.id.slice(0, 8) + "..." : r.id}
                    </div>

                    <div>{r.empId}</div>

                    <div>
                      <b>{r.score}</b> / {r.totalPoints}
                    </div>

                    <div>{fmt(r.startedAt)}</div>
                    <div>{fmt(r.submittedAt)}</div>
                    <div>{r.totalQuestions || "-"}</div>

                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {r.status ?? "-"}
                      {r.team ? ` (팀 ${r.team})` : ""}
                    </div>

                    <div style={{ whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => router.push(`/admin/results/${encodeURIComponent(r.id)}`)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                      >
                        보기
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 페이징 */}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              onClick={() => router.push(`/admin/results?page=${Math.max(1, page - 1)}`)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              이전
            </button>
            <button
              onClick={() => router.push(`/admin/results?page=${page + 1}`)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              다음
            </button>
          </div>
        </>
      )}
    </div>
  );
}
