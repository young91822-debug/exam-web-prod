// lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";

/**
 * ⚠️ 빌드 타임 안전 버전
 * - import 시점에 env 접근 ❌
 * - 실제 사용 시점에만 env 체크
 */

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// 🔥 Proxy로 감싸서 "접근할 때만" 생성
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = createAdminClient();
      // @ts-ignore
      return client[prop];
    },
  }
) as any;
