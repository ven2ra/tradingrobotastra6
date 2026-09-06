import { useState } from "react";
import Ajv2020 from "ajv/dist/2020";
import {
  ArrowLeft,
  Download,
  Save,
  ShieldCheck,
  Check,
  AlertCircle,
  CircleHelp,
  Zap,
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
const hints: Record<string, string> = {
  step_unit:
    "В чём измеряется шаг сетки: проценты от цены, ATR или фиксированные пункты.",
  step: "Расстояние между соседними уровнями сетки в выбранных единицах.",
  levels_up: "Сколько лимитных уровней ставится выше текущей цены.",
  levels_down: "Сколько уровней ставится ниже текущей цены.",
  anchor:
    "От чего отсчитывать сетку: от последней цены или от зафиксированного значения.",
  fixed_anchor: "Цена, от которой строится сетка, если якорь зафиксирован.",
  exit: "Как закрывать позицию по сетке: по обратному уровню или по тейк-профиту.",
  outside_flat:
    "Что делать, если рынок вышел из флэта: отменить неисполненные входы или просто запретить новые.",
  lookback:
    "Число последних баров, по которым ищутся максимум и минимум для пробоя (канал Дончиана).",
  ma: "Тип скользящей средней, используемой как фильтр направления тренда.",
  ma_period: "Период скользящей средней в барах.",
  adx_min:
    "Минимальное значение индикатора ADX, при котором тренд считается достаточно сильным для входа.",
  pyramiding:
    "Разрешить ли докупать в позицию по мере движения цены в вашу сторону.",
  enabled: "Включает или выключает этот блок правил.",
  max_additions: "Максимальное число дополнительных входов сверх первого.",
  add_every_atr:
    "Через сколько ATR движения цены добавляется следующая часть позиции.",
  range_bars: "Число баров, за которые формируется диапазон перед пробоем.",
  min_volume_ratio:
    "Во сколько раз объём на пробое должен превышать средний, чтобы сигнал считался подтверждённым.",
  cancel_on_reentry:
    "Отменять неисполненную заявку, если цена вернулась обратно в диапазон.",
  session_from:
    "Время начала окна, в которое стратегии разрешено работать (МСК).",
  session_to: "Время конца окна, в которое стратегии разрешено работать (МСК).",
  confirmation_bars:
    "Сколько баров подряд должны подтверждать сигнал, прежде чем он считается действительным.",
  mean: "Тип средней, от которой считается отклонение цены (VWAP, SMA и т.п.).",
  period: "Число баров для расчёта средней и статистики отклонения.",
  deviation_unit:
    "В чём измеряется отклонение от средней: в процентах или в стандартных отклонениях.",
  deviation:
    "Порог отклонения цены от средней, при котором возникает сигнал на возврат.",
  rsi_low:
    "Уровень индикатора RSI, ниже которого рынок считается перепроданным.",
  rsi_high:
    "Уровень индикатора RSI, выше которого рынок считается перекупленным.",
  extremum_bars:
    "Число баров, по которым ищется локальный экстремум для размещения стопа.",
  stop_buffer_points:
    "Дополнительный отступ стопа за найденным экстремумом, в пунктах цены.",
  compression_bars:
    "Число баров, по которым оценивается сжатие волатильности перед импульсом.",
  max_atr_ratio:
    "Максимальное отношение текущего ATR к среднему, при котором рынок ещё считается сжатым.",
  min_impulse_atr:
    "Минимальный размер импульсного движения в единицах ATR, чтобы считать его сигналом.",
  time_stop_bars:
    "Через сколько баров позиция закрывается по времени, если цель не достигнута.",
  events:
    "Типы событий, перед которыми действует запрет на вход (дивиденды, купон, оферта, размещение).",
  block_hours:
    "За сколько часов до события запрещается открывать новые позиции.",
  close_before: "Закрывать ли существующую позицию заранее перед событием.",
  close_hours: "За сколько часов до события принудительно закрывается позиция.",
  missing_calendar:
    "Что делать, если календарь событий недоступен: блокировать входы или пропустить проверку.",
  min_ytm:
    "Минимальная доходность к погашению, при которой облигация проходит отбор.",
  max_duration:
    "Максимальная дюрация облигации в годах, допустимая для отбора.",
  max_rating_rank:
    "Максимально допустимый (наихудший) ранг кредитного рейтинга бумаги.",
  min_daily_turnover_rub:
    "Минимальный дневной оборот бумаги в рублях — отсекает неликвидные выпуски.",
  max_spread_bps:
    "Максимально допустимый спред bid/ask в базисных пунктах (1 bps = 0,01%).",
  signal: "Способ расчёта целевой доходности для сравнения со спредом.",
  spread_bps:
    "Пороговый спред к кривой ОФЗ в базисных пунктах, при котором возникает сигнал.",
  offer_days: "За сколько дней до оферты бумага исключается из отбора.",
  dirty_anomaly_points:
    "Порог аномалии полной (грязной) цены в пунктах, отсекающий некорректные котировки.",
  target_ytm: "Целевая доходность к погашению для сравнения с рыночной.",
  ofz_curve: "Кривая ОФЗ, используемая как база для сравнения спреда.",
  yield_basis:
    "На основании чего считается доходность для сравнения: к погашению, к оферте или худший сценарий.",
  shock:
    "Действие при рыночном режиме SHOCK: отменять входы или полностью блокировать торговлю.",
  daily_stop: "Действие при срабатывании дневного лимита убытка.",
  imoex_drop_pct:
    "Падение индекса IMOEX в процентах, при котором активируется защита.",
  cancel_entries:
    "Отменять ли неисполненные заявки на вход при срабатывании защиты.",
  allow_only_reduction:
    "Разрешать только сделки, уменьшающие риск (закрытие или сокращение позиций).",
  mode: "Тип стоп-заявки: по проценту, по сумме в рублях, по ATR, по уровню цены или трейлинг.",
  value: "Величина стопа в единицах, заданных выбранным типом (mode).",
  initial_pct: "Начальный процент стопа до активации трейлинга.",
  activation_pct:
    "После какого движения цены (в процентах) трейлинг-стоп начинает подтягиваться.",
  breakeven_pct:
    "Движение цены в процентах, после которого стоп переносится в безубыток.",
  yield_bps:
    "Изменение доходности в базисных пунктах, которое запускает стоп по облигации.",
  trade_risk_rub: "Максимальная сумма риска на одну сделку в рублях.",
  max_weight_pct:
    "Максимальная доля одной бумаги в портфеле, в процентах от капитала.",
  max_positions: "Максимальное число одновременно открытых позиций по счёту.",
  daily_turnover_rub: "Лимит дневного оборота по счёту в рублях.",
  daily_loss_rub:
    "Дневной лимит убытка в рублях. При достижении новые входы блокируются до следующей сессии.",
  weekly_drawdown_pct:
    "Максимально допустимая просадка за неделю в процентах от пикового значения капитала.",
  cooldown_seconds:
    "Пауза в секундах перед новыми входами после срабатывания стопа.",
  stale_seconds:
    "Через сколько секунд котировка считается устаревшей и перестаёт использоваться для решений.",
  fee_bps:
    "Комиссия брокера и биржи в базисных пунктах, учитываемая в расчёте P/L.",
  slippage_bps: "Запас на проскальзывание цены исполнения, в базисных пунктах.",
  event_block_hours:
    "За сколько часов до события риск-политика запрещает новый вход.",
  event_close_hours:
    "За сколько часов до события риск-политика принудительно закрывает позиции.",
  imoex_stop_pct:
    "Падение индекса IMOEX в процентах, при котором риск-политика останавливает торговлю целиком.",
};
function Hint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="field-hint-icon" role="img" aria-label={text} title={text}>
      <CircleHelp size={13} />
    </span>
  );
}
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
  const hint = hints[name];
  if (schema.type === "object")
    return (
      <fieldset className="nested-field">
        <legend>
          {title} <Hint text={hint} />
        </legend>
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
        <legend>
          {title} <Hint text={hint} />
        </legend>
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
        <Hint text={hint} />
      </label>
    );
  if (schema.enum)
    return (
      <label className="field">
        {title} <Hint text={hint} />
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
      {title} <Hint text={hint} />
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
const EXECUTABLE_KINDS: Kind[] = ["Grid", "Trend", "MeanReversion", "BondSpread"];
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
  const [activation, setActivation] = useState<{
    status: "idle" | "pending" | "ok" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const set = (key: string, value: any) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setChecked(false);
    setErrors([]);
    setActivation({ status: "idle", message: "" });
  };
  const b = branch(draft.kind);
  const overlay = draft.kind === "Event" || draft.kind === "RiskOff";
  const executable = EXECUTABLE_KINDS.includes(draft.kind as Kind);
  async function activate() {
    if (!check()) return;
    setActivation({ status: "pending", message: "" });
    try {
      const res = await fetch("/api/paper/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActivation({
          status: "error",
          message: body.detail || `Ошибка активации (HTTP ${res.status})`,
        });
        return;
      }
      setActivation({
        status: "ok",
        message: `Активирована в paper-движке на: ${(body.instrument_ids ?? []).join(", ")}`,
      });
    } catch {
      setActivation({
        status: "error",
        message: "Не удалось связаться с Paper API. Проверьте, что backend запущен.",
      });
    }
  }
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
              Название / ID{" "}
              <Hint text="Уникальный идентификатор профиля стратегии. Используется в журнале решений и в связи с политикой риска." />
              <input
                required
                value={draft.id}
                onChange={(e) => set("id", e.target.value)}
              />
            </label>
            <label className="field">
              Класс{" "}
              <Hint text="Тип стратегии из каталога: определяет правило входа и набор доступных параметров ниже." />
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
              Инструменты · SECID:BOARDID через запятую{" "}
              <Hint text="Тикеры MOEX, к которым применяется профиль, в формате КОД:РЕЖИМ_ТОРГОВ (например SBER:TQBR). Можно указать несколько через запятую." />
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
          <h3>
            Разрешённые режимы{" "}
            <Hint text="Рыночные режимы, в которых стратегии разрешено открывать новые позиции. Вне этих режимов RiskEngine отклонит вход независимо от сигнала." />
          </h3>
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
                  Объём входа, лоты{" "}
                  <Hint text="Сколько лотов покупается/продаётся одной входной заявкой." />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.lots}
                    onChange={(e) => set("lots", Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  Максимальная позиция, лоты{" "}
                  <Hint text="Верхний предел размера позиции по инструменту с учётом всех входов и докупок." />
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
                  торгов{" "}
                  <Hint text="Позволяет стратегии открывать короткие позиции (продажу без покрытия). Требует маржинального счёта и поддержки шорта по инструменту." />
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
                    {labels[k]} · необязательно <Hint text={hints[k]} />
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
              <h3>
                Тейк-профит{" "}
                <Hint text="Уровни фиксации прибыли: на каждом уровне закрывается указанная доля позиции. Сумма долей должна быть равна 100%, а цели — строго возрастать." />
              </h3>
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
                    Цель, %{" "}
                    <Hint text="На сколько процентов должна вырасти (или упасть для шорта) цена от входа, чтобы сработал этот уровень тейк-профита." />
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
                    Доля позиции, %{" "}
                    <Hint text="Какая часть текущей позиции закрывается при достижении этого уровня цели." />
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
              Приоритет · меньше = выше{" "}
              <Hint text="Если на один инструмент претендуют несколько стратегий одновременно, побеждает профиль с меньшим числом приоритета." />
              <input
                type="number"
                min="0"
                value={draft.priority}
                onChange={(e) => set("priority", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Политика риска{" "}
              <Hint text="Идентификатор риск-политики (лимиты дневного стопа, размера позиции и т.д.), которая проверяет каждую заявку этой стратегии." />
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
            «Сохранить черновик» пишет только в этот браузер и не запускает
            стратегию. «Активировать в Paper» отправляет профиль в реальный
            paper-движок backend — он начнёт получать тики и генерировать
            решения.
          </div>
          <p className="mt-4">
            {executable
              ? "Заявки остаются виртуальными: PaperBroker не подключён к брокеру и реальным деньгам."
              : "Backend пока не исполняет этот класс стратегии — активация вернёт понятную ошибку вместо запуска."}
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
      {activation.status === "ok" && (
        <div role="status" className="notice success mt-4">
          <Check size={17} /> {activation.message}
        </div>
      )}
      {activation.status === "error" && (
        <div role="alert" className="notice error mt-4">
          <AlertCircle size={17} /> {activation.message}
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
          className="secondary"
          onClick={() => {
            if (check()) onSave(draft);
          }}
        >
          <Save size={16} /> Сохранить черновик
        </button>
        <button
          className="primary"
          disabled={overlay || activation.status === "pending"}
          title={
            overlay
              ? "Event и RiskOff — надстройки риск-политики, а не отдельная торгуемая стратегия"
              : !executable
                ? "Движок пока не исполняет этот класс — активация вернёт ошибку с объяснением"
                : undefined
          }
          onClick={activate}
        >
          <Zap size={16} />{" "}
          {activation.status === "pending"
            ? "Активация…"
            : "Активировать в Paper"}
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
