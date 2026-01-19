// app/login/LoginClient.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LoginOk = { ok: true; empId: string; role: string; name?: string; redirect?: string };
type LoginFail = { ok: false; error: string; detail?: any };
type LoginResp = LoginOk | LoginFail;

function s(v: any) {
  return String(v ?? "").trim();
}

function friendlyError(code: string) {
  const c = s(code).toUpperCase();
  if (!c) return "로그인에 실패했어요. 다시 시도해 주세요.";
  if (c.includes("MISSING")) return "아이디와 비밀번호를 입력해 주세요.";
  if (c.includes("INVALID")) return "아이디 또는 비밀번호가 올바르지 않아요.";
  if (c.includes("DISABLED") || c.includes("INACTIVE")) return "비활성화된 계정이에요. 관리자에게 문의해 주세요.";
  if (c.includes("LOCK")) return "잠긴 계정이에요. 관리자에게 문의해 주세요.";
  if (c.includes("SERVER") || c.includes("FATAL") || c.includes("FAILED"))
    return "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
  return `로그인 실패: ${code}`;
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: 999,
        border: "2px solid rgba(255,255,255,0.45)",
        borderTopColor: "rgba(255,255,255,0.95)",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );
}

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = s(sp.get("next")) || "";

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");

  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const idRef = useRef<HTMLInputElement | null>(null);
  const pwRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = useMemo(() => s(id).length > 0 && s(pw).length > 0 && !loading, [id, pw, loading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const loginId = s(id);
    const loginPw = s(pw);

    if (!loginId || !loginPw) {
      setMsg("아이디/비밀번호를 입력하세요.");
      if (!loginId) idRef.current?.focus();
      else pwRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: loginId, pw: loginPw, next }),
        cache: "no-store",
        credentials: "include",
      });

      const text = await res.text();
      let data: LoginResp | null = null;

      try {
        data = text ? (JSON.parse(text) as LoginResp) : null;
      } catch {
        data = null;
      }

      // ✅ JSON이 깨진 경우만 서버응답 오류
      if (!data) {
        setMsg("서버 응답이 올바르지 않아요. 잠시 후 다시 시도해 주세요.");
        return;
      }

      // ✅ ok=false면 (401/403이어도) 정상 로그인 실패로 처리
      if (!data.ok) {
        const err = s((data as any)?.error) || "LOGIN_FAILED";
        setMsg(friendlyError(err));
        pwRef.current?.focus();
        return;
      }

      // ✅ ok=true일 때만 이동
      const ok = data as LoginOk;
      const dest = s(ok.redirect) || next || (ok.role === "admin" ? "/admin" : "/exam");
      router.replace(dest);
      router.refresh();
    } catch (err: any) {
      setMsg(`네트워크 오류: ${String(err?.message ?? err)}`);
    } finally {
      setLoading(false);
    }
  }

  // --- Styles (Tailwind 있으면 className, 없어도 style로 보장) ---
  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
      "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.18), transparent 60%)," +
      "radial-gradient(800px 400px at 50% 95%, rgba(236,72,153,0.12), transparent 60%)," +
      "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 440,
    borderRadius: 22,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.48)",
    backdropFilter: "blur(12px)",
    padding: 22,
    color: "white",
  };

  const inputBase: React.CSSProperties = {
    width: "100%",
    height: 46,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    padding: "0 12px",
    outline: "none",
  };

  const buttonStyle: React.CSSProperties = {
    width: "100%",
    height: 46,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: canSubmit ? "linear-gradient(90deg, #6366f1 0%, #22c55e 100%)" : "rgba(255,255,255,0.10)",
    color: "white",
    fontWeight: 800,
    cursor: canSubmit ? "pointer" : "not-allowed",
    boxShadow: canSubmit ? "0 14px 30px rgba(99,102,241,0.25)" : "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  };

  return (
    <div style={pageStyle} className="min-h-screen grid place-items-center p-6">
      {/* keyframes (Tailwind 없어도 스피너 동작) */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .focusGlow:focus { box-shadow: 0 0 0 4px rgba(99,102,241,0.18); border-color: rgba(255,255,255,0.22); }
        .hoverLift:hover { transform: translateY(-1px); }
        .smooth { transition: all 160ms ease; }
      `}</style>

      <div style={cardStyle} className="w-full max-w-[440px] rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-extrabold tracking-tight">시험 시스템</div>
            <div className="mt-1 text-sm text-white/70">사내 인증으로 안전하게 로그인하세요</div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              <span aria-hidden>🔒</span>
              <span>보안 로그인</span>
            </div>
          </div>

          <div className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 grid place-items-center" aria-hidden title="Exam">
            <span className="text-lg">📝</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs text-white/80 mb-2">아이디</label>
            <input
              ref={idRef}
              style={inputBase}
              className="smooth focusGlow w-full h-[46px] rounded-[14px] border border-white/10 bg-white/5 px-3 text-white placeholder-white/40"
              placeholder="예) 2022057"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
              inputMode="text"
            />
          </div>

          <div>
            <label className="block text-xs text-white/80 mb-2">비밀번호</label>

            {/* ✅ 보기 버튼 제거 + input 1개만 유지 */}
            <input
              ref={pwRef}
              style={inputBase}
              className="smooth focusGlow w-full h-[46px] rounded-[14px] border border-white/10 bg-white/5 px-3 text-white placeholder-white/40"
              placeholder="비밀번호"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>

          {msg ? <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{msg}</div> : null}

          <button type="submit" disabled={!canSubmit} style={buttonStyle} className="smooth hoverLift">
            {loading ? (
              <>
                <Spinner />
                로그인 중…
              </>
            ) : (
              "로그인"
            )}
          </button>

          <div className="pt-2 text-center text-xs text-white/50">문제가 계속되면 관리자에게 문의해 주세요.</div>
        </form>

        <div className="mt-6 text-center text-[11px] text-white/35">© {new Date().getFullYear()} Exam Web • Internal Use Only</div>
      </div>
    </div>
  );
}
