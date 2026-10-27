// Who waits at each stop along the walk, and what they say as you come up: a word from someone in
// that part of the story (the card beside them says what it is). Each has their own drawing, so no
// two stops share a face. `drawing` is a cell of public/planet/tex/townsfolk.webp: the first row is
// the shopkeeper (0), the woman with her shopping (1), the man in overalls (2) and the schoolgirl
// (3 on, see lib/gift.ts); the second row (15 on) the rest, left to right.
//
// Stopping by someone (or clicking them) has them say their one line, `says`, with `react` popping up
// beside them.

export const enum Folk {
  Shopkeeper = 0,
  Shopper = 1,
  Overalls = 2,
  Glasses = 15,
  Gardener = 16,
  HiVis = 17,
  Doctor = 18,
  Student = 19,
  Blazer = 20,
  Guard = 21,
  Tote = 22,
  Cane = 23,
  Postmaster = 24,
}

export const townsfolk: Record<string, { drawing: Folk; who: string; says: string; react: string }> = {
  origins: { drawing: Folk.Glasses, who: "Professor", says: "Welcome to town! Top of the class, this one. Mostly.", react: "🎓" },
  inventory: { drawing: Folk.Shopkeeper, who: "Shopkeeper", says: "Need a tool? I've got plenty.", react: "🔧" },
  "exp-adani": { drawing: Folk.Overalls, who: "Old colleague", says: "Two years of wind and sun. Good times.", react: "🌬️" },
  "exp-smu": { drawing: Folk.Student, who: "Classmate", says: "Late nights in the lab, those were.", react: "📚" },
  "exp-ezer": { drawing: Folk.Cane, who: "Alumnus", says: "At my age, finding old friends is a gift.", react: "🤝" },
  "exp-citadel": { drawing: Folk.Shopper, who: "Visitor", says: "Checked in within a minute. Easy!", react: "⏱️" },
  shrine: { drawing: Folk.Postmaster, who: "Postmaster", says: "That's the whole walk. Thanks for coming by!", react: "✉️" },
};
