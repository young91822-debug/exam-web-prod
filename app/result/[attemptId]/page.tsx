"use client";

export const dynamic = "force-dynamic";

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

export default function ResultPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = s((params as any)?.attemptId);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<ApiResp | null>(null);

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
    if (tab === "wrong" && wrongOnly.length > 0) {
      const next: Record<string, boolean> = {};
      for (const g of wrongOnly.slice(0, 3)) next[String(g.questionId)] = true;
      setOpenMap((prev) => ({ ...next, ...prev }));
    }
  }, [tab, wrongOnly.length]);

  function toggleOne(key: string) {
    setOpenMap((m) => ({ ...m, [key]: !m[key] }));
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        <div className="max-w-5xl mx-auto p-6">불러오는 중…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        <div className="max-w-3xl mx-auto p-6 space-y-3">
          <div className="font-semibold text-red-300">결과를 불러오지 못했습니다.</div>
          <div className="text-sm text-slate-300">에러: {err}</div>
          <button
            className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900"
            onClick={() => router.refresh()}
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">결과 상세</h1>
            <div className="text-sm text-slate-300 mt-1">제출이 완료되었습니다.</div>
          </div>
          <div className="flex gap-2">
            <a className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900 text-sm" href="/exam">
              다시 시험 보기
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-700 text-xs">attemptId: {attemptId}</span>
          {s((attempt as any)?.emp_id) ? (
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-700 text-xs">
              응시자: {s((attempt as any)?.emp_id)}
            </span>
          ) : null}
          <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-700 text-xs">
            상태: {s((attempt as any)?.status) || "SUBMITTED"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-300">점수</div>
            <div className="text-3xl font-extrabold mt-1">
              {score} <span className="text-slate-400 text-base font-semibold">/ {totalPoints}</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-slate-200/70" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-300">정답률</div>
            <div className="text-3xl font-extrabold mt-1">{percent}%</div>
            <div className="text-sm text-slate-300 mt-2">
              정답 {correctCount} / {totalQuestions} · 오답 {wrongCount}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-300">시작</div>
            <div className="text-lg font-semibold mt-2">{fmt((attempt as any)?.started_at)}</div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-sm text-slate-300">제출</div>
            <div className="text-lg font-semibold mt-2">{fmt((attempt as any)?.submitted_at)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60">
            <input type="checkbox" checked={tab === "wrong"} onChange={(e) => setTab(e.target.checked ? "wrong" : "all")} />
            <span className="text-sm font-semibold">틀린 문제만 보기</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900 text-sm"
              onClick={() => {
                const next = !openAll;
                setOpenAll(next);
                const m: Record<string, boolean> = {};
                for (const g of list) m[String(g.questionId)] = next;
                setOpenMap((prev) => ({ ...prev, ...m }));
              }}
            >
              {openAll ? "모두 접기" : "모두 펼치기"}
            </button>
            <button className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-900 text-sm" onClick={() => window.print()}>
              인쇄
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="text-sm text-slate-300">{tab === "wrong" ? "오답이 없습니다. 잘했어요!" : "표시할 문항이 없습니다."}</div>
        ) : (
          <div className="space-y-4">
            {list.map((g, idx) => {
              const key = String(g.questionId ?? idx);
              const opened = !!openMap[key];
              const selected = g.selectedIndex;
              const correct = g.correctIndex;
              const isCorrect = !!g.isCorrect;

              return (
                <div key={key} className="rounded-2xl border border-slate-700 bg-slate-900/60 overflow-hidden">
                  <button className="w-full text-left px-4 py-4 hover:bg-slate-900 flex items-start justify-between gap-3" onClick={() => toggleOne(key)}>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">Q{idx + 1}</div>
                      <div className="font-semibold leading-snug break-words">{g.content}</div>
                      <div className="text-xs text-slate-400 mt-2">
                        선택: {selected === null || selected === undefined ? "-" : selected + 1} / 정답:{" "}
                        {correct === null || correct === undefined ? "-" : correct + 1}
                      </div>
                    </div>
                    <div
                      className={cls(
                        "shrink-0 px-3 py-1 rounded-full text-xs font-extrabold border",
                        isCorrect ? "bg-emerald-900/40 text-emerald-200 border-emerald-700/60" : "bg-rose-900/40 text-rose-200 border-rose-700/60"
                      )}
                    >
                      {isCorrect ? "정답" : "오답"}
                    </div>
                  </button>

                  {opened && (
                    <div className="px-4 pb-4 space-y-2">
                      {(g.choices ?? []).map((c, i) => {
                        const mine = selected === i;
                        const ans = correct === i;

                        return (
                          <div
                            key={i}
                            className={cls(
                              "rounded-xl border px-3 py-2 text-sm flex items-start gap-2",
                              "border-slate-700 bg-slate-950/30",
                              ans ? "border-emerald-700/60 bg-emerald-900/20" : "",
                              mine && !ans ? "border-amber-700/60 bg-amber-900/20" : ""
                            )}
                          >
                            <div className="shrink-0 w-6 text-slate-400 font-semibold">{i + 1}.</div>
                            <div className="min-w-0 break-words">
                              <div>{c}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {ans ? "정답" : ""}
                                {mine ? " · 내 선택" : ""}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <div className="text-xs text-slate-400 mt-2">배점: {Number.isFinite(Number(g.points)) ? g.points : 0}점</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
