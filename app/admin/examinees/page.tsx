"use client";

import { useEffect, useMemo, useState } from "react";

type Examinee = {
  id: number;
  emp_id: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
};

export default function AdminExamineesPage() {
  const [items, setItems] = useState<Examinee[]>([]);
  const [loading, setLoading] = useState(true);

  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");

  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter(
      (x) =>
        x.emp_id.toLowerCase().includes(qq) ||
        (x.name || "").toLowerCase().includes(qq)
    );
  }, [items, q]);

  async function fetchJson(url: string, init?: RequestInit) {
    const r = await fetch(url, { cache: "no-store", ...init });
    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    return { r, text, j };
  }

  function showFail(title: string, r: Response, text: string, j: any) {
    alert(
      `${title} (status ${r.status})\n` +
        (j ? JSON.stringify(j, null, 2) : text.slice(0, 1000))
    );
  }

  async function refresh() {
    setLoading(true);
    try {
      const { r, text, j } = await fetchJson("/api/admin/examinees");
      if (!r.ok || !j?.ok) return showFail("목록 불러오기 실패", r, text, j);
      setItems(j.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createOne() {
    const payload = {
      emp_id: empId.trim(),
      name: name.trim(),
      password: pw.trim(),
    };

    if (!payload.emp_id || !payload.password) {
      alert("emp_id / password는 필수야");
      return;
    }

    const { r, text, j } = await fetchJson("/api/admin/examinees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok || !j?.ok) return showFail("계정 생성 실패", r, text, j);

    setEmpId("");
    setName("");
    setPw("");
    await refresh();
  }

  async function toggleActive(id: number, to: boolean) {
    const { r, text, j } = await fetchJson("/api/admin/examinees", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, is_active: to }),
    });

    if (!r.ok || !j?.ok) return showFail("상태 변경 실패", r, text, j);
    await refresh();
  }

  async function resetPw(id: number) {
    const newPw = prompt("새 비밀번호 입력");
    if (!newPw) return;

    const { r, text, j } = await fetchJson("/api/admin/examinees", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, password: newPw }),
    });

    if (!r.ok || !j?.ok) return showFail("비밀번호 변경 실패", r, text, j);
    alert("비밀번호 변경 완료");
    await refresh();
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>응시자 계정 관리</h1>
        <a href="/admin" style={{ textDecoration: "none", color: "#2563eb" }}>← 관리자 홈</a>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>응시자 계정 생성</div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, alignItems: "center", maxWidth: 520 }}>
          <label>emp_id *</label>
          <input value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="예: 201978" style={inputStyle} />

          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" style={inputStyle} />

          <label>비밀번호 *</label>
          <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="임시 비밀번호" style={inputStyle} />
        </div>

        <div style={{ marginTop: 10 }}>
          <button onClick={createOne} style={btnPrimary}>생성</button>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="emp_id 또는 이름 검색" style={{ ...inputStyle, maxWidth: 320 }} />
        <button onClick={refresh} style={btn}>새로고침</button>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          {loading ? "로딩중..." : `총 ${items.length}명 / 검색결과 ${filtered.length}명`}
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 160px 1fr 120px 220px", padding: 10, background: "#f9fafb", fontWeight: 700 }}>
          <div>ID</div><div>emp_id</div><div>이름</div><div>상태</div><div>액션</div>
        </div>

        {filtered.map((x) => (
          <div key={x.id} style={{ display: "grid", gridTemplateColumns: "90px 160px 1fr 120px 220px", padding: 10, borderTop: "1px solid #f1f5f9", alignItems: "center" }}>
            <div>{x.id}</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{x.emp_id}</div>
            <div>{x.name || "-"}</div>
            <div>
              <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: x.is_active ? "#ecfdf5" : "#fff7ed", fontSize: 12 }}>
                {x.is_active ? "활성" : "비활성"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => toggleActive(x.id, !x.is_active)} style={btn}>
                {x.is_active ? "비활성" : "활성"}
              </button>
              <button onClick={() => resetPw(x.id)} style={btn}>비번변경</button>
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 16, opacity: 0.7 }}>데이터 없음</div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  outline: "none",
};

const btn: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "white",
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  border: "1px solid #2563eb",
};
