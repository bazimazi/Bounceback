import { createApp } from "./game/app.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const overlay = document.querySelector<HTMLElement>("#overlay")!;
const live = document.querySelector<HTMLElement>("#live")!;
createApp({ canvas, overlay, live });
