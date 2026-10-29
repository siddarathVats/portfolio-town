"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { EMOTES, emoteGlyph, players, type EmoteEvent } from "@/lib/players";

const serverState = players.getState();

/** Who else is playing: a live count, their names, your own name, and emotes that pop up for everyone. */
export function PlayersHud() {
  const st = useSyncExternalStore(players.subscribe, players.getState, () => serverState);
  const [toasts, setToasts] = useState<EmoteEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => players.connect(), []);
  useEffect(() => {
    const timers = new Set<number>();
    const off = players.onEmote((e) => {
      // (your own pop up over your head instead: see Runner)
      if (e.id === players.getState().me?.id) return;
      setToasts((t) => [...t.slice(-3), e]);
      const id = window.setTimeout(() => {
        timers.delete(id);
        setToasts((t) => t.filter((x) => x.key !== e.key));
      }, 2600);
      timers.add(id);
    });
    return () => {
      off();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  /** The site's address to someone else: the phone's own share sheet where there is one, else copied. */
  const invite = async () => {
    const url = `${location.origin}/`;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, text: "Walk through this little town with me", url });
      } catch {
        // (closed without sharing)
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const me = st.me;
  if (!me) return null;
  const others = st.players.filter((p) => p.id !== me.id);
  const count = others.length + 1;

  return (
    <aside className={`party ${open ? "party--open" : ""}`} aria-label="Players online">
      <div className="party__toasts" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.key} className="party__toast" style={{ ["--c" as string]: t.color }}>
            <span className="party__glyph" aria-hidden="true">
              {emoteGlyph(t.emote)}
            </span>
            <span>{t.id === me.id ? "You" : t.name}</span>
          </p>
        ))}
      </div>

      <button className="party__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`party__live ${st.connected ? "party__live--on" : ""}`} aria-hidden="true" />
        <span className="party__count">
          {count} {count === 1 ? "player" : "players"} online
        </span>
      </button>

      <div className="party__body">
        <ul className="party__list">
          <li className="party__row">
            <span className="party__swatch" style={{ background: me.color }} aria-hidden="true" />
            <span className="party__name">
              {me.name} <em>(you)</em>
            </span>
            <button className="party__reroll" onClick={() => players.reroll()} aria-label="Pick a new name">
              🎲
            </button>
          </li>
          {others.slice(0, 6).map((p) => (
            <li key={p.id} className="party__row">
              <span className="party__swatch" style={{ background: p.color }} aria-hidden="true" />
              <span className="party__name">{p.name}</span>
            </li>
          ))}
          {others.length > 6 && <li className="party__more">+{others.length - 6} more</li>}
          {others.length === 0 && (
            <li>
              <button className="party__invite" onClick={() => void invite()}>
                {copied ? "Link copied ✓ send it to a friend" : "Share the link to play together ↗"}
              </button>
            </li>
          )}
        </ul>
      </div>

      <div className="party__emotes" role="group" aria-label="Send an emote to everyone">
        {EMOTES.map((e) => (
          <button key={e.id} className="party__emote" onClick={() => players.emote(e.id)} aria-label={e.label} title={e.label}>
            {e.glyph}
          </button>
        ))}
      </div>
    </aside>
  );
}
