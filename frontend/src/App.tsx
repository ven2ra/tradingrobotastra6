import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FileText,
  Layers,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  assetValue,
  catalog,
  download,
  kinds,
  money,
  number,
  regimes,
  type Asset,
  type JournalRow,
  type Kind,
  type Regime,
} from "./data";
import { Constructor, readDrafts, RiskEditor, type Draft } from "./Constructor";
import { useMonitor, type Monitor, type Source } from "./useMonitor";

const regimeExplanations: Record<Regime, string> = {
  FLAT: "Цена колеблется в диапазоне без выраженного тренда. Разрешены Grid, Mean reversion и другие диапазонные стратегии.",
  UPTREND:
    "Устойчивое движение цены вверх, подтверждённое трендовыми индикаторами. Разрешены Trend-follow, Breakout и Momentum.",
  DOWNTREND:
    "Устойчивое движение цены вниз. Новые лонги обычно запрещены; актуальны шорт-стратегии и защита позиций.",
  SHOCK:
    "Резкий аномальный скачок цены или волатильности. Новые входы запрещены всем стратегиям, работает только Risk-off.",
  LOW_LIQUIDITY:
    "Недостаточный объём торгов или ширина спреда. Любые новые сделки запрещены до восстановления ликвидности.",
  UNDEFINED:
    "Недостаточно данных, чтобы классифицировать рынок. Новые сделки запрещены до появления надёжного сигнала.",
};
const pages = [
  { id: "overview", title: "Обзор", icon: LayoutDashboard },
  { id: "portfolio", title: "Портфель", icon: Wallet },
  { id: "strategies", title: "Стратегии", icon: Layers },
  { id: "regimes", title: "Режимы рынка", icon: Activity },
  { id: "risk", title: "Риск", icon: ShieldCheck },
  { id: "journal", title: "Журнал", icon: FileText },
  { id: "bonds", title: "Облигации", icon: BookOpen },
  { id: "watchlist", title: "Watchlist", icon: Star },
];
type Page = (typeof pages)[number]["id"];
const pageGuides: Record<Page, string> = {
  overview:
    "Вся картина рынка. Каждая стратегия. Ни одного решения без причины.",
  portfolio:
    "Открытые позиции, свободные деньги и текущие заявки по выбранному источнику данных.",
  strategies:
    "Разные режимы рынка — разные правила исполнения. Соберите профиль из каталога: Grid, Trend-follow, Mean reversion и Bonds carry можно активировать в paper-движке, остальные пока только сохраняются черновиком.",
  regimes:
    "Как рынок классифицируется по режимам и какие тикеры сейчас в каком режиме — от этого зависит, каким стратегиям разрешён вход.",
  risk: "Единые лимиты риска: проверяются перед каждой заявкой независимо от стратегии — дневной стоп, размер позиции, недельная просадка.",
  journal:
    "Полная история решений движка: почему заявка отправлена, отклонена или отменена, с указанием причины и режима рынка.",
  bonds:
    "Метрики облигаций — доходность к погашению, дюрация, НКД и спред к ОФЗ — используются стратегией Bonds carry для отбора бумаг.",
  watchlist:
    "Список инструментов для быстрого наблюдения. Хранится локально в этом браузере и не влияет на торговлю.",
};
function RegimeBadge({ regime }: { regime: Regime }) {
  const r = regimes[regime] ?? regimes.UNDEFINED;
  return (
    <span
      className="regime-badge"
      title={regimeExplanations[regime] ?? regimeExplanations.UNDEFINED}
      style={{ color: r.color, background: `${r.color}12` }}
    >
      {r.icon} {r.label}
    </span>
  );
}
function Panel({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Layers size={26} />
      <p>{children}</p>
    </div>
  );
}
function AssetName({ asset }: { asset: Asset }) {
  return (
    <div className="asset-name">
      <span
        className="asset-avatar"
        style={{ background: `${asset.color}20`, color: asset.color }}
      >
        {asset.kind === "bond" ? (
          <BookOpen size={17} />
        ) : (
          asset.ticker.slice(0, 1)
        )}
      </span>
      <div>
        <b>{asset.ticker}</b>
        <small>{asset.name}</small>
      </div>
    </div>
  );
}
function Pnl({ value }: { value: number | null }) {
  return (
    <span
      className={
        value === null ? "muted" : value >= 0 ? "positive" : "negative"
      }
    >
      {value !== null && value > 0 ? "+" : ""}
      {money(value)}
    </span>
  );
}
function Positions({
  data,
  compact = false,
}: {
  data: Asset[];
  compact?: boolean;
}) {
  return data.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Инструмент</th>
            <th>Цена</th>
            <th>Позиция</th>
            <th>P/L{!compact ? " · без комиссий" : ""}</th>
            {!compact && (
              <>
                <th>Стратегия</th>
                <th>Режим</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.ticker}>
              <td>
                <AssetName asset={a} />
              </td>
              <td>
                {a.kind === "bond" ? `${number(a.price)} %` : money(a.price, 2)}
              </td>
              <td>
                {a.lots} <span className="muted">лот.</span>
              </td>
              <td>
                <Pnl value={a.pnl} />
              </td>
              {!compact && (
                <>
                  <td>{a.strategy}</td>
                  <td>
                    <RegimeBadge regime={a.regime} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>Открытых позиций нет</Empty>
  );
}
function Orders({ m }: { m: Monitor }) {
  return m.orders.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Инструмент</th>
            <th>Стратегия</th>
            <th>Тип</th>
            <th>Лимит</th>
            <th>Лоты</th>
            <th>ID заявки</th>
          </tr>
        </thead>
        <tbody>
          {m.orders.map((o) => (
            <tr key={o.id}>
              <td>
                <b>{o.ticker}</b>
              </td>
              <td>{o.strategy ?? "—"}</td>
              <td>
                <span className="badge muted-badge">{o.type}</span>
              </td>
              <td>{o.price ? number(Number(o.price)) : "—"}</td>
              <td>{o.lots ?? "—"}</td>
              <td className="mono small">{o.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>Рабочих заявок нет. Решения доступны в журнале.</Empty>
  );
}
function Journal({
  rows,
  preview = false,
}: {
  rows: JournalRow[];
  preview?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const filtered = rows.filter(
    (r) =>
      (filter === "ALL" || r.action === filter) &&
      `${r.ticker} ${r.strategy} ${r.reason} ${r.order_id ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      {!preview && (
        <div className="table-toolbar">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Поиск по журналу"
              placeholder="Тикер, стратегия или причина…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Действие"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="ALL">Все действия</option>
            {["HOLD", "SIGNAL", "REJECT", "SUBMIT", "FILL", "CANCEL"].map(
              (a) => (
                <option key={a}>{a}</option>
              ),
            )}
          </select>
          <button
            className="secondary"
            onClick={() => download(filtered, "astra-journal.json")}
          >
            <ArrowDownToLine size={15} /> Экспорт
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table className="journal-table">
          <thead>
            <tr>
              <th>Время МСК</th>
              <th>Инструмент</th>
              <th>Режим</th>
              <th>Стратегия</th>
              <th>Действие</th>
              <th>Причина решения</th>
              {!preview && (
                <>
                  <th>Цена</th>
                  <th>Лоты</th>
                  <th>Статус</th>
                  <th>ID заявки</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(preview ? filtered.slice(0, 4) : filtered).map((r, i) => (
              <tr key={`${r.time}-${i}`}>
                <td className="mono muted">
                  {new Date(r.time).toLocaleTimeString("ru-RU", {
                    timeZone: "Europe/Moscow",
                  })}
                </td>
                <td>
                  <b>{r.ticker}</b>
                </td>
                <td>
                  <RegimeBadge regime={r.regime} />
                </td>
                <td>{r.strategy}</td>
                <td>
                  <span className={`action action-${r.action}`}>
                    {r.action}
                  </span>
                </td>
                <td className="reason">{r.reason}</td>
                {!preview && (
                  <>
                    <td>{r.price ?? "—"}</td>
                    <td>{r.lots}</td>
                    <td>{r.status}</td>
                    <td className="mono small">{r.order_id ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <Empty>Решения по выбранным фильтрам не найдены</Empty>
      )}
    </>
  );
}
function Overview({
  m,
  source,
  go,
}: {
  m: Monitor;
  source: Source;
  go: (p: Page) => void;
}) {
  const [range, setRange] = useState("1Д");
  const history = range === "1Ч" ? m.history.slice(-12) : m.history;
  const loss = Math.max(0, -m.pnl);
  const usage = Math.min(100, (loss / m.dailyLimit) * 100);
  const stock = m.positions
      .filter((a) => a.kind === "stock")
      .reduce((s, a) => s + assetValue(a), 0),
    bond = m.positions
      .filter((a) => a.kind === "bond")
      .reduce((s, a) => s + assetValue(a), 0),
    total = stock + bond + m.cash || 1;
  const distribution = [
    { name: "Акции", value: stock, color: "#b9a0fa" },
    { name: "Облигации", value: bond, color: "#79a9e6" },
    { name: "Деньги", value: m.cash, color: "#73c7b1" },
  ];
  return (
    <>
      <div className="kpi-grid">
        <div className="panel kpi">
          <div className="kpi-label">
            Стоимость портфеля <Wallet size={17} />
          </div>
          <div className="kpi-value">
            {m.status === "loading" ? "—" : money(m.equity)}
          </div>
          <div className="kpi-footer">
            <span className="positive">
              <ArrowUpRight size={14} />{" "}
              {source === "live" ? "Live" : "Paper"}
            </span>
            <span>
              {source === "live" ? "реальный счёт" : "состояние движка"}
            </span>
          </div>
          <div className="kpi-decoration" />
        </div>
        <div className="panel kpi">
          <div className="kpi-label">
            Результат за день <Activity size={17} />
          </div>
          <div className="kpi-value">
            <Pnl value={m.status === "loading" ? null : m.pnl} />
          </div>
          <div className="kpi-footer">
            <span className={m.pnl >= 0 ? "positive" : "negative"}>
              {m.equity - m.pnl
                ? `${m.pnl >= 0 ? "+" : ""}${number((m.pnl / (m.equity - m.pnl)) * 100)}%`
                : "—"}
            </span>
            <span>от начала сессии</span>
          </div>
        </div>
        <div className="panel kpi">
          <div className="kpi-label">
            Дневной стоп <ShieldCheck size={17} />
          </div>
          <div className="kpi-value smaller">
            {money(loss)} <span>/ {money(m.dailyLimit)}</span>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${usage}%`,
                background: m.stopped ? "#f18aa5" : "#b9a0fa",
              }}
            />
          </div>
          <div className="kpi-footer">
            <span>
              {m.stopped
                ? "Стоп сработал"
                : `${number(usage, 1)}% лимита использовано`}
            </span>
            <span className={m.stopped ? "negative" : "positive"}>
              {m.stopped ? "Входы запрещены" : "В пределах"}
            </span>
          </div>
        </div>
        <div className="panel kpi robot-card">
          <div className="kpi-label">
            Статус робота <Zap size={17} />
          </div>
          <div className="robot-status">
            <span
              className={`status-orb ${m.status === "offline" ? "off" : ""}`}
            />
            {m.status === "connected"
              ? source === "live"
                ? "Live подключён"
                : "Paper работает"
              : m.status === "loading"
                ? "Подключение"
                : "Нет связи"}
          </div>
          <div className="kpi-footer">
            <span>
              {source === "live"
                ? "Ваш реальный брокерский счёт"
                : "Исполнение на backend"}
            </span>
          </div>
          <button className="text-button" onClick={() => go("risk")}>
            Контроль риска <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div className="dashboard-middle">
        <Panel
          title="Динамика портфеля"
          className="equity-panel"
          action={
            <div className="segment">
              {["1Ч", "1Д"].map((r) => (
                <button
                  className={range === r ? "active" : ""}
                  key={r}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          }
        >
          <div className="chart-subtitle">
            <span className="legend-dot" /> Equity, RUB{" "}
            <span className="muted">
              Накопленные наблюдения текущего подключения
            </span>
          </div>
          <div className="equity-chart">
            {history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={history}
                  margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#b5a0fb"
                        stopOpacity={0.28}
                      />
                      <stop offset="100%" stopColor="#b5a0fb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#ffffff0b"
                    strokeDasharray="3 5"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#858399", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={55}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    orientation="right"
                    tickFormatter={(v) => `${number(v / 1000, 0)}k`}
                    tick={{ fill: "#858399", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#252135",
                      border: "1px solid #4c425f",
                      borderRadius: 10,
                      color: "#f5f1ff",
                    }}
                    formatter={(v) => [money(Number(v)), "Equity"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#baa2ff"
                    fill="url(#equityFill)"
                    strokeWidth={2.5}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty>График появится после двух обновлений API</Empty>
            )}
          </div>
          <div className="chart-bottom">
            <span>Включая открытые позиции и денежный остаток</span>
            <span>
              RUB <ChevronDown size={12} />
            </span>
          </div>
        </Panel>
        <Panel
          title="Структура портфеля"
          className="allocation-panel"
          action={<span className="small muted">3 класса</span>}
        >
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#b9a0fa 0 ${(stock / total) * 100}%, #79a9e6 ${(stock / total) * 100}% ${((stock + bond) / total) * 100}%, #73c7b1 ${((stock + bond) / total) * 100}% 100%)`,
              }}
            >
              <div>
                <small>Активы</small>
                <b>{m.positions.length}</b>
                <span>в портфеле</span>
              </div>
            </div>
          </div>
          <div className="allocation-legend">
            {distribution.map((d) => (
              <div key={d.name}>
                <span>
                  <i style={{ background: d.color }} />
                  {d.name}
                </span>
                <b>{number((d.value / total) * 100, 1)}%</b>
                <small>{money(d.value)}</small>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="Стратегии по режимам"
          action={
            <button
              className="icon-button"
              aria-label="Открыть стратегии"
              onClick={() => go("strategies")}
            >
              <ArrowUpRight size={17} />
            </button>
          }
        >
          <div className="strategy-mini">
            <span className="mini-symbol purple">▦</span>
            <div>
              <b>
                Grid <span className="muted">/ диапазон</span>
              </b>
              <small>Сетка только во флэте</small>
            </div>
            <RegimeBadge regime="FLAT" />
          </div>
          <div className="strategy-mini">
            <span className="mini-symbol green">↗</span>
            <div>
              <b>Trend-follow</b>
              <small>По направлению движения</small>
            </div>
            <RegimeBadge regime="UPTREND" />
          </div>
          <div className="strategy-mini">
            <span className="mini-symbol blue">◫</span>
            <div>
              <b>Bonds carry</b>
              <small>Доходность и спред к ОФЗ</small>
            </div>
            <RegimeBadge regime="FLAT" />
          </div>
          <div className="panel-footnote">
            Каталог разрешений · активность смотрите в журнале
          </div>
        </Panel>
        <Panel
          title="Дисциплина риска"
          action={
            <ShieldCheck
              size={17}
              className="accent"
              aria-label="Взвешенная оценка использования лимитов риска: дневной стоп 35%, недельная просадка 25%, число позиций 15%, дневной оборот 15%, статус дневного стопа 10%."
            />
          }
        >
          <div className="health-row">
            <div
              className="health-ring"
              style={
                m.health
                  ? {
                      background: `conic-gradient(${m.health.score >= 60 ? "#92cab5" : "#f18aa5"} 0 ${m.health.score}%, #ffffff06 ${m.health.score}% 100%)`,
                    }
                  : undefined
              }
            >
              <b>
                {m.health ? m.health.score : "—"}
                <small>/ 100</small>
              </b>
            </div>
            <div>
              <b>{m.health ? m.health.label : "Оценка недоступна"}</b>
              <p>
                {m.health
                  ? m.health.note
                  : "Снимок ещё не получен от API или health-score не рассчитан"}
              </p>
              <span className="badge muted-badge">
                {source === "live" ? "Нет расчёта для Live" : "Расчёт backend"}
              </span>
            </div>
          </div>
          {m.health && (
            <div className="health-breakdown">
              {[
                ["Дневной лимит", m.health.dailyLossUsedPct],
                ["Недельная просадка", m.health.weeklyDrawdownUsedPct],
                ["Число позиций", m.health.positionsUsedPct],
                ["Дневной оборот", m.health.turnoverUsedPct],
              ].map(([label, pct]) => (
                <div className="health-item" key={label as string}>
                  <span>{label}</span>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${Math.min(100, Number(pct))}%`,
                        background: Number(pct) >= 80 ? "#f18aa5" : "#b9a0fa",
                      }}
                    />
                  </div>
                  <small>{number(Number(pct), 0)}%</small>
                </div>
              ))}
            </div>
          )}
          <div className="health-item">
            <ShieldCheck size={14} />
            <span>RiskEngine обязателен для заявки</span>
          </div>
          <div className="health-item">
            <LockKeyhole size={14} />
            <span>Live-торговля отключена</span>
          </div>
          <button className="text-button mt-3" onClick={() => go("risk")}>
            Проверить лимиты <ArrowRight size={14} />
          </button>
        </Panel>
        <Panel
          title="Лучшие позиции"
          action={
            <button
              className="icon-button"
              aria-label="Открыть портфель"
              onClick={() => go("portfolio")}
            >
              <ArrowUpRight size={17} />
            </button>
          }
        >
          {[...m.positions]
            .sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
            .slice(0, 3)
            .map((a) => (
              <div className="top-position" key={a.ticker}>
                <AssetName asset={a} />
                <div>
                  <Pnl value={a.pnl} />
                  <small>{a.strategy}</small>
                </div>
              </div>
            ))}
          {!m.positions.length && <Empty>Пока нет позиций</Empty>}
          <div className="panel-footnote">Результат по открытым позициям</div>
        </Panel>
      </div>
      <Panel
        title="Открытые заявки"
        action={<span className="count-badge">{m.orders.length}</span>}
      >
        <Orders m={m} />
      </Panel>
      <Panel
        title="Последние решения"
        className="mt-5"
        action={
          <button className="text-button" onClick={() => go("journal")}>
            Весь журнал <ArrowRight size={14} />
          </button>
        }
      >
        <Journal rows={m.journal} preview />
      </Panel>
    </>
  );
}
function MarketTable({
  data,
  watch,
  toggle,
}: {
  data: Asset[];
  watch?: string[];
  toggle?: (t: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {toggle && <th aria-label="Избранное" />}
            <th>Инструмент</th>
            <th>Цена</th>
            <th>Изменение</th>
            <th>Режим</th>
            <th>Котировка · МСК</th>
            <th>Стратегия / ограничение</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.ticker}>
              {toggle && (
                <td>
                  <button
                    className="icon-button"
                    aria-label={`${watch?.includes(a.ticker) ? "Удалить" : "Добавить"} ${a.ticker} в Watchlist`}
                    onClick={() => toggle(a.ticker)}
                  >
                    <Star
                      size={16}
                      fill={watch?.includes(a.ticker) ? "#b9a0fa" : "none"}
                      className="accent"
                    />
                  </button>
                </td>
              )}
              <td>
                <AssetName asset={a} />
              </td>
              <td>
                {a.price
                  ? `${number(a.price)} ${a.kind === "bond" ? "%" : "₽"}`
                  : "—"}
              </td>
              <td
                className={
                  a.change === null
                    ? "muted"
                    : a.change >= 0
                      ? "positive"
                      : "negative"
                }
              >
                {a.change === null
                  ? "—"
                  : `${a.change >= 0 ? "+" : ""}${number(a.change)}%`}
              </td>
              <td>
                <RegimeBadge regime={a.regime} />
              </td>
              <td className={a.stale ? "negative" : "muted"}>
                {a.quoteTime ? (
                  <>
                    {new Date(a.quoteTime).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    {a.stale && (
                      <small className="block">Устарела · вход запрещён</small>
                    )}
                  </>
                ) : (
                  a.stale ? "Ожидаем цену" : "Демо"
                )}
              </td>
              <td className="market-reason">{a.strategy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <Empty>Инструменты не найдены</Empty>}
    </div>
  );
}
interface LiveAccountInfo {
  configured: boolean;
  error: string;
  account_id_masked?: string;
  account_name?: string;
  total_amount_rub?: string;
  positions_count?: number;
  accounts_available?: number;
}
interface LiveProposal {
  id: string;
  created_at: string;
  ticker: string;
  side: string;
  lots: number;
  price: string;
  order_type: string;
  rule: string;
  status: string;
  my_status: string | null;
  my_broker_order_id: string | null;
  my_error: string | null;
}
const MY_TOKEN_KEY = "live_token_v1";
const DISMISSED_KEY = "live_dismissed_v1";
function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
}
function LiveDialog({
  close,
  activeToken,
  onCommitToken,
}: {
  close: () => void;
  activeToken: string;
  onCommitToken: (token: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(1);
  const [ack, setAck] = useState(false);
  const [systemEnabled, setSystemEnabled] = useState<boolean | null>(null);
  // tokenInput is just the text box value as the user types it; it only
  // becomes the shared activeToken (owned by App, also used by the Portfolio
  // page's Live source) on blur/Enter/click. Without this split, an effect
  // keyed on every keystroke would fire one fetch per character typed, and
  // those requests can resolve out of order, letting a stale partial-token
  // error overwrite the real result for the finished token (the bug behind
  // "ввёл токен, но счёт не появился").
  const [tokenInput, setTokenInput] = useState(activeToken);
  const [account, setAccount] = useState<LiveAccountInfo | null>(null);
  const [proposals, setProposals] = useState<LiveProposal[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const accountRequestId = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    fetch("/api/live/enabled")
      .then((r) => r.json())
      .then((d) => setSystemEnabled(Boolean(d.enabled)))
      .catch(() => setSystemEnabled(null));
  }, []);
  function tokenHeaders(): Record<string, string> {
    return activeToken ? { "X-Live-Token": activeToken } : {};
  }
  function loadAccount() {
    if (!activeToken) {
      setAccount(null);
      return;
    }
    const requestId = ++accountRequestId.current;
    fetch("/api/live/account", { headers: tokenHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (requestId === accountRequestId.current) setAccount(d);
      })
      .catch(() => {
        if (requestId === accountRequestId.current) {
          setAccount({ configured: false, error: "Нет связи с backend" });
        }
      });
  }
  function loadProposals() {
    fetch("/api/live/orders", { headers: tokenHeaders() })
      .then((r) => r.json())
      .then(setProposals)
      .catch(() => {
        /* keep last known list */
      });
  }
  useEffect(() => {
    if (step !== 2) return;
    loadAccount();
    loadProposals();
    const id = setInterval(loadProposals, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeToken]);
  function commitToken() {
    const trimmed = tokenInput.trim();
    setTokenInput(trimmed);
    onCommitToken(trimmed);
  }
  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  }
  async function approve(id: string) {
    if (!activeToken) {
      setMessage({ text: "Сначала укажите свой токен T-Invest.", ok: false });
      return;
    }
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/live/orders/${id}/approve`, {
        method: "POST",
        headers: tokenHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.detail || `Ошибка (HTTP ${res.status})`, ok: false });
      } else {
        setMessage({ text: `Заявка отправлена вашему брокеру: ${body.orderId ?? ""}`, ok: true });
      }
    } catch {
      setMessage({ text: "Нет связи с backend.", ok: false });
    } finally {
      setBusy("");
      loadProposals();
    }
  }
  async function killSwitch() {
    if (!activeToken) {
      setMessage({ text: "Сначала укажите свой токен T-Invest.", ok: false });
      return;
    }
    if (!confirm("Отменить все ваши ещё не исполненные заявки, отправленные этим приложением?")) return;
    setBusy("kill");
    try {
      const res = await fetch("/api/live/kill", { method: "POST", headers: tokenHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.detail || `Ошибка (HTTP ${res.status})`, ok: false });
      } else {
        setMessage({ text: `Отменено ваших заявок: ${body.cancelled ?? 0}.`, ok: true });
      }
    } catch {
      setMessage({ text: "Нет связи с backend.", ok: false });
    } finally {
      setBusy("");
      loadProposals();
    }
  }
  const visibleProposals = (proposals || []).filter((p) => !dismissed.includes(p.id));
  return (
    <dialog ref={dialog} className="live-dialog" onCancel={close}>
      <button
        className="icon-button modal-close"
        aria-label="Закрыть"
        onClick={close}
      >
        <X size={20} />
      </button>
      <div className="modal-icon">
        <LockKeyhole size={28} />
      </div>
      <div className="eyebrow">LIVE · ШАГ {step} ИЗ 2</div>
      <h2>{step === 1 ? "Реальная торговля" : "Ваш счёт и предложения"}</h2>
      {step === 1 ? (
        <>
          <p>
            Live торгует на вашем собственном брокерском счёте, вашим токеном
            T-Invest и реальными деньгами. Сервер не хранит ваш токен — он
            остаётся в этом браузере и передаётся только при ваших
            действиях (просмотр счёта, подтверждение или отмена заявки).
          </p>
          <div className="notice">
            Не является индивидуальной инвестиционной рекомендацией. Возможна
            потеря капитала.
          </div>
          <label className="check-label my-5">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />{" "}
            Я понимаю риск потери капитала и торгую собственным токеном на
            свой счёт
          </label>
          <button
            className="primary w-full"
            disabled={!ack}
            onClick={() => setStep(2)}
          >
            Продолжить <ArrowRight size={16} />
          </button>
        </>
      ) : (
        <>
          {systemEnabled === false && (
            <div className="notice mb-4">
              Администратор пока не включил приём предложений на сервере —
              сигналы стратегий не создают заявок ни для кого. Ваш токен
              ниже всё равно позволяет посмотреть счёт.
            </div>
          )}
          <label className="field span-2 mb-2">
            Ваш токен T-Invest{" "}
            <span className="small muted">
              · нужен доступ к счёту и торговле; хранится только в этом
              браузере
            </span>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onBlur={commitToken}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitToken();
              }}
              placeholder="t.…"
              autoComplete="off"
            />
          </label>
          <button className="secondary w-full mb-4" onClick={commitToken}>
            Показать счёт
          </button>
          {!activeToken ? (
            <p className="small muted">Введите токен и нажмите «Показать счёт».</p>
          ) : !account ? (
            <p>Запрашиваем данные счёта…</p>
          ) : !account.configured ? (
            <p>{account.error}</p>
          ) : account.error ? (
            <>
              <p>Не удалось прочитать счёт: {account.error}</p>
              <div className="notice">
                Если это «Токен не принят» — проверьте, что у токена включён
                доступ к счёту и торговле (это отдельные опции при выпуске
                токена в T-Invest).
              </div>
            </>
          ) : (
            <>
              <p>
                Ваш брокерский счёт: {account.account_name} ·{" "}
                {account.account_id_masked}
              </p>
              <div className="aside-rule">
                <span>Стоимость портфеля</span>
                <b>{money(Number(account.total_amount_rub ?? 0))}</b>
              </div>
              <div className="aside-rule">
                <span>Открытых позиций</span>
                <b>{account.positions_count ?? 0}</b>
              </div>
              {(account.accounts_available ?? 0) > 1 && (
                <div className="aside-rule">
                  <span>Доступно счетов на токене</span>
                  <b>{account.accounts_available}</b>
                </div>
              )}
            </>
          )}
          <div className="section-heading mt-5">
            <div>
              <h3>Предложения на подтверждение</h3>
              <p>
                Общие для всех кандидаты от стратегий. Заявка уходит вашему
                брокеру только когда вы сами нажимаете «Отправить».
              </p>
            </div>
          </div>
          {!visibleProposals.length ? (
            <p className="small muted">Предложений пока нет.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Тикер</th>
                    <th>Сторона</th>
                    <th>Лоты</th>
                    <th>Цена</th>
                    <th>Правило</th>
                    <th>Ваш статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleProposals.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.ticker}</b></td>
                      <td>{p.side}</td>
                      <td>{p.lots}</td>
                      <td>{p.price}</td>
                      <td className="small">{p.rule}</td>
                      <td>
                        <span className="badge muted-badge">{p.my_status || p.status}</span>
                        {p.my_error && <div className="small negative">{p.my_error}</div>}
                      </td>
                      <td>
                        {p.status === "PENDING" && !p.my_status && (
                          <div className="flex gap-2">
                            <button
                              className="primary"
                              disabled={busy === p.id || !activeToken}
                              onClick={() => approve(p.id)}
                            >
                              Отправить
                            </button>
                            <button
                              className="secondary"
                              disabled={busy === p.id}
                              onClick={() => dismiss(p.id)}
                            >
                              Скрыть
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {message && (
            <div
              className={`notice mt-4 ${message.ok ? "success" : "error"}`}
              role={message.ok ? "status" : "alert"}
            >
              {message.text}
            </div>
          )}
          <button
            className="secondary w-full mt-4"
            disabled={busy === "kill" || !activeToken}
            onClick={killSwitch}
          >
            <LockKeyhole size={14} /> Отменить мои заявки (kill-switch)
          </button>
          <button className="primary w-full mt-3" onClick={close}>
            Вернуться в терминал
          </button>
        </>
      )}
    </dialog>
  );
}
interface SettingsStatus {
  admin_enabled: boolean;
  token_configured: boolean;
  max_instruments: number;
}
function SettingsDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [maxInstruments, setMaxInstruments] = useState("300");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [liveMessage, setLiveMessage] = useState<
    { text: string; ok: boolean } | null
  >(null);
  const [liveBusy, setLiveBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function refreshStatus() {
    fetch("/api/settings/status")
      .then((r) => r.json())
      .then((d: SettingsStatus) => {
        setStatus(d);
        setMaxInstruments(String(d.max_instruments));
      })
      .catch(() => setStatus(null));
  }
  useEffect(refreshStatus, []);
  useEffect(() => {
    fetch("/api/live/enabled")
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(null));
  }, []);
  function authHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${password}`,
    };
  }
  async function toggleEnabled() {
    if (!password) {
      setLiveMessage({ text: "Введите пароль администратора выше.", ok: false });
      return;
    }
    setLiveBusy(true);
    try {
      const res = await fetch("/api/live/enabled", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLiveMessage({ text: body.detail || `Ошибка (HTTP ${res.status})`, ok: false });
      } else {
        setEnabled(Boolean(body.enabled));
        setLiveMessage({
          text: body.enabled
            ? "Приём предложений включён: сигналы стратегий начнут создавать предложения, которые каждый пользователь подтверждает своим токеном."
            : "Приём предложений выключен для всех.",
          ok: true,
        });
      }
    } catch {
      setLiveMessage({ text: "Нет связи с backend.", ok: false });
    } finally {
      setLiveBusy(false);
    }
  }
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/t-invest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify({
          token: token.trim(),
          max_instruments: Number(maxInstruments) || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.detail || `Ошибка (HTTP ${res.status})`, ok: false });
      } else {
        setMessage({
          text: !body.token_configured
            ? "Сохранено, но токен не настроен."
            : token.trim()
              ? "Токен сохранён. Котировки и счёт перезапущены с новым токеном."
              : "Настройки сохранены. Котировки и счёт перезапущены.",
          ok: true,
        });
        setToken("");
        refreshStatus();
      }
    } catch {
      setMessage({ text: "Нет связи с backend.", ok: false });
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog ref={dialog} className="live-dialog" onCancel={close}>
      <button
        className="icon-button modal-close"
        aria-label="Закрыть"
        onClick={close}
      >
        <X size={20} />
      </button>
      <div className="modal-icon">
        <Settings2 size={28} />
      </div>
      <div className="eyebrow">НАСТРОЙКИ</div>
      <h2>Токен T-Invest</h2>
      {status === null ? (
        <p>Загрузка…</p>
      ) : !status.admin_enabled ? (
        <>
          <p>
            Форма отключена: на сервере не задан пароль администратора.
          </p>
          <div className="notice">
            Задайте переменную окружения <code>ADMIN_PASSWORD</code> в{" "}
            <code>.env</code> на сервере и перезапустите контейнер, чтобы
            включить этот раздел.
          </div>
        </>
      ) : (
        <>
          <p>
            Токен сейчас {status.token_configured ? "настроен" : "не настроен"}
            . Изменение сразу перезапускает получение котировок и данных
            счёта, без остановки контейнера.
          </p>
          <div className="form-grid mt-4">
            <label className="field span-2">
              Пароль администратора
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field span-2">
              Новый токен T-Invest{" "}
              <span className="small muted">
                · оставьте пустым, чтобы не менять
              </span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="t.…"
                autoComplete="off"
              />
            </label>
            <label className="field">
              Максимум инструментов
              <input
                type="number"
                min="1"
                max="300"
                value={maxInstruments}
                onChange={(e) => setMaxInstruments(e.target.value)}
              />
            </label>
          </div>
          {message && (
            <div
              className={`notice mt-4 ${message.ok ? "success" : "error"}`}
              role={message.ok ? "status" : "alert"}
            >
              {message.text}
            </div>
          )}
          <button
            className="primary w-full mt-5"
            disabled={saving || !password}
            onClick={save}
          >
            {saving ? "Сохраняем…" : "Сохранить и перезапустить"}
          </button>
          <div className="section-heading mt-5">
            <div>
              <h3>Live — приём предложений</h3>
              <p>
                Общий выключатель на весь сервер: разрешает ли он вообще
                создавать предложения по сигналам стратегий. Каждый
                пользователь всё равно подтверждает и отправляет заявки сам,
                своим токеном, в диалоге Live — здесь нет доступа к чужим
                счетам или токенам.
              </p>
            </div>
            <span className={`badge ${enabled ? "active-badge" : "muted-badge"}`}>
              {enabled === null ? "…" : enabled ? "Включено" : "Выключено"}
            </span>
          </div>
          <div className="flex gap-2 mb-4">
            <button
              className="secondary"
              disabled={liveBusy || !password}
              onClick={toggleEnabled}
            >
              {enabled ? "Выключить для всех" : "Включить для всех"}
            </button>
          </div>
          {liveMessage && (
            <div
              className={`notice mb-4 ${liveMessage.ok ? "success" : "error"}`}
              role={liveMessage.ok ? "status" : "alert"}
            >
              {liveMessage.text}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>(() =>
    pages.some((p) => p.id === location.hash.slice(1))
      ? location.hash.slice(1)
      : "overview",
  );
  const [source, setSource] = useState<Source>("paper");
  const [liveToken, setLiveToken] = useState(
    () => localStorage.getItem(MY_TOKEN_KEY) || "",
  );
  function commitLiveToken(token: string) {
    try {
      localStorage.setItem(MY_TOKEN_KEY, token);
    } catch {
      /* Token still works for this session even if storage is unavailable. */
    }
    setLiveToken(token);
  }
  const m = useMonitor(source, source === "live" ? liveToken : undefined);
  const [menu, setMenu] = useState(false),
    [live, setLive] = useState(false),
    [info, setInfo] = useState(false),
    [query, setQuery] = useState(""),
    [marketFilter, setMarketFilter] = useState("ALL"),
    [editing, setEditing] = useState<{ kind: Kind; draft?: Draft } | null>(
      null,
    ),
    [drafts, setDrafts] = useState<Draft[]>(readDrafts),
    [toast, setToast] = useState(""),
    [showAll, setShowAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState("all");
  const [watch, setWatch] = useState<string[]>(() => {
    try {
      const x = JSON.parse(
        localStorage.getItem("astra.watchlist.v1") ??
          '["SBER","GAZP","LKOH","YDEX"]',
      );
      return Array.isArray(x) ? x.filter((v) => typeof v === "string") : [];
    } catch {
      return ["SBER", "GAZP", "LKOH", "YDEX"];
    }
  });
  // Real T-Invest quotes power Watchlist/Regimes/Journal/Bonds independently
  // of whether Paper or Live is selected above; the watched tickers (usually
  // a handful) are fast-refreshed on the backend every couple of seconds,
  // while the full liquid catalog keeps updating in the background at a
  // pace the broker's rate limit actually allows for 300 instruments.
  const marketMonitor = useMonitor("t-invest", undefined, watch);
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const [activeStrategyIds, setActiveStrategyIds] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch("/api/paper/strategies");
        if (res.ok && active) {
          const list = await res.json();
          setActiveStrategyIds(
            new Set(list.map((s: { id: string }) => s.id)),
          );
        }
      } catch {
        // Paper API unreachable; keep the last known activation state.
      }
    }
    void poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    const f = () => {
      const p = location.hash.slice(1);
      if (pages.some((x) => x.id === p)) {
        setPage(p);
        setEditing(null);
      }
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const go = (p: Page) => {
    location.hash = p;
    setPage(p);
    setMenu(false);
    setEditing(null);
    setQuery("");
    setMarketFilter("ALL");
    window.scrollTo({ top: 0 });
  };
  function save(d: Draft) {
    const next = [...drafts.filter((x) => x.id !== d.id), d];
    try {
      localStorage.setItem("astra.strategy-drafts.v1", JSON.stringify(next));
      setDrafts(next);
      setEditing(null);
      setToast("Черновик сохранён. Торговля не запущена.");
    } catch {
      setToast("Не удалось сохранить. Используйте экспорт JSON.");
    }
  }
  function toggle(t: string) {
    const next = watch.includes(t)
      ? watch.filter((x) => x !== t)
      : [...watch, t];
    setWatch(next);
    try {
      localStorage.setItem("astra.watchlist.v1", JSON.stringify(next));
    } catch {
      setToast("Watchlist изменён только до перезагрузки браузера.");
    }
  }
  const title = pages.find((p) => p.id === page)?.title ?? "Обзор";
  const market = marketMonitor.instruments.filter(
    (a) =>
      (marketFilter === "ALL" || a.regime === marketFilter) &&
      `${a.ticker} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const paperUnavailable = m.updated === null && m.instruments.length === 0;
  const marketUnavailable =
    marketMonitor.updated === null && marketMonitor.instruments.length === 0;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <span className="brand-mark">
            <Sparkles size={24} />
          </span>
          <div>
            ASTRA<small>TRADING TERMINAL</small>
          </div>
        </a>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Основная навигация">
          {pages.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${page === p.id ? "active" : ""}`}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => go(p.id)}
            >
              <p.icon size={19} />
              <span>{p.title}</span>
              {p.id === "strategies" && <small>8</small>}
              {page === p.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="protect-card">
            <div>
              <ShieldCheck size={18} />
              <b>Защита капитала</b>
            </div>
            <p>Риск-проверки перед каждой заявкой</p>
            <button onClick={() => go("risk")}>
              Параметры риска <ChevronRight size={14} />
            </button>
          </div>
          <button className="help-button" onClick={() => setInfo(!info)}>
            <CircleHelp size={18} /> О терминале <ArrowUpRight size={14} />
          </button>
          <button className="help-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} /> Настройки T-Invest
          </button>
          <div className="account">
            <div className="account-avatar">К</div>
            <div>
              <b>Рабочий счёт</b>
              <small>
                {source === "live" ? "Live · реальный счёт" : "Paper engine"}
              </small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span>Терминал</span>
            <ChevronRight size={13} />
            <b>{title}</b>
          </div>
          <div className="topbar-actions">
            <div className="market-time">
              <span className="status-dot" /> MOEX{" "}
              <span className="muted">
                {clock.toLocaleTimeString("ru-RU", {
                  timeZone: "Europe/Moscow",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                МСК
              </span>
            </div>
            <div className="mode-switch">
              <button
                className={source === "paper" ? "active" : ""}
                aria-pressed={source === "paper"}
                onClick={() => setSource("paper")}
              >
                Paper
              </button>
              <button
                className={source === "live" ? "active" : ""}
                aria-pressed={source === "live"}
                onClick={() => (liveToken ? setSource("live") : setLive(true))}
              >
                {!liveToken && <LockKeyhole size={11} />} Live
              </button>
            </div>
            <button
              className="icon-button notification"
              aria-label="Информация о терминале"
              onClick={() => setInfo(!info)}
            >
              <Bell size={19} />
              <i />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ВАШ РЫНОК. ВАШИ ПРАВИЛА.</div>
              <h1>{title === "Обзор" ? "Портфель под контролем" : title}</h1>
              <p>{pageGuides[page]}</p>
            </div>
            <div className="page-controls">
              {page === "strategies" ? (
                <button
                  className="primary"
                  onClick={() => setEditing({ kind: "Grid" })}
                >
                  <Plus size={16} /> Новая стратегия
                </button>
              ) : (
                <button className="secondary" onClick={() => go("strategies")}>
                  <Settings2 size={15} /> Стратегии
                </button>
              )}
            </div>
          </div>
          <div
            className={`data-banner ${m.status === "offline" ? "error" : ""}`}
          >
            <span>
              <span
                className={`status-dot ${m.status === "connected" ? "" : "offline-dot"}`}
              />
              {source === "live"
                ? `Live · ваш реальный счёт${m.status === "connected" ? "" : m.error ? ` · ${m.error}` : " · нет связи"}`
                : m.status === "connected"
                  ? "Подключено к paper-движку · обновление каждые 2 секунды"
                  : m.status === "loading"
                    ? "Подключаемся к paper API…"
                    : `Нет связи с paper API · ${m.updated ? "показан последний снимок" : "данных нет"}`}
            </span>
            <span>
              {m.updated
                ? `Снимок ${new Date(m.updated).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
                : source === "live"
                  ? "Введите токен в диалоге Live"
                  : "Запустите backend на порту 8000"}
            </span>
          </div>
          {info && (
            <div className="notice mb-5">
              <CircleHelp size={18} />
              <div>
                <b>ASTRA · монитор стратегий MOEX</b>
                <p>
                  Ордера создаёт backend после RiskEngine. UI показывает
                  решения. Конструктор может активировать Grid, Trend-follow,
                  Mean reversion и Bonds carry в paper-движке; политика риска
                  пока сохраняет только локальные черновики. Live недоступен.
                  Не является ИИР; возможна потеря капитала.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Закрыть информацию"
                onClick={() => setInfo(false)}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {m.stopped && (
            <div className="notice error mb-5" role="alert">
              <ShieldCheck size={20} /> Дневной стоп сработал. Новые входы
              запрещены до следующей торговой сессии, разрешено только
              сокращение риска.
            </div>
          )}
          {["overview", "portfolio"].includes(page) && paperUnavailable && (
            <div className="panel">
              <Empty>
                {m.status === "loading"
                  ? "Ожидаем первый снимок…"
                  : m.error ||
                    "API недоступен. Проверьте backend; демонстрационные данные не подставляются."}
              </Empty>
            </div>
          )}
          {["regimes", "journal", "bonds", "watchlist"].includes(page) &&
            marketUnavailable && (
              <div className="panel">
                <Empty>
                  {marketMonitor.status === "loading"
                    ? "Ожидаем первые котировки T-Invest…"
                    : marketMonitor.error ||
                      "Котировки T-Invest недоступны. Проверьте backend."}
                </Empty>
              </div>
            )}
          <>
              {page === "overview" && !paperUnavailable && (
                <Overview m={m} source={source} go={go} />
              )}
              {page === "portfolio" && !paperUnavailable && (
                <>
                  <div className="mini-kpis">
                    <div>
                      <span>Стоимость портфеля</span>
                      <b>{money(m.equity)}</b>
                    </div>
                    <div>
                      <span>Свободные деньги</span>
                      <b>{money(m.cash)}</b>
                    </div>
                    <div>
                      <span>Открытые позиции</span>
                      <b>{m.positions.length}</b>
                    </div>
                    <div>
                      <span>Результат за день</span>
                      <b>
                        <Pnl value={m.status === "loading" ? null : m.pnl} />
                      </b>
                    </div>
                  </div>
                  {!m.positions.length && (
                    <div className="notice mt-3 mb-5">
                      Открытых позиций нет, поэтому по отдельным бумагам
                      нечего показывать в плюсе или минусе. Общий результат за
                      день — «Результат за день» выше и на странице «Обзор».
                    </div>
                  )}
                  <Panel
                    title="Позиции"
                    action={
                      <button
                        className="text-button"
                        onClick={() => download(m.positions, "positions.json")}
                      >
                        <ArrowDownToLine size={15} /> Экспорт
                      </button>
                    }
                  >
                    <Positions data={m.positions} />
                  </Panel>
                  <Panel title="Открытые заявки" className="mt-5">
                    <Orders m={m} />
                  </Panel>
                </>
              )}
              {page === "strategies" &&
                (editing ? (
                  <Constructor
                    key={editing.draft?.id ?? editing.kind}
                    kind={editing.kind}
                    existing={editing.draft}
                    onClose={() => setEditing(null)}
                    onSave={save}
                  />
                ) : (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>
                          Каталог стратегий <span className="muted">/ 08</span>
                        </h2>
                        <p>Шесть классов входа и две защитные надстройки</p>
                      </div>
                      <span className="badge muted-badge">
                        <ShieldCheck size={13} /> RiskEngine обязателен
                      </span>
                    </div>
                    <div className="catalog-grid">
                      {kinds.map((k, i) => (
                        <button
                          className="panel catalog-card"
                          key={k}
                          onClick={() => setEditing({ kind: k })}
                        >
                          <div className="catalog-card-top">
                            <span className={`catalog-symbol symbol-${i % 4}`}>
                              {catalog[k].symbol}
                            </span>
                            <span className="small muted">
                              0{i + 1} <ArrowUpRight size={15} />
                            </span>
                          </div>
                          <h3>{catalog[k].title}</h3>
                          <div className="catalog-subtitle">
                            {catalog[k].subtitle}
                          </div>
                          <p>{catalog[k].description}</p>
                          <div className="catalog-footer">
                            <span>
                              {k === "RiskOff"
                                ? "Обязательная защита"
                                : k === "Event"
                                  ? "Надстройка"
                                  : "Настроить профиль"}
                            </span>
                            <ArrowRight size={15} />
                          </div>
                        </button>
                      ))}
                    </div>
                    <Panel
                      title={`Мои черновики · ${drafts.length}`}
                      className="mt-5"
                    >
                      {drafts.length ? (
                        drafts.map((d) => (
                          <div className="draft-row" key={d.id}>
                            <span className="mini-symbol purple">
                              {catalog[d.kind as Kind].symbol}
                            </span>
                            <div>
                              <b>{d.id}</b>
                              <small>
                                {catalog[d.kind as Kind].title} ·{" "}
                                {d.instrument_ids.join(", ")} · приоритет{" "}
                                {d.priority}
                              </small>
                            </div>
                            <span
                              className={`badge ${activeStrategyIds.has(d.id) ? "active-badge" : "muted-badge"}`}
                            >
                              {activeStrategyIds.has(d.id)
                                ? "Активна в Paper"
                                : "Не активирована"}
                            </span>
                            <button
                              className="secondary"
                              onClick={() =>
                                setEditing({ kind: d.kind, draft: d })
                              }
                            >
                              Изменить
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Выгрузить ${d.id}`}
                              onClick={() => download(d, `${d.id}.json`)}
                            >
                              <ArrowDownToLine size={16} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <Empty>
                          Соберите первый профиль из каталога. Он останется
                          черновиком до подключения к движку.
                        </Empty>
                      )}
                    </Panel>
                  </>
                ))}
              {page === "regimes" && !marketUnavailable && (
                <>
                  <div className="regime-grid">
                    {Object.entries(regimes).map(([r, meta]) => (
                      <button
                        key={r}
                        className={`panel regime-card ${marketFilter === r ? "selected" : ""}`}
                        title={regimeExplanations[r as Regime]}
                        onClick={() =>
                          setMarketFilter(marketFilter === r ? "ALL" : r)
                        }
                      >
                        <span style={{ color: meta.color }}>{meta.icon}</span>
                        <b>
                          {
                            marketMonitor.instruments.filter(
                              (a) => a.regime === r,
                            ).length
                          }
                        </b>
                        <small>{meta.label}</small>
                      </button>
                    ))}
                  </div>
                  <Panel
                    title="Карта режимов"
                    action={
                      <button
                        className="text-button"
                        onClick={() => setMarketFilter("ALL")}
                      >
                        Все инструменты
                      </button>
                    }
                  >
                    <MarketTable data={market} />
                  </Panel>
                  <div className="notice mt-5">
                    <ShieldCheck size={18} /> SHOCK запрещает новые входы.
                    LOW_LIQUIDITY и UNDEFINED запрещают новые торговые заявки.
                  </div>
                </>
              )}
              {page === "risk" && (
                <>
                  <div className="risk-summary panel mb-5">
                    <ShieldCheck size={32} />
                    <div>
                      <h3>Защита действует до выбора стратегии</h3>
                      <p>
                        Текущий дневной лимит движка: {money(m.dailyLimit)}.{" "}
                        {m.stopped
                          ? "Новые входы заблокированы."
                          : "Дневной стоп не сработал."}
                      </p>
                    </div>
                    <span className="badge muted-badge">
                      LIMIT по умолчанию
                    </span>
                  </div>
                  <RiskEditor />
                </>
              )}
              {page === "journal" && !marketUnavailable && (
                <Panel
                  title="Журнал решений"
                  action={
                    <span className="count-badge">
                      {marketMonitor.journal.length}
                    </span>
                  }
                >
                  <Journal
                    rows={[...marketMonitor.journal].sort((a, b) =>
                      b.time.localeCompare(a.time),
                    )}
                  />
                </Panel>
              )}
              {page === "bonds" && !marketUnavailable && (
                <>
                  <div className="notice mb-5">
                    <BookOpen size={18} /> Цена облигаций — в % номинала. Полная
                    стоимость = цена × номинал / 100 + НКД.
                  </div>
                  <div className="bond-grid">
                    {marketMonitor.instruments
                      .filter((a) => a.kind === "bond")
                      .map((a) => (
                        <article className="panel bond-card" key={a.ticker}>
                          <div className="panel-heading">
                            <AssetName asset={a} />
                            <RegimeBadge regime={a.regime} />
                          </div>
                          <div className="bond-yield">
                            <div>
                              <span>Доходность к погашению</span>
                              <b>{a.ytm ? `${number(a.ytm)}%` : "—"}</b>
                            </div>
                            <span className="badge muted-badge">
                              {a.rating ?? "Нет рейтинга"}
                            </span>
                          </div>
                          <div className="bond-metrics">
                            {[
                              ["Чистая цена", `${number(a.price)} %`],
                              [
                                "Полная цена",
                                money(
                                  (a.price * (a.nominal ?? 0)) / 100 +
                                    (a.nkd ?? 0),
                                  2,
                                ),
                              ],
                              ["НКД", a.nkd == null ? "—" : money(a.nkd, 2)],
                              [
                                "Номинал",
                                a.nominal == null ? "—" : money(a.nominal),
                              ],
                              [
                                "Дюрация",
                                a.duration == null
                                  ? "—"
                                  : `${number(a.duration)} лет`,
                              ],
                              [
                                "Спред к ОФЗ",
                                a.spread == null ? "—" : `${a.spread} bps`,
                              ],
                              ["Купон / дата", a.coupon ?? "Нет данных"],
                              ["Оферта", a.offer ?? "Нет данных"],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <span>{k}</span>
                                <b>{v}</b>
                              </div>
                            ))}
                          </div>
                          <button
                            className="text-button"
                            onClick={() => {
                              go("strategies");
                              setEditing({ kind: "BondSpread" });
                            }}
                          >
                            Настроить Bonds carry <ArrowRight size={15} />
                          </button>
                        </article>
                      ))}
                  </div>
                  {!marketMonitor.instruments.some(
                    (a) => a.kind === "bond",
                  ) && (
                    <div className="panel">
                      <Empty>
                        T-Invest пока не передал облигационные инструменты
                      </Empty>
                    </div>
                  )}
                </>
              )}
              {page === "watchlist" && !marketUnavailable && (
                <Panel
                  title={`Список наблюдения · ${marketMonitor.instruments.filter((a) => watch.includes(a.ticker)).length} бумаг`}
                  action={
                    <button
                      className="secondary"
                      onClick={() => setShowAll(!showAll)}
                    >
                      <Plus size={15} />
                      {showAll ? "Только избранное" : "Добавить инструменты"}
                    </button>
                  }
                >
                  <div className="table-toolbar">
                    <label className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Поиск инструмента"
                        placeholder="Поиск по тикеру или названию…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Класс актива"
                      value={assetFilter}
                      onChange={(e) => setAssetFilter(e.target.value)}
                    >
                      <option value="all">Акции и облигации</option>
                      <option value="stock">Акции</option>
                      <option value="bond">Облигации</option>
                    </select>
                    <span className="small muted">
                      {showAll
                        ? "Отметьте инструменты звёздочкой"
                        : "Сохраняется в этом браузере"}
                    </span>
                  </div>
                  <MarketTable
                    data={market.filter(
                      (a) =>
                        (showAll || watch.includes(a.ticker)) &&
                        (assetFilter === "all" || a.kind === assetFilter),
                    )}
                    watch={watch}
                    toggle={toggle}
                  />
                </Panel>
              )}
          </>
          <footer>
            <span>
              <span className="brand-star">✧</span> ASTRA{" "}
              <span className="muted">/ Осознанное исполнение</span>
            </span>
            <span>Не является ИИР · Риск потери капитала</span>
            <span>v0.2 · Paper</span>
          </footer>
        </main>
      </div>
      {live && (
        <LiveDialog
          close={() => setLive(false)}
          activeToken={liveToken}
          onCommitToken={commitLiveToken}
        />
      )}{" "}
      {settingsOpen && (
        <SettingsDialog close={() => setSettingsOpen(false)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
