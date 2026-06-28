'use client';

import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from '@/components/ui/sidebar';

type AppSidebarProps = {
  editorView: ReactNode;
};

export function AppSidebar({ editorView }: AppSidebarProps) {
  return (
    <Sidebar side="right" className="app-sidebar">
      <SidebarHeader className="p-2">
        <div className="px-1 text-sm font-medium">Editor</div>
      </SidebarHeader>
      <SidebarContent className="px-2 pb-4">{editorView}</SidebarContent>
    </Sidebar>
  );
}
