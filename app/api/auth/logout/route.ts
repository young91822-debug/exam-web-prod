// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";

const COOKIE_NAMES = ["empId", "emp_id", "userId", "employeeId", "emp", "admin"];

function expire(res: NextResponse, name: string, httpOnly: boolean) {
  res.cookies.set({
    name,
    value: "",
    path: "/",          // 중요
    httpOnly,           // 둘 다 처리할 거임
    sameSite: "lax",
    secure: false,      // localhost
    expires: new Date(0),
  });
}

export async function POST() {
  const res = NextResponse.json({ ok: true, marker: "LOGOUT_OK" });

  // httpOnly 쿠키 만료
  for (const n of COOKIE_NAMES) expire(res, n, true);
  // 비-httpOnly 쿠키 만료(혹시 남아있을 수 있어서)
  for (const n of COOKIE_NAMES) expire(res, n, false);

  return res;
}

// 실수로 GET 호출해도 동작하게
export async function GET() {
  return POST();
}
