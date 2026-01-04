"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Q = {
  id: number;
  content: string;
  choices: string[];
  answer_index: number;
  points: number;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

function fmt(dt?: string | null) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "-";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function isModified(q: Q) {
  if (!q.created_at || !q.updated_at) return null;
  const c = new Date(q.created_at).getTime();
  const u = new Date(q.updated_at).getTime();
  if (Number.isNaN(c) || Number.isNaN(u)) return null;
  return u > c + 1000;
}

function ToggleSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!!disabled}
      onClick={() => onToggle(!on)}
      style={{
        ...toggleWrap,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span style={{ ...toggleTrack, background: on ? "#111" : "#ddd" }}>
        <span
          style={{
            ...toggleThumb,
            transform: on ? "translateX(18px)" : "translateX(0px)",
            background: "white",
          }}
        />
      </span>
      <span style={{ fontWeight: 800, fontSize: 12, width: 32, textAlign: "left" }}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

export default function AdminQuestionsPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<Q[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // OFF 숨김 기본, 체크하면 OFF도 보여줌
  const [showOff, setShowOff] = useState(false);

  // 직접등록/수정 모달
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const [content, setContent] = useState("");
  const [c1, setC1] = useState("");
  const [c2, setC2] = useState("");
  const [c3, setC3] = useState("");
  const [c4, setC4] = useState("");
  const [answerIndex, setAnswerIndex] = useState(0);
  const [points, setPoints] = useState(5);
  const [isActive, setIsActive] = useState(true);

  const total = items.length;

  function resetForm() {
    setEditId(null);
    setContent("");
    setC1("");
    setC2("");
    setC3("");
    setC4("");
    setAnswerIndex(0);
    setPoints(5);
    setIsActive(true);
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(q: Q) {
    setEditId(q.id);
    setContent(q.content ?? "");
    setC1(q.choices?.[0] ?? "");
    setC2(q.choices?.[1] ?? "");
    setC3(q.choices?.[2] ?? "");
    setC4(q.choices?.[3] ?? "");
    setAnswerIndex(Number(q.answer_index ?? 0));
    setPoints(Number(q.points ?? 0));
    setIsActive(!!q.is_active);
    setFormOpen(true);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/questions?limit=100000", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "문항 조회 실패");
      setItems(Array.isArray(data?.data) ? data.data : []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openFilePicker() {
    fileRef.current?.click();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    setToast(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/admin/questions/import", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "CSV 업로드 실패");

      setToast(`✅ CSV 업로드 완료 (${data?.inserted ?? "?"}건)`);
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setUploading(false);
    }
  }

  function validateForm() {
    if (!content.trim()) return "문제 내용을 입력해줘.";
    const arr = [c1, c2, c3, c4].map((v) => v.trim());
    if (arr.some((v) => !v)) return "보기 4개를 모두 입력해줘.";
    if (answerIndex < 0 || answerIndex > 3) return "정답은 1~4 중에서 골라줘.";
    if (!Number.isFinite(points) || points <= 0) return "배점은 1 이상 숫자로 입력해줘.";
    return null;
  }

  async function saveQuestion() {
    setError(null);
    setToast(null);

    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        content: content.trim(),
        choices: [c1.trim(), c2.trim(), c3.trim(), c4.trim()],
        answer_index: answerIndex,
        points: Number(points),
        is_active: !!isActive,
      };

      if (editId == null) {
        const res = await fetch("/api/admin/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "직접 등록 실패");
        setToast("✅ 직접 등록 완료");
      } else {
        const res = await fetch(`/api/admin/questions/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "수정 실패");
        setToast("✅ 수정 완료");
      }

      setFormOpen(false);
      resetForm();
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  // ✅ ON/OFF 변경 (토글)
  async function setActive(q: Q, next: boolean) {
    setError(null);
    setToast(null);

    setItems((prev) => prev.map((x) => (x.id === q.id ? { ...x, is_active: next } : x)));

    try {
      const res = await fetch(`/api/admin/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "사용여부 변경 실패");

      if (data?.updated_at) {
        setItems((prev) => prev.map((x) => (x.id === q.id ? { ...x, updated_at: data.updated_at } : x)));
      }

      setToast(next ? "✅ ON(사용)으로 변경" : "✅ OFF(숨김) 처리 완료");
    } catch (e: any) {
      setItems((prev) => prev.map((x) => (x.id === q.id ? { ...x, is_active: q.is_active } : x)));
      setError(String(e?.message || e));
    }
  }

  const visibleRows = useMemo(() => {
    return showOff ? items : items.filter((x) => x.is_active);
  }, [items, showOff]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>문제등록</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#444" }}>
            <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
            OFF도 보기
          </label>

          <button onClick={openCreate} disabled={saving || uploading} style={btnPrimary}>
            직접등록
          </button>

          <button onClick={openFilePicker} disabled={uploading || saving} style={btn}>
            {uploading ? "업로드 중..." : "CSV 업로드"}
          </button>

          <button onClick={loadAll} disabled={loading || uploading || saving} style={btn2}>
            새로고침
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPickFile}
            style={{ display: "none" }}
          />
        </div>
      </div>

      <div style={{ color: "#666", marginBottom: 14 }}>
        전체 <b>{total}</b>건 / 현재 표시 <b>{visibleRows.length}</b>건
        <span style={{ marginLeft: 10, color: "#999" }}>(※ ID는 숨김 처리됨)</span>
      </div>

      {toast && (
        <div style={{ padding: 10, border: "1px solid #cfe9d6", background: "#f3fff6", borderRadius: 10, marginBottom: 12 }}>
          {toast}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, border: "1px solid #f99", background: "#fff5f5", borderRadius: 10, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* 모달 */}
      {formOpen && (
        <div style={modalBackdrop}>
          <div style={modal}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                {editId == null ? "직접등록" : "문항 수정"}
              </h2>
              <button
                onClick={() => {
                  setFormOpen(false);
                  resetForm();
                }}
                style={{ marginLeft: "auto", ...btn2 }}
                disabled={saving}
              >
                닫기
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <label style={lbl}>문제</label>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} style={inpArea} />

              <label style={lbl}>보기 1</label>
              <input value={c1} onChange={(e) => setC1(e.target.value)} style={inp} />
              <label style={lbl}>보기 2</label>
              <input value={c2} onChange={(e) => setC2(e.target.value)} style={inp} />
              <label style={lbl}>보기 3</label>
              <input value={c3} onChange={(e) => setC3(e.target.value)} style={inp} />
              <label style={lbl}>보기 4</label>
              <input value={c4} onChange={(e) => setC4(e.target.value)} style={inp} />

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={lbl}>정답</span>
                  <select value={answerIndex} onChange={(e) => setAnswerIndex(Number(e.target.value))} style={sel}>
                    <option value={0}>1번</option>
                    <option value={1}>2번</option>
                    <option value={2}>3번</option>
                    <option value={3}>4번</option>
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={lbl}>배점</span>
                  <input type="number" value={points} onChange={(e) => setPoints(Number(e.target.value))} style={{ ...inp, width: 110 }} min={1} />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  사용(ON)
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={saveQuestion} disabled={saving} style={btnPrimary}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                  disabled={saving}
                  style={btn2}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      {loading ? (
        <div style={{ padding: 16 }}>불러오는 중...</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={th}>번호</th>
                <th style={th}>문제</th>
                <th style={th}>배점</th>
                <th style={th}>사용</th>
                <th style={th}>수정여부</th>
                <th style={th}>수정</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td style={td} colSpan={6}>
                    표시할 문항이 없습니다. (OFF 숨김 중이면 “OFF도 보기” 체크)
                  </td>
                </tr>
              ) : (
                visibleRows.map((q, idx) => {
                  const mod = isModified(q);
                  return (
                    <tr key={q.id} style={{ borderTop: "1px solid #eee", opacity: q.is_active ? 1 : 0.55 }}>
                      <td style={td}>{idx + 1}</td>
                      <td style={{ ...td, textAlign: "left" }}>{q.content}</td>
                      <td style={td}>{q.points ?? 0}</td>
                      <td style={td}>
                        <ToggleSwitch on={!!q.is_active} onToggle={(next) => setActive(q, next)} />
                      </td>
                      <td style={td}>
                        {mod === null ? "-" : mod ? `수정됨 (${fmt(q.updated_at)})` : "신규"}
                      </td>
                      <td style={td}>
                        <button onClick={() => openEdit(q)} style={btnSmall}>
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const btn2: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #eee",
  background: "#fafafa",
  cursor: "pointer",
  fontWeight: 600,
};

const btnSmall: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};

const th: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 12px",
  fontSize: 13,
  verticalAlign: "top",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.25)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modal: React.CSSProperties = {
  width: "min(820px, 100%)",
  background: "white",
  borderRadius: 16,
  border: "1px solid #eee",
  boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  padding: 16,
};

const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#333" };

const inp: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  outline: "none",
  width: "100%",
};

const inpArea: React.CSSProperties = {
  ...inp,
  resize: "vertical",
};

const sel: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #ddd",
};

const toggleWrap: React.CSSProperties = {
  border: "none",
  background: "transparent",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: 0,
};

const toggleTrack: React.CSSProperties = {
  width: 38,
  height: 20,
  borderRadius: 999,
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  padding: 2,
  transition: "background 120ms ease",
};

const toggleThumb: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 999,
  display: "inline-block",
  transition: "transform 120ms ease",
  boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
};
