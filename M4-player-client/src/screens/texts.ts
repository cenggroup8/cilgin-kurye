// All words the screens show, in one place, so a language change touches one file.

export const TEXT = {
  join: {
    title: "Join the game",
    name: "Your name",
    code: "Game code",
    button: "Join",
    busy: "Joining…",
    nameEmpty: "Type your name.",
    codeInvalid: "The game code has 6 digits.",
  },
  refusal: {
    bad_code: "Wrong game code. Check the number on the screen.",
    full: "The game is full.",
    bad_hello: "Could not join. Reload the page and try again.",
  },
  lobby: {
    title: "Choose your team",
    waiting: "Waiting for the game to start…",
    full: "Full",
    yours: "Your team",
  },
} as const;
