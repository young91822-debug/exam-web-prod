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
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid",
    whiteSpace: "nowrap",
  };

  const toneStyle =
    tone === "green"
      ? { background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }
      : tone === "red"
      ? { background: "#fff1f2", color: "#9f1239", borderColor: "#fecdd3" }
      : tone === "blue"
      ? { background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }
      : tone === "amber"
      ? { background: "#fffbeb", color: "#92400e", borderColor: "#fde68a" }
      : { background: "#f3f4f6", color: "#111827", borderColor: "#e5e7eb" };

  return <span style={{ ...base, ...toneStyle }}>{children}</span>;
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
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
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 900 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 950, letterSpacing: "-0.2px" }}>
        {value}
      </div>
      {sub ? (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
          {sub}
        </div>
      ) : null}
    </Card>
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
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${v}%`,
          height: "100%",
          background: "#111827",
          opacity: 0.85,
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

  // UI state
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
      <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto", fontFamily: "system-ui" }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>로딩중...</div>
      </div>
    );
  }

  if (!data || (data as any).ok !== true) {
    return (
      <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto", fontFamily: "system-ui" }}>
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
        <button
          onClick={() => router.push("/admin/results")}
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontWeight: 950,
            cursor: "pointer",
          }}
        >
          ← 목록으로
        </button>
      </div>
    );
  }

  const ok = data as Extract<DetailResp, { ok: true }>;
  const a = ok.attempt ?? {};

  // ✅ attempt snake/camel 둘 다 대응
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

  // ✅ wrongItems 우선
  const wrongFromApi: WrongItem[] = Array.isArray(ok.wrongItems) ? ok.wrongItems : [];
  const graded: GradedItem[] = Array.isArray((ok as any).graded) ? (ok as any).graded : [];

  // ✅ 틀린 문항(graded 기반)
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

  // ✅ 전체 문항(보여줄 소스)
  const allItems: Array<{
    key: string;
    content: string;
    choices: string[];
    selectedIndex: number | null;
    correctIndex: number | null;
    isWrong: boolean;
  }> = (() => {
    if (graded.length) {
      return graded.map((g, idx) => {
        const sel = g.selectedIndex ?? null;
        const cor = g.correctIndex ?? null;
        const isWrong =
          sel !== null && cor !== null ? Number(sel) !== Number(cor) : false;
        return {
          key: `${g.questionId ?? "q"}-${idx}`,
          content: g.content ?? "",
          choices: Array.isArray(g.choices) ? g.choices : [],
          selectedIndex: sel,
          correctIndex: cor,
          isWrong,
        };
      });
    }
    // graded가 없으면 wrong만이라도 보여줌
    return wrong.map((w, idx) => ({
      key: `${w.questionId ?? "q"}-${idx}`,
      content: w.content ?? "",
      choices: Array.isArray(w.choices) ? w.choices : [],
      selectedIndex: w.selectedIndex ?? null,
      correctIndex: w.correctIndex ?? null,
      isWrong: true,
    }));
  })();

  const viewItems = onlyWrong ? allItems.filter((x) => x.isWrong) : allItems;

  // 점수/퍼센트
  const totalPts = attempt.total_points || 100;
  const scorePct = totalPts > 0 ? Math.round((attempt.score / totalPts) * 100) : 0;

  const totalQ = attempt.total_questions || graded.length || 0;
  const correctQ = attempt.correct_count || (totalQ ? totalQ - wrongCount : 0);
  const accPct = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

  // 상태 배지 톤
  const statusTone =
    String(attempt.status || "").toUpperCase() === "SUBMITTED" ? "blue" : "gray";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f6f7fb",
        padding: 24,
        fontFamily: "system-ui",
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
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="gray">attemptId: {attempt.id}</Badge>
              <Badge tone="gray">응시자: {attempt.emp_id ?? "-"}</Badge>
              <Badge tone="gray">팀: {attempt.team ?? "-"}</Badge>
              <Badge tone={statusTone as any}>상태: {attempt.status ?? "-"}</Badge>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                background: "white",
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
                fontWeight: 900,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={onlyWrong}
                onChange={(e) => setOnlyWrong(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              틀린 문제만 보기
            </label>

            <button
              onClick={() => router.push("/admin/results")}
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "white",
                fontWeight: 950,
                cursor: "pointer",
              }}
            >
              ← 목록
            </button>
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
                <span style={{ fontSize: 14, opacity: 0.7, fontWeight: 900 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between" }}>
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
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>
              표시: {viewItems.length}개
            </div>
          </div>

          {viewItems.length === 0 ? (
            <Card style={{ padding: 16, background: "#fafafa", borderStyle: "dashed" }}>
              <div style={{ fontWeight: 900, color: "#374151" }}>
                오답이 없거나(만점), 답안/정답 비교 데이터(graded)가 비어있어요.
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {viewItems.map((item, idx) => {
                const choices = item.choices || [];
                const sel = item.selectedIndex;
                const cor = item.correctIndex;

                return (
                  <Card key={item.key} style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 950, fontSize: 15, letterSpacing: "-0.2px" }}>
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
                            ? "#ecfdf5"
                            : isSelected
                            ? "#fff7ed"
                            : "#ffffff";

                          const border = isCorrect
                            ? "#a7f3d0"
                            : isSelected
                            ? "#fed7aa"
                            : "#e5e7eb";

                          return (
                            <div
                              key={i}
                              style={{
                                position: "relative",
                                padding: 12,
                                borderRadius: 14,
                                border: `1px solid ${border}`,
                                background: bg,
                                boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ fontWeight: 900 }}>
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
                      <div style={{ marginTop: 12, opacity: 0.75, fontWeight: 800 }}>
                        보기 데이터가 없는 유형(주관식 등)일 수 있어요.
                      </div>
                    )}

                    <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
                      선택: {sel == null ? "-" : sel + 1} / 정답: {cor == null ? "-" : cor + 1}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
