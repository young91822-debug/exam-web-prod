"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

/* ---------------- types ---------------- */

type GradedItem = {
  questionId: string | null;
  content: string;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  status?: string | null;
  isCorrect?: boolean | null;
};

type WrongItem = {
  questionId: string | null;
  content: string;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  points: number;
  isWrong: boolean;
};

type DetailResp =
  | {
      ok: true;
      attempt: any;
      wrongItems?: WrongItem[];
      graded?: GradedItem[];
      meta?: any;
    }
  | { ok: false; error: string; detail?: any };

/* ---------------- utils ---------------- */

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("ko-KR", { hour12: true });
}
function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

/* ---------------- UI atoms (glass dark) ---------------- */

const COLORS = {
  bg1: "#0b1220",
  bg2: "#05070c",
  panel: "rgba(255,255,255,0.08)",
  panel2: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.12)",
  border2: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.92)",
  textDim: "rgba(255,255,255,0.70)",
  textMute: "rgba(255,255,255,0.55)",
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
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Badge({
  tone = "gray",
  children,
}: {
  tone?: "gray" | "green" | "red" | "blue" | "amber";
  children: React.ReactNode;
}) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: `1px solid ${COLORS.border2}`,
    background: COLORS.panel2,
    color: COLORS.text,
    whiteSpace: "nowrap",
  };

  const toneStyle =
    tone === "green"
      ? { borderColor: "rgba(52,211,153,0.35)", background: "rgba(16,185,129,0.12)" }
      : tone === "red"
      ? { borderColor: "rgba(244,63,94,0.35)", background: "rgba(244,63,94,0.12)" }
      : tone === "blue"
      ? { borderColor: "rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.12)" }
      : tone === "amber"
      ? { borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.12)" }
      : {};

  return <span style={{ ...base, ...toneStyle }}>{children}</span>;
}

function Button({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        background: "rgba(255,255,255,0.08)",
        color: COLORS.text,
        fontWeight: 950,
        cursor: "pointer",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Glass style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: COLORS.textMute, fontWeight: 900 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 950, color: COLORS.text }}>
        {value}
      </div>
      {sub ? <div style={{ marginTop: 10 }}>{sub}</div> : null}
    </Glass>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = clamp(value, 0, 100);
  return (
    <div
      style={{
        width: "100%",
        height: 10,
        borderRadius: 999,
        background: "rgba(255,255,255,0.10)",
        border: `1px solid ${COLORS.border2}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${v}%`,
          height: "100%",
          background: "rgba(255,255,255,0.75)",
        }}
      />
    </div>
  );
}

/* ---------------- page ---------------- */

export default function AdminResultDetailPage() {
  const router = useRouter();
  const params = useParams() as any;
  const attemptId = useMemo(() => String(params?.attemptId ?? ""), [params]);

  const apiUrl = useMemo(
    () => `/api/admin/result-detail?attemptId=${encodeURIComponent(attemptId)}`,
    [attemptId]
  );

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailResp | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      const res = await fetch(apiUrl, { cache: "no-store" });
      const json: DetailResp = await res.json().catch(() => ({} as any));
      if (!alive) return;
      setData(json);
      setLoading(false);
    }
    run();
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  if (loading) {
    return (
      <div style={{ padding: 24, color: COLORS.text, fontFamily: "system-ui" }}>
        로딩중...
      </div>
    );
  }

  if (!data || (data as any).ok !== true) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", color: COLORS.text }}>
        <div style={{ fontSize: 18, fontWeight: 950, marginBottom: 12 }}>에러</div>
        <pre
          style={{
            background: "#0b1220",
            color: "white",
            padding: 14,
            borderRadius: 14,
            overflow: "auto",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
        <div style={{ marginTop: 14 }}>
          <Button onClick={() => router.push("/admin/results")}>← 목록으로</Button>
        </div>
      </div>
    );
  }

  const ok = data as Extract<DetailResp, { ok: true }>;
  const a = ok.attempt ?? {};

  const attempt = {
    id: a.id ?? a.attemptId ?? a.attempt_id ?? "-",
    emp_id: a.emp_id ?? a.empId ?? null,
    team: a.team ?? null,
    status: a.status ?? null,
    started_at: a.started_at ?? a.startedAt ?? null,
    submitted_at: a.submitted_at ?? a.submittedAt ?? null,

    score: n(a.score, 0),
    total_points: n(a.total_points ?? a.totalPoints, 100),
    total_questions: n(a.total_questions ?? a.totalQuestions, 0),
    wrong_count: n(a.wrong_count ?? a.wrongCount, 0),
    correct_count: n(a.correct_count ?? a.correctCount, 0),
  };

  const wrongFromApi: WrongItem[] = Array.isArray(ok.wrongItems) ? ok.wrongItems : [];
  const graded: GradedItem[] = Array.isArray((ok as any).graded) ? (ok as any).graded : [];

  const wrongFromGraded: WrongItem[] = graded
    .filter((g) => {
      if (g.selectedIndex === null || g.selectedIndex === undefined) return false;
      if (g.correctIndex === null || g.correctIndex === undefined) return false;
      return Number(g.selectedIndex) !== Number(g.correctIndex);
    })
    .map((g) => ({
      questionId: g.questionId ?? null,
      content: g.content ?? "",
      choices: Array.isArray(g.choices) ? g.choices : [],
      selectedIndex: g.selectedIndex ?? null,
      correctIndex: g.correctIndex ?? null,
      points: 0,
      isWrong: true,
    }));

  const wrong: WrongItem[] = wrongFromApi.length ? wrongFromApi : wrongFromGraded;
  const wrongCount = wrong.length;

  const allItems: Array<{
    key: string;
    content: string;
    choices: string[];
    selectedIndex: number | null;
    correctIndex: number | null;
    isWrong: boolean;
  }> = graded.length
    ? graded.map((g, idx) => {
        const sel = g.selectedIndex ?? null;
        const cor = g.correctIndex ?? null;
        const isWrong = sel !== null && cor !== null ? Number(sel) !== Number(cor) : false;
        return {
          key: `${g.questionId ?? "q"}-${idx}`,
          content: g.content ?? "",
          choices: Array.isArray(g.choices) ? g.choices : [],
          selectedIndex: sel,
          correctIndex: cor,
          isWrong,
        };
      })
    : wrong.map((w, idx) => ({
        key: `${w.questionId ?? "q"}-${idx}`,
        content: w.content ?? "",
        choices: Array.isArray(w.choices) ? w.choices : [],
        selectedIndex: w.selectedIndex ?? null,
        correctIndex: w.correctIndex ?? null,
        isWrong: true,
      }));

  const viewItems = onlyWrong ? allItems.filter((x) => x.isWrong) : allItems;

  const totalPts = attempt.total_points || 100;
  const scorePct = totalPts > 0 ? Math.round((attempt.score / totalPts) * 100) : 0;

  const totalQ = attempt.total_questions || graded.length || 0;
  const correctQ = attempt.correct_count || (totalQ ? totalQ - wrongCount : 0);
  const accPct = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

  const statusTone =
    String(attempt.status || "").toUpperCase() === "SUBMITTED" ? "blue" : "gray";

  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "system-ui",
        color: COLORS.text,
        background:
          "radial-gradient(1200px 600px at 20% 10%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(900px 500px at 70% 20%, rgba(99,102,241,0.18), transparent 60%), linear-gradient(135deg, #0b1220 0%, #05070c 70%)",
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: "-0.3px" }}>
              결과 상세
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="gray">attemptId: {attempt.id}</Badge>
              <Badge tone="gray">응시자: {attempt.emp_id ?? "-"}</Badge>
              <Badge tone="gray">팀: {attempt.team ?? "-"}</Badge>
              <Badge tone={statusTone as any}>상태: {attempt.status ?? "-"}</Badge>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Glass
              style={{
                padding: "10px 12px",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <input
                type="checkbox"
                checked={onlyWrong}
                onChange={(e) => setOnlyWrong(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <div style={{ fontWeight: 950, color: COLORS.text }}>
                틀린 문제만 보기
              </div>
            </Glass>

            <Button onClick={() => router.push("/admin/results")}>← 목록</Button>
          </div>
        </div>

        {/* Summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <StatCard
            label="점수"
            value={
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span>
                  {attempt.score} / {totalPts}
                </span>
                <span style={{ fontSize: 14, color: COLORS.textDim, fontWeight: 900 }}>
                  ({scorePct}점)
                </span>
              </div>
            }
            sub={<ProgressBar value={scorePct} />}
          />
          <StatCard
            label="정답률"
            value={`${accPct}%`}
            sub={
              <div style={{ display: "flex", justifyContent: "space-between", color: COLORS.textDim, fontWeight: 900, fontSize: 12 }}>
                <span>정답 {correctQ} / {totalQ}</span>
                <span>오답 {wrongCount}</span>
              </div>
            }
          />
          <StatCard label="시작" value={fmt(attempt.started_at)} />
          <StatCard label="제출" value={fmt(attempt.submitted_at)} />
        </div>

        {/* Questions */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 950 }}>
              {onlyWrong ? "틀린 문제" : "문항 전체"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textMute, fontWeight: 900 }}>
              표시: {viewItems.length}개
            </div>
          </div>

          {viewItems.length === 0 ? (
            <Glass style={{ padding: 16, background: "rgba(255,255,255,0.06)" }}>
              <div style={{ fontWeight: 900, color: COLORS.textDim }}>
                오답이 없거나(만점), 답안/정답 비교 데이터(graded)가 비어있어요.
              </div>
            </Glass>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {viewItems.map((item, idx) => {
                const choices = item.choices || [];
                const sel = item.selectedIndex;
                const cor = item.correctIndex;

                return (
                  <Glass key={item.key} style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 950, fontSize: 15 }}>
                        Q{idx + 1}. {item.content}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {item.isWrong ? <Badge tone="red">오답</Badge> : <Badge tone="green">정답</Badge>}
                      </div>
                    </div>

                    {choices.length ? (
                      <div
                        style={{
                          marginTop: 12,
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        {choices.map((c, i) => {
                          const isCorrect = cor === i;
                          const isSelected = sel === i;

                          const bg = isCorrect
                            ? "rgba(16,185,129,0.12)"
                            : isSelected
                            ? "rgba(245,158,11,0.12)"
                            : "rgba(255,255,255,0.05)";

                          const border = isCorrect
                            ? "rgba(52,211,153,0.35)"
                            : isSelected
                            ? "rgba(245,158,11,0.35)"
                            : "rgba(255,255,255,0.10)";

                          return (
                            <div
                              key={i}
                              style={{
                                position: "relative",
                                padding: 12,
                                borderRadius: 14,
                                border: `1px solid ${border}`,
                                background: bg,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ fontWeight: 900, color: COLORS.text }}>
                                  <span style={{ opacity: 0.65, marginRight: 8 }}>{i + 1}.</span>
                                  {c}
                                </div>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  {isSelected ? (
                                    <Badge tone={isCorrect ? "green" : "amber"}>내 선택</Badge>
                                  ) : null}
                                  {isCorrect ? <Badge tone="green">정답</Badge> : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ marginTop: 12, color: COLORS.textDim, fontWeight: 800 }}>
                        보기 데이터가 없는 유형(주관식 등)일 수 있어요.
                      </div>
                    )}

                    <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMute, fontWeight: 900 }}>
                      선택: {sel == null ? "-" : sel + 1} / 정답: {cor == null ? "-" : cor + 1}
                    </div>
                  </Glass>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
