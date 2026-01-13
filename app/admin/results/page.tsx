"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Row = {
  id: string; // ✅ uuid든 숫자든 문자열
  idType: "uuid" | "num";
  empId: string;
  score: number;
  totalPoints: number;
  startedAt: any;
  submittedAt: any;
  totalQuestions: number;
  wrongCount: number;
};

type ApiResp =
  | { ok: true; page: number; pageSize: number; items: Row[]; debug?: any }
  | { ok: false; error: string; detail?: any };

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
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

  const items = (data as any).items as Row[];

  // ✅ 그리드 최소폭: 컬럼 합계(1030px) + 여유
  const GRID_MIN_WIDTH = 1060;

  return (
    <div
      style={{
        padding: 16,
        width: "100%",          // ✅ 화면 꽉
        maxWidth: 1400,         // ✅ 너무 좁게 자르지 말기 (원하면 더 키워도 됨)
        margin: "0 auto",
        fontFamily: "system-ui",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 900 }}>응시현황</div>
      <div style={{ marginTop: 6, opacity: 0.7 }}>apiUrl: {apiUrl}</div>

      {/* ✅ 가로 스크롤 컨테이너 */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #eee",
          borderRadius: 14,
          overflowX: "auto",    // ✅ 핵심: 오른쪽 잘림 방지
          overflowY: "hidden",
        }}
      >
        {/* ✅ 실제 내용은 최소폭을 확보 */}
        <div style={{ minWidth: GRID_MIN_WIDTH }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "160px 120px 120px 220px 220px 120px 90px",
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
            <div style={{ whiteSpace: "nowrap" }}>상세</div>
          </div>

          {items.map((r) => (
            <div
              key={`${r.idType}:${r.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "160px 120px 120px 220px 220px 120px 90px",
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
              <div>{r.totalQuestions}</div>
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
