// Mapping between the sim's 320x200 pixel space (y down) and world units (y up).

/** World units per sim pixel. */
export const S = 0.1;
export const CX = 160;
export const CY = 107;

/** Sim y of the ground surface (top of the playfield). */
export const FIELD_TOP = 14;
export const FIELD_BOTTOM = 200;

/** How far tunnels are carved into the front face. */
export const TUNNEL_DEPTH = 1.7;
/** Depth at which characters move inside tunnels. */
export const ACTOR_Z = -0.95;

export const wx = (x: number) => (x - CX) * S;
export const wy = (y: number) => -(y - CY) * S;

/** Centre of a 16x15 sprite whose top-left is at (x, y). */
export const spriteCx = (x: number) => wx(x + 8);
export const spriteCy = (y: number) => wy(y + 7.5);
