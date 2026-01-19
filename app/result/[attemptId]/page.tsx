// app/result/[attemptId]/page.tsx
import ResultClient from "./ResultClient";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { attemptId: string } }) {
  return <ResultClient attemptId={params.attemptId} />;
}
