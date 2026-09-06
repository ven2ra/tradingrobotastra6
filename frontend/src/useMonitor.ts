import { useEffect, useState } from "react";
import {
  assets,
  demoJournal,
  equitySeries,
  type Asset,
  type JournalRow,
  type Regime,
} from "./data";

export type Source = "demo" | "paper" | "t-invest";
export interface Health {
  score: number;
  label: string;
  note: string;
  dailyLossUsedPct: number;
  weeklyDrawdownUsedPct: number;
  positionsUsedPct: number;
  turnoverUsedPct: number;
}
export interface Monitor {
  equity: number;
  cash: number;
  pnl: number;
  stopped: boolean;
  positions: Asset[];
  instruments: Asset[];
  journal: JournalRow[];
  orders: {
    id: string;
    ticker: string;
    type: string;
    lots?: number;
    price?: string;
    strategy?: string;
  }[];
  history: { time: string; value: number }[];
  dailyLimit: number;
  health: Health | null;
  updated: number | null;
  status: "demo" | "loading" | "connected" | "offline";
  error: string;
}
const demo: Monitor = {
  equity: 1284560,
  cash: 307874.3,
  pnl: 15505,
  stopped: false,
  positions: assets.filter((a) => a.lots > 0),
  instruments: assets,
  journal: demoJournal,
  health: {
    score: 96,
    label: "Под контролем",
    note: "Демонстрационный score",
    dailyLossUsedPct: 4,
    weeklyDrawdownUsedPct: 2,
    positionsUsedPct: 40,
    turnoverUsedPct: 12,
  },
  orders: [
    {
      id: "DEMO-1048",
      ticker: "SBER",
      type: "LIMIT",
      lots: 2,
      price: "312.84",
      strategy: "Trend-follow",
    },
    {
      id: "DEMO-1047",
      ticker: "YDEX",
      type: "LIMIT",
      lots: 1,
      price: "4223",
      strategy: "Grid",
    },
  ],
  history: equitySeries.map((p, i) =>
    i === 48 ? { ...p, value: 1284560 } : p,
  ),
  dailyLimit: 25000,
  updated: null,
  status: "demo",
  error: "",
};
const empty: Monitor = {
  equity: 0,
  cash: 0,
  pnl: 0,
  stopped: false,
  positions: [],
  instruments: [],
  journal: [],
  orders: [],
  history: [],
  dailyLimit: 5000,
  health: null,
  updated: null,
  status: "loading",
  error: "",
};
export function useMonitor(source: Source) {
  const [paper, setPaper] = useState<Monitor>(empty);
  useEffect(() => {
    if (source === "demo") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setPaper({ ...empty });
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const replies = await Promise.all([
          fetch(`/api/${source}/snapshot`, { signal: controller.signal }),
          fetch(`/api/${source}/journal`, { signal: controller.signal }),
        ]);
        if (replies.some((r) => !r.ok)) throw new Error("API недоступен");
        const [s, j] = await Promise.all(replies.map((r) => r.json()));
        if (
          s.mode !== (source === "t-invest" ? "OBSERVE" : "PAPER") ||
          !Number.isFinite(Number(s.equity_rub)) ||
          !s.positions ||
          !Array.isArray(s.orders) ||
          !Array.isArray(j)
        )
          throw new Error("Некорректный ответ Paper API");
        const instruments: Asset[] = Object.entries(s.marks ?? {}).map(
          ([ticker, raw]) => {
            const m = raw as Record<string, unknown>;
            const p = s.positions[ticker];
            return {
              ticker: String(m.ticker ?? ticker),
              name: String(m.name ?? ticker),
              kind: m.kind === "bond" ? "bond" : "stock",
              price: Number(m.price),
              change: null,
              regime: String(m.regime) as Regime,
              color: "#b8a1ff",
              lots: p?.lots ?? 0,
              lotSize: Number(m.lot_size ?? 1),
              pnl: p?.pnl_rub == null ? null : Number(p.pnl_rub),
              strategy: p?.strategy ?? String(m.reason ?? "—"),
              nominal: Number(m.nominal ?? 1000),
              nkd: m.nkd == null ? undefined : Number(m.nkd),
            };
          },
        );
        const positions: Asset[] = Object.entries(s.positions).map(
          ([ticker, raw]) => {
            const p = raw as { lots: number; entry: string; strategy: string };
            return (
              instruments.find((a) => a.ticker === ticker) ?? {
                ticker,
                name: ticker,
                kind: "stock",
                price: Number(p.entry),
                change: null,
                regime: "UNDEFINED",
                color: "#969aac",
                lots: p.lots,
                lotSize: 1,
                pnl: null,
                strategy: p.strategy,
              }
            );
          },
        );
        if (active)
          setPaper((old) => ({
            ...old,
            equity: Number(s.equity_rub),
            cash: Number(s.cash_rub),
            pnl: Number(s.day_pnl_rub),
            stopped: s.day_stopped === true,
            positions,
            instruments,
            journal: j,
            orders: s.orders,
            dailyLimit: Number(s.daily_limit_rub ?? 5000),
            health: s.health
              ? {
                  score: Number(s.health.score),
                  label: String(s.health.label),
                  note: String(s.health.note),
                  dailyLossUsedPct: Number(s.health.daily_loss_used_pct),
                  weeklyDrawdownUsedPct: Number(
                    s.health.weekly_drawdown_used_pct,
                  ),
                  positionsUsedPct: Number(s.health.positions_used_pct),
                  turnoverUsedPct: Number(s.health.turnover_used_pct),
                }
              : null,
            updated: source === "t-invest" ? (s.updated ? Date.parse(s.updated) : null) : Date.now(),
            status: source === "t-invest" && !["connected","partial"].includes(s.status) ? (s.status === "loading" ? "loading" : "offline") : "connected",
            error: source === "t-invest" ? (s.error || (s.status === "not_configured" ? "Токен не настроен в серверном .env" : "")) : "",
            history: [
              ...old.history,
              {
                time: new Date().toLocaleTimeString("ru-RU", {
                  timeZone: "Europe/Moscow",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }),
                value: Number(s.equity_rub),
              },
            ].slice(-180),
          }));
      } catch (e) {
        if (active)
          setPaper((old) => ({
            ...old,
            status: "offline",
            error: e instanceof Error ? e.message : "Нет соединения",
          }));
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [source]);
  return source === "demo" ? demo : paper;
}
