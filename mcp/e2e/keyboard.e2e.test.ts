/**
 * The library's keyboard contract, end to end against `wrangler dev`.
 *
 * Landing focuses the filter, typing narrows the catalog, Tab reaches the best
 * match, Enter opens it, and Enter copies the install prompt. Every run records
 * video, so a reviewer can watch the flow rather than infer it from assertions.
 */
import { expect, test, type Page } from "@playwright/test";

const filter = (page: Page) => page.getByRole("searchbox", { name: "Filter skills" });
const matches = (page: Page) => page.locator("#catalog li:not([hidden]) h2 a");
const everyRow = (page: Page) => page.locator("#catalog li");
const copyButton = (page: Page) => page.getByRole("button", { name: "Copy install prompt" });
// Slow enough to watch in the recording, fast enough to stay a test.
const typing = { delay: 70 };

test("land, filter, Tab, Enter, Enter: the whole flow on the keyboard alone", async ({ page }) => {
  await page.goto("/");
  const total = await everyRow(page).count();

  await expect(filter(page)).toBeFocused();
  // Nothing typed yet, so the status line stays out of the way.
  await expect(page.locator("#search-status")).toBeHidden();
  // Focusing on landing must not scroll the page out from under the reader.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.keyboard.type("git-work", typing);
  await expect(matches(page).first()).toHaveText("git-worktree");
  await expect(page.locator("#search-status")).toContainText(`of ${total} skills`);

  await page.keyboard.press("Tab");
  await expect(matches(page).first()).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/skills\/git-worktree\/$/);

  await expect(copyButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#copy-status")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Install the git-worktree skill",
  );
});

test("descriptions are searchable and the filtered view survives a reload", async ({ page }) => {
  await page.goto("/");
  const first = everyRow(page).first();
  const name = (await first.locator("a").innerText()).toLowerCase();
  const description = await first.locator("p").innerText();
  // A word the description carries and the name does not: a name-only filter
  // would drop this row instead of keeping it.
  const word = description.toLowerCase().split(/[^a-z]+/).find((token) => token.length > 5 && !name.includes(token));
  expect(word, "the first row needs a description word outside its name").toBeTruthy();

  await page.keyboard.type(word!, typing);
  await expect(first).toBeVisible();
  await expect(first.locator("mark").first()).toBeVisible();
  // The address bar trails the keystrokes by a debounce.
  await expect(page).toHaveURL(new RegExp(`\\?q=${word}$`));

  await page.reload();
  await expect(filter(page)).toHaveValue(word!);
  await expect(first).toBeVisible();
});

test("an empty result says so, and Escape restores the full catalog", async ({ page }) => {
  await page.goto("/");
  const total = await everyRow(page).count();

  await page.keyboard.type("nosuchskillanywhere", typing);
  await expect(matches(page)).toHaveCount(0);
  await expect(page.locator("#search-status")).toContainText("No skills match");

  await page.keyboard.press("Escape");
  await expect(filter(page)).toHaveValue("");
  await expect(matches(page)).toHaveCount(total);
  await expect(page.locator("#search-status")).toBeHidden();
  await expect(page).not.toHaveURL(/\?q=/);

  // Escape on an already-empty field is a no-op, not a blur-then-refocus.
  await page.keyboard.press("Escape");
  await expect(filter(page)).toBeFocused();
});

test("arrows walk the results and / comes back to the filter", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("ArrowDown");
  await expect(matches(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(matches(page).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(matches(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(filter(page)).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(matches(page).nth(0)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filter(page)).toBeFocused();

  await filter(page).blur();
  await page.keyboard.press("/");
  await expect(filter(page)).toBeFocused();
});

test("Enter and the arrows follow the order on screen, not the catalog order", async ({ page }) => {
  await page.goto("/");
  // "git" ranks a name match above description-only matches that sort earlier
  // alphabetically, so screen order and catalog order disagree here.
  await page.keyboard.type("git", typing);
  await expect(matches(page)).not.toHaveCount(1);
  const top = await matches(page).first().innerText();

  await page.keyboard.press("ArrowDown");
  await expect(matches(page).first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(filter(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/skills/${top}/$`));
});

test("Enter on an empty filter opens nothing", async ({ page }) => {
  await page.goto("/");
  await expect(filter(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(filter(page)).toBeFocused();
});

test("Escape on a skill page hands the keyboard back to the filtered list", async ({ page }) => {
  await page.goto("/?q=git-work");
  await expect(filter(page)).toHaveValue("git-work");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/skills\/git-worktree\/$/);

  // An open prompt is the first thing Escape unwinds, before the page itself.
  await page.locator("#prompt-preview summary").click();
  await expect(page.locator("#install-prompt")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#install-prompt")).toBeHidden();
  await expect(page).toHaveURL(/\/skills\/git-worktree\/$/);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\?q=git-work$/);
  await expect(filter(page)).toHaveValue("git-work");
});

test("the pointer path is untouched: click through and click copy", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "git-worktree", exact: true }).click();
  await expect(page).toHaveURL(/\/skills\/git-worktree\/$/);

  await copyButton(page).click();
  await expect(page.locator("#copy-status")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Install the git-worktree skill",
  );
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the catalog stays a complete, linked list and hides the dead field", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#search")).toBeHidden();
    expect(await everyRow(page).count()).toBeGreaterThan(1);

    await everyRow(page).first().locator("a").click();
    await expect(page).toHaveURL(/\/skills\/[a-z0-9-]+\/$/);
    await expect(copyButton(page)).toBeVisible();
  });
});

test.describe("on a touch device", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("landing leaves the field alone instead of opening the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(filter(page)).toBeVisible();
    await expect(filter(page)).not.toBeFocused();
    // Nor does it advertise keys this device has no way to press.
    await expect(page.locator("#search .hint")).toBeHidden();

    await filter(page).fill("git-work");
    await expect(matches(page).first()).toHaveText("git-worktree");
  });
});
