'use client';

import type { ReactNode } from 'react';

import { Sidebar, SidebarContent } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { cornerOptions, DEFAULT_CORNER_RADIUS, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS, strokePath } from '../corners';
import type { CornerStyle, StrokeStyle } from '../corners';
import type { FontConfigDispatch } from '../font-config';
import { MAX_SLANT } from '../slant';
import { resolveSpacing, SPACING_RANGES } from '../spacing';
import type { SpacingKey } from '../spacing';
import type { CharLayer, FontConfig } from '../types';
import { SHIPPED_WEIGHTS, styleName } from '../weights';

type AppSidebarProps = {
  editorView: ReactNode;
  fontConfig: FontConfig;
  fontConfigDispatch: FontConfigDispatch;
};

const SPACING_FIELDS: { key: SpacingKey; label: string; title: string }[] = [
  {
    key: 'spacing',
    label: 'Letters',
    title: 'Gap between two flat-sided letters, such as "HH"',
  },
  {
    key: 'wordSpacing',
    label: 'Words',
    title: 'Width of the space character',
  },
  {
    key: 'kerning',
    label: 'Kerning',
    title: 'The most a pair such as "Ta" may be pulled together. 0 turns it off',
  },
];

const SAMPLE_CORNER: CharLayer = [[3, 29], [3, 15], [15, 3], [41, 3]];

const CORNER_FIELDS: { value: CornerStyle; label: string; title: string }[] = [
  { value: 'chamfer', label: 'Chamfer', title: 'Curves stay as the chamfers they are drawn as' },
  { value: 'round', label: 'Circular', title: 'Chamfers and bends become circular arcs' },
  {
    value: 'continuous',
    label: 'Continuous',
    title: 'Chamfers and bends become curves that ease in and out of the straights',
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SliderField({
  id,
  label,
  title,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  title?: string;
  value: number;
  /** What the readout shows; also announced as the slider's value. */
  display: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={cn('flex flex-col gap-1.5', disabled && 'opacity-40')}
      title={title}
    >
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="tabular-nums text-muted-foreground">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

// Every control that picks one of a few (the tabs, the two-way switches) is
// one well with the dropdown's border and fill; the chosen option is a raised
// tile inside it, so no line is brighter than the shell around it.
const WELL = 'h-8 w-full rounded-md border border-input bg-background p-0.5';
const TILE = 'h-full flex-1 rounded-[5px] text-xs font-normal text-muted-foreground';

/** A two-way switch. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={0.5}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className={WELL}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(
            TILE,
            'data-[state=off]:hover:bg-transparent data-[state=off]:hover:text-foreground',
            'data-[state=on]:bg-input data-[state=on]:text-foreground data-[state=on]:hover:text-foreground'
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function AppSidebar({
  editorView,
  fontConfig,
  fontConfigDispatch,
}: AppSidebarProps) {
  const slant = fontConfig.slant ?? 0;
  const corners = fontConfig.corners ?? 'chamfer';
  const cornerRadius = fontConfig.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const spacing = resolveSpacing(fontConfig);
  const spacingIsCustom = SPACING_FIELDS.some(
    ({ key }) => fontConfig[key] !== undefined
  );

  return (
    <Sidebar side="right" className="app-sidebar">
      <Tabs defaultValue="glyph" className="min-h-0 flex-1 gap-0">
        <div className="px-3 pt-3 pb-2">
          <TabsList className={cn(WELL, 'group-data-[orientation=horizontal]/tabs:h-8')}>
            {[
              ['glyph', 'Glyph'],
              ['style', 'Style'],
            ].map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  TILE,
                  'dark:data-[state=active]:bg-input',
                  'group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none'
                )}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="glyph" asChild>
          <SidebarContent className="overflow-x-hidden px-2 pb-4">
            {editorView}
          </SidebarContent>
        </TabsContent>

        <TabsContent value="style" asChild>
          <SidebarContent className="gap-6 overflow-x-hidden px-3 pt-2 pb-6">
            <Section title="Shape">
              <SliderField
                id="font-weight"
                label="Weight"
                value={fontConfig.weight}
                display={`${fontConfig.weight} ${styleName({ weight: fontConfig.weight })}`}
                min={SHIPPED_WEIGHTS[0]}
                max={SHIPPED_WEIGHTS[SHIPPED_WEIGHTS.length - 1]}
                step={100}
                onChange={(value) =>
                  fontConfigDispatch({
                    type: 'change-weight',
                    payload: String(value),
                  })
                }
              />
              <SliderField
                id="font-slant"
                label="Slant"
                value={slant}
                display={`${slant}°`}
                min={0}
                max={MAX_SLANT}
                step={1}
                onChange={(value) =>
                  fontConfigDispatch({ type: 'change-slant', payload: value })
                }
              />
            </Section>

            <Section title="Stroke">
              <Segmented<StrokeStyle>
                label="Stroke"
                value={fontConfig.stroke ?? 'round'}
                options={[
                  { value: 'round', label: 'Round', title: 'Round ends, corners and dots' },
                  { value: 'sharp', label: 'Sharp', title: 'Flat ends, pointed corners and square dots' },
                ]}
                onChange={(payload) => fontConfigDispatch({ type: 'change-stroke', payload })}
              />
            </Section>

            <Section title="Curves">
              <div className="flex items-center gap-2">
                <select
                  aria-label="Curve style"
                  title={CORNER_FIELDS.find(({ value }) => value === corners)?.title}
                  value={corners}
                  onChange={(event) =>
                    fontConfigDispatch({
                      type: 'change-corners',
                      payload: event.target.value as CornerStyle,
                    })
                  }
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs"
                >
                  {CORNER_FIELDS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 44 32"
                  className="h-8 w-11 shrink-0"
                >
                  <path
                    d={strokePath(SAMPLE_CORNER, cornerOptions({ corners, cornerRadius }, 12))}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <SliderField
                id="font-corner-radius"
                label="Radius"
                title="Radius of the curves, as a share of one grid step"
                value={cornerRadius}
                display={`${cornerRadius}%`}
                min={MIN_CORNER_RADIUS}
                max={MAX_CORNER_RADIUS}
                step={5}
                disabled={corners === 'chamfer'}
                onChange={(value) =>
                  fontConfigDispatch({
                    type: 'change-corner-radius',
                    payload: value,
                  })
                }
              />
            </Section>

            <Section title="Width">
              <Segmented
                label="Width"
                value={fontConfig.monospace ? 'mono' : 'prop'}
                options={[
                  { value: 'mono', label: 'Mono' },
                  { value: 'prop', label: 'Proportional' },
                ]}
                onChange={(value) =>
                  fontConfigDispatch({ type: 'change-width', payload: value === 'mono' })
                }
              />
            </Section>

            <Section title="Spacing">
              {SPACING_FIELDS.map(({ key, label, title }) => (
                <SliderField
                  key={key}
                  id={`font-${key}`}
                  label={label}
                  title={title}
                  value={spacing[key]}
                  display={
                    key === 'kerning' && spacing[key] === 0
                      ? 'Off'
                      : String(spacing[key])
                  }
                  {...SPACING_RANGES[key]}
                  disabled={fontConfig.monospace}
                  onChange={(value) =>
                    fontConfigDispatch({
                      type: 'change-spacing',
                      payload: { key, value },
                    })
                  }
                />
              ))}
              {fontConfig.monospace ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Monospace fonts use one fixed width. Switch to Proportional
                  to adjust spacing.
                </p>
              ) : spacingIsCustom ? (
                <button
                  type="button"
                  className="self-start rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => fontConfigDispatch({ type: 'reset-spacing' })}
                >
                  Reset spacing
                </button>
              ) : null}
            </Section>
          </SidebarContent>
        </TabsContent>
      </Tabs>
    </Sidebar>
  );
}
