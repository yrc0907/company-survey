import { AuthorProfile } from "@/components/platform/author-profile";

/** 作者公开主页路由；详细数据由客户端调用公开作者 API，支持匿名访问。 */
export default function AuthorPage({ params }: { params: { username: string } }) {
  return <AuthorProfile username={params.username} />;
}
