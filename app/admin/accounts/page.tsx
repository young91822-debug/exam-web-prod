// app/admin/accounts/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Account = any;

type ListResp =
  | { ok: true; rows: Account[] }
  | { ok: false; error: string; detail?: any };

type PostResp =
  | { ok: true; row: Account; mode?: string; tempPassword?: string; marker?: string }
  | { ok: false; error: string; detail?: any };

function s(v: any) {
  return String(v ?? "").trim();
}

export default function AdminAccountsPage() {
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      const text = await res.text();
      const json = (text ? JSON.parse(text) : null) as ListResp;

      if (!res.ok || !json?.ok) {
        setItems([]);
        setErr((json as any)?.error || `HTTP_${res.status}`);
        return;
      }

      // ✅ 서버 응답은 rows
      setItems(Array.isArray((json as any).rows) ? (json as any).rows : []);
    } catch (e: any) {
      setItems([]);
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const listCount = useMemo(() => items?.length ?? 0, [items]);

  async function onCreate() {
    setErr("");
    setMsg("");
    const payload = {
      empId: s(empId),
      name: s(name), // "이름(선택)"
      is_active: !!isActive,
    };

    if (!payload.empId) {
      setErr("응시자ID(emp_id)를 입력해줘.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await res.text();
      const json = (text ? JSON.parse(text) : null) as PostResp;

      if (!res.ok || !json?.ok) {
        setErr((json as any)?.error || `HTTP_${res.status}`);
        return;
      }

      // ✅ 서버 응답은 row
      const createdEmpId =
        (json as any)?.row?.emp_id ??
        (json as any)?.row?.empId ??
        payload.empId;

      const tempPw = (json as any)?.tempPassword;

      setMsg(`생성 완료: ${createdEmpId}${tempPw ? ` (기본비번: ${tempPw})` : ""}`);

      // ✅ 생성 후 목록 다시 불러오기
      await load();

      setEmpId("");
      setName("");
      setIsActive(true);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>응시자 계정 관리</h2>

      {err ? (
        <div
          style={{
            background: "#ffecec",
            color: "#b40000",
            padding: 12,
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          에러: {err}
        </div>
      ) : null}

      {msg ? (
        <div
          style={{
            background: "#e9f8ee",
            color: "#116b2b",
            padding: 12,
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          {msg}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 14,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>응시자ID(emp_id) *</div>
            <input
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="예: 201978"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>이름(선택)</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>사용 여부</div>
            <select
              value={isActive ? "Y" : "N"}
              onChange={(e) => setIsActive(e.target.value === "Y")}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            >
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </div>

          <button
            onClick={onCreate}
            disabled={loading}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #222",
              background: "#222",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            생성
          </button>

          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            새로고침
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          * “생성” 눌렀는데 목록이 안 바뀌면 DevTools → Network에서 <b>/api/admin/accounts</b> GET/POST 응답을 확인
        </div>
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, fontWeight: 700 }}>목록 ({listCount}건)</div>

        <div style={{ borderTop: "1px solid #eee" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: 12, fontWeight: 700 }}>
            <div>ID</div>
            <div>emp_id</div>
            <div>이름</div>
            <div>사용</div>
            <div>생성일</div>
          </div>

          <div style={{ borderTop: "1px solid #eee" }}>
            {items.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.7 }}>아직 계정이 없습니다.</div>
            ) : (
              items.map((it: any) => (
                <div
                  key={String(it?.id ?? it?.emp_id ?? Math.random())}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                    padding: 12,
                    borderTop: "1px solid #f2f2f2",
                    alignItems: "center",
                  }}
                >
                  <div style={{ wordBreak: "break-all" }}>{String(it?.id ?? "-")}</div>
                  <div>{String(it?.emp_id ?? it?.empId ?? "-")}</div>
                  <div>{String(it?.name ?? it?.display_name ?? it?.fullname ?? it?.username ?? "-")}</div>
                  <div>{(it?.is_active ?? it?._active) ? "사용" : "미사용"}</div>
                  <div>{String(it?.created_at ?? it?.createdAt ?? "-")}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
