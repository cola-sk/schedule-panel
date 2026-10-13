/**
 * 访问控制与白名单权限管理
 * 
 * 规则：
 * 1. localhost / 127.0.0.1 具备完全管理员权限。
 * 2. 外部域名访问默认处于只读模式，仅白名单路由（如 /drive-migration）具备完全操作权限。
 * 3. 支持在外部域名下通过管理员口令解锁完全权限。
 */

export const WRITABLE_PAGE_ROUTES = ["/drive-migration"];

export const WRITABLE_API_PREFIXES = [
  "/api/drive-migration",
  "/api/cron", // 供定时调度派发（自带 CRON_SECRET 认证）
];

export const ADMIN_TOKEN_KEY = "orbit_admin_token";

export function isLocalhost(hostOrHostname?: string | null): boolean {
  if (!hostOrHostname) return false;
  const clean = hostOrHostname.split(":")[0].toLowerCase().trim();
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1" || clean === "[::1]";
}

export function isWhitelistedPageRoute(pathname: string): boolean {
  return WRITABLE_PAGE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isWhitelistedApiRoute(pathname: string): boolean {
  return WRITABLE_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isValidAdminToken(token?: string | null): boolean {
  if (!token) return false;
  const envAdminToken = process.env.ADMIN_TOKEN || process.env.NEXT_PUBLIC_ADMIN_TOKEN || "orbit-admin";
  return token.trim() === envAdminToken.trim();
}

/**
 * 校验指定请求是否具有写操作权限（POST, PUT, DELETE, PATCH）
 */
export function canPerformMutation({
  pathname,
  host,
  token,
}: {
  pathname: string;
  host?: string | null;
  token?: string | null;
}): boolean {
  // 1. 本地 localhost 始终放行
  if (isLocalhost(host)) {
    return true;
  }

  // 2. 有效管理员 Token 始终放行
  if (isValidAdminToken(token)) {
    return true;
  }

  // 3. API 接口白名单校验
  if (pathname.startsWith("/api/")) {
    return isWhitelistedApiRoute(pathname);
  }

  // 4. 前端页面白名单校验
  return isWhitelistedPageRoute(pathname);
}
