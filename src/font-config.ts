import type { FontConfig } from './types';

// App-layer font configuration state. Kept separate from src/app.tsx so the
// app-layer sidebar UI can share the action type without a circular import.

export const DEFAULT_FONT_CONFIG: FontConfig = {
  name: 'Brutalita Custom',
  weight: 400,
  height: 1.888,
  monospace: true,
  designer: 'javierbyte',
  designerURL: 'https://javier.xyz',
};

export type FontConfigAction =
  | { type: 'rename'; payload: string }
  | { type: 'change-weight'; payload: string }
  | { type: 'change-width'; payload: boolean }
  | { type: 'change-designer'; payload: string }
  | { type: 'change-designer-url'; payload: string }
  | { type: 'reset'; payload: FontConfig };

export type FontConfigDispatch = (action: FontConfigAction) => void;

export function fontConfigReducer(state: FontConfig, action: FontConfigAction) {
  switch (action.type) {
    case 'rename':
      return { ...state, name: action.payload };
    case 'change-weight': {
      const weight = Number(action.payload);
      const next = { ...state };
      if (weight === 300 || weight === 400 || weight === 700) {
        next.weight = weight;
      }
      return next;
    }
    case 'change-width':
      return {
        ...state,
        monospace: action.payload,
      };
    case 'change-designer':
      return { ...state, designer: action.payload };
    case 'change-designer-url':
      return { ...state, designerURL: action.payload };
    case 'reset':
      return action.payload;
    default:
      throw new Error();
  }
}
