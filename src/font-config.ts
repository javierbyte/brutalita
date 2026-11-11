import type { FontConfig } from './types';
import { parseWeight } from './weights';
import { isValidCornerRadius } from './corners';
import type { CornerStyle, StrokeStyle } from './corners';
import { isValidSlant } from './slant';
import { isValidSpacing } from './spacing';
import type { SpacingKey } from './spacing';

// App-layer font configuration state. Kept separate from src/app.tsx so the
// app-layer sidebar UI can share the action type without a circular import.

export const DEFAULT_FONT_CONFIG: FontConfig = {
  name: 'Brutalita Custom',
  weight: 400,
  height: 2,
  monospace: true,
  slant: 0,
  designer: 'javierbyte',
  designerURL: 'https://javier.xyz',
};

export type FontConfigAction =
  | { type: 'rename'; payload: string }
  | { type: 'change-weight'; payload: string }
  | { type: 'change-width'; payload: boolean }
  | { type: 'change-slant'; payload: number }
  | { type: 'change-stroke'; payload: StrokeStyle }
  | { type: 'change-corners'; payload: CornerStyle }
  | { type: 'change-corner-radius'; payload: number }
  | { type: 'change-spacing'; payload: { key: SpacingKey; value: number } }
  | { type: 'reset-spacing' }
  | { type: 'change-designer'; payload: string }
  | { type: 'change-designer-url'; payload: string }
  | { type: 'reset'; payload: FontConfig };

export type FontConfigDispatch = (action: FontConfigAction) => void;

export function fontConfigReducer(
  state: FontConfig,
  action: FontConfigAction
): FontConfig {
  switch (action.type) {
    case 'rename':
      return { ...state, name: action.payload };
    case 'change-weight': {
      const weight = parseWeight(action.payload);
      return weight === null ? state : { ...state, weight };
    }
    case 'change-width':
      return {
        ...state,
        monospace: action.payload,
      };
    case 'change-designer':
      return { ...state, designer: action.payload };
    case 'change-slant':
      return isValidSlant(action.payload) ? { ...state, slant: action.payload } : state;
    case 'change-stroke':
      return { ...state, stroke: action.payload };
    case 'change-corners':
      return { ...state, corners: action.payload };
    case 'change-corner-radius':
      return isValidCornerRadius(action.payload)
        ? { ...state, cornerRadius: action.payload }
        : state;
    case 'change-spacing': {
      const { key, value } = action.payload;
      return isValidSpacing(key, value) ? { ...state, [key]: value } : state;
    }
    case 'reset-spacing': {
      // Dropped rather than set to their defaults, so the exported source
      // keeps following the letter gap instead of pinning today's numbers.
      const { spacing, wordSpacing, kerning, ...rest } = state;
      return rest;
    }
    case 'change-designer-url':
      return { ...state, designerURL: action.payload };
    case 'reset':
      return action.payload;
    default:
      throw new Error();
  }
}
