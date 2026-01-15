// app/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

type LoginOk = { ok: true; empId: string; role: string; name?: string; redirect?: string };
type LoginFail = { ok: false; error: string; detail?: any };
type LoginResp = LoginOk | LoginFail;

function s(v: any) {
  return String(v ?? "").trim();
}

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = s(sp.get("next")) || "";

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const id2 = s(id);
    const pw2 = s(pw);

    if (!id2 || !pw2) {
      setMsg("아이디/비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: id2, pw: pw2 }),
      });

      const text = await res.text();
      const json: LoginResp = text ? JSON.parse(text) : ({ ok: false, error: "EMPTY_RESPONSE" } as any);

      if (!res.ok || !json.ok) {
        const errCode = (json as LoginFail)?.error || `HTTP_${res.status}`;
        setMsg(
          errCode === "USER_NOT_FOUND"
            ? "계정이 없습니다."
            : errCode === "PASSWORD_NOT_SET"
            ? "비밀번호가 설정되지 않았습니다."
            : errCode === "USER_INACTIVE"
            ? "비활성 계정입니다."
            : errCode === "MISSING_FIELDS"
            ? "아이디/비밀번호를 입력하세요."
            : "로그인 실패: 아이디/비밀번호를 확인하세요."
        );
        return;
      }

      const ok = json as LoginOk;
      const redirect =
        s(ok.redirect) ||
        (next ? next : ok.role === "admin" ? "/admin" : "/exam");

      router.replace(redirect);
      router.refresh();
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">로그인</h1>

        <div className="space-y-2">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="아이디"
            className="w-full border rounded px-3 py-2"
            autoComplete="username"
          />
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
            type="password"
            className="w-full border rounded px-3 py-2"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded px-3 py-2 border bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}
      </form>
    </div>
  );
}
