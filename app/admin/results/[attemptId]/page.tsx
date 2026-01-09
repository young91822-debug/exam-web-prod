// app/admin/results/[attemptId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type ApiOk = {
  ok: true;
  attempt: any;
  graded: any[];
  wrongQuestions?: any[];
  wrongCount?: number;
  totalQuestions?: number;
  meta?: any;
};

type ApiErr = { ok: false; error: string; detail?: any };

type ApiResp = ApiOk | ApiErr;

function fmtDate(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export default function AdminResultDetailPage() {
  const params = useParams();

  const attemptId = useMemo(() => {
    const raw = (params as any)?.attemptId ?? (params as any)?.attemptID ?? "";
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);

  useEffect(() => {
    let dead = false;

    async function run() {
      if (!attemptId) {
        if (!dead) {
          setErr("INVALID_ATTEMPT_ID");
          setData({ ok: false, error: "INVALID_ATTEMPT_ID" });
          setLoading(false);
        }
        return;
      }

      if (!dead) {
        setLoading(true);
        setErr(null);
      }

      try {
        const res = await fetch(`/api/admin/result-detail?attemptId=${attemptId}`, {
          cache: "no-store",
        });

        const text = await res.text();

        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (dead) return;

        if (!res.ok || !json?.ok) {
          console.error("RESULT_DETAIL_FETCH_FAILED", { status: res.status, text, json });

          setErr(json?.error || `HTTP_${res.status}`);
          setData(json ?? { ok: false, error: `HTTP_${res.status}`, detail: text });
        } else {
          setData(json as ApiOk);
        }
      } catch (e: any) {
        if (dead) return;
        console.error("RESULT_DETAIL_FETCH_EXCEPTION", e);
        setErr("NETWORK_OR_RUNTIME_ERROR");
        setData({ ok: false, error: "NETWORK_OR_RUNTIME_ERROR", detail: String(e?.message ?? e) });
      } finally {
        if (!dead) setLoading(false);
      }
    }

    run();

    return () => {
      dead = true;
    };
  }, [attemptId]);

  const attempt = data && (data as any).ok ? (data as any).attempt : null;
  const gradedAll = data && (data as any).ok ? ((data as any).graded ?? []) : [];

  // ✅ 오답/미제출만 표시
  const graded = useMemo(() => {
    return gradedAll.filter((g: any) => g?.status === "unsubmitted" || g?.isCorrect === false);
  }, [gradedAll]);

  async function downloadExcel() {
    if (!attemptId) return;
    const url = `/api/admin/result-detail/download?attemptId=${attemptId}`;
    window.location.href = url;
  }

  if (loading) return <div style={{ padding: 16 }}>불러오는 중...</div>;

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>에러</div>
        <pre style={{ whiteSpace: "pre-wrap" }}>{err}</pre>
        {data && <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{JSON.stringify(data, null, 2)}</pre>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>결과 상세</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>attemptId: {attemptId}</div>
        </div>

        <button
          onClick={downloadExcel}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          엑셀 다운로드
        </button>
      </div>

      {/* 기본 정보 */}
      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>기본 정보</div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div style={{ opacity: 0.75 }}>응시자ID</div>
          <div>{attempt?.emp_id ?? "-"}</div>

          <div style={{ opacity: 0.75 }}>점수</div>
          <div>
            {attempt?.score ?? 0} / {attempt?.total_points ?? "-"}
          </div>

          <div style={{ opacity: 0.75 }}>응시 시작</div>
          <div>{fmtDate(attempt?.started_at)}</div>

          <div style={{ opacity: 0.75 }}>제출 시각</div>
          <div>{fmtDate(attempt?.submitted_at)}</div>

          <div style={{ opacity: 0.75 }}>상태</div>
          <div>{attempt?.status ?? "-"}</div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>❌ 오답 및 미제출 문제만 표시됩니다.</div>
      </div>

      {/* 문제 리스트 */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {graded.length === 0 ? (
          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
            표시할 오답/미제출 문제가 없습니다.
          </div>
        ) : (
          graded.map((g: any, idx: number) => {
            const isUnsubmitted = g?.status === "unsubmitted";
            const isWrong = g?.status === "submitted" && g?.isCorrect === false;

            const borderColor = isWrong ? "#ff3b30" : isUnsubmitted ? "#bbb" : "#eee";
            const bg = isWrong ? "rgba(255,59,48,0.04)" : isUnsubmitted ? "rgba(0,0,0,0.03)" : "white";

            const choices: any[] = Array.isArray(g?.choices) ? g.choices : [];
            const selectedIndex = typeof g?.selectedIndex === "number" ? g.selectedIndex : null;
            const correctIndex = typeof g?.correctIndex === "number" ? g.correctIndex : null;

            return (
              <div
                key={String(g?.questionId ?? idx)}
                style={{
                  border: `2px solid ${borderColor}`,
                  background: bg,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 800 }}>
                    Q{idx + 1}. {g?.content ?? ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                    {isWrong ? "오답" : isUnsubmitted ? "미제출" : ""}
                  </div>
                </div>

                {/* 보기 */}
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {choices.map((c: any, i: number) => {
                    const isSelected = !isUnsubmitted && selectedIndex === i;
                    const isCorrectChoice = correctIndex === i;

                    // ✅ 표시 규칙
                    // - 미제출: 정답만 표시(원하면 여기서 정답도 숨길 수 있음)
                    // - 제출(오답): 내 선택 + 정답 모두 표시
                    let tag = "";
                    if (isCorrectChoice) tag = "정답";
                    else if (isSelected) tag = "내 선택";

                    return (
                      <div
                        key={i}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          opacity: isUnsubmitted ? 0.9 : 1,
                        }}
                      >
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {i + 1}. {String(c ?? "")}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, opacity: tag ? 0.9 : 0.2 }}>{tag || "•"}</div>
                      </div>
                    );
                  })}
                </div>

                {/* 요약 */}
                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                  <div>내 선택: {isUnsubmitted ? "-" : selectedIndex != null ? selectedIndex + 1 : "-"}</div>
                  <div>정답: {correctIndex != null ? correctIndex + 1 : "-"}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
