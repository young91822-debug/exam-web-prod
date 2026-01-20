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
  | {
      ok: true;
      page: number;
      pageSize: number;
      total?: number;
      items: ApiItem[];
      mode?: string;
      filters?: any;
      selectExpr?: string;
    }
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

/* ---------------- utils ---------------- */

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("ko-KR", { hour12: true });
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

  // total_points 없으면 "문항수"로 fallback (기존 방식 유지)
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

/* ---------------- UI helpers ---------------- */

const C = {
  bgA: "#0b1220",
  bgB: "#05070c",
  glass: "rgba(255,255,255,0.08)",
  glass2: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.12)",
  border2: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.92)",
  dim: "rgba(255,255,255,0.72)",
  mute: "rgba(255,255,255,0.55)",
};

function Glass({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.glass,
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 14px 42px rgba(0,0,0,0.28)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Pill({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "green" | "red" | "amber";
}) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    color: C.text,
    border: `1px solid ${C.border2}`,
    background: C.glass2,
    whiteSpace: "nowrap",
  };

  const toneStyle =
    tone === "blue"
      ? {
          borderColor: "rgba(59,130,246,0.35)",
          background: "rgba(59,130,246,0.12)",
        }
      : tone === "green"
      ? {
          borderColor: "rgba(16,185,129,0.35)",
          background: "rgba(16,185,129,0.12)",
        }
      : tone === "red"
      ? {
          borderColor: "rgba(244,63,94,0.35)",
          background: "rgba(244,63,94,0.12)",
        }
      : tone === "amber"
      ? {
          borderColor: "rgba(245,158,11,0.35)",
          background: "rgba(245,158,11,0.12)",
        }
      : {};

  return <span style={{ ...base, ...toneStyle }}>{children}</span>;
}

function btnStyle(
  compact = false,
  primary = false,
  danger = false
): React.CSSProperties {
  return {
    padding: compact ? "8px 10px" : "10px 12px",
    borderRadius: 14,
    border: `1px solid ${
      danger
        ? "rgba(244,63,94,0.45)"
        : primary
        ? "rgba(255,255,255,0.20)"
        : C.border
    }`,
    background: danger
      ? "rgba(244,63,94,0.18)"
      : primary
      ? "rgba(255,255,255,0.14)"
      : "rgba(255,255,255,0.08)",
    color: C.text,
    cursor: "pointer",
    fontWeight: 950,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    transition: "transform 0.12s ease, background 0.12s ease",
  };
}

/* ---------------- page ---------------- */

export default function AdminResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const page = useMemo(() => Number(sp.get("page") ?? 1) || 1, [sp]);
  const pageSize = 50;

  const apiUrl = useMemo(
    () => `/api/admin/results?page=${page}&pageSize=${pageSize}`,
    [page]
  );

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResp | null>(null);
  const [tick, setTick] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const ok = (data as any)?.ok === true;
  const modeText =
    ok && (data as any)?.mode ? String((data as any).mode) : "";
  const teamText =
    ok && (data as any)?.filters?.team
      ? String((data as any).filters.team)
      : "";
  const ownerText =
    ok && (data as any)?.filters?.owner_admin
      ? String((data as any).filters.owner_admin)
      : "";

  const items: ApiItem[] = ok ? (data as any).items ?? [] : [];
  const rows = items.map(normalize);

  async function onDeleteAttempt(r: Row) {
    if (deletingId) return;

    const prettyId = r.idType === "uuid" ? r.id.slice(0, 8) + "..." : r.id;
    const yes = window.confirm(
      `정말 삭제할까요?\n\n- attemptId: ${prettyId}\n- 응시자: ${r.empId}\n\n삭제하면 복구가 어렵습니다.`
    );
    if (!yes) return;

    setDeletingId(r.id);
    try {
      const res = await fetch("/api/admin/results/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ attemptId: r.id }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok !== true) {
        alert(
          `삭제 실패: ${json?.error || "DELETE_FAILED"}\n${JSON.stringify(
            json?.detail || json,
            null,
            2
          )}`
        );
        return;
      }

      setTick((x) => x + 1);
    } finally {
      setDeletingId(null);
    }
  }

  // ✅ 한 화면에 다 들어오게: 고정 minWidth 제거 + grid fr로 유동
  const gridCols =
    "0.9fr 1fr 1fr 1.3fr 1.3fr 0.7fr 1.6fr 0.7fr 0.7fr";

  const ellipsis: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 10, // ✅ 좌우 패딩 줄여서 더 넓게
        background:
          "radial-gradient(1100px 620px at  20%  8%, rgba(255,255,255,0.10), transparent 62%)," +
          "radial-gradient(900px 520px at  70% 16%, rgba(99,102,241,0.14), transparent 60%)," +
          "linear-gradient(135deg, #0b1220 0%, #05070c 70%)",
        color: C.text,
        fontFamily: "system-ui",
      }}
    >
      <div style={{ width: "100%", maxWidth: "none", margin: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "flex-end",
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 950,
                letterSpacing: "-0.3px",
              }}
            >
              응시현황
            </div>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Pill tone="gray">
                apiUrl:{" "}
                <span style={{ fontFamily: "monospace", opacity: 0.9 }}>
                  {apiUrl}
                </span>
              </Pill>
              {modeText ? <Pill tone="blue">mode: {modeText}</Pill> : null}
              {teamText ? <Pill tone="amber">team: {teamText}</Pill> : null}
              {ownerText ? <Pill tone="gray">owner: {ownerText}</Pill> : null}
              {ok ? <Pill tone="green">rows: {rows.length}</Pill> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                window.location.href = `/api/admin/results?page=1&pageSize=500&format=csv`;
              }}
              style={btnStyle(false, true)}
            >
              CSV 다운로드
            </button>

            <button onClick={() => setTick((x) => x + 1)} style={btnStyle()}>
              새로고침
            </button>
          </div>
        </div>

        {/* Content */}
        {loading && (
          <Glass style={{ padding: 16 }}>
            <div style={{ fontWeight: 900, color: C.dim }}>로딩중...</div>
          </Glass>
        )}

        {!loading && (!data || (data as any).ok !== true) && (
          <Glass
            style={{
              padding: 16,
              borderColor: "rgba(244,63,94,0.35)",
              background: "rgba(244,63,94,0.10)",
            }}
          >
            <div style={{ fontWeight: 950, marginBottom: 8 }}>에러</div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: C.text }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </Glass>
        )}

        {!loading && ok && (
          <>
            {/* Table */}
            <Glass style={{ overflow: "hidden" }}>
              {/* ✅ 가로 스크롤 제거: 화면폭에 맞춰 유동 */}
              <div style={{ overflowX: "hidden", overflowY: "hidden" }}>
                <div style={{ width: "100%" }}>
                  {/* Sticky header */}
                  <div
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      fontWeight: 950,
                      letterSpacing: "0.2px",
                      background: "rgba(255,255,255,0.10)",
                      padding: 12,
                      borderBottom: `1px solid ${C.border2}`,
                      columnGap: 10,
                    }}
                  >
                    <div style={ellipsis}>attemptId</div>
                    <div style={ellipsis}>응시자ID</div>
                    <div style={ellipsis}>점수</div>
                    <div style={ellipsis}>시작</div>
                    <div style={ellipsis}>제출</div>
                    <div style={ellipsis}>문항수</div>
                    <div style={ellipsis}>상태</div>
                    <div style={{ whiteSpace: "nowrap" }}>상세</div>
                    <div style={{ whiteSpace: "nowrap" }}>삭제</div>
                  </div>

                  {rows.map((r, idx) => {
                    const statusUp = String(r.status ?? "").toUpperCase();
                    const statusTone =
                      statusUp === "SUBMITTED"
                        ? "blue"
                        : statusUp
                        ? "gray"
                        : "gray";
                    const shortId =
                      r.idType === "uuid" ? r.id.slice(0, 8) + "..." : r.id;

                    return (
                      <div
                        key={`${r.idType}:${r.id}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: gridCols,
                          padding: 12,
                          borderTop: `1px solid ${
                            idx === 0
                              ? "transparent"
                              : "rgba(255,255,255,0.08)"
                          }`,
                          alignItems: "center",
                          background:
                            idx % 2 === 0
                              ? "rgba(255,255,255,0.02)"
                              : "transparent",
                          transition: "background 0.12s ease",
                          columnGap: 10,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as any).style.background =
                            "rgba(255,255,255,0.06)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as any).style.background =
                            idx % 2 === 0
                              ? "rgba(255,255,255,0.02)"
                              : "transparent";
                        }}
                      >
                        <div
                          style={{
                            ...ellipsis,
                            fontFamily: "monospace",
                            fontSize: 12,
                            color: C.dim,
                          }}
                          title={r.id}
                        >
                          {shortId}
                        </div>

                        <div style={{ ...ellipsis, fontWeight: 950 }}>
                          {r.empId}
                        </div>

                        <div style={{ ...ellipsis, color: C.text }}>
                          <span style={{ fontWeight: 950 }}>{r.score}</span>
                          <span style={{ color: C.dim }}> / {r.totalPoints}</span>
                          {r.wrongCount ? (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 12,
                                color: C.mute,
                                fontWeight: 900,
                              }}
                            >
                              (오답 {r.wrongCount})
                            </span>
                          ) : null}
                        </div>

                        <div style={{ ...ellipsis, color: C.dim }}>
                          {fmt(r.startedAt)}
                        </div>
                        <div style={{ ...ellipsis, color: C.dim }}>
                          {fmt(r.submittedAt)}
                        </div>

                        <div style={{ ...ellipsis, fontWeight: 950 }}>
                          {r.totalQuestions || "-"}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            ...ellipsis,
                          }}
                        >
                          <Pill tone={statusTone as any}>
                            {r.status ?? "-"}
                          </Pill>
                          {r.team ? <Pill tone="amber">팀 {r.team}</Pill> : null}
                          {r.ownerAdmin ? (
                            <Pill tone="gray">{r.ownerAdmin}</Pill>
                          ) : null}
                        </div>

                        <div style={{ whiteSpace: "nowrap" }}>
                          <button
                            onClick={() =>
                              router.push(
                                `/admin/results/${encodeURIComponent(r.id)}`
                              )
                            }
                            style={btnStyle(true, true)}
                          >
                            보기
                          </button>
                        </div>

                        <div style={{ whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => onDeleteAttempt(r)}
                            style={btnStyle(true, false, true)}
                            disabled={deletingId === r.id}
                            title="해당 응시 이력/답안 기록을 삭제합니다"
                          >
                            {deletingId === r.id ? "삭제중..." : "삭제"}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {rows.length === 0 ? (
                    <div style={{ padding: 16, color: C.dim, fontWeight: 900 }}>
                      데이터가 없습니다.
                    </div>
                  ) : null}
                </div>
              </div>
            </Glass>

            {/* Paging */}
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() =>
                  router.push(`/admin/results?page=${Math.max(1, page - 1)}`)
                }
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

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Pill tone="gray">page: {page}</Pill>
                <Pill tone="gray">pageSize: {pageSize}</Pill>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
