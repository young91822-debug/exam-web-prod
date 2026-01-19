// app/exam/done/page.tsx
export default function DonePage() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>제출이 완료되었습니다.</div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>창을 닫아도 됩니다.</div>
      </div>
    </div>
  );
}
