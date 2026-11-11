'use client';

import type { ReactNode } from 'react';

import { Sidebar, SidebarContent } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { DEFAULT_CORNER_RADIUS, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS } from '../corners';
import type { CornerStyle, StrokeStyle } from '../corners';
import type { FontConfigDispatch } from '../font-config';
import { MAX_SLANT } from '../slant';
import { resolveSpacing, SPACING_RANGES } from '../spacing';
import type { SpacingKey } from '../spacing';
import type { FontConfig } from '../types';
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
        <div className="p-2">
          <TabsList className="w-full">
            <TabsTrigger value="glyph">Glyph</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
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
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={fontConfig.stroke ?? 'round'}
                onValueChange={(value) => {
                  if (value)
                    fontConfigDispatch({
                      type: 'change-stroke',
                      payload: value as StrokeStyle,
                    });
                }}
                className="w-full"
              >
                <ToggleGroupItem
                  value="round"
                  title="Round ends, corners and dots"
                  className="flex-1 text-xs"
                >
                  Round
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="sharp"
                  title="Flat ends, pointed corners and square dots"
                  className="flex-1 text-xs"
                >
                  Sharp
                </ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <Section title="Curves">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={corners}
                onValueChange={(value) => {
                  if (value)
                    fontConfigDispatch({
                      type: 'change-corners',
                      payload: value as CornerStyle,
                    });
                }}
                className="w-full"
              >
                {CORNER_FIELDS.map(({ value, label, title }) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    title={title}
                    className="flex-auto px-2 text-xs"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
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
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={fontConfig.monospace ? 'mono' : 'prop'}
                onValueChange={(value) => {
                  if (value)
                    fontConfigDispatch({
                      type: 'change-width',
                      payload: value === 'mono',
                    });
                }}
                className="w-full"
              >
                <ToggleGroupItem value="mono" className="flex-1 text-xs">
                  Mono
                </ToggleGroupItem>
                <ToggleGroupItem value="prop" className="flex-1 text-xs">
                  Proportional
                </ToggleGroupItem>
              </ToggleGroup>
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
