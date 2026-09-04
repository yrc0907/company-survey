"use client";

import { Database, ShieldAlert } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface DataDisclaimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 首页数据说明弹窗：说明采集范围、更新延迟和读者核验责任，不改变项目数据。 */
export function DataDisclaimerDialog({ open, onOpenChange }: DataDisclaimerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <div className="border-b px-6 pb-5 pt-6">
          <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
            <ShieldAlert size={20} aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl">数据采集与使用说明</DialogTitle>
          <DialogDescription className="mt-2 leading-6">
            所有数据来自 BOSS 公开可访问范围内的销售职位联网采集与 AI 自动比对，优先选取高净值职位。服务器在香港，更新会有延迟，欢迎各位联系增加岗位信息，具体岗位细节请各位自行判断。
          </DialogDescription>
        </div>
        <div className="flex items-start gap-3 px-6 py-5 text-sm leading-6 text-muted-foreground">
          <Database size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="m-0">职位信息仅作为公开研究线索，不构成招聘承诺或职业建议；请以企业官方招聘页面和实际沟通结果为准。</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
