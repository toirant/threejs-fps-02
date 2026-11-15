// Emberline's look plan, in one place. Dusk over a rusted foundry yard: a deep
// blue-grey sky, warm sodium lamps, ember-orange accents on rusted steel and
// the bomb sites. Every colour in the game and the page is one of these six.
export const PALETTE = {
  canvas: '#191d26',
  surface: '#232833',
  hairline: '#313947',
  ink: '#e8e4d8',
  muted: '#8b95a5',
  accent: '#ff7a1a',
  rust: '#a34a24',
  lamp: '#ffb347',
  slate: '#3d5a73',
};

export function shade(name) {
  return PALETTE[name];
}
