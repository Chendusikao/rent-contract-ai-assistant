/**
 * API 基础地址配置
 * 
 * 前后端分离部署时，通过环境变量 VITE_API_BASE_URL 指定后端地址：
 * - 开发环境：不设置，走同源 /api（Vite 代理转发到 3001）
 * - 生产环境分离部署：设置如 https://api.example.com，前端请求该域名
 * - 生产环境同进程部署：不设置，后端同进程托管前端静态文件 + API
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

export function api(path: string): string {
  return `${API_BASE}${path}`;
}
