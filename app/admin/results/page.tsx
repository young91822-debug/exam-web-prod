"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const font =
  'system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';

type AttemptRow = {
  attempt_id: number;
  emp_id: string;
  score: number;
  submitted_at: string | null;
};

type WrongQ = {
  questionId?: number | string;
  content?: string; // question_content
  choices?: string[];
  chosenIndex?: number; // chosen
  answerIndex?: number; // answer
};

function pill(active?: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #ddd",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 800,
  };
}

function fmtDateTime(s?: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  const escaped = s.replaceAll('"', '""');
  return `"${escaped}"`;
}

function safeStr(v: any) {
  return String(v ?? "").trim();
}

// 여러 형태의 결과 JSON에서 wrongQuestions를 뽑아오는 함수
function pickWrongQuestions(json: any): WrongQ[] {
  const list =
    json?.wrongQuestions ||
    json?.wrong_questions ||
    json?.wrongs ||
    json?.wrong ||
    json?.data?.wrongQuestions ||
    json?.data?.wrong_questions ||
    [];

  if (!Array.isArray(list)) return [];

  return list.map((w: any) => ({
    questionId: w.questionId ?? w.question_id ?? w.id ?? undefined,
    content: w.content ?? w.question ?? w.question_content ?? undefined,
    choices: w.choices ?? w.options ?? undefined,
    chosenIndex:
      w.chosenIndex ??
      w.chosen_index ??
      w.selectedIndex ??
      w.selected_index ??
      undefined,
    answerIndex:
      w.answerIndex ?? w.answer_index ?? w.correctIndex ?? w.correct_index ?? undefined,
  }));
}

export default function AdminResultsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AttemptRow[]>([]);

  const [selectedEmp, setSelectedEmp] = useState<string>("");
  const [searchEmp, setSearchEmp] = useState<string>("");
  const [showUnsubmitted, setShowUnsubmitted] = useState<boolean>(false);

  const [downloading, setDownloading] = useState(false);

  // ✅ 데이터 로드
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/results", { cache: "no-store" });
        const json = await res.json();

        const list: AttemptRow[] = Array.isArray(json?.data) ? json.data : [];

        // ✅ emp_id 빈값 제거 (너 데이터에 "" 엄청 많음)
        const cleaned = list.filter((r) => safeStr(r.emp_id) !== "");

        // ✅ 최신순 정렬: submitted_at 있는 것 우선 + 시간 내림차순
        cleaned.sort((a, b) => {
          const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : -1;
          const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : -1;
          return tb - ta;
        });

        if (!alive) return;
        setRows(cleaned);

        // ✅ 기본 선택 계정
        const firstEmp = cleaned[0]?.emp_id ?? "";
        setSelectedEmp(firstEmp);
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setRows([]);
        setSelectedEmp("");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ 계정 목록 (rows에서 unique)
  const empOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(String(r.emp_id));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // ✅ 검색 적용된 계정 목록
  const empOptionsFiltered = useMemo(() => {
    const q = searchEmp.trim().toLowerCase();
    if (!q) return empOptions;
    return empOptions.filter((e) => e.toLowerCase().includes(q));
  }, [empOptions, searchEmp]);

  // ✅ 선택 계정의 응시 기록만
  const attemptsOfEmp = useMemo(() => {
    const emp = safeStr(selectedEmp);
    if (!emp) return [];
    return rows
      .filter((r) => r.emp_id === emp)
      .filter((r) => (showUnsubmitted ? true : r.submitted_at !== null));
  }, [rows, selectedEmp, showUnsubmitted]);

  // ✅ (핵심) 오답 CSV 다운로드: attempt 상세 API(/api/result/{attemptId})를 호출해서 wrongQuestions 모음
  async function downloadWrongCSV() {
    if (!selectedEmp) return;
    if (attemptsOfEmp.length === 0) return;

    setDownloading(true);
    try {
      // 제출된 attempt만 대상으로
      const submittedAttempts = attemptsOfEmp.filter((a) => a.submitted_at !== null);

      if (submittedAttempts.length === 0) {
        alert("제출된 응시 기록이 없습니다.");
        return;
      }

      // 병렬 호출 chunk
      const chunkSize = 6;
      const details: Array<{ attempt: AttemptRow; wrongs: WrongQ[] }> = [];

      for (let i = 0; i < submittedAttempts.length; i += chunkSize) {
        const chunk = submittedAttempts.slice(i, i + chunkSize);

        const chunkResults = await Promise.all(
          chunk.map(async (attempt) => {
            const aid = attempt.attempt_id;

            // ✅ 상세 결과 API 호출
            const r = await fetch(`/api/result/${aid}`, { cache: "no-store" });
            const t = await r.text();

            let json: any = null;
            try {
              json = JSON.parse(t);
            } catch {
              json = null;
            }

            const wrongs = pickWrongQuestions(json);
            return { attempt, wrongs };
          })
        );

        details.push(...chunkResults);
      }

      // ✅ CSV 컬럼: emp_id / submitted_at / question_content / chosen / answer
      const header = ["emp_id", "submitted_at", "question_content", "chosen", "answer"];
      const lines: string[] = [header.join(",")];

      for (const d of details) {
        const a = d.attempt;
        const emp = a.emp_id;
        const submitted = fmtDateTime(a.submitted_at);

        if (!d.wrongs || d.wrongs.length === 0) {
          // 오답 없으면 한 줄만
          lines.push(
            [
              csvEscape(emp),
              csvEscape(submitted),
              csvEscape("오답없음"),
              csvEscape(""),
              csvEscape(""),
            ].join(",")
          );
          continue;
        }

        for (const w of d.wrongs) {
          const content = w.content ?? "";
          const chosen = w.chosenIndex ?? "";
          const answer = w.answerIndex ?? "";

          lines.push(
            [
              csvEscape(emp),
              csvEscape(submitted),
              csvEscape(content),
              csvEscape(chosen),
              csvEscape(answer),
            ].join(",")
          );
        }
      }

      const blob = new Blob(["\uFEFF" + lines.join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `오답_${selectedEmp}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("오답 CSV 다운로드 실패. 콘솔 로그를 확인해줘!");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{ fontFamily: font }}>
      {/* ✅ 상단바 */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "1px solid #eee",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>관리자</div>
          <Link href="/admin/accounts" style={pill(false)}>
            계정관리
          </Link>
          <Link href="/admin/questions" style={pill(false)}>
            문제등록
          </Link>
          <Link href="/admin/results" style={pill(true)}>
            응시현황
          </Link>
        </div>

        <Link href="/exam" style={pill(false)}>
          응시페이지로
        </Link>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>
            📊 응시현황
          </h1>
          <span style={{ fontSize: 12, color: "#666" }}>
            계정을 선택하면 해당 계정의 응시 기록만 보이고, 오답 CSV를 다운로드할 수 있어요.
          </span>
        </div>

        {/* ✅ 계정 선택 카드 */}
        <div
          style={{
            marginTop: 14,
            border: "1px solid #eee",
            borderRadius: 14,
            background: "#fff",
            boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 900 }}>계정 선택</div>

            <input
              value={searchEmp}
              onChange={(e) => setSearchEmp(e.target.value)}
              placeholder="계정 검색 (emp_id)"
              style={{
                width: 220,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                outline: "none",
                fontSize: 13,
              }}
            />

            <select
              value={selectedEmp}
              onChange={(e) => setSelectedEmp(e.target.value)}
              style={{
                minWidth: 260,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {loading ? (
                <option value="">불러오는 중…</option>
              ) : empOptionsFiltered.length ? (
                empOptionsFiltered.map((emp) => (
                  <option key={emp} value={emp}>
                    {emp}
                  </option>
                ))
              ) : (
                <option value="">계정이 없습니다</option>
              )}
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={showUnsubmitted}
                onChange={(e) => setShowUnsubmitted(e.target.checked)}
              />
              <span style={{ fontSize: 13, color: "#333", fontWeight: 700 }}>
                미제출 기록도 보기
              </span>
            </label>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <button
                onClick={downloadWrongCSV}
                disabled={
                  downloading ||
                  !selectedEmp ||
                  attemptsOfEmp.filter((a) => a.submitted_at !== null).length === 0
                }
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background:
                    downloading ||
                    !selectedEmp ||
                    attemptsOfEmp.filter((a) => a.submitted_at !== null).length === 0
                      ? "#f4f4f4"
                      : "#111",
                  color:
                    downloading ||
                    !selectedEmp ||
                    attemptsOfEmp.filter((a) => a.submitted_at !== null).length === 0
                      ? "#999"
                      : "#fff",
                  fontWeight: 900,
                  cursor:
                    downloading ||
                    !selectedEmp ||
                    attemptsOfEmp.filter((a) => a.submitted_at !== null).length === 0
                      ? "not-allowed"
                      : "pointer",
                  fontSize: 13,
                }}
              >
                {downloading ? "오답 CSV 생성중…" : "선택 계정 오답 CSV 다운로드"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
            {loading
              ? "로딩중…"
              : selectedEmp
              ? `선택 계정: ${selectedEmp} / 표시 ${attemptsOfEmp.length}건 (제출 ${
                  attemptsOfEmp.filter((a) => a.submitted_at !== null).length
                }건)`
              : "계정을 선택하세요"}
          </div>
        </div>

        {/* ✅ 응시 기록 테이블 */}
        <div
          style={{
            marginTop: 16,
            border: "1px solid #eee",
            borderRadius: 14,
            overflow: "hidden",
            background: "#fff",
            boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              background: "#fafafa",
              borderBottom: "1px solid #eee",
              fontWeight: 900,
            }}
          >
            응시 기록
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
              }}
            >
              <thead>
                <tr>
                  {["점수", "응시일시", "틀린문항", "상세"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === "점수" ? "right" : "left",
                        padding: "12px 14px",
                        fontSize: 12,
                        color: "#666",
                        background: "#fff",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 18, color: "#666" }}>
                      불러오는 중…
                    </td>
                  </tr>
                ) : !selectedEmp ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 18, color: "#666" }}>
                      상단에서 계정을 선택해 주세요.
                    </td>
                  </tr>
                ) : attemptsOfEmp.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 18, color: "#666" }}>
                      표시할 응시 기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  attemptsOfEmp.map((a, idx) => {
                    const aid = String(a.attempt_id);
                    const submitted = a.submitted_at !== null;

                    return (
                      <tr
                        key={aid}
                        style={{ background: idx % 2 ? "#fff" : "#fcfcfc" }}
                      >
                        <td
                          style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid #f0f0f0",
                            textAlign: "right",
                            fontWeight: 900,
                          }}
                        >
                          {a.score ?? 0}
                        </td>

                        <td
                          style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid #f0f0f0",
                            color: submitted ? "#111" : "#999",
                          }}
                        >
                          {submitted ? fmtDateTime(a.submitted_at) : "미제출(진행중/중단)"}
                        </td>

                        <td
                          style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid #f0f0f0",
                            color: "#666",
                            fontSize: 13,
                          }}
                        >
                          오답 CSV / 상세에서 확인
                        </td>

                        <td
                          style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid #f0f0f0",
                          }}
                        >
                          <Link
                            href={`/admin/results/${aid}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #ddd",
                              background: "#fff",
                              color: "#111",
                              fontWeight: 900,
                              textDecoration: "none",
                              fontSize: 13,
                            }}
                          >
                            보기
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div
            style={{
              padding: "12px 14px",
              background: "#fafafa",
              borderTop: "1px solid #eee",
              fontSize: 12,
              color: "#666",
            }}
          >
            * 다운로드 파일 컬럼은 <b>emp_id / submitted_at / question_content / chosen / answer</b>만 포함합니다.
          </div>
        </div>
      </main>
    </div>
  );
}
