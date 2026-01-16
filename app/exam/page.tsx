// app/exam/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

export default async function ExamPage() {
  const c = await cookies();

  const empId = c.get("empId")?.value || "";
  const role = c.get("role")?.value || "";

  if (!empId) redirect("/login?next=/exam");
  if (role === "admin") redirect("/admin");

  // ✅ ExamClient 로직은 그대로 두고, 전체 톤만 맞추는 래퍼
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.12), transparent 60%)," +
          "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.10), transparent 60%)," +
          "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <ExamClient />
      </div>
    </div>
  );
}
