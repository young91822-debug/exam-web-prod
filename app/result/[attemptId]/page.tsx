// app/exam/result/[attemptId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Graded = {
  questionId: any;
  content: string;
  choices: string[];
  correctIndex: number | null;
  selectedIndex: number | null;
  isCorrect: boolean;
  points: number;
};

type ApiOk = {
  ok: true;
  attempt: {
    id: any;
    emp_id?: string | null;
    started_at?: any;
    submitted_at?: any;
    status?: string | null;
    score: number;
    total_points: number;
    total_questions: number;
  };
  graded: Graded[];
  totalQuestions?: number;
  wrongCount?: number;
  totalPoints?: number;
};

type ApiFail = { ok: false; error: string; detail?: any };
type ApiResp = ApiOk | ApiFail | any;

function s(v: any) {
  return String(v ?? "").trim();
}

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ko-KR");
}

function pct(score: number, total: number) {
  if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((score / total) * 100);
}

function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export default function ExamResultPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = s((params as any)?.attemptId);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<ApiResp | null>(null);

  // UI state
  const [tab, setTab] = useState<"all" | "wrong">("wrong");
  const [openAll, setOpenAll] = useState(false);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        const res = await fetch(`/api/result/${attemptId}`, { cache: "no-store" });
        const txt = await res.text();
        const json = txt ? JSON.parse(txt) : null;

        if (dead) return;

        if (!res.ok || !json?.ok) {
          setErr(json?.error || `HTTP_${res.status}`);
          setData(json);
        } else {
          setData(json);
        }
      } catch (e: any) {
        if (!dead) setErr(String(e?.message ?? e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();

    return () => {
      dead = true;
    };
  }, [attemptId]);

  const ok = (data as any)?.ok === true;
  const attempt = ok ? (data as ApiOk).attempt : {};
  const graded: Graded[] = ok && Array.isArray((data as ApiOk).graded) ? (data as ApiOk).graded : [];

  const score = Number((attempt as any)?.score ?? 0);
  const totalPoints = Number(
    (data as any)?.totalPoints ??
      (attempt as any)?.total_points ??
      graded.reduce((acc, g) => acc + Number(g?.points ?? 0), 0)
  );

  const totalQuestions = Number((attempt as any)?.total_questions ?? graded.length ?? 0);
  const wrongCount = Number((data as any)?.wrongCount ?? graded.filter((g) => g?.isCorrect === false).length ?? 0);
  const correctCount = Math.max(0, totalQuestions - wrongCount);
  const percent = useMemo(() => pct(score, totalPoints), [score, totalPoints]);

  const wrongOnly = useMemo(() => graded.filter((g) => g?.isCorrect === false), [graded]);
  const list = tab === "wrong" ? wrongOnly : graded;

  useEffect(() => {
    // 기본: 오답 탭이면 오답 항목은 펼쳐두는 게 편함
    if (tab === "wrong" && wrongOnly.length > 0) {
      const next: Record<string, boolean> = {};
      for (const g of wrongOnly.slice(0, 3)) {
        next[String(g.questionId)] = true; // 처음 3개 정도만 자동 오픈
      }
      setOpenMap((prev) => ({ ...next, ...prev }));
    }
  }, [tab, wrongOnly.length]);

  function toggleOne(key: string) {
    setOpenMap((m) => ({ ...m, [key]: !m[key] }));
  }

  if (loading) return <div className="p-6">불러오는 중…</div>;

  if (err) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <div className="text-red-600 font-semibold">결과를 불러오지 못했습니다.</div>
        <div className="text-sm text-gray-600">에러: {err}</div>
        <button className="px-3 py-2 rounded border" onClick={() => router.refresh()}>
          새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">시험 결과</h1>
          <div className="text-sm text-gray-500">제출이 완료되었습니다.</div>
        </div>
        <div className="flex gap-2">
          <a className="px-3 py-2 rounded-lg border text-sm bg-white hover:bg-gray-50" href="/exam">
            다시 시험 보기
          </a>
        </div>
      </div>

      {/* Summary */}
      <div className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">요약</div>
          <div className="text-sm text-gray-500">{percent}%</div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">점수</div>
            <div className="text-lg font-bold">
              {score} <span className="text-gray-400 font-medium">/ {totalPoints}</span>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">정답</div>
            <div className="text-lg font-bold">
              {correctCount} <span className="text-gray-400 font-medium">/ {totalQuestions}</span>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">오답</div>
            <div className="text-lg font-bold">{wrongCount}</div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">상태</div>
            <div className="text-lg font-bold">{s((attempt as any)?.status) || "SUBMITTED"}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">응시 시작</div>
            <div className="font-medium">{fmt((attempt as any)?.started_at)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">제출 시각</div>
            <div className="font-medium">{fmt((attempt as any)?.submitted_at)}</div>
          </div>
        </div>
      </div>

      {/* Tabs + controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border bg-white p-1">
          <button
            className={cls(
              "px-3 py-2 text-sm rounded-lg",
              tab === "wrong" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-50"
            )}
            onClick={() => setTab("wrong")}
          >
            오답만 ({wrongOnly.length})
          </button>
          <button
            className={cls(
              "px-3 py-2 text-sm rounded-lg",
              tab === "all" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-50"
            )}
            onClick={() => setTab("all")}
          >
            전체 ({graded.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-lg border text-sm bg-white hover:bg-gray-50"
            onClick={() => {
              // 전체 펼치기/접기
              const next = !openAll;
              setOpenAll(next);
              const m: Record<string, boolean> = {};
              for (const g of list) m[String(g.questionId)] = next;
              setOpenMap((prev) => ({ ...prev, ...m }));
            }}
          >
            {openAll ? "모두 접기" : "모두 펼치기"}
          </button>
          <button className="px-3 py-2 rounded-lg border text-sm bg-white hover:bg-gray-50" onClick={() => window.print()}>
            인쇄
          </button>
        </div>
      </div>

      {/* Questions */}
      {list.length === 0 ? (
        <div className="text-sm text-gray-600">
          {tab === "wrong" ? "오답이 없습니다. 잘했어요!" : "표시할 문항이 없습니다."}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((g, idx) => {
            const key = String(g.questionId ?? idx);
            const opened = !!openMap[key];
            const selected = g.selectedIndex;
            const correct = g.correctIndex;

            const isCorrect = !!g.isCorrect;

            return (
              <div key={key} className="border rounded-2xl bg-white shadow-sm overflow-hidden">
                <button
                  className="w-full text-left px-4 py-4 hover:bg-gray-50 flex items-start justify-between gap-3"
                  onClick={() => toggleOne(key)}
                >
                  <div className="min-w-0">
                    <div className="text-sm text-gray-500">Q{tab === "all" ? graded.findIndex((x) => String(x.questionId) === key) + 1 : idx + 1}</div>
                    <div className="font-semibold leading-snug break-words">{g.content}</div>
                  </div>
                  <div
                    className={cls(
                      "shrink-0 px-3 py-1 rounded-full text-xs font-bold border",
                      isCorrect
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    )}
                  >
                    {isCorrect ? "정답" : "오답"}
                  </div>
                </button>

                {opened && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* 내 선택 / 정답 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border p-3">
                        <div className="text-xs text-gray-500">내 선택</div>
                        <div className="font-semibold">
                          {selected === null || selected === undefined ? "-" : `${selected + 1}번`}
                        </div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-xs text-gray-500">정답</div>
                        <div className="font-semibold">
                          {correct === null || correct === undefined ? "-" : `${correct + 1}번`}
                        </div>
                      </div>
                    </div>

                    {/* 보기 리스트 */}
                    <div className="space-y-2">
                      {(g.choices ?? []).map((c, i) => {
                        const mine = selected === i;
                        const ans = correct === i;

                        return (
                          <div
                            key={i}
                            className={cls(
                              "rounded-xl border px-3 py-2 text-sm flex items-start gap-2",
                              ans ? "border-green-300 bg-green-50" : "border-gray-200",
                              mine && !ans ? "border-blue-300 bg-blue-50" : "",
                              mine && ans ? "border-green-400 bg-green-50" : ""
                            )}
                          >
                            <div className="shrink-0 w-6 text-gray-500 font-semibold">{i + 1}.</div>
                            <div className="min-w-0 break-words">
                              <div>{c}</div>
                              <div className="mt-1 text-xs text-gray-500">
                                {ans ? "정답" : ""}
                                {mine ? (ans ? (ans ? " · 내 선택" : "내 선택") : " · 내 선택") : ""}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 점수(있으면) */}
                    <div className="text-xs text-gray-500">
                      배점: {Number.isFinite(Number(g.points)) ? g.points : 0}점
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-gray-400">attemptId: {attemptId}</div>
    </div>
  );
}
