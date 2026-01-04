import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 40 }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>시험 시스템</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        관리자/응시자 로그인으로 이동하세요.
      </p>

      <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
        <Link href="/admin" style={cardStyle}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>관리자 페이지</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>
            계정관리 / 문제등록 / 응시현황
          </div>
        </Link>

        <Link href="/login" style={cardStyle}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>응시자 로그인</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>
            직원 계정으로 로그인 후 시험 응시
          </div>
        </Link>
      </div>

      <div style={{ marginTop: 28, fontSize: 13, opacity: 0.6 }}>
        ✅ Next.js 정상 작동 중
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  display: "block",
  width: 360,
  padding: 18,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  textDecoration: "none",
  color: "inherit",
  background: "white",
};
