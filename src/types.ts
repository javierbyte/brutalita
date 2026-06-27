export type CharLayer = [number, number][];
export type CharLayers = CharLayer[];

// Editor grid resolution: 2 columns x 4 rows of segments.
export const SEGMENTS = [2, 4] as const;

export type FontWeightType = 300 | 400 | 700;

export type FontConfig = {
  name: string;
  weight: FontWeightType;
  height: number;
  monospace: boolean;
};

export type FontDefinition = {
  [char: string]: CharLayers;
};
