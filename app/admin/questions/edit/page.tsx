"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";

export default function QuestionEditPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get("id");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [content, setContent] = useState("");
  const [points, setPoints] = useState(1);
  const [isActive, setIsActive] = useState(true);

  // ✅ 보기 4개 + 정답(0~3)
  const [choices, setChoices] = useState<string[]>(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState<number>(0);

  const canSave = useMemo(() => {
    if (!content.trim()) return false;
    const filled = choices.filter((c) => c.trim()).length;
    return filled >= 2;
  }, [content, choices]);

  useEffect(() => {
    if (!id) return;

    (async () => {
      setErr("");
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/questions/detail?id=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          setErr(`DETAIL_FAILED: ${json?.detail || json?.error || res.status}`);
          return;
        }

        const item = json.item || {};
        setContent(String(item.content ?? ""));
        setPoints(Number(item.points ?? 1));
        setIsActive(item.is_active === false ? false : true);

        // ✅ DB 구조 대응:
        // 1) choice1~choice4 컬럼 (현재 너 DB 스샷에 있음)
        // 2) (혹시 남아있으면) choices 배열 컬럼도 fallback
        const byChoiceCols = [item.choice1, item.choice2, item.choice3, item.choice4].some(
          (v) => v != null
        );

        if (byChoiceCols) {
          const a = [0, 1, 2, 3].map((i) => String(item[`choice${i + 1}`] ?? ""));
          setChoices(a);
        } else if (Array.isArray(item.choices)) {
          const a = [0, 1, 2, 3].map((i) => String(item.choices?.[i] ?? ""));
          setChoices(a);
        } else {
          setChoices(["", "", "", ""]);
        }

        // ✅ 정답 컬럼: answer_index (DB 스샷 기준)
        const ai = Number(item.answer_index);
        setCorrectIndex(Number.isFinite(ai) ? ai : 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function setChoice(i: number, v: string) {
    setChoices((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  async function onSave() {
    if (!id) return;

    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/questions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id,
          content,
          points,
          is_active: isActive,
          // ✅ 보기 4개는 계속 배열로 관리하고, API에서 choice1~4로 매핑해서 저장
          choices,
          // ✅ DB는 answer_index
          answer_index: correctIndex,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setErr(`UPDATE_FAILED: ${json?.detail || json?.error || res.status}`);
        return;
      }

      router.push("/admin/questions?page=1");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>문항 수정</h1>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
            ID: {id ?? "-"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => router.back()} disabled={loading} style={btnStyle}>
            취소
          </button>
          <button
            onClick={onSave}
            disabled={loading || !canSave}
            style={{ ...btnStyle, borderColor: "#abefc6" }}
          >
            저장
          </button>
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "#fff3f2",
            border: "1px solid #f2b8b5",
            borderRadius: 10,
          }}
        >
          <b style={{ color: "#b42318" }}>{err}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {/* 문항 */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>문항</div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ddd",
              fontFamily: "inherit",
            }}
            disabled={loading}
          />
        </div>

        {/* 보기 + 정답 */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 10 }}>보기</div>

          <div style={{ display: "grid", gap: 10 }}>
            {choices.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 56, fontSize: 13, opacity: 0.8 }}>보기 {i + 1}</div>
                <input
                  value={c}
                  onChange={(e) => setChoice(i, e.target.value)}
                  disabled={loading}
                  style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                />
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="radio"
                    name="correct"
                    checked={correctIndex === i}
                    onChange={() => setCorrectIndex(i)}
                    disabled={loading}
                  />
                  정답
                </label>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
            * 보기 최소 2개 이상 입력해야 저장 가능(원하면 조건 바꿔줌)
          </div>
        </div>

        {/* 배점/상태 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 200px", border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>배점</div>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
              disabled={loading}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ flex: "0 0 240px", border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>상태</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={loading}
              />
              사용(ON)
            </label>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              OFF로 바꾸면 목록에서 OFF로 표시됩니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  border: "1px solid #ddd",
  background: "#fff",
  padding: "8px 12px",
  borderRadius: 10,
  cursor: "pointer",
};
