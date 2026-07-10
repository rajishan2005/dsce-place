"use client";

interface ColorPaletteProps {
  colors: readonly string[];
  selected: string;
  onSelect: (color: string) => void;
  compact?: boolean;
}

export default function ColorPalette({
  colors,
  selected,
  onSelect,
  compact = false,
}: ColorPaletteProps) {
  return (
    <div className={`flex flex-wrap items-center justify-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {colors.map((c) => {
        const active = c === selected;
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
