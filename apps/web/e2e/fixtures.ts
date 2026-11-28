import type { Page } from "@playwright/test";

export async function useLocalFixtures(page: Page, signedIn = false) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") {
      return route.fulfill({ json: { user: signedIn ? { id: "mobile-test", email: "mobile@example.test" } : null, expiresAt: null } });
    }
    if (["/api/workspaces", "/api/workspaces/order", "/api/mindmaps"].includes(url.pathname)) return route.fulfill({ json: [] });
    if (url.pathname === "/api/ai/config") {
      return route.fulfill({ json: { tier: url.searchParams.get("tier"), available: true, isMock: true, providerLabel: "Test fixture", modelLabel: "Test fixture", dailyLimit: 3, remainingToday: 3 } });
    }
    return route.fulfill({ status: 503, json: { error: "Offline fixture: cloud services are unavailable" } });
  });
}
