'use client';

import type { ReactNode } from 'react';
import { Download, Upload, FileJson, ExternalLink } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FontConfig } from '@/src/types';
import type { FontConfigDispatch } from '@/src/font-config';

type AppSidebarProps = {
  fontConfig: FontConfig;
  fontConfigDispatch: FontConfigDispatch;
  onExportOtf: () => void;
  onExportJson: () => void;
  onImport: () => void;
  editorView: ReactNode;
};

// macOS-style segmented control: inset track + a clearly raised selected pill.
const segmentTrack =
  'w-full rounded-lg bg-input p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)]';
const segmentItem = cn(
  'flex-1 rounded-md border-0 bg-transparent text-muted-foreground shadow-none',
  'hover:bg-foreground/5 hover:text-foreground',
  'data-[state=on]:bg-[#5b5b5b] data-[state=on]:text-white data-[state=on]:shadow-sm'
);

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SidebarGroup className="gap-2 px-1 py-2">
      <SidebarGroupLabel className="px-0 text-[11px] font-medium tracking-wide text-muted-foreground">
        {label}
      </SidebarGroupLabel>
      {children}
    </SidebarGroup>
  );
}

export function AppSidebar({
  fontConfig,
  fontConfigDispatch,
  onExportOtf,
  onExportJson,
  onImport,
  editorView,
}: AppSidebarProps) {
  return (
    <Sidebar side="right" className="app-sidebar">
      <Tabs
        defaultValue="editor"
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <SidebarHeader className="p-2">
          <TabsList className="w-full bg-input p-1">
            <TabsTrigger
              value="settings"
              className="flex-1 data-[state=active]:bg-[#5b5b5b] data-[state=active]:text-white dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#5b5b5b] dark:data-[state=active]:text-white"
            >
              Font settings
            </TabsTrigger>
            <TabsTrigger
              value="editor"
              className="flex-1 data-[state=active]:bg-[#5b5b5b] data-[state=active]:text-white dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#5b5b5b] dark:data-[state=active]:text-white"
            >
              Editor
            </TabsTrigger>
          </TabsList>
        </SidebarHeader>

        <SidebarContent className="px-2 pb-4">
          <TabsContent value="settings" className="m-0 flex-1">
            <Section label="Font name">
              <Input
                className="h-8"
                value={fontConfig.name}
                spellCheck={false}
                onChange={(event) =>
                  fontConfigDispatch({
                    type: 'rename',
                    payload: event.target.value,
                  })
                }
              />
            </Section>

            <Section label="Weight">
              <ToggleGroup
                type="single"
                size="sm"
                spacing={1}
                value={String(fontConfig.weight)}
                onValueChange={(value) => {
                  if (value)
                    fontConfigDispatch({
                      type: 'change-weight',
                      payload: value,
                    });
                }}
                className={segmentTrack}
              >
                <ToggleGroupItem value="300" className={segmentItem}>
                  300
                </ToggleGroupItem>
                <ToggleGroupItem value="400" className={segmentItem}>
                  400
                </ToggleGroupItem>
                <ToggleGroupItem value="700" className={segmentItem}>
                  700
                </ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <Section label="Width">
              <ToggleGroup
                type="single"
                size="sm"
                spacing={1}
                value={fontConfig.monospace ? 'mono' : 'prop'}
                onValueChange={(value) => {
                  if (value)
                    fontConfigDispatch({
                      type: 'change-width',
                      payload: value === 'mono',
                    });
                }}
                className={segmentTrack}
              >
                <ToggleGroupItem value="mono" className={segmentItem}>
                  Monospace
                </ToggleGroupItem>
                <ToggleGroupItem value="prop" className={segmentItem}>
                  Proportional
                </ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <Section label="Export your font">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={onExportOtf}>
                  <Download />
                  OTF
                </Button>
                <Button variant="secondary" onClick={onExportJson}>
                  <FileJson />
                  JSON
                </Button>
              </div>
              <Button
                variant="ghost"
                className="justify-start"
                onClick={onImport}
              >
                <Upload />
                Import .json…
              </Button>
            </Section>

            <SidebarSeparator className="mx-1" />

            <Section label="Original fonts">
              {[300, 400, 700].map((weight) => (
                <Button
                  key={weight}
                  variant="ghost"
                  className="justify-start"
                  asChild
                >
                  <a href={`/Brutalita-${weight}.otf`} download>
                    <Download />
                    Brutalita {weight}
                  </a>
                </Button>
              ))}
            </Section>

            <SidebarSeparator className="mx-1" />

            <Section label="About">
              <p className="px-1 pb-1 text-xs leading-relaxed text-muted-foreground">
                Brutalita is an experimental font and editor. Create and
                download your own font.
              </p>
              {[
                { href: 'https://javier.xyz', label: 'Made by Javier Bórquez' },
                {
                  href: 'https://github.com/javierbyte/brutalita',
                  label: 'Github repo',
                },
                { href: 'https://x.com/javierbyte', label: '@javierbyte on X' },
              ].map((link) => (
                <Button
                  key={link.href}
                  variant="ghost"
                  className="justify-start"
                  asChild
                >
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    {link.label}
                  </a>
                </Button>
              ))}
            </Section>
          </TabsContent>

          <TabsContent value="editor" className="m-0 flex-1">
            {editorView}
          </TabsContent>
        </SidebarContent>
      </Tabs>
    </Sidebar>
  );
}
