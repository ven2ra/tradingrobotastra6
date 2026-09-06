import { expect, test } from "@playwright/test";

test("300 liquid instruments are auto-added; asset filter and removals persist", async ({
  page,
}) => {
  const marks = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      `T${i}`,
      {
        ticker: `T${i}`,
        name: `Instrument ${i}`,
        kind: i < 100 ? "stock" : "bond",
        price: "100",
        lot_size: 1,
        regime: "UNDEFINED",
        stale: true,
        time: null,
      },
    ]),
  );
  await page.route("**/api/t-invest/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("journal")
        ? []
        : {
            mode: "OBSERVE",
            status: "partial",
            configured: true,
            updated: null,
            marks,
            positions: {},
            orders: [],
            equity_rub: "0",
            cash_rub: "0",
            day_pnl_rub: "0",
          },
    }),
  );
  await page.goto("/#watchlist");
  await expect(page.locator("tbody tr")).toHaveCount(300);
  await page.getByLabel("Класс актива").selectOption("bond");
  await expect(page.locator("tbody tr")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Удалить T100 в Watchlist", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(199);
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(299);
  await page.getByLabel("Поиск инструмента").fill("Instrument 299");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/t-invest/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("journal")
        ? []
        : {
            mode: "OBSERVE",
            status: "not_configured",
            configured: false,
            error: "",
            updated: null,
            positions: {},
            marks: {},
            orders: [],
            equity_rub: "0",
          },
    }),
  );
});

test("screens, watchlist and validated strategy draft", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Источник данных").selectOption("demo");
  await expect(
    page.getByRole("heading", { name: "Портфель под контролем" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  for (const title of [
    "Портфель",
    "Режимы рынка",
    "Риск",
    "Журнал",
    "Облигации",
    "Watchlist",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Удалить SBER в Watchlist" }).click();
  await page.reload();
  await page.getByLabel("Источник данных").selectOption("demo");
  await expect(
    page.getByRole("button", { name: "Удалить SBER в Watchlist" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить инструменты" }).click();
  await page.getByRole("button", { name: "Добавить SBER в Watchlist" }).click();
  await expect(
    page.getByRole("button", { name: "Удалить SBER в Watchlist" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Стратегии" })
    .click();
  await expect(page.locator(".catalog-card")).toHaveCount(8);
  await page
    .locator(".catalog-card")
    .filter({ hasText: "Сетка в диапазоне" })
    .click();
  await page.getByLabel("Название / ID").fill("grid-browser-test");
  await expect(
    page.getByRole("checkbox", { name: "↗ Рост", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Проверить профиль" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Структура и распределение TP корректны",
  );
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page.locator(".draft-row")).toContainText("grid-browser-test");
  await page.reload();
  await expect(page.locator(".draft-row")).toContainText("grid-browser-test");
  expect(errors).toEqual([]);
});

test("eight valid constructor defaults and rejected invalid TP", async ({
  page,
}) => {
  await page.goto("/#strategies");
  for (let i = 0; i < 8; i++) {
    await page.locator(".catalog-card").nth(i).click();
    await page.getByRole("button", { name: "Проверить профиль" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Структура и распределение TP корректны",
    );
    if (i === 0) {
      await page
        .getByLabel("Доля позиции, %", { exact: true })
        .first()
        .fill("50");
      await page.getByRole("button", { name: "Сохранить черновик" }).click();
      await expect(page.getByRole("alert")).toContainText("100%");
    }
    await page.getByRole("button", { name: "Все стратегии" }).click();
  }
});

test("live acknowledgement, disabled activation, responsive layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Источник данных").selectOption("demo");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeDisabled();
  await page.getByLabel("Я понимаю риск потери капитала").check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Подключение недоступно" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Вернуться в терминал" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Стратегии" })
    .click();
  await page.locator(".catalog-card").first().click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("paper data, daily stop and disconnect; no order POSTs", async ({
  page,
}) => {
  let failed = false;
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() !== "GET") writes++;
  });
  await page.route("**/api/paper/**", async (route) => {
    if (failed) {
      await route.fulfill({ status: 503, body: "offline" });
      return;
    }
    const body = route.request().url().endsWith("journal")
      ? []
      : {
          mode: "PAPER",
          equity_rub: "424242",
          cash_rub: "424242",
          day_pnl_rub: "-6000",
          day_stopped: true,
          positions: {},
          marks: {},
          orders: [],
          daily_limit_rub: "5000",
        };
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByLabel("Источник данных").selectOption("paper");
  await expect(page.locator(".data-banner")).toContainText("Подключено");
  await expect(page.locator(".kpi").first()).toContainText("424");
  await expect(page.getByRole("alert")).toContainText("Дневной стоп сработал");
  failed = true;
  await expect(page.locator(".data-banner")).toContainText("последний снимок", {
    timeout: 10000,
  });
  await expect(page.locator(".kpi").first()).toContainText("424");
  expect(writes).toBe(0);
});
