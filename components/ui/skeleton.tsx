import type { HTMLAttributes } from "react";

import { cn } from "@/lib/ui/cn";

/** shadcn 风格骨架屏；只表达加载状态，不伪造业务数据或统计数字。 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton", className)} {...props} />;
}
