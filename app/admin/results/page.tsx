"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** ✅ API 응답(스네이크케이스) 기준 */
type ApiItem = {
  id: any; // bigint/uuid 등
  emp_id?: string | null;
  score?: number | null;
  started_at?: any;
  submitted_at?: any;
  total_questions?: number | null;

  // 있을 수도 있는 필드들(안 오면 무시)
  total_points?: number | null;
  wrong_count?: number | null;
  team?: string | null;
  status?: string | null;
  attempt_uuid?: string | null; // 혹시 쓰는 경우
};

type ApiResp =
  | { ok: true; page: number; pageSize: number; total?: number; items: ApiItem[]; debug?: any; mode?: string; filters?: any }
  | { ok: false; error: string; detail?: any };

type Row = {
  id: string;
  idType: "uuid" | "num";
  empId: string;
  score: number;
  totalPoints: number;      // 없으면 totalQuestions로 대체
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
  // uuid면 보통 하이픈 포함
  return id.includes("-") ? ("uuid" as const) : ("num" as const);
}

function normalize(a: ApiItem): Row {
  const id = String(a.id ?? a.attempt_uuid ?? "");
  const idType = guessIdType(id);

  const totalQuestions = toNum(a.total_questions, 0);
  const totalPoints = Number.isFinite(Number(a.total_points))
    ? toNum(a.total_points, totalQuestions) // total_points 있으면 그걸 쓰고
    : totalQuestions;                       // 없으면 totalQuestions로 표시

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

  if (loading) return <div style={{ padding: 16 }}>로딩중...</div>;

  if (!data || (data as any).ok !== true) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        에러: {JSON.stringify(data, null, 2)}
      </div>
    );
  }

  const api = data as Extract<ApiResp, { ok: true }>;
  const items = (api.items ?? []).map(normalize);

  // ✅ 그리드 최소폭
  const GRID_MIN_WIDTH = 1180;

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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>응시현황</div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          {api.mode ? `mode: ${api.mode}` : ""} {api.filters?.team ? ` / team: ${api.filters.team}` : ""}
        </div>
      </div>

      <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>apiUrl: {apiUrl}</div>

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
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
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

          {items.map((r) => (
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
          ))}
        </div>
      </div>

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
    </div>
  );
}
