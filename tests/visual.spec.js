import { test, expect } from "@playwright/test";

const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  // Font availability must not make the game or these checks depend on a network.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No renderer or UI exceptions").toEqual([]);
});

test("title, chapter entry, bouncing and completion work together", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little momentum. A second chance." })).toBeVisible();
  await page.getByRole("button", { name: "Enter the observatory" }).click();
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.locator(".hud h1")).toHaveText("First Bounce");
  await page.keyboard.down("ArrowRight");
  await expect(page.getByText("Chamber resolved", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.up("ArrowRight");
  await page.getByRole("button", { name: "Next chamber" }).click();
  await expect(page.locator(".hud h1")).toHaveText("Keep the Door");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(650);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator(".chip[data-i='0']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`responsive controls and preferences at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const start = page.getByRole("button", { name: "Enter the observatory" });
    await expect(start).toBeInViewport();
    expect(await page.locator(".title-screen").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Reduced motion" }).check();
    await page.getByRole("switch", { name: "High contrast" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("body")).toHaveClass(/reduce/);
    await start.click();
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(page.locator(".hud")).toBeInViewport();
    await expect(page.locator(".dock")).toBeInViewport();
    expect(await page.locator(".dock").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test("all 16 chambers render, animate, and respect reduced motion", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { levels } = await import("/src/game/levels.js");
    const { createSession, step, commitEcho } = await import("/src/game/sim.js");
    const { drawFrame, fitCamera } = await import("/src/game/render.js");
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext("2d");
    return levels.map((level) => {
      const session = createSession(level);
      for (let i = 0; i < 50; i++) step(session, { x: 1 });
      if (level.maxGhosts) {
        commitEcho(session);
        for (let i = 0; i < 10; i++) step(session, { x: 1 });
      }
      const state = {
        mode: "play", session, settings: { reducedMotion: false, highContrast: false, shake: false },
        fx: { trauma: 0, kickX: 0, kickY: 0, rewind: 0, flash: 0 },
        ballFx: { qx: 0, qy: 0, roll: 0, rimFlash: 0 },
        particles: [], trails: [], nowTrail: [], doorAnim: {}, plateAnim: {}, springAnim: {},
        levelT0: -10, spawnT: -10, renderAlpha: 0.5,
      };
      const view = { width: 1280, height: 720, dpr: 1, state, session,
        cam: fitCamera(1280, 720, { top: 0, bottom: 0, side: 0 }) };
      const render = (now) => {
        drawFrame(ctx, { ...view, now });
        return canvas.toDataURL();
      };
      const first = render(10), second = render(11);
      state.settings.reducedMotion = true;
      const stillA = render(10), stillB = render(11);
      state.settings.highContrast = true;
      render(12);
      return { id: level.id, animated: first !== second, reducedStable: stillA === stillB };
    });
  });
  expect(results).toHaveLength(16);
  for (const result of results) {
    expect(result.animated, `${result.id} animates`).toBe(true);
    expect(result.reducedStable, `${result.id} reduced motion is stationary`).toBe(true);
  }
});
