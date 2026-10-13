import { NextRequest, NextResponse } from "next/server";
import { canPerformMutation } from "@/lib/auth/permissions";

export const config = {
  matcher: ["/api/:path*"],
};

export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase();

  // 1. 查询类请求（GET/HEAD/OPTIONS）天然放行，保障任何人都能顺畅查阅
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }

  // 2. 获取请求主机名
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;

  // 3. 读取管理员 Token（支持 Header 与 Cookie）
  const token =
    request.headers.get("x-admin-token") ||
    request.cookies.get("orbit_admin_token")?.value ||
    request.nextUrl.searchParams.get("admin_token");

  const pathname = request.nextUrl.pathname;

  // 4. 校验是否允许写操作
  if (!canPerformMutation({ pathname, host, token })) {
    return NextResponse.json(
      {
        error: "只读模式：当前外部域名仅开放只读浏览，该操作已被禁止。",
        code: "READ_ONLY_MODE",
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}
