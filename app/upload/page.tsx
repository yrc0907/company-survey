import { UploadPanel } from "@/components/platform/upload-panel";
import { AuthClosedPage } from "@/components/platform/auth/auth-closed";
import { isPublicAuthEnabled } from "@/lib/auth/public-access";

// 上传入口与认证开关同步，必须按服务器运行时环境渲染。
export const dynamic = "force-dynamic";

/** 登录上传入口；客户端组件会在进入时再次验证服务端 Session。 */
export default function UploadPage() { return isPublicAuthEnabled() ? <UploadPanel /> : <AuthClosedPage />; }
