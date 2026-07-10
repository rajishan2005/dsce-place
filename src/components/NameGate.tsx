"use client";

import { useState } from "react";
import {
  MAX_NAME_LENGTH,
  MAX_STARS,
  REGEN_SECONDS,
  TEAMS,
  TEAM_COLORS,
  type GameMode,
  type TeamId,
} from "@/lib/config";

interface NameGateProps {
  onJoin: (name: string, mode: GameMode, team: TeamId | null) => void;
}

export default function NameGate({ onJoin }: NameGateProps) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("free");
  const [team, setTeam] = useState<TeamId>("CSE");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError("Pick a name so people know who placed that pixel.");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Name max ${MAX_NAME_LENGTH} characters.`);
      return;
    }
    if (mode === "team" && !team) {
      setError("Pick a branch/team.");
      return;
    }
    onJoin(trimmed, mode, mode === "team" ? team : null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="hud-panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-sm font-black text-black shadow-lg shadow-amber-500/30">
            D
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-400/80">
            Kumaraswamy Layout
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-white">
            DSCE Place
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Paint the campus in real time. Free-for-all or branch vs branch.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
              Callsign
            </span>
            <input
              autoFocus
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="e.g. Arjun"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
              Mode
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("free")}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                  mode === "free"
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                    : "border-white/10 bg-black/30 text-white/50 hover:border-white/20"
                }`}
              >
                <div className="font-bold">Free Mode</div>
                <div className="mt-0.5 text-[10px] opacity-70">
                  Solo FFA — personal score
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("team")}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                  mode === "team"
                    ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                    : "border-white/10 bg-black/30 text-white/50 hover:border-white/20"
                }`}
              >
                <div className="font-bold">Team Mode</div>
                <div className="mt-0.5 text-[10px] opacity-70">
                  Branch war — team scores
                </div>
              </button>
            </div>
          </div>

          {mode === "team" && (
            <div>
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                Branch / Team
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {TEAMS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTeam(t)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-left text-[11px] font-bold ${
                      team === t
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/10 bg-black/30 text-white/55"
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-white/25"
                      style={{ backgroundColor: TEAM_COLORS[t] }}
                    />
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-white/30">
                Your whole branch shares one paint color.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 active:scale-[0.99]"
          >
            Drop in
          </button>
        </form>

        <p className="mt-4 text-center text-[10px] text-white/30">
          ★{MAX_STARS} stars · +1 / {REGEN_SECONDS}s · IP locked · Be kind
        </p>
      </div>
    </div>
  );
}
