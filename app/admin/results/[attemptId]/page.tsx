// app/result/[attemptId]/page.tsx
export default async function ResultPage(props: {
  params: { attemptId: string } | Promise<{ attemptId: string }>;
}) {
  // ✅ Next 16: params가 Promise일 수 있으니 무조건 await로 unwrap
  const p = await Promise.resolve(props.params);
  const attemptId = p?.attemptId;

  if (!attemptId || attemptId === "undefined") {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <h1 style={{ fontSize: 32, fontWeight: 900 }}>시험 결과</h1>
        <pre style={{ background: "#f3f4f6", padding: 12, borderRadius: 8 }}>
{JSON.stringify({ error: "invalid attemptId", attemptId }, null, 2)}
        </pre>
      </div>
    );
  }

  // ✅ 서버 컴포넌트니까 상대경로 fetch 대신, headers로 origin 만들어서 호출
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const baseUrl = `${proto}://${host}`;

  const res = await fetch(`${baseUrl}/api/result/${attemptId}`, {
    cache: "no-store",
  });

  const json = await res.json();

  if (!res.ok) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <h1 style={{ fontSize: 32, fontWeight: 900 }}>시험 결과</h1>
        <pre style={{ background: "#f3f4f6", padding: 12, borderRadius: 8 }}>
{JSON.stringify({ status: res.status, json }, null, 2)}
        </pre>
      </div>
    );
  }

  const attempt = json?.attempt;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 900, marginBottom: 12 }}>시험 결과</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>응시ID: {attemptId}</div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Stat label="점수" value={`${attempt?.score ?? 0} / ${attempt?.max_score ?? 0}`} />
          <Stat label="총 배점" value={`${attempt?.total_points ?? 0}`} />
          <Stat label="문항 수" value={`${attempt?.question_ids?.length ?? 0}`} />
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
          제출시간: {attempt?.submitted_at ?? "-"}
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <a href="/" style={btnStyle(false)}>홈으로</a>
        <a href="/exam" style={btnStyle(true)}>다시 응시</a>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 170, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: primary ? "1px solid #111827" : "1px solid #d1d5db",
    background: primary ? "#111827" : "#fff",
    color: primary ? "#fff" : "#111827",
    fontWeight: 800,
    textDecoration: "none",
    display: "inline-block",
  };
}
