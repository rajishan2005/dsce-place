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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-sky-500/30 bg-gradient-to-b from-slate-900 to-slate-950 p-8 shadow-2xl shadow-sky-900/40">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-400">
            Kumaraswamy Layout
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
            DSCE Place
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Turn campus into a live pixel canvas. Drop your name, pick a color,
            and leave your mark on DSCE — everyone sees it in real time.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Your name
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
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none ring-sky-500/0 transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            />
          </label>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 active:scale-[0.99]"
          >
            Enter campus canvas
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] text-slate-500">
          No account · ★{MAX_STARS} stars · +1 every {REGEN_SECONDS}s after you
          paint · Limits per IP · Be kind
        </p>
      </div>
    </div>
  );
}
