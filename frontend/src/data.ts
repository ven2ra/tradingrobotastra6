export type Regime =
  "FLAT" | "UPTREND" | "DOWNTREND" | "SHOCK" | "LOW_LIQUIDITY" | "UNDEFINED";
export const regimes: Record<
  Regime,
  { label: string; color: string; icon: string }
> = {
  FLAT: { label: "Флэт", color: "#b8a1ff", icon: "↔" },
  UPTREND: { label: "Рост", color: "#73d8b0", icon: "↗" },
  DOWNTREND: { label: "Падение", color: "#f18aa5", icon: "↘" },
  SHOCK: { label: "Шок", color: "#ffba7a", icon: "ϟ" },
  LOW_LIQUIDITY: { label: "Низкая ликвидность", color: "#e4ce86", icon: "≋" },
  UNDEFINED: { label: "Нет данных", color: "#969aac", icon: "?" },
};
export const kinds = [
  "Grid",
  "Trend",
  "Breakout",
  "MeanReversion",
  "Momentum",
  "Event",
  "BondSpread",
  "RiskOff",
] as const;
export type Kind = (typeof kinds)[number];
export const catalog: Record<
  Kind,
  { title: string; subtitle: string; symbol: string; description: string }
> = {
  Grid: {
    title: "Grid",
    subtitle: "Сетка в диапазоне",
    symbol: "▦",
    description: "Лимитные уровни вокруг средней. Новые входы только во флэте.",
  },
  Trend: {
    title: "Trend-follow",
    subtitle: "Следование тренду",
    symbol: "↗",
    description:
      "Пробой N-баров, фильтр MA и ADX. Сопровождение по направлению тренда.",
  },
  Breakout: {
    title: "Breakout",
    subtitle: "Пробой диапазона",
    symbol: "⌁",
    description:
      "Подтверждение объёмом. Возврат в диапазон отменяет неисполненный вход.",
  },
  MeanReversion: {
    title: "Mean reversion",
    subtitle: "Возврат к средней",
    symbol: "∿",
    description:
      "Отклонение от VWAP или SMA и RSI. Жёсткий стоп за экстремумом.",
  },
  Momentum: {
    title: "Momentum",
    subtitle: "Короткий импульс",
    symbol: "ϟ",
    description: "Импульс после сжатия волатильности. Выход по тайм-стопу.",
  },
  Event: {
    title: "Event calendar",
    subtitle: "Календарная защита",
    symbol: "▣",
    description:
      "Запрет входа перед отсечкой, купоном, офертой или размещением.",
  },
  BondSpread: {
    title: "Bonds carry",
    subtitle: "Доходность и спред",
    symbol: "◫",
    description:
      "Отбор по YTM, дюрации и рейтингу. Спред к сопоставимой кривой ОФЗ.",
  },
  RiskOff: {
    title: "Risk-off",
    subtitle: "Защита портфеля",
    symbol: "◇",
    description:
      "Обязательная надстройка: отмена входов и сокращение риска при шоке.",
  },
};
export interface Asset {
  quoteTime?: string;
  stale?: boolean;
  ticker: string;
  name: string;
  kind: "stock" | "bond";
  price: number;
  change: number | null;
  regime: Regime;
  color: string;
  lots: number;
  lotSize: number;
  pnl: number | null;
  strategy: string;
  nominal?: number;
  nkd?: number;
  ytm?: number;
  duration?: number;
  rating?: string;
  coupon?: string;
  offer?: string;
  spread?: number;
  instrumentUid?: string;
  averagePrice?: number;
}
export const assets: Asset[] = [
  {
    ticker: "SBER",
    name: "Сбербанк",
    kind: "stock",
    price: 312.84,
    change: 1.42,
    regime: "UPTREND",
    color: "#6cbda2",
    lots: 80,
    lotSize: 10,
    pnl: 6840,
    strategy: "Trend-follow",
  },
  {
    ticker: "LKOH",
    name: "ЛУКОЙЛ",
    kind: "stock",
    price: 7248,
    change: 0.86,
    regime: "UPTREND",
    color: "#d9768d",
    lots: 25,
    lotSize: 1,
    pnl: 3520,
    strategy: "Breakout",
  },
  {
    ticker: "YDEX",
    name: "Яндекс",
    kind: "stock",
    price: 4265.5,
    change: 0.24,
    regime: "FLAT",
    color: "#c9b1fb",
    lots: 30,
    lotSize: 1,
    pnl: 2185,
    strategy: "Grid",
  },
  {
    ticker: "GAZP",
    name: "Газпром",
    kind: "stock",
    price: 132.65,
    change: -0.68,
    regime: "DOWNTREND",
    color: "#80b3da",
    lots: 75,
    lotSize: 10,
    pnl: -1460,
    strategy: "Risk-off",
  },
  {
    ticker: "OFZ26238",
    name: "ОФЗ 26238",
    kind: "bond",
    price: 63.42,
    change: 0.32,
    regime: "FLAT",
    color: "#c1a4ef",
    lots: 300,
    lotSize: 1,
    pnl: 2940,
    strategy: "Bonds carry",
    nominal: 1000,
    nkd: 18.74,
    ytm: 14.82,
    duration: 6.2,
    rating: "Суверенный",
    coupon: "35,40 ₽ · 03.12.2026",
    offer: "Нет оферты",
    spread: 0,
  },
  {
    ticker: "RU000A10DEMO",
    name: "Корп. облигация · пример",
    kind: "bond",
    price: 99.15,
    change: 0.08,
    regime: "FLAT",
    color: "#e0ba89",
    lots: 120,
    lotSize: 1,
    pnl: 1480,
    strategy: "Bonds carry",
    nominal: 1000,
    nkd: 24.16,
    ytm: 17.24,
    duration: 1.8,
    rating: "AA (пример)",
    coupon: "42,30 ₽ · 18.09.2026",
    offer: "15.06.2027",
    spread: 185,
  },
  {
    ticker: "NVTK",
    name: "НОВАТЭК",
    kind: "stock",
    price: 1124.2,
    change: -3.82,
    regime: "SHOCK",
    color: "#8a9cde",
    lots: 0,
    lotSize: 1,
    pnl: 0,
    strategy: "Входы запрещены",
  },
  {
    ticker: "DEMO-L",
    name: "Неликвидная бумага · пример",
    kind: "stock",
    price: 84.5,
    change: -0.14,
    regime: "LOW_LIQUIDITY",
    color: "#b6a080",
    lots: 0,
    lotSize: 10,
    pnl: 0,
    strategy: "Сделки запрещены",
  },
  {
    ticker: "DEMO-U",
    name: "Новый инструмент · пример",
    kind: "stock",
    price: 0,
    change: null,
    regime: "UNDEFINED",
    color: "#848798",
    lots: 0,
    lotSize: 1,
    pnl: null,
    strategy: "Недостаточно данных",
  },
];
export interface JournalRow {
  time: string;
  ticker: string;
  regime: Regime;
  strategy: string;
  action: string;
  reason: string;
  price: string | null;
  lots: number;
  status: string;
  order_id: string | null;
}
export const demoJournal: JournalRow[] = [
  [
    "SBER",
    "UPTREND",
    "Trend-follow",
    "SUBMIT",
    "Пробой 20-барного максимума · ADX 28,4 > 25. Риск-проверки пройдены.",
    "312.84",
    2,
    "DRAFT",
  ],
  [
    "YDEX",
    "FLAT",
    "Grid",
    "HOLD",
    "Цена внутри шага сетки. Следующий вход на уровне 4 223,00 ₽.",
    "4265.50",
    0,
    "NO_ORDER",
  ],
  [
    "NVTK",
    "SHOCK",
    "Risk-off",
    "REJECT",
    "SHOCK: новые входы запрещены. Защитные заявки сохранены.",
    "1124.20",
    0,
    "NO_ORDER",
  ],
  [
    "OFZ26238",
    "FLAT",
    "Bonds carry",
    "HOLD",
    "Спред не достиг порога. Цена и НКД учтены в полной стоимости.",
    "63.42",
    0,
    "NO_ORDER",
  ],
  [
    "GAZP",
    "DOWNTREND",
    "Mean reversion",
    "REJECT",
    "Возврат к средней запрещён в DOWNTREND.",
    "132.65",
    0,
    "NO_ORDER",
  ],
  [
    "LKOH",
    "UPTREND",
    "Breakout",
    "FILL",
    "Объём пробоя 1,8× среднего. Лимитная заявка исполнена.",
    "7248",
    1,
    "FILLED",
  ],
].map((r, i) => ({
  time: `2026-09-04T16:42:${String(58 - i * 7).padStart(2, "0")}+03:00`,
  ticker: r[0] as string,
  regime: r[1] as Regime,
  strategy: r[2] as string,
  action: r[3] as string,
  reason: r[4] as string,
  price: r[5] as string,
  lots: r[6] as number,
  status: r[7] as string,
  order_id: i === 0 || i === 5 ? `DEMO-${1048 - i}` : null,
}));
export const equitySeries = Array.from({ length: 49 }, (_, i) => ({
  time: `${10 + Math.floor(i / 8)}:${String((i % 8) * 7).padStart(2, "0")}`,
  value: Math.round(
    1232300 + i * 960 + Math.sin(i * 1.2) * 2800 + Math.cos(i * 0.43) * 3400,
  ),
}));
export const money = (v: number | null, digits = 0) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: digits,
      }).format(v);
export const number = (v: number, digits = 2) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(v);
export const assetValue = (a: Asset) =>
  a.lots *
  a.lotSize *
  (a.kind === "bond"
    ? (a.price * (a.nominal ?? 0)) / 100 + (a.nkd ?? 0)
    : a.price);
export function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
