import type { PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";

/** 作者公开主页的安全投影；不包含邮箱、权限或私有草稿。 */
export interface PublicAuthorRecord {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarAssetId: string | null;
  createdAt: string;
  projectCount: number;
  followerCount: number;
  followingCount: number;
  followedByCurrentUser: boolean;
  projects: PublicProjectRecord[];
}

/** 单个当前用户对作者的关注状态；匿名只返回 false 与公开计数。 */
export interface AuthorFollowState {
  authorUserId: string;
  username: string;
  following: boolean;
  followerCount: number;
}
