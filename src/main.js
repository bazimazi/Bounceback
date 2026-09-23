import { createApp } from "./game/app.js";

const canvas = document.querySelector("#view");
const overlay = document.querySelector("#overlay");
const live = document.querySelector("#live");
createApp({ canvas, overlay, live });
