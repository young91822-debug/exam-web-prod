// app/result/[attemptId]/page.tsx
import Link from "next/link";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>결과 화면</h1>
      <p style={{ marginTop: 12 }}>
        attemptId: <b>{attemptId}</b>
      </p>

      <p style={{ marginTop: 12, color: "#666" }}>
        (지금은 404 방지용 임시 페이지야. 다음 단계에서 점수/오답 데이터를 붙일 거야.)
      </p>

      <div style={{ marginTop: 20 }}>
        <Link href="/exam">시험으로 돌아가기</Link>
      </div>
    </main>
  );
}
