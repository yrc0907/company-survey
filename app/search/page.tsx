import { PublicSearch } from "@/components/platform/public-search";

/** 公开搜索路由；查询词通过 URL 保留，便于复制和返回。 */
export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  return <PublicSearch initialQuery={typeof searchParams.q === "string" ? searchParams.q : ""} />;
}

