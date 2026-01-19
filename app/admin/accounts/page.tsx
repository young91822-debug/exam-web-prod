// app/admin/accounts/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Account = any;

type ListResp =
  | { ok: true; items?: Account[]; rows?: Account[] }
  | { ok: false; error: string; detail?: any };

type PostResp =
  | { ok: true; item: Account; mode?: string; tempPassword?: string; marker?: string }
  | { ok: false; error: string; detail?: any };

function s(v: any) {
  return String(v ?? "").trim();
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, error: "INVALID_JSON", detail: text };
  }
}

function pickList(json: any): Account[] {
  if (!json) return [];
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.rows)) return json.rows;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

function fmtDate(v: any) {
  const t = String(v ?? "").trim();
  if (!t) return "";
  // ISO 형태면 보기 좋게
  try {
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.toLocaleString();
  } catch {}
  return t;
}

export default function AdminAccountsPage() {
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string>("");

  const count = items.length;

  async function fetchList() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      const json = (await safeJson(res)) as ListResp;

      if (!res.ok || !json?.ok) {
        setErr((json as any)?.detail || (json as any)?.error || `HTTP_${res.status}`);
        setItems([]);
        return;
      }

      const list = pickList(json);
      setItems(list);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList();
  }, []);

  async function onCreate() {
    const emp_id = s(empId);
    if (!emp_id) {
      setErr("emp_id를 입력해줘");
      return;
    }

    setPosting(true);
    setErr("");

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          empId: emp_id,
          name: s(name),
          is_active: isActive,
        }),
        cache: "no-store",
      });

      const json = (await safeJson(res)) as PostResp;

      if (!res.ok || !json?.ok) {
        setErr((json as any)?.detail || (json as any)?.error || `HTTP_${res.status}`);
        return;
      }

      await fetchList();

      setEmpId("");
      setName("");
      setIsActive(true);

      if ((json as any)?.tempPassword) {
        alert(`생성/갱신 완료! 임시 비번: ${(json as any).tempPassword}`);
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPosting(false);
    }
  }

  const filtered = useMemo(() => {
    return items;
  }, [items]);

  return (
    <div style={pageWrap}>
      <h1 style={titleStyle}>응시자 계정 관리</h1>

      {err ? (
        <div style={errBox}>
          에러: {err}
        </div>
      ) : null}

      {/* form card */}
      <div style={card}>
        <div style={formRow}>
          <div style={{ minWidth: 220 }}>
            <div style={labelStyle}>응시자ID(emp_id) *</div>
            <input
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="예: 201978"
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 220 }}>
            <div style={labelStyle}>이름(선택)</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              style={inputStyle}
            />
          </div>

          <div style={{ minWidth: 160 }}>
            <div style={labelStyle}>사용 여부</div>
            <select
              value={isActive ? "1" : "0"}
              onChange={(e) => setIsActive(e.target.value === "1")}
              style={inputStyle}
            >
              <option value="1">사용</option>
              <option value="0">미사용</option>
            </select>
          </div>

          <button onClick={onCreate} disabled={posting} style={primaryBtn(posting)}>
            {posting ? "처리중..." : "생성"}
          </button>

          <button onClick={fetchList} disabled={loading} style={ghostBtn(loading)}>
            새로고침
          </button>
        </div>

        <div style={hintStyle}>
          * “생성” 눌렀는데 목록이 안 바뀌면 DevTools → Network에서 <b>/api/admin/accounts</b> GET 응답 확인
        </div>
      </div>

      {/* list card */}
      <div style={card}>
        <div style={{ fontWeight: 900, marginBottom: 10, color: "#111827" }}>
          목록 ({count}건)
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRow}>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>emp_id</th>
                <th style={thStyle}>이름</th>
                <th style={thStyle}>사용</th>
                <th style={thStyle}>생성일</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 12, color: "#6b7280" }}>
                    {loading ? "불러오는 중..." : "아직 계정이 없습니다."}
                  </td>
                </tr>
              ) : (
                filtered.map((r: any) => {
                  const id = String(r?.id ?? "");
                  const emp = String(r?.emp_id ?? "");
                  const nm = String(r?.name ?? "");
                  const active = !!r?.is_active;
                  const created = fmtDate(r?.created_at);

                  return (
                    <tr key={String(r?.id ?? r?.emp_id)} style={trStyle}>
                      {/* ✅ 여기에서 글씨색/폰트 강제해서 '회색 이슈' 해결 */}
                      <td style={tdMono}>{id}</td>
                      <td style={tdTextStrong}>{emp}</td>
                      <td style={tdText}>{nm}</td>
                      <td style={tdText}>{active ? "사용" : "미사용"}</td>
                      <td style={tdTextSub}>{created}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */

const pageWrap: React.CSSProperties = {
  padding: 24,
  // ✅ layout의 글자색 상속이 와도 페이지에서는 또렷하게
  color: "#111827",
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
  marginBottom: 16,
  color: "#ffffff", // 다크 배경 상단 타이틀은 흰색이 더 잘 보임
};

const errBox: React.CSSProperties = {
  background: "#fee2e2",
  color: "#991b1b",
  padding: "10px 12px",
  borderRadius: 10,
  marginBottom: 12,
  fontWeight: 700,
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  color: "#111827", // ✅ 카드 내부 글자는 항상 진하게
};

const formRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 6,
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  outline: "none",
  color: "#111827",
  background: "#fff",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: disabled ? "#9ca3af" : "#111827",
    color: "#fff",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    marginTop: 18,
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    marginTop: 18,
    opacity: disabled ? 0.7 : 1,
  };
}

const hintStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 600,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  color: "#111827",
};

const theadRow: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
  background: "#fafafa",
};

const thStyle: React.CSSProperties = {
  padding: 10,
  fontSize: 12,
  fontWeight: 900,
  color: "#374151",
  whiteSpace: "nowrap",
};

const trStyle: React.CSSProperties = {
  borderBottom: "1px solid #f3f4f6",
};

const tdText: React.CSSProperties = {
  padding: 10,
  color: "#111827",
  fontWeight: 700,
};

const tdTextStrong: React.CSSProperties = {
  padding: 10,
  color: "#111827",
  fontWeight: 900,
};

const tdTextSub: React.CSSProperties = {
  padding: 10,
  color: "#374151",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const tdMono: React.CSSProperties = {
  padding: 10,
  color: "#111827", // ✅ 회색 문제 해결 핵심
  fontWeight: 800,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "nowrap",
};
