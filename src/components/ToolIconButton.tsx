"use client";

/**
 * Tool / power-up button with custom art and bottom-up color refill on cooldown.
 * Greyscale base; color layer clip-path grows from bottom as cooldown completes.
 */
export default function ToolIconButton({
  iconSrc,
  label,
  cost,
  selected,
  fill = 1,
  cdLabel = null,
  active = false,
  disabled = false,
  onClick,
}: {
  iconSrc: string;
  label: string;
  cost: number;
  selected?: boolean;
  /** 0 = fully grey (just used), 1 = full color (ready) */
  fill?: number;
  cdLabel?: string | null;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const clamped = Math.max(0, Math.min(1, fill));
  const onCd = clamped < 0.999 && Boolean(cdLabel);
  // Unfilled portion from top stays grey; color fills from bottom
  const greyTopPct = (1 - clamped) * 100;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !onCd}
      title={
        onCd
          ? `${label} · cooldown ${cdLabel}`
          : `${label} · ${cost}★`
      }
      className={`group relative flex w-[52px] flex-col items-center gap-0.5 rounded-lg px-1 py-1 transition ${
        selected || active
          ? "bg-white/15 ring-1 ring-amber-400/50"
          : "bg-white/[0.03] hover:bg-white/[0.08]"
      } ${onCd ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className="relative block h-9 w-9 overflow-hidden rounded-md">
        {/* Greyscale base (drained portion) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconSrc}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
          style={{
            filter: "grayscale(1) brightness(0.72)",
            opacity: onCd ? 0.9 : 0,
          }}
        />
        {/* Color layer — revealed from bottom as fill increases */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconSrc}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain transition-[clip-path] duration-1000 linear"
          style={{
            clipPath: onCd
              ? `inset(${greyTopPct}% 0 0 0)`
              : "inset(0 0 0 0)",
            opacity: 1,
          }}
        />
        {onCd && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-black/55 py-px text-[8px] font-bold tabular-nums leading-none text-amber-100/90">
            {cdLabel}
          </span>
        )}
      </span>
      <span
        className={`text-[8px] font-bold leading-none ${
          onCd
            ? "text-white/30"
            : selected || active
              ? "text-white"
              : "text-white/45 group-hover:text-white/70"
        }`}
      >
        {onCd ? cdLabel : `${cost}★`}
      </span>
    </button>
  );
}
