// app/result/[attemptId]/page.tsx
export const dynamic = "force-dynamic";

import ResultClient from "./ResultClient";

export default async function Page({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <ResultClient attemptId={String(attemptId)} />;
}
