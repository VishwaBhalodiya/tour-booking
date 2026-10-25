// Run only against the isolated preview started with node src/preview.js in server/.
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
const expect = baseExpect.configure({ timeout: 30000 });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const customer = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const admin = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await customer.newPage(),
  panel = await admin.newPage();
async function assetsReady(p) {
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
    const hero = document.querySelector(".hero");
    if (hero) {
      const url =
        getComputedStyle(hero).backgroundImage.match(
          /url\(["']?([^"')]+)/,
        )?.[1];
      if (url) {
        const image = new Image();
        image.src = url;
        await image.decode();
      }
    }
  });
}
for (const p of [page, panel]) p.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("docs/screenshots", { recursive: true });
try {
  await page.goto("http://127.0.0.1:5173/");
  await expect(
    page.getByRole("heading", { name: "Somewhere new. Something you." }),
  ).toBeVisible();
  await expect(page.locator(".destination")).toHaveCount(4);
  await expect(page.locator(".package-card")).toHaveCount(3);
  await assetsReady(page);
  await page.screenshot({
    path: "docs/screenshots/home-desktop.png",
    fullPage: true,
  });
  const packageId = await page
    .locator(".package-card a")
    .first()
    .getAttribute("href");
  await panel.goto("http://127.0.0.1:5173/login");
  await panel.getByLabel("Email address").fill("admin@roam.test");
  await panel
    .getByLabel("Password", { exact: true })
    .fill("ChangeMe!Admin2026");
  await panel.getByRole("button", { name: "Sign in" }).click();
  await expect(
    panel.getByRole("heading", { name: "Welcome to your workspace." }),
  ).toBeVisible();
  await expect(panel.locator(".stat").first().locator("strong")).not.toHaveText(
    "—",
  );
  await panel.screenshot({
    path: "docs/screenshots/admin-dashboard.png",
    fullPage: true,
  });
  await panel.getByRole("link", { name: "Packages", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(4);
  await panel.screenshot({
    path: "docs/screenshots/admin-packages.png",
    fullPage: true,
  });
  await panel.locator('button[title="Edit"]').first().click();
  await expect(panel.getByLabel("Package title")).toBeVisible();
  const original = await panel.getByLabel("Package title").inputValue();
  await panel.getByLabel("Package title").fill(original + " — updated");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(panel.locator("tbody")).toContainText(original + " — updated");
  await expect(
    page.getByText(original + " — updated", { exact: true }),
  ).toBeVisible();
  await panel.locator('button[title="Edit"]').first().click();
  await panel.getByLabel("Package title").fill(original);
  await panel.getByRole("button", { name: "Save changes" }).click();
  await page.goto("http://127.0.0.1:5173/login");
  await page.getByLabel("Email address").fill("customer@roam.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("ChangeMe!Customer2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/packages$/);
  await page.goto("http://127.0.0.1:5173" + packageId);
  await expect(page.locator(".departure-list button")).toHaveCount(4);
  await page
    .getByLabel("Departure", { exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel("Children").fill("1");
  await page.getByLabel("Room sharing").selectOption("single");
  await page.getByLabel("Travel insurance").check();
  await expect(page.locator(".price-total strong").last()).toContainText("₹");
  await page.screenshot({
    path: "docs/screenshots/package-pricing.png",
    fullPage: true,
  });
  const apiPackage = await (
    await page.request.get("http://127.0.0.1:5173/api" + packageId)
  ).json();
  const departure = apiPackage.departures[0];
  const beforeSeats = departure.bookedSeats;
  await page
    .getByRole("button", { name: "Continue to traveller details" })
    .click();
  for (let i = 0; i < 3; i++) {
    const block = page.locator(".traveller").nth(i);
    await block
      .getByLabel("Full name")
      .fill(["Alex Traveller", "Taylor Traveller", "Jamie Child"][i]);
    await block.getByLabel("Age", { exact: true }).fill(String([30, 28, 8][i]));
    await block.getByLabel("ID proof number").fill("TEST-ID-" + i);
  }
  await page.getByRole("button", { name: /Book now/ }).click();
  await expect(page).toHaveURL(/\/bookings$/);
  await expect(
    page.locator(".booking-card").first().locator(".status"),
  ).toHaveText("Pending");
  const afterPackage = await (
    await page.request.get("http://127.0.0.1:5173/api" + packageId)
  ).json();
  expect(afterPackage.departures[0].bookedSeats).toBe(beforeSeats + 3);
  const forbidden = await page.request.get(
    "http://127.0.0.1:5173/api/admin/settings",
  );
  expect(forbidden.status()).toBe(403);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel booking" }).first().click();
  await expect(
    page.locator(".booking-card").first().locator(".status"),
  ).toHaveText("Cancelled");
  const cancelled = await (
    await page.request.get("http://127.0.0.1:5173/api" + packageId)
  ).json();
  expect(cancelled.departures[0].bookedSeats).toBe(beforeSeats);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".destination")).toHaveCount(4);
  await assetsReady(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/home-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "Browser QA passed: database content, admin edit live refresh, checkout, seat reservation/cancellation, access control and mobile overflow.",
  );
} finally {
  await browser.close();
}
