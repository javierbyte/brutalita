'use client';

import { useState } from 'react';
import { Download, Upload, FileJson, ExternalLink } from 'lucide-react';

import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
} from '@/components/ui/menubar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FontConfig } from '@/src/types';
import type { FontConfigDispatch } from '@/src/font-config';

type AppMenubarProps = {
  fontConfig: FontConfig;
  fontConfigDispatch: FontConfigDispatch;
  onExportOtf: () => void;
  onExportJson: () => void;
  onImport: () => void;
};

// macOS-style segmented control: inset track + a clearly raised selected pill.
const segmentTrack =
  'w-full rounded-lg bg-input p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)]';
const segmentItem = cn(
  'flex-1 rounded-md border-0 bg-transparent text-muted-foreground shadow-none',
  'hover:bg-foreground/5 hover:text-foreground',
  'data-[state=on]:bg-[#5b5b5b] data-[state=on]:text-white data-[state=on]:shadow-sm'
);

const ABOUT_LINKS = [
  { href: 'https://javier.xyz', label: 'Made by Javier Bórquez' },
  { href: 'https://github.com/javierbyte/brutalita', label: 'Github repo' },
  { href: 'https://x.com/javierbyte', label: '@javierbyte on X' },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function AppMenubar({
  fontConfig,
  fontConfigDispatch,
  onExportOtf,
  onExportJson,
  onImport,
}: AppMenubarProps) {
  // Controlled so the Export form's download buttons can close the menu (they
  // are plain buttons, not selectable menu items).
  const [openMenu, setOpenMenu] = useState('');

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-border px-2"
      style={{ height: 'var(--topnav-height)' }}
    >
      <SidebarTrigger className="md:hidden" />

      <Menubar
        value={openMenu}
        onValueChange={setOpenMenu}
        className="h-auto rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        {/* Brutalita (about) --------------------------------------------- */}
        <MenubarMenu value="about">
          <MenubarTrigger className="font-bold">Brutalita</MenubarTrigger>
          <MenubarContent className="w-72">
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              Brutalita is an experimental font and editor. Create and download
              your own font.
            </p>
            <MenubarSeparator />
            {ABOUT_LINKS.map((link) => (
              <MenubarItem key={link.href} asChild>
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  {link.label}
                </a>
              </MenubarItem>
            ))}
          </MenubarContent>
        </MenubarMenu>

        {/* Export --------------------------------------------------------- */}
        {/* No MenubarItems inside: the content is a form, so there is no
            roving-focus/typeahead machinery to block the inputs. */}
        <MenubarMenu value="export">
          <MenubarTrigger>Export</MenubarTrigger>
          <MenubarContent className="w-72 p-3">
            <div
              className="flex flex-col gap-3"
              // Keep the menu's typeahead from swallowing keystrokes in the
              // font-name field, while letting Escape still close the menu.
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
              }}
            >
              <Field label="Font name">
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
              </Field>

              <Field label="Weight">
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
              </Field>

              <Field label="Width">
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
              </Field>

              <div className="-mx-3 h-px bg-border" />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    onExportOtf();
                    setOpenMenu('');
                  }}
                >
                  <Download />
                  OTF
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    onExportJson();
                    setOpenMenu('');
                  }}
                >
                  <FileJson />
                  JSON
                </Button>
              </div>
            </div>
          </MenubarContent>
        </MenubarMenu>

        {/* Import --------------------------------------------------------- */}
        <MenubarMenu value="import">
          <MenubarTrigger>Import</MenubarTrigger>
          <MenubarContent className="w-64">
            <MenubarItem onSelect={onImport}>
              <Upload />
              Choose .json file…
            </MenubarItem>
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              Load a previously exported Brutalita .json font.
            </p>
          </MenubarContent>
        </MenubarMenu>

        {/* Download ------------------------------------------------------- */}
        <MenubarMenu value="download">
          <MenubarTrigger>Download</MenubarTrigger>
          <MenubarContent className="w-72">
            <MenubarLabel className="text-muted-foreground">
              Original Brutalita
            </MenubarLabel>
            {[300, 400, 700].map((weight) => (
              <MenubarItem key={weight} asChild>
                <a href={`/Brutalita-${weight}.otf`} download>
                  <Download />
                  Brutalita {weight}
                </a>
              </MenubarItem>
            ))}
            <MenubarSeparator />
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              Looking to download your custom font? Use the{' '}
              <span className="font-medium text-foreground">Export</span> menu.
            </p>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
}
