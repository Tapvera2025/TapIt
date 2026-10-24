declare module 'liquid-gl' {
  export interface LiquidGlassLens {
    destroy(): void;
  }

  export interface LiquidGlassOptions {
    target: string;
    snapshot?: string;
    resolution?: number;
    refraction?: number;
    bevelDepth?: number;
    bevelWidth?: number;
    frost?: number;
    shadow?: boolean;
    specular?: boolean;
    draggable?: boolean;
    interaction?: 'none' | 'fluid';
    interactionStrength?: number;
    interactionRadius?: number;
    interactionViscosity?: number;
    reveal?: 'fade';
    tint?: string;
    zIndex?: number;
  }

  export default function liquidGL(
    options: LiquidGlassOptions,
  ): LiquidGlassLens | LiquidGlassLens[] | undefined;
}
