export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

export type Surface = "stone" | "ice" | "spring" | "bumper" | "door" | "ghost";

/** Anything the ball can collide with: level solids, closed doors, and movers. */
export interface Box extends Rect {
  id?: string;
  surface?: Surface;
  grate?: boolean;
  launch?: number;
  bump?: number;
}

export interface Solid extends Box {
  id: string;
}

export type DoorLogic = "or" | "and" | "and-latch";

export interface Door extends Rect {
  id: string;
  logic: DoorLogic;
}

export type PlateMode = "hold" | "latch" | "pulse" | "delay";
export type PlateWho = "any" | "ghost" | "present";

export interface Plate extends Rect {
  id: string;
  targets?: string[];
  mode: PlateMode;
  who: PlateWho;
  duration?: number;
  delay?: number;
  requires?: string;
}

export interface MoverDef extends Rect {
  id: string;
  axis: "x" | "y";
  distance: number;
  period: number;
  requires?: string;
  surface?: Surface;
}

export interface Mover extends MoverDef {
  clock: number;
}

export interface Plaque extends Point {
  text: string;
}

export interface Chapter {
  id: number;
  name: string;
  line: string;
}

export interface Level {
  id: string;
  name: string;
  chapter: number;
  objective: string;
  caption: string;
  echoSeconds: number;
  maxGhosts: number;
  par: { ghosts: number; seconds: number };
  spawn: Point;
  ghostSolid: boolean;
  solids: Solid[];
  doors: Door[];
  plates: Plate[];
  movers?: MoverDef[];
  hazards?: Rect[];
  goal: Rect;
  plaques?: Plaque[];
  hints: string[];
}

export interface Ball extends Point {
  vx: number;
  vy: number;
  r: number;
  prevX: number;
  prevY: number;
  alive: boolean;
  grounded: boolean;
  groundId: string | null;
  surface: Surface;
  springLock: number;
  dropping: boolean;
}

export interface Ghost {
  frames: Point[];
}

export interface PlateState {
  occupied: boolean;
  active: boolean;
  latched: boolean;
  until: number;
  arm: number;
  pending: boolean;
  rejected: boolean;
  wasOccupied: boolean;
  /** Set by the app once it has played the activation cue. */
  heard?: boolean;
}

export interface DoorState {
  open: boolean;
  latched: boolean;
}

export interface Session {
  level: Level;
  frame: number;
  time: number;
  ball: Ball;
  ghosts: Ghost[];
  recording: Point[];
  plates: Record<string, PlateState>;
  doors: Record<string, DoorState>;
  movers: Mover[];
  won: boolean;
  dead: boolean;
  winFrame: number;
  /** Set by the app when the echo clock runs out. */
  expired?: boolean;
}

export interface Input {
  x?: number;
  drop?: boolean;
  sensitivity?: number;
}

export type SimEvent =
  | { type: "bounce"; speed: number; axis: "x" | "y" }
  | { type: "bumper"; speed: number }
  | { type: "spring"; speed: number }
  | { type: "door"; id: string; open: boolean }
  | { type: "die" }
  | { type: "win" };

export type EchoRejection = "won" | "full" | "short";

export interface EchoResult {
  ok: boolean;
  reason?: EchoRejection;
}

/* ---------- persistence ---------- */

export type Medal = "clear" | "lean" | "swift";

export interface Settings {
  volume: number;
  reducedMotion: boolean;
  highContrast: boolean;
  shake: boolean;
  haptics: boolean;
  sensitivity: number;
  scale: number;
}

export interface ClearedRecord {
  medals: Medal[];
  bestTime: number;
  bestGhosts: number;
  time: number;
  ghosts: number;
}

export interface Save {
  version: number;
  cleared: Record<string, ClearedRecord>;
  seenChapter: Record<number, boolean>;
  seenCaption: Record<string, boolean>;
  hints: Record<string, number>;
  settings: Settings;
}

/* ---------- presentation ---------- */

export type Mode = "title" | "facility" | "settings" | "confirm" | "chapter" | "pause" | "clear" | "play";

export type ParticleKind = "dot" | "ring" | "shard" | "spark" | "ripple";

export interface Particle extends Point {
  life: number;
  decay: number;
  vx: number;
  vy: number;
  grav: number;
  drag: number;
  rot: number;
  vr: number;
  size: number;
  kind: ParticleKind;
  add: boolean;
  expand: number;
  color: string;
  grow?: number;
  alpha?: number;
}

export interface Camera {
  scale: number;
  ox: number;
  oy: number;
}

export interface Insets {
  top: number;
  bottom: number;
  side?: number;
}

export interface Transition {
  phase: "out" | "in";
  t: number;
  cx?: number;
  cy?: number;
  fn?: () => void;
}

export interface ScreenFx {
  trauma: number;
  kickX: number;
  kickY: number;
  rewind: number;
  rewindFrames: Point[] | null;
  rewindColor: string;
  flash: number;
  flashColor: string;
}

export interface BallFx {
  qx: number;
  qy: number;
  vx: number;
  vy: number;
  roll: number;
  rimFlash: number;
}

export interface ClearResult {
  seconds: number;
  ghosts: number;
  earned: Medal[];
  medals: Medal[];
  best: boolean;
  traces: number;
}

export interface AppState {
  mode: Mode;
  returnMode?: Mode;
  settings: Settings;
  levelIndex: number;
  session: Session | null;
  speed: number;
  hintOpen: boolean;
  message: string;
  messageT: number;
  fx: ScreenFx;
  ballFx: BallFx;
  trails: Point[][];
  nowTrail: Point[];
  previousBall: Point | null;
  renderAlpha: number;
  particles: Particle[];
  doorAnim: Record<string, number>;
  doorVel: Record<string, number>;
  plateAnim: Record<string, number>;
  springAnim: Record<string, number>;
  time: number;
  freeze: number;
  levelT0: number;
  spawnT: number;
  winT0: number;
  winReveal: number;
  clearT0: number;
  attempts: number;
  result: ClearResult | null;
  sig: string;
  screenKey: string;
  trans: Transition | null;
  cam: Camera | null;
  insets: Insets;
  measured: boolean;
  lastTick: number;
  lastChips: number;
}
