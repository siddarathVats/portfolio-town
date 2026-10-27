"use client";

import { useState } from "react";
import { person, experience } from "@/content/portfolio";
import { scrollToId, scrollToTop } from "@/lib/scroll";
import { SoundToggle } from "./SoundToggle";
import { AutoToggle } from "./AutoToggle";
import { WeatherToggle } from "./WeatherToggle";

const LINKS = [
  { label: "Home", id: "home" },
  { label: "About", id: "origins" },
  { label: "Inventory", id: "inventory" },
  { label: "Experience", id: `exp-${experience[0].slug}` },
  { label: "Contact", id: "shrine" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const go = (id: string, label: string) => {
    setOpen(false);
    scrollToId(id, label);
  };
  return (
    <header className="header">
      <button className="mark" onClick={scrollToTop} aria-label={`${person.name}, back to the start`}>
        <span className="mark__glyph" aria-hidden="true" />
        <span className="mark__name">{person.name}</span>
      </button>
      <div className="header__right">
        <AutoToggle />
        <SoundToggle />
        <nav aria-label="Journey">
        <button className="menu-toggle" aria-expanded={open} aria-controls="nav-list" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
        <ul id="nav-list" className={`nav ${open ? "nav--open" : ""}`}>
          {/* (phones: the music switch lives here, to keep the header to three buttons) */}
          <li className="nav__sound">
            <SoundToggle variant="menu" />
          </li>
          <li className="nav__wx">
            <WeatherToggle variant="menu" />
          </li>
          {LINKS.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(l.id, l.label);
                }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        </nav>
      </div>
    </header>
  );
}
