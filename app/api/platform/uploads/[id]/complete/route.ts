import { POST as completeUpload } from "@/app/api/platform/uploads/[id]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 语义化确认入口；与 POST /uploads/{id} 共用同一套鉴权、HeadObject 和幂等逻辑。 */
export async function POST(request: Request, context: { params: { id: string } }) {
  return completeUpload(request, context);
}
