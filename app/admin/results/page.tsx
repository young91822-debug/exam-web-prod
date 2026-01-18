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
  owner_admin?: string | null;
};

type ApiResp =
  | { ok: true; page: number; pageSize: number; total?: number; items: ApiItem[]; mode?: string; filters?: any; selectExpr?: string }
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
  ownerAdmin?: string | null;
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

  // total_points 없으면 "문항수"로 fallback (너가 원래 하던 방식 유지)
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
    ownerAdmin: a.owner_admin ?? null,
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
  const [tick, setTick] = useState(0); // 새로고침 트리거

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const json: ApiResp = await res.json().catch(() => ({} as any));
        if (!alive) return;
        setData(json);
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [apiUrl, tick]);

  const GRID_MIN_WIDTH = 1320;

  const ok = (data as any)?.ok === true;
  const modeText = ok && (data as any)?.mode ? String((data as any).mode) : "";
  const teamText = ok && (data as any)?.filters?.team ? String((data as any).filters.team) : "";
  const ownerText = ok && (data as any)?.filters?.owner_admin ? String((data as any).filters.owner_admin) : "";

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 18,
        background:
          "radial-gradient(1200px 650px at 18% 10%, rgba(60, 130, 255, 0.25) 0%, rgba(10, 16, 32, 1) 50%, rgba(6, 8, 15, 1) 100%)",
        color: "#eaf0ff",
        fontFamily: "system-ui",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        {/* ✅ 헤더 + 버튼 */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 950 }}>응시현황</div>

            <div style={{ marginTop: 8, opacity: 0.72, fontSize: 12 }}>
              apiUrl: <span style={{ fontFamily: "monospace" }}>{apiUrl}</span>
            </div>

            <div style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>
              {modeText ? `mode: ${modeText}` : ""}
              {teamText ? ` / team: ${teamText}` : ""}
              {ownerText ? ` / owner_admin: ${ownerText}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* ✅ CSV 다운로드 (export 라우트 말고, results에 format=csv로) */}
            <button
              onClick={() => {
                // 팀/권한 필터는 서버가 쿠키로 알아서 적용. 넉넉히 500개.
                window.location.href = `/api/admin/results?page=1&pageSize=500&format=csv`;
              }}
              style={btnStyle()}
            >
              CSV 다운로드
            </button>

            <button
              onClick={() => setTick((x) => x + 1)}
              style={btnStyle()}
            >
              새로고침
            </button>
          </div>
        </div>

        {/* 상태 */}
        {loading && <div style={{ padding: 16, opacity: 0.9 }}>로딩중...</div>}

        {!loading && (!data || (data as any).ok !== true) && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              borderRadius: 14,
              border: "1px solid rgba(255,120,150,0.35)",
              background: "rgba(255,120,150,0.10)",
              color: "#ffb3c7",
              whiteSpace: "pre-wrap",
            }}
          >
            에러: {JSON.stringify(data, null, 2)}
          </div>
        )}

        {!loading && ok && (
          <>
            {/* ✅ 테이블 */}
            <div
              style={{
                marginTop: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                overflowX: "auto",
                overflowY: "hidden",
                background: "rgba(255,255,255,0.04)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              }}
            >
              <div style={{ minWidth: GRID_MIN_WIDTH }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 140px 160px 220px 220px 90px 150px 90px",
                    fontWeight: 900,
                    background: "rgba(255,255,255,0.06)",
                    padding: 12,
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
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
                        gridTemplateColumns: "140px 140px 160px 220px 220px 90px 150px 90px",
                        padding: 12,
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.95 }}>
                        {r.idType === "uuid" ? r.id.slice(0, 8) + "..." : r.id}
                      </div>

                      <div style={{ fontWeight: 800 }}>{r.empId}</div>

                      <div>
                        <b>{r.score}</b> / {r.totalPoints}
                        {r.wrongCount ? (
                          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
                            (오답 {r.wrongCount})
                          </span>
                        ) : null}
                      </div>

                      <div style={{ opacity: 0.9 }}>{fmt(r.startedAt)}</div>
                      <div style={{ opacity: 0.9 }}>{fmt(r.submittedAt)}</div>
                      <div style={{ fontWeight: 800 }}>{r.totalQuestions || "-"}</div>

                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                        {r.status ?? "-"}
                        {r.team ? ` (팀 ${r.team})` : ""}
                        {r.ownerAdmin ? ` / ${r.ownerAdmin}` : ""}
                      </div>

                      <div style={{ whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => router.push(`/admin/results/${encodeURIComponent(r.id)}`)}
                          style={btnStyle(true)}
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
                style={btnStyle()}
              >
                이전
              </button>
              <button
                onClick={() => router.push(`/admin/results?page=${page + 1}`)}
                style={btnStyle()}
              >
                다음
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function btnStyle(compact = false): React.CSSProperties {
  return {
    padding: compact ? "7px 10px" : "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#eaf0ff",
    cursor: "pointer",
    fontWeight: 900,
    backdropFilter: "blur(6px)",
  };
}
