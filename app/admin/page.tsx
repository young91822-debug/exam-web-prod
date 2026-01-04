"use client";
import Link from "next/link";

export default function AdminHome() {
  return (
    <div style={{ padding: 40 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
        관리자 대시보드
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 20,
        }}
      >
        <AdminCard
          title="👤 계정 관리"
          desc="직원 계정 생성 / 삭제"
          href="/admin/accounts"
        />

        <AdminCard
          title="📝 문제 등록"
          desc="CSV 업로드 · 문제 관리"
          href="/admin/questions"
        />

        <AdminCard
          title="📊 응시 현황"
          desc="점수 · 오답 확인 / 다운로드"
          href="/admin/results"
        />
      </div>
    </div>
  );
}

function AdminCard({
  title,
  desc,
  href,
}: {
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 20,
        textDecoration: "none",
        color: "#000",
        background: "#fff",
        boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
      }}
    >
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: 14, color: "#555" }}>{desc}</p>
    </Link>
  );
}
