"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    return n && n.startsWith("/") ? n : "/admin";
  }, [searchParams]);

  const [empId, setEmpId] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: empId, password: pw })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setMsg(data?.error || "로그인 실패");
        return;
      }

      router.replace(nextPath);
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>로그인</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, maxWidth: 360 }}>
        <input
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          placeholder="사번/아이디"
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
        />
        <input
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호"
          type="password"
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: loading ? "#eee" : "#111",
            color: loading ? "#111" : "#fff",
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        {msg && <div style={{ color: "crimson", fontSize: 13 }}>{msg}</div>}
        <div style={{ fontSize: 12, color: "#666" }}>로그인 후 이동: {nextPath}</div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>로딩 중...</div>}>
      <LoginInner />
    </Suspense>
  );
}
