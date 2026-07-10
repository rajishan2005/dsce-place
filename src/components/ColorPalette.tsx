"use client";

interface ColorPaletteProps {
  colors: readonly string[];
  selected: string;
  onSelect: (color: string) => void;
}

export default function ColorPalette({ colors, selected, onSelect }: ColorPaletteProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => {
        const active = c === selected;
        return (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onSelect(c)}
            className={`h-8 w-8 rounded-md border-2 transition ${
              active
                ? "scale-110 border-white shadow-lg shadow-sky-500/40"
                : "border-white/20 hover:border-white/60"
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
