// app/exam/done/DoneClient.tsx
"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DoneClient() {
  const router = useRouter();

  useEffect(() => {
    // ✅ 1.2초 보여주고 로그인 화면으로
    const t = setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1200);

    return () => clearTimeout(t);
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
          "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.18), transparent 60%)," +
          "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
        color: "white",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 18,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.42)",
          backdropFilter: "blur(12px)",
          padding: 22,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 950 }}>제출이 완료되었습니다.</div>
        <div style={{ marginTop: 10, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
          응시가 정상적으로 제출되었습니다. 잠시 후 로그인 화면으로 이동합니다…
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          © {new Date().getFullYear()} Exam Web • Internal Use Only
        </div>
      </div>
    </div>
  );
}
