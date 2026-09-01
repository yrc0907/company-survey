"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/ui/cn";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content ref={ref} className={cn("menu-content", className)} {...props} /></ContextMenuPrimitive.Portal>;
});

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(function ContextMenuItem({ className, ...props }, ref) {
  return <ContextMenuPrimitive.Item ref={ref} className={cn("menu-item", className)} {...props} />;
});

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return <ContextMenuPrimitive.Separator ref={ref} className={cn("menu-separator", className)} {...props} />;
});

export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>
>(function ContextMenuSubTrigger({ className, children, ...props }, ref) {
  return <ContextMenuPrimitive.SubTrigger ref={ref} className={cn("menu-item", className)} {...props}>{children}<ChevronRight className="ml-auto size-4" /></ContextMenuPrimitive.SubTrigger>;
});

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(function ContextMenuSubContent({ className, ...props }, ref) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.SubContent ref={ref} className={cn("menu-content", className)} {...props} /></ContextMenuPrimitive.Portal>;
});
