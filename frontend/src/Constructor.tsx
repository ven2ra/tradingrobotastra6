import { useState } from "react";
import Ajv2020 from "ajv/dist/2020";
import {
  ArrowLeft,
  Download,
  Save,
  ShieldCheck,
  Check,
  AlertCircle,
} from "lucide-react";
import strategySchema from "../../schemas/strategy.schema.json";
import riskSchema from "../../schemas/risk-policy.schema.json";
import riskExample from "../../schemas/risk-policy.example.json";
import {
  catalog,
  kinds,
  regimes,
  download,
  type Kind,
  type Regime,
} from "./data";

// Schema-owned dynamic fields. Values are validated by AJV before persistence.
type Schema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  minItems?: number;
  allOf?: unknown[];
};
export type Draft = Record<string, any>;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(strategySchema);
const validateRisk = ajv.compile(riskSchema);
const labels: Record<string, string> = {
  step_unit: "Единица шага",
  step: "Шаг сетки",
  levels_up: "Уровней вверх",
  levels_down: "Уровней вниз",
  anchor: "Якорь сетки",
  fixed_anchor: "Фиксированная цена",
  exit: "Выход",
  outside_flat: "Вне флэта",
  lookback: "Период Donchian, баров",
  ma: "Скользящая средняя",
  ma_period: "Период MA",
  adx_min: "Минимальный ADX",
  pyramiding: "Пирамидинг",
  enabled: "Включено",
  max_additions: "Максимум добавлений",
  add_every_atr: "Шаг добавления, ATR",
  range_bars: "Длина диапазона, баров",
  min_volume_ratio: "Объём к среднему, ×",
  cancel_on_reentry: "Отмена при возврате в диапазон",
  session_from: "Начало окна, МСК",
  session_to: "Конец окна, МСК",
  confirmation_bars: "Баров подтверждения",
  mean: "Средняя",
  period: "Период, баров",
  deviation_unit: "Единица отклонения",
  deviation: "Отклонение от средней",
  rsi_low: "RSI: нижняя зона",
  rsi_high: "RSI: верхняя зона",
  extremum_bars: "Поиск экстремума, баров",
  stop_buffer_points: "Буфер за экстремумом, п.",
  compression_bars: "Период сжатия, баров",
  max_atr_ratio: "ATR к среднему, максимум",
  min_impulse_atr: "Минимальный импульс, ATR",
  time_stop_bars: "Тайм-стоп, баров",
  events: "События",
  block_hours: "Запрет за N часов",
  close_before: "Закрыть заранее",
  close_hours: "Закрыть за N часов",
  missing_calendar: "Нет календаря",
  min_ytm: "Минимальная YTM, %",
  max_duration: "Максимальная дюрация, лет",
  max_rating_rank: "Максимальный ранг рейтинга",
  min_daily_turnover_rub: "Мин. оборот бумаги, ₽",
  max_spread_bps: "Максимальный bid/ask, bps",
  signal: "Сигнал",
  spread_bps: "Спред к ОФЗ, bps",
  offer_days: "Дней до оферты",
  dirty_anomaly_points: "Аномалия полной цены, п.",
  target_ytm: "Целевая доходность, %",
  ofz_curve: "Кривая ОФЗ",
  yield_basis: "Основа доходности",
  shock: "Защита при SHOCK",
  daily_stop: "Защита дневного стопа",
  imoex_drop_pct: "Падение IMOEX, %",
  cancel_entries: "Отменять входы",
  allow_only_reduction: "Только сокращение",
  mode: "Тип стопа",
  value: "Величина стопа",
  initial_pct: "Начальный стоп, %",
  activation_pct: "Активация трейлинга после, %",
  breakeven_pct: "Безубыток после, %",
  yield_bps: "Стоп по изменению YTM, bps",
  trade_risk_rub: "Риск сделки, ₽",
  max_weight_pct: "Максимальная доля бумаги, %",
  max_positions: "Максимум позиций",
  daily_turnover_rub: "Дневной оборот, ₽",
  daily_loss_rub: "Дневной стоп, ₽",
  weekly_drawdown_pct: "Недельная просадка, %",
  cooldown_seconds: "Cooldown после стопа, сек.",
  stale_seconds: "Возраст котировки, сек.",
  fee_bps: "Комиссия, bps",
  slippage_bps: "Буфер проскальзывания, bps",
  event_block_hours: "Запрет перед событием, ч",
  event_close_hours: "Закрытие перед событием, ч",
  imoex_stop_pct: "Стоп IMOEX, %",
};
const options: Record<string, string> = {
  pct: "Проценты, %",
  atr: "ATR",
  rub: "Сумма, ₽",
  level: "Уровень цены",
  trailing: "Трейлинг, %",
  points: "Пункты цены",
  session_vwap: "VWAP сессии",
  fixed: "Фиксированная цена",
  reverse_level: "Обратный уровень",
  tp: "Тейк-профит",
  cancel_entries: "Отменить входы",
  sma: "SMA",
  ema: "EMA",
  vwap: "VWAP",
  dividend: "Дивидендная отсечка",
  coupon: "Купон",
  offer: "Оферта",
  placement: "Размещение",
  block_entries: "Запретить входы",
  ofz_spread: "Спред к ОФЗ",
  offer_approach: "Приближение оферты",
  dirty_price_anomaly: "Аномалия цены к НКД",
  duration_matched: "Сопоставимая дюрация",
  maturity: "К погашению",
  worst: "Худшая доходность",
};
const defaults: Record<string, unknown> = {
  step: 1,
  levels_up: 5,
  levels_down: 5,
  lookback: 20,
  ma_period: 50,
  adx_min: 25,
  max_additions: 0,
  add_every_atr: 1,
  range_bars: 20,
  min_volume_ratio: 1.5,
  session_from: "10:00",
  session_to: "18:30",
  confirmation_bars: 2,
  period: 20,
  deviation: 2,
  rsi_low: 30,
  rsi_high: 70,
  extremum_bars: 10,
  stop_buffer_points: 1,
  compression_bars: 10,
  max_atr_ratio: 0.7,
  min_impulse_atr: 1.5,
  time_stop_bars: 5,
  block_hours: 24,
  close_hours: 4,
  min_ytm: 12,
  max_duration: 3,
  max_rating_rank: 3,
  min_daily_turnover_rub: 1000000,
  max_spread_bps: 100,
  spread_bps: 150,
  offer_days: 30,
  dirty_anomaly_points: 2,
  target_ytm: 10,
  imoex_drop_pct: -5,
  fixed_anchor: 100,
};
function initial(s: Schema, key = ""): any {
  if (s.const !== undefined) return s.const;
  if (defaults[key] !== undefined) return defaults[key];
  if (s.enum) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      Object.entries(s.properties ?? {}).map(([k, v]) => [k, initial(v, k)]),
    );
  if (s.type === "array") return s.items?.enum ? [s.items.enum[0]] : [];
  if (s.type === "boolean") return false;
  if (s.type === "number" || s.type === "integer") return s.minimum ?? 1;
  return "";
}
function branch(kind: Kind) {
  return strategySchema.oneOf.find((b) => b.properties.kind.const === kind)!;
}
function makeDraft(kind: Kind): Draft {
  const b = branch(kind);
  const overlay = kind === "Event" || kind === "RiskOff";
  return {
    version: 1,
    id: `${kind.toLowerCase()}-${Date.now().toString(36)}`,
    kind,
    enabled: false,
    mode: "paper",
    instrument_ids: [kind === "BondSpread" ? "OFZ26238:TQOB" : "SBER:TQBR"],
    regimes: [...b.properties.regimes.items.enum],
    priority: kind === "Breakout" ? 10 : kind === "Trend" ? 20 : 30,
    risk_policy_id: "paper-default",
    params: initial(b.properties.params as unknown as Schema),
    ...(!overlay
      ? {
          lots: 1,
          max_lots: 10,
          short: false,
          stop: {
            mode:
              kind === "MeanReversion"
                ? "level"
                : kind === "BondSpread"
                  ? "points"
                  : "pct",
            value: kind === "MeanReversion" ? 95 : 2,
          },
          tp: [
            { target_pct: 2, share_pct: 30 },
            { target_pct: 4, share_pct: 30 },
            { target_pct: 6, share_pct: 40 },
          ],
        }
      : {}),
  };
}
export function Field({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: Schema;
  value: any;
  onChange: (v: any) => void;
}) {
  const title = labels[name] ?? name;
  if (schema.type === "object")
    return (
      <fieldset className="nested-field">
        <legend>{title}</legend>
        <div className="form-grid">
          {Object.entries(schema.properties ?? {}).map(([k, s]) => (
            <Field
              key={k}
              name={k}
              schema={s}
              value={value?.[k]}
              onChange={(v) => onChange({ ...value, [k]: v })}
            />
          ))}
        </div>
      </fieldset>
    );
  if (schema.type === "array" && schema.items?.enum)
    return (
      <fieldset className="nested-field">
        <legend>{title}</legend>
        <div className="flex flex-wrap gap-3">
          {schema.items.enum.map((v) => (
            <label className="check-label" key={String(v)}>
              <input
                type="checkbox"
                checked={(value ?? []).includes(v)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...(value ?? []), v]
                      : (value ?? []).filter((x: unknown) => x !== v),
                  )
                }
              />
              {options[String(v)] ?? String(v)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  if (
    schema.type === "boolean" ||
    typeof schema.const === "boolean" ||
    schema.enum?.every((v) => typeof v === "boolean")
  )
    return (
      <label className="check-label field-check">
        <input
          type="checkbox"
          disabled={schema.const !== undefined || schema.enum?.length === 1}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {title}
        {(schema.const === true ||
          (schema.enum?.[0] === true && schema.enum.length === 1)) && (
          <ShieldCheck size={14} />
        )}
      </label>
    );
  if (schema.enum)
    return (
      <label className="field">
        {title}
        <select
          value={String(value ?? schema.enum[0])}
          onChange={(e) => onChange(e.target.value)}
        >
          {schema.enum.map((v) => (
            <option key={String(v)} value={String(v)}>
              {options[String(v)] ?? String(v)}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label className="field">
      {title}
      <input
        type={
          schema.type === "number" || schema.type === "integer"
            ? "number"
            : name.includes("session_")
              ? "time"
              : "text"
        }
        step={schema.type === "integer" ? 1 : "any"}
        min={
          schema.minimum ??
          (schema.exclusiveMinimum !== undefined
            ? schema.exclusiveMinimum + 0.0001
            : undefined)
        }
        max={schema.maximum}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            schema.type === "number" || schema.type === "integer"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </label>
  );
}
export function readDrafts(): Draft[] {
  try {
    const v = JSON.parse(
      localStorage.getItem("astra.strategy-drafts.v1") ?? "[]",
    );
    return Array.isArray(v) ? v.filter((d) => validate(d)) : [];
  } catch {
    return [];
  }
}
export function Constructor({
  kind,
  existing,
  onClose,
  onSave,
}: {
  kind: Kind;
  existing?: Draft;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => existing ?? makeDraft(kind));
  const [errors, setErrors] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const set = (key: string, value: any) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setChecked(false);
    setErrors([]);
  };
  const b = branch(draft.kind);
  const overlay = draft.kind === "Event" || draft.kind === "RiskOff";
  function check() {
    const ok = validate(draft);
    const e = ok
      ? []
      : (validate.errors ?? [])
          .filter((x) => !["const", "oneOf"].includes(x.keyword))
          .slice(0, 4)
          .map((x) => `${x.instancePath || "Профиль"}: ${x.message}`);
    if (!overlay) {
      if (draft.lots > draft.max_lots)
        e.push("Объём входа превышает максимальную позицию.");
      if (
        draft.tp.reduce((a: number, t: any) => a + Number(t.share_pct), 0) !==
        100
      )
        e.push("Доли TP должны составлять 100%.");
      if (
        draft.tp.some(
          (t: any, i: number) =>
            i > 0 && t.target_pct <= draft.tp[i - 1].target_pct,
        )
      )
        e.push("Цели TP должны строго возрастать.");
    }
    if (draft.params.session_from >= draft.params.session_to)
      e.push("Конец окна должен быть позже начала.");
    setErrors(e);
    setChecked(e.length === 0);
    return e.length === 0;
  }
  return (
    <div className="constructor">
      <button className="text-button mb-5" onClick={onClose}>
        <ArrowLeft size={16} /> Все стратегии
      </button>
      <div className="section-heading">
        <div>
          <div className="eyebrow">КОНСТРУКТОР СТРАТЕГИИ</div>
          <h2>{catalog[draft.kind as Kind].title}</h2>
          <p>{catalog[draft.kind as Kind].description}</p>
        </div>
        <span className="badge muted-badge">Черновик · Paper</span>
      </div>
      <div className="builder-layout">
        <div className="panel builder-form">
          <div className="form-grid">
            <label className="field">
              Название / ID
              <input
                required
                value={draft.id}
                onChange={(e) => set("id", e.target.value)}
              />
            </label>
            <label className="field">
              Класс
              <select
                value={draft.kind}
                onChange={(e) => {
                  setDraft(makeDraft(e.target.value as Kind));
                  setChecked(false);
                  setErrors([]);
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {catalog[k].title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field span-2">
              Инструменты · SECID:BOARDID через запятую
              <input
                key={draft.kind}
                defaultValue={draft.instrument_ids.join(", ")}
                onChange={(e) =>
                  set(
                    "instrument_ids",
                    e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </div>
          <h3>Разрешённые режимы</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(regimes).map(([r, m]) => {
              const allowed = (
                b.properties.regimes.items.enum as string[]
              ).includes(r);
              return (
                <label
                  key={r}
                  className={`regime-choice ${!allowed ? "unavailable" : ""}`}
                  style={{ color: m.color }}
                >
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={draft.regimes.includes(r)}
                    onChange={(e) =>
                      set(
                        "regimes",
                        e.target.checked
                          ? [...draft.regimes, r]
                          : draft.regimes.filter((x: string) => x !== r),
                      )
                    }
                  />
                  {m.icon} {m.label}
                </label>
              );
            })}
          </div>
          <h3>{overlay ? "Правила надстройки" : "Правило входа"}</h3>
          <div className="form-grid">
            {Object.entries(
              (b.properties.params as unknown as Schema).properties ?? {},
            ).map(([key, s]) => (
              <Field
                key={key}
                name={key}
                schema={s}
                value={draft.params[key]}
                onChange={(v) => set("params", { ...draft.params, [key]: v })}
              />
            ))}
          </div>
          {!overlay && (
            <>
              <h3>Позиция и защита</h3>
              <div className="form-grid">
                <label className="field">
                  Объём входа, лоты
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.lots}
                    onChange={(e) => set("lots", Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  Максимальная позиция, лоты
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.max_lots}
                    onChange={(e) => set("max_lots", Number(e.target.value))}
                  />
                </label>
                <label className="check-label span-2">
                  <input
                    type="checkbox"
                    disabled={draft.kind === "BondSpread"}
                    checked={draft.short}
                    onChange={(e) => set("short", e.target.checked)}
                  />{" "}
                  Разрешить short · дополнительно нужны права брокера и режима
                  торгов
                </label>
                <Field
                  name="mode"
                  schema={{
                    enum:
                      draft.kind === "MeanReversion"
                        ? ["level"]
                        : draft.kind === "BondSpread"
                          ? ["points"]
                          : ["pct", "rub", "atr", "level", "trailing"],
                  }}
                  value={draft.stop.mode}
                  onChange={(v) =>
                    set("stop", {
                      ...draft.stop,
                      mode: v,
                      ...(v === "trailing"
                        ? { initial_pct: 2, activation_pct: 1 }
                        : {}),
                    })
                  }
                />
                <Field
                  name="value"
                  schema={{ type: "number", exclusiveMinimum: 0 }}
                  value={draft.stop.value}
                  onChange={(v) => set("stop", { ...draft.stop, value: v })}
                />
                {draft.stop.mode === "trailing" &&
                  ["initial_pct", "activation_pct"].map((k) => (
                    <Field
                      key={k}
                      name={k}
                      schema={{
                        type: "number",
                        minimum: k === "activation_pct" ? 0 : 0.01,
                      }}
                      value={draft.stop[k]}
                      onChange={(v) => set("stop", { ...draft.stop, [k]: v })}
                    />
                  ))}
                {[
                  "breakeven_pct",
                  ...(draft.kind === "BondSpread" ? ["yield_bps"] : []),
                ].map((k) => (
                  <label key={k} className="field">
                    {labels[k]} · необязательно
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={draft.stop[k] ?? ""}
                      onChange={(e) => {
                        const s = { ...draft.stop };
                        if (e.target.value === "") delete s[k];
                        else s[k] = Number(e.target.value);
                        set("stop", s);
                      }}
                    />
                  </label>
                ))}
              </div>
              <h3>Тейк-профит</h3>
              <div className="flex gap-2 mb-4">
                <button
                  className={`chip ${draft.tp.length === 1 ? "selected" : ""}`}
                  onClick={() => set("tp", [{ target_pct: 3, share_pct: 100 }])}
                >
                  Один уровень
                </button>
                <button
                  className={`chip ${draft.tp.length === 3 ? "selected" : ""}`}
                  onClick={() =>
                    set("tp", [
                      { target_pct: 2, share_pct: 30 },
                      { target_pct: 4, share_pct: 30 },
                      { target_pct: 6, share_pct: 40 },
                    ])
                  }
                >
                  Лестница 30 / 30 / 40
                </button>
              </div>
              {draft.tp.map((tp: any, i: number) => (
                <div className="tp-row" key={i}>
                  <span className="step-number">{i + 1}</span>
                  <label className="field">
                    Цель, %
                    <input
                      type="number"
                      step="any"
                      min=".01"
                      value={tp.target_pct}
                      onChange={(e) =>
                        set(
                          "tp",
                          draft.tp.map((x: any, n: number) =>
                            n === i
                              ? { ...x, target_pct: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Доля позиции, %
                    <input
                      type="number"
                      step="any"
                      min=".01"
                      max="100"
                      value={tp.share_pct}
                      onChange={(e) =>
                        set(
                          "tp",
                          draft.tp.map((x: any, n: number) =>
                            n === i
                              ? { ...x, share_pct: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </>
          )}
          <h3>Приоритет и лимиты</h3>
          <div className="form-grid">
            <label className="field">
              Приоритет · меньше = выше
              <input
                type="number"
                min="0"
                value={draft.priority}
                onChange={(e) => set("priority", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Политика риска
              <input
                value={draft.risk_policy_id}
                onChange={(e) => set("risk_policy_id", e.target.value)}
              />
            </label>
          </div>
        </div>
        <aside className="panel builder-aside">
          <ShieldCheck className="accent" size={28} />
          <h3>Риск — прежде входа</h3>
          <p>
            Запреты рынка и дневной стоп всегда сильнее разрешений стратегии.
          </p>
          <div className="aside-rule">
            <span>Исполнение</span>
            <b>Только LIMIT</b>
          </div>
          <div className="aside-rule">
            <span>Рабочий набор</span>
            <b>Один на тикер</b>
          </div>
          <div className="aside-rule">
            <span>Среда черновика</span>
            <b>Paper</b>
          </div>
          <h3>Проверка режима</h3>
          {(["FLAT", "UPTREND", "DOWNTREND", "SHOCK"] as Regime[]).map((r) => (
            <div className="aside-rule" key={r}>
              <span style={{ color: regimes[r].color }}>
                {regimes[r].label}
              </span>
              <b>
                {overlay
                  ? "Контроль"
                  : draft.regimes.includes(r)
                    ? "Право на вход"
                    : "Вход запрещён"}
              </b>
            </div>
          ))}
          <div className="notice mt-5">
            Черновик хранится в этом браузере. Сохранение не запускает стратегию
            и не выставляет заявки.
          </div>
          <p className="mt-4">
            Полная активация профилей пока не поддерживается paper-движком.
            Перед подключением он должен проверить стоп, инструменты и доступные
            функции.
          </p>
        </aside>
      </div>
      {errors.length > 0 && (
        <div role="alert" className="notice error mt-4">
          <AlertCircle size={17} />
          <div>
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        </div>
      )}
      {checked && (
        <div role="status" className="notice success mt-4">
          <Check size={17} /> Структура и распределение TP корректны. Это не
          проверка исполнимости сделки.
        </div>
      )}
      <div className="builder-actions">
        <button className="secondary" onClick={check}>
          <ShieldCheck size={16} /> Проверить профиль
        </button>
        <button
          className="secondary"
          onClick={() => {
            if (check())
              download(
                draft,
                `${draft.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
              );
          }}
        >
          <Download size={16} /> JSON
        </button>
        <button
          className="primary"
          onClick={() => {
            if (check()) onSave(draft);
          }}
        >
          <Save size={16} /> Сохранить черновик
        </button>
      </div>
    </div>
  );
}
export function RiskEditor() {
  const [value, setValue] = useState<Draft>(() => {
    try {
      const d = JSON.parse(
        localStorage.getItem("astra.risk-draft.v1") ?? "null",
      );
      return d && validateRisk(d) ? d : riskExample;
    } catch {
      return riskExample;
    }
  });
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="panel">
      <div className="section-heading">
        <div>
          <h3>Политика риска</h3>
          <p>Локальный черновик · не изменяет действующие лимиты движка</p>
        </div>
        <ShieldCheck className="accent" />
      </div>
      <div className="form-grid">
        {Object.entries(riskSchema.properties as Record<string, Schema>)
          .filter(([, s]) => s.type === "number" || s.type === "integer")
          .map(([k, s]) =>
            k === "version" ? null : (
              <Field
                key={k}
                name={k}
                schema={s as Schema}
                value={value[k]}
                onChange={(v) => {
                  setValue({ ...value, [k]: v });
                  setMessage("");
                }}
              />
            ),
          )}
      </div>
      {message && (
        <div
          role="status"
          className={`notice mt-5 ${invalid ? "error" : "success"}`}
        >
          {message}
        </div>
      )}
      <div className="builder-actions">
        <button
          className="secondary"
          onClick={() => {
            if (validateRisk(value)) {
              download(value, "risk-policy.json");
              setInvalid(false);
              setMessage("JSON выгружен.");
            } else {
              setInvalid(true);
              setMessage(
                "Проверьте положительные лимиты и диапазоны процентов.",
              );
            }
          }}
        >
          <Download size={16} /> JSON
        </button>
        <button
          className="primary"
          onClick={() => {
            if (validateRisk(value)) {
              try {
                localStorage.setItem(
                  "astra.risk-draft.v1",
                  JSON.stringify(value),
                );
                setInvalid(false);
                setMessage("Черновик сохранён в браузере.");
              } catch {
                setInvalid(true);
                setMessage(
                  "Браузер запретил сохранение. Используйте экспорт JSON.",
                );
              }
            } else {
              setInvalid(true);
              setMessage(
                "Проверьте положительные лимиты и диапазоны процентов.",
              );
            }
          }}
        >
          <Save size={16} /> Сохранить черновик
        </button>
      </div>
    </div>
  );
}
