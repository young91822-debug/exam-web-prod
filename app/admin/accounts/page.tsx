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

type PatchResp =
  | { ok: true; rows?: Account[]; items?: Account[] }
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
        setErr((json as any)?.error || `HTTP_${res.status}`);
        setItems([]); // 화면상 혼동 줄이려면 비우고
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
      });

      const json = (await safeJson(res)) as PostResp;

      if (!res.ok || !json?.ok) {
        setErr((json as any)?.error || `HTTP_${res.status}`);
        return;
      }

      // ✅ 생성 성공 → 목록 새로고침 (가장 확실)
      await fetchList();

      // 입력 초기화
      setEmpId("");
      setName("");
      setIsActive(true);

      // 필요하면 임시비번 안내
      if ((json as any)?.tempPassword) {
        // 너무 귀찮으면 alert로
        alert(`생성/갱신 완료! 임시 비번: ${(json as any).tempPassword}`);
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPosting(false);
    }
  }

  // (선택) 간단 검색
  const filtered = useMemo(() => {
    return items;
  }, [items]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
        응시자 계정 관리
      </h1>

      {err ? (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "10px 12px",
            borderRadius: 10,
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          에러: {err}
        </div>
      ) : null}

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              응시자ID(emp_id) *
            </div>
            <input
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="예: 201978"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
              }}
            />
          </div>

          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              이름(선택)
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
              }}
            />
          </div>

          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              사용 여부
            </div>
            <select
              value={isActive ? "1" : "0"}
              onChange={(e) => setIsActive(e.target.value === "1")}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
              }}
            >
              <option value="1">사용</option>
              <option value="0">미사용</option>
            </select>
          </div>

          <button
            onClick={onCreate}
            disabled={posting}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111827",
              background: posting ? "#9ca3af" : "#111827",
              color: "#fff",
              fontWeight: 700,
              cursor: posting ? "not-allowed" : "pointer",
              marginTop: 18,
            }}
          >
            {posting ? "처리중..." : "생성"}
          </button>

          <button
            onClick={fetchList}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#111827",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: 18,
            }}
          >
            새로고침
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          * “생성” 눌렀는데 목록이 안 바뀌면 DevTools → Network에서 <b>/api/admin/accounts</b> GET 응답 확인
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>
          목록 ({count}건)
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                <th style={{ padding: 10 }}>ID</th>
                <th style={{ padding: 10 }}>emp_id</th>
                <th style={{ padding: 10 }}>이름</th>
                <th style={{ padding: 10 }}>사용</th>
                <th style={{ padding: 10 }}>생성일</th>
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
                filtered.map((r: any) => (
                  <tr key={String(r?.id ?? r?.emp_id)} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 10 }}>{String(r?.id ?? "")}</td>
                    <td style={{ padding: 10 }}>{String(r?.emp_id ?? "")}</td>
                    <td style={{ padding: 10 }}>{String(r?.name ?? "")}</td>
                    <td style={{ padding: 10 }}>
                      {r?.is_active ? "사용" : "미사용"}
                    </td>
                    <td style={{ padding: 10 }}>
                      {String(r?.created_at ?? "")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
