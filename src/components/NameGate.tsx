"use client";

import { useState } from "react";
import { MAX_NAME_LENGTH, MAX_STARS, REGEN_SECONDS } from "@/lib/config";

interface NameGateProps {
  onJoin: (name: string) => void;
}

export default function NameGate({ onJoin }: NameGateProps) {
  const [name, setName] = useState("");
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
    onJoin(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="hud-panel w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 text-center">
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
            Full-campus pixel war. Enter a callsign and paint in real time.
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
              placeholder="e.g. Arjun from CSE"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30"
            />
          </label>
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
