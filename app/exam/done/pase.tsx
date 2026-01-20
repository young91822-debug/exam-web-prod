// app/exam/done/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DoneClient from "./DoneClient";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

export default async function Page() {
  // ✅ Next 16 계열에서 cookies()가 Promise로 잡히는 경우가 있어서 await 유지
  const ck = await cookies();

  const empId = s(ck.get("empId")?.value);
  const role = s(ck.get("role")?.value);

  // 로그인 안했으면 로그인
  if (!empId) redirect("/login?next=/exam");

  // 관리자는 done 필요 없으니 관리자 화면
  if (role === "admin") redirect("/admin");

  // ✅ 일반 응시자: 완료 화면 보여주고 로그인으로 자동 이동(클라이언트에서 처리)
  return <DoneClient />;
}
