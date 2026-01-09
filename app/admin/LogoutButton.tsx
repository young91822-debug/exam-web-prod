"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onLogout = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include", // ✅ 이거 없으면 쿠키 안 실려서 꼬일 수 있음
        cache: "no-store",
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        alert(`로그아웃 실패 (status ${r.status})\n${JSON.stringify(j)}`);
        return;
      }

      // ✅ 쿠키가 지워진 상태에서 로그인으로 이동
      router.replace("/login");
      router.refresh();
    } catch (e: any) {
      alert(`로그아웃 실패: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={onLogout}
      disabled={loading}
      style={{
        padding: "8px 12px",
        border: "1px solid #ddd",
        borderRadius: 8,
        cursor: loading ? "not-allowed" : "pointer",
        background: "white",
      }}
    >
      {loading ? "로그아웃 중..." : "로그아웃"}
    </button>
  );
}
