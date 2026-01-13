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

function s(v: any) {
  return String(v ?? "").trim();
}

function looksLikeUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

export default function AdminResultDetailPage() {
  const params = useParams();

  // ✅ 숫자든 UUID든 "문자열 그대로" 받는다
  const attemptKey = useMemo(() => {
    const raw = (params as any)?.attemptId ?? (params as any)?.attemptID ?? "";
    const key = s(raw);
    return key ? key : null;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);

  useEffect(() => {
    let dead = false;

    async function run() {
      if (!attemptKey) {
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
        // ✅ attemptId에 그대로 넣어서 보냄 (API가 숫자/UUID 알아서 처리하게)
        // + 혹시 API가 attemptUuid를 따로 받는 버전이면 같이 보냄(안 받으면 무시됨)
        const qs = new URLSearchParams();
        qs.set("attemptId", attemptKey);
        if (looksLikeUuid(attemptKey)) qs.set("attemptUuid", attemptKey);

        const res = await fetch(`/api/admin/result-detail?${qs.toString()}`, {
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
          console.error("RESULT_DETAIL_FETCH_FAILED", { status: res.status, text, json, attemptKey });

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
  }, [attemptKey]);

  const attempt = data && (data as any).ok ? (data as any).attempt : null;
  const gradedAll = data && (data as any).ok ? ((data as any).graded ?? []) : [];

  // ✅ 오답/미제출만 표시(네가 쓰던 로직 유지)
  const graded = useMemo(() => {
    return gradedAll.filter((g: any) => g?.status === "unsubmitted" || g?.isCorrect === false);
  }, [gradedAll]);

  async function downloadExcel() {
    if (!attemptKey) return;

    const qs = new URLSearchParams();
    qs.set("attemptId", attemptKey);
    if (looksLikeUuid(attemptKey)) qs.set("attemptUuid", attemptKey);

    window.location.href = `/api/admin/result-detail/download?${qs.toString()}`;
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
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>attemptId: {attemptKey}</div>
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
          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 14 }}>표시할 오답/미제출 문제가 없습니다.</div>
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

                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {choices.map((c: any, i: number) => {
                    const isSelected = !isUnsubmitted && selectedIndex === i;
                    const isCorrectChoice = correctIndex === i;

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
