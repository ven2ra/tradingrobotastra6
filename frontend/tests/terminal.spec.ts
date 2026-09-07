import { expect, test } from "@playwright/test";

test("300 liquid instruments are browsable via 'Добавить инструменты'; filter and manual add/remove persist", async ({
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
  // None of the synthetic T0..T299 tickers are among the default favorites
  // (SBER/GAZP/LKOH/YDEX), so the favorites-only view starts empty.
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить инструменты" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(300);
  await page.getByLabel("Класс актива").selectOption("bond");
  await expect(page.locator("tbody tr")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Добавить T100 в Watchlist", exact: true })
    .click();
  await page.getByRole("button", { name: "Только избранное" }).click();
  await expect(
    page.getByRole("button", { name: "Удалить T100 в Watchlist" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Удалить T100 в Watchlist" }),
  ).toBeVisible();
  await page.getByLabel("Поиск инструмента").fill("Instrument 299");
  await page.getByRole("button", { name: "Добавить инструменты" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test.beforeEach(async ({ page }) => {
  const now = new Date().toISOString();
  const marks = Object.fromEntries(
    [
      ["SBER", "Сбербанк"],
      ["GAZP", "Газпром"],
      ["LKOH", "Лукойл"],
      ["YDEX", "Яндекс"],
    ].map(([ticker, name]) => [
      ticker,
      {
        ticker,
        name,
        kind: "stock",
        price: "100",
        lot_size: 10,
        regime: "FLAT",
        stale: false,
        time: now,
      },
    ]),
  );
  await page.route("**/api/t-invest/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("journal")
        ? []
        : {
            mode: "OBSERVE",
            status: "connected",
            configured: true,
            error: "",
            updated: now,
            positions: {},
            marks,
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

test("Настройки T-Invest reachable via hamburger in the 640-900px icon-rail range", async ({
  page,
}) => {
  // Between 900px (sidebar collapses to an icon-only rail, hiding
  // sidebar-bottom) and 640px (full off-canvas drawer takes over) there was
  // no way at all to reach "Настройки T-Invest" — no hamburger shown either.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("button", { name: "Настройки T-Invest" }).click();
  await expect(
    page.getByRole("heading", { name: "Токен T-Invest" }),
  ).toBeVisible();
});

test("Live button reopens the dialog straight to proposals once token+ack are already saved", async ({
  page,
}) => {
  // Regression: the topbar Live pill used to just flip the data source
  // silently once a token existed, with no way left to reopen the dialog
  // (and its proposals list) at all — clicking it looked like nothing
  // happened.
  await page.route("**/api/live/account", (route) =>
    route.fulfill({
      json: { configured: true, error: "", account_name: "Счёт", account_id_masked: "••1",
        total_amount_rub: "1000", cash_rub: "1000", positions_count: 0, positions: [] },
    }),
  );
  await page.route("**/api/live/orders", (route) =>
    route.fulfill({
      json: [{ id: "p1", created_at: new Date().toISOString(), ticker: "LKOH", side: "BUY",
        lots: 1, price: "5150", order_type: "LIMIT", rule: "Trend: x", status: "PENDING",
        my_status: null, my_broker_order_id: null, my_error: null }],
    }),
  );
  await page.route("**/api/live/enabled", (route) => route.fulfill({ json: { enabled: true } }));
  await page.addInitScript(() => {
    localStorage.setItem("live_token_v1", "t.valid");
    localStorage.setItem("live_risk_ack_v1", "1");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ваш счёт и предложения" }),
  ).toBeVisible();
  await expect(page.getByText("LKOH")).toBeVisible();
  await page.getByRole("button", { name: "Вернуться в терминал" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Портфель" }).click();
  await expect(page.getByRole("heading", { name: "Live", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
});

test("live acknowledgement, disabled activation, responsive layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeDisabled();
  await page.getByLabel("Я понимаю риск потери капитала").check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Ваш счёт и предложения" }),
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
