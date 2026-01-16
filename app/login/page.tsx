// app/login/page.tsx
import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic"; // ✅ 정적 프리렌더링 방지

function LoadingFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.20), transparent 60%)," +
          "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.18), transparent 60%)," +
          "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
        color: "white",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              height: 40,
              width: 40,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.06)",
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: "55%", borderRadius: 8, background: "rgba(255,255,255,0.10)" }} />
            <div style={{ marginTop: 8, height: 12, width: "70%", borderRadius: 8, background: "rgba(255,255,255,0.08)" }} />
          </div>
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          <div style={{ height: 12, width: 70, borderRadius: 8, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ height: 44, borderRadius: 12, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ height: 12, width: 80, borderRadius: 8, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ height: 44, borderRadius: 12, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ height: 46, marginTop: 6, borderRadius: 12, background: "rgba(255,255,255,0.10)" }} />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoginClient />
    </Suspense>
  );
}
