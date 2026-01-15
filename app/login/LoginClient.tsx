// app/login/LoginClient.tsx
"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LoginOk = { ok: true; empId: string; role: string; name?: string; redirect?: string };
type LoginFail = { ok: false; error: string };
type LoginResp = LoginOk | LoginFail;

function s(v: any) {
  return String(v ?? "").trim();
}

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = s(sp.get("next")) || "";

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!id || !pw) {
      setMsg("아이디/비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id, pw }),
      });

      const json: LoginResp = await res.json();

      if (!res.ok || !json.ok) {
        setMsg("로그인 실패: 아이디/비밀번호를 확인하세요.");
        return;
      }

      const redirect =
        s((json as LoginOk).redirect) ||
        (next ? next : json.role === "admin" ? "/admin" : "/exam");

      router.replace(redirect);
      router.refresh();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">로그인</h1>

        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="아이디"
          className="w-full border rounded px-3 py-2"
        />
        <input
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          type="password"
          placeholder="비밀번호"
          className="w-full border rounded px-3 py-2"
        />

        <button
          disabled={loading}
          className="w-full rounded px-3 py-2 border bg-gray-100"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        {msg && <div className="text-sm text-red-600">{msg}</div>}
      </form>
    </div>
  );
}
