"use client";

interface ColorPaletteProps {
  colors: readonly string[];
  selected: string | null;
  onSelect: (color: string) => void;
  compact?: boolean;
  /** Flash border to guide user to pick a color */
  highlight?: boolean;
}

export default function ColorPalette({
  colors,
  selected,
  onSelect,
  compact = false,
  highlight = false,
}: ColorPaletteProps) {
  return (
    <div
      className={`flex flex-wrap items-center justify-center rounded-lg p-1.5 transition ${
        compact ? "gap-1" : "gap-1.5"
      } ${
        highlight
          ? "palette-nudge ring-2 ring-amber-400/90 bg-amber-400/10"
          : ""
      }`}
    >
      {colors.map((c) => {
        const active = selected != null && c === selected;
        return (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onSelect(c)}
            className={`${
              compact ? "h-6 w-6" : "h-8 w-8"
            } rounded-md border-2 transition active:scale-95 ${
              active
                ? "scale-110 border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.55)]"
                : highlight
                  ? "border-amber-300/70 hover:border-amber-200"
                  : "border-white/25 hover:border-white/70"
            }`}
            style={{ backgroundColor: c }}
            aria-label={`Color ${c}`}
            aria-pressed={active}
          />
        );
      })}
    </div>
  );
}
