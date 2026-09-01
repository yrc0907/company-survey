import { AuthorProfile } from "@/components/platform/author-profile";

/** GitHub 风格的短作者地址；/author/:username 保留为兼容别名。 */
export default function UserProfilePage({ params }: { params: { username: string } }) {
  return <AuthorProfile username={params.username} />;
}
