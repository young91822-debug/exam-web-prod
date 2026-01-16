// app/admin/page.tsx
import Link from "next/link";

export default function AdminHomePage() {
  const menus = [
    { href: "/admin/questions", label: "시험문항 관리", desc: "문항 업로드/수정/삭제", emoji: "🧩" },
    { href: "/admin/results", label: "응시현황", desc: "제출 결과/상세 확인", emoji: "📊" },
    { href: "/admin/accounts", label: "응시자 계정 관리", desc: "계정 생성/활성/팀 설정", emoji: "👥" },
  ];

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    padding: 24,
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.18), transparent 60%)," +
      "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.14), transparent 60%)," +
      "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
    color: "white",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  };

  const wrapStyle: React.CSSProperties = {
    maxWidth: 980,
    margin: "0 auto",
  };

  const headerCard: React.CSSProperties = {
    borderRadius: 20,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    padding: 18,
    backdropFilter: "blur(10px)",
  };

  const gridStyle: React.CSSProperties = {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    padding: 16,
    textDecoration: "none",
    color: "white",
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
    backdropFilter: "blur(10px)",
  };

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    padding: "6px 10px",
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
  };

  return (
    <div style={pageStyle}>
      <style>{`
        .smooth { transition: all 160ms ease; }
        .lift:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); }
      `}</style>

      <div style={wrapStyle}>
        <div style={headerCard}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>관리자 홈</div>
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
                메뉴를 선택해서 관리하세요.
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={badgeStyle}>🔒 Admin</span>
                <span style={badgeStyle}>⚡ Fast</span>
                <span style={badgeStyle}>🧾 결과 분리 적용</span>
              </div>
            </div>

            <Link
              href="/admin/results"
              className="smooth lift"
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                textDecoration: "none",
                fontWeight: 800,
              }}
            >
              응시현황 바로가기 →
            </Link>
          </div>
        </div>

        <div style={gridStyle}>
          {menus.map((m) => (
            <Link key={m.href} href={m.href} className="smooth lift" style={cardStyle}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.06)",
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                }}
                aria-hidden
              >
                <span style={{ fontSize: 20 }}>{m.emoji}</span>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>{m.label}</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.70)" }}>{m.desc}</div>
                <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                  이동 →
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          © {new Date().getFullYear()} Exam Web • Internal Use Only
        </div>
      </div>
    </div>
  );
}
