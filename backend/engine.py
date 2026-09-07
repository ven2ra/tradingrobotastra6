"""Executable paper reference; no live broker connectivity."""
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from typing import Protocol
from uuid import uuid4

MSK = timezone(timedelta(hours=3))
ALLOWED = {'Grid': {'FLAT'}, 'Trend': {'UPTREND', 'DOWNTREND'},
           'MeanReversion': {'FLAT'}, 'BondSpread': {'FLAT', 'UPTREND', 'DOWNTREND'},
           'Breakout': {'FLAT', 'UPTREND', 'DOWNTREND'}, 'Momentum': {'FLAT', 'UPTREND', 'DOWNTREND'}}

@dataclass(frozen=True)
class Tick:
    ticker: str
    regime: str
    price: D
    bid: D
    ask: D
    time: datetime
    session: str = 'DEMO'
    lot_size: int = 1
    price_step: D = D('.01')
    kind: str = 'stock'
    nominal: D = D('1000')
    nkd: D = D('0')
    mean: D = D('100')
    atr: D = D('1')
    high_n: D = D('102')
    low_n: D = D('98')
    adx: D = D('25')
    rsi: D = D('50')
    ytm: D | None = None
    duration: D | None = None
    spread_bps: D | None = None
    rating_rank: int | None = None
    hours_to_event: D | None = None
    calendar_complete: bool = True
    session_open: bool = True
    broker_short: bool = False
    board_short: bool = False
    imoex_pct: D = D('0')

    def unit(self, price):
        return price * self.nominal / 100 + self.nkd if self.kind == 'bond' else price

    def delta(self, price_delta):
        return price_delta * self.nominal / 100 if self.kind == 'bond' else price_delta

@dataclass(frozen=True)
class Stop:
    mode: str = 'pct'
    value: D = D('2')
    initial_pct: D = D('2')
    activation_pct: D = D('1')
    breakeven_pct: D | None = None
    yield_bps: D | None = None

@dataclass(frozen=True)
class Config:
    id: str
    kind: str
    regimes: frozenset[str]
    priority: int = 100
    lots: int = 1
    max_lots: int = 10
    short: bool = False
    stop: Stop = field(default_factory=Stop)
    tp: tuple = ((D('3'), D('100')),)
    params: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.kind not in ALLOWED or not self.regimes or not self.regimes <= ALLOWED[self.kind]:
            raise ValueError('Forbidden strategy/regime combination')
        if type(self.lots) is not int or self.lots <= 0 or self.max_lots < self.lots:
            raise ValueError('Invalid lots')
        if self.stop.mode not in {'pct', 'rub', 'atr', 'level', 'trailing', 'points'} or self.stop.value <= 0:
            raise ValueError('Invalid stop')
        if self.stop.initial_pct <= 0 or self.stop.activation_pct < 0 or (self.stop.yield_bps is not None and self.stop.yield_bps <= 0):
            raise ValueError('Invalid protective threshold')
        if not self.tp or sum(w for _, w in self.tp) != 100 or any(p <= 0 or w <= 0 for p, w in self.tp):
            raise ValueError('TP weights must total 100')
        if [p for p, _ in self.tp] != sorted({p for p, _ in self.tp}):
            raise ValueError('TP targets must strictly increase')

@dataclass(frozen=True)
class RiskPolicy:
    trade_risk_rub: D = D('1000')
    max_weight_pct: D = D('20')
    max_positions: int = 10
    daily_turnover_rub: D = D('1000000')
    daily_loss_rub: D = D('5000')
    weekly_drawdown_pct: D = D('5')
    cooldown_seconds: int = 900
    max_spread_bps: D = D('100')
    stale_seconds: int = 10
    fee_bps: D = D('5')
    slippage_bps: D = D('20')
    event_block_hours: D = D('24')
    event_close_hours: D = D('0')
    imoex_stop_pct: D = D('-5')

    def __post_init__(self):
        if min(self.trade_risk_rub, self.max_weight_pct, self.max_positions, self.daily_turnover_rub,
               self.daily_loss_rub, self.weekly_drawdown_pct, self.max_spread_bps, self.stale_seconds) <= 0:
            raise ValueError('Risk limits must be positive')
        if max(self.max_weight_pct, self.weekly_drawdown_pct) > 100 or self.imoex_stop_pct >= 0:
            raise ValueError('Invalid percentage')
        if min(self.cooldown_seconds, self.fee_bps, self.slippage_bps, self.event_block_hours, self.event_close_hours) < 0:
            raise ValueError('Negative buffer')

@dataclass
class Position:
    lots: int
    entry: D
    entry_dirty: D
    initial_lots: int
    config: Config
    best: D
    atr_at_entry: D
    entry_ytm: D | None = None
    tp_done: int = 0

@dataclass(frozen=True)
class Intent:
    ticker: str
    config: Config
    side: str
    lots: int
    price: D
    rule: str
    reduce_only: bool = False
    emergency: str | None = None
    tp_index: int | None = None

@dataclass(frozen=True)
class OrderDraft:
    id: str
    intent: Intent
    order_type: str
    reserve: D

@dataclass
class State:
    cash: D = D('100000')
    equity: D = D('100000')
    day_start: D = D('100000')
    week_peak: D = D('100000')
    session: str = 'DEMO'
    day_stopped: bool = False
    turnover: D = D('0')
    positions: dict = field(default_factory=dict)
    pending: dict = field(default_factory=dict)
    cooldown: dict = field(default_factory=dict)
    journal: list = field(default_factory=list)

def bond_pnl(lots, lot_size, entry_clean, entry_nominal, entry_nkd,
             clean, nominal, nkd, coupons=D('0'), amortization=D('0'), fees=D('0')):
    return lots * lot_size * (clean * nominal / 100 + nkd + coupons + amortization
                             - entry_clean * entry_nominal / 100 - entry_nkd) - fees

def stop_level(p, t):
    s, direction = p.config.stop, D(1 if p.lots > 0 else -1)
    if s.mode == 'level': return s.value
    distances = {'pct': p.entry * s.value / 100, 'atr': p.atr_at_entry * s.value,
                 'points': s.value, 'trailing': p.entry * s.initial_pct / 100}
    per_unit = s.value / (p.initial_lots * t.lot_size)
    distances['rub'] = per_unit * 100 / t.nominal if t.kind == 'bond' else per_unit
    level = p.entry - direction * distances[s.mode]
    gain = direction * (p.best - p.entry) / p.entry * 100
    if s.mode == 'trailing' and gain >= s.activation_pct:
        trail = p.best * (1 - direction * s.value / 100)
        level = max(level, trail) if direction > 0 else min(level, trail)
    if s.breakeven_pct is not None and gain >= s.breakeven_pct:
        level = max(level, p.entry) if direction > 0 else min(level, p.entry)
    return level

class Strategy(Protocol):
    config: Config
    def on_tick(self, ctx: Tick) -> list[Intent]: ...

class Plugin:
    def __init__(self, config): self.config = config
    def signal(self, t): raise NotImplementedError
    def on_tick(self, ctx):
        if ctx.regime not in self.config.regimes: return []
        signal = self.signal(ctx)
        if not signal: return []
        side, rule = signal
        return [Intent(ctx.ticker, self.config, side, self.config.lots,
                       ctx.ask if side == 'BUY' else ctx.bid, rule)]

class Grid(Plugin):
    def signal(self, t):
        p = self.config.params
        step = D(str(p.get('step', 1))) * (t.atr if p.get('step_unit') == 'atr' else t.mean / 100)
        if step <= 0: return None
        return ('BUY', 'grid lower level') if 1 <= (t.mean - t.price) / step <= p.get('levels_down', 5) else None

class Trend(Plugin):
    def signal(self, t):
        if t.adx < D(str(self.config.params.get('adx_min', 20))): return None
        # breakout_margin_pct lets an entry fire within that % of the
        # breakout level instead of requiring price to have already cleared
        # it outright; 0 (default) reproduces the original strict breakout.
        margin = D(str(self.config.params.get('breakout_margin_pct', 0))) / 100
        if t.regime == 'UPTREND' and t.price > max(t.high_n, t.mean) * (1 - margin): return 'BUY', 'N-bar breakout + MA + ADX'
        if t.regime == 'DOWNTREND' and t.price < min(t.low_n, t.mean) * (1 + margin): return 'SELL', 'N-bar breakdown + MA + ADX'
        return None

class MeanReversion(Plugin):
    def signal(self, t):
        p = self.config.params
        if t.price <= t.mean - t.atr * D(str(p.get('deviation', 2))) and t.rsi <= D(str(p.get('rsi_low', 30))):
            return 'BUY', 'mean deviation + RSI oversold'
        return None

class BondSpread(Plugin):
    def signal(self, t):
        if t.kind != 'bond' or any(v is None for v in (t.ytm, t.duration, t.spread_bps, t.rating_rank)): return None
        p = self.config.params
        if (t.ytm >= D(str(p.get('min_ytm', 12))) and t.duration <= D(str(p.get('max_duration', 3)))
                and t.rating_rank <= p.get('max_rating_rank', 3) and t.spread_bps >= D(str(p.get('spread_bps', 150)))):
            return 'BUY', 'YTM + duration + rating + OFZ spread'
        return None

class RiskEngine:
    def __init__(self, policy: RiskPolicy, state: State):
        if not isinstance(policy, RiskPolicy): raise ValueError('RiskPolicy is mandatory')
        self.policy, self.state = policy, state

    def log(self, t, strategy, action, reason, intent=None, order=None):
        self.state.journal.append(dict(time=t.time.astimezone(MSK).isoformat(), ticker=t.ticker,
            regime=t.regime, strategy=strategy, action=action, reason=reason,
            price=str(intent.price) if intent else None, lots=intent.lots if intent else 0,
            status='DRAFT' if order else 'NO_ORDER', order_id=order.id if order else None))

    def latch(self):
        s = self.state
        s.week_peak = max(s.week_peak, s.equity)
        s.day_stopped |= s.day_start - s.equity >= self.policy.daily_loss_rub

    def begin_session(self, session):
        # Called by trusted exchange calendar after account reconciliation.
        s = self.state
        if session != s.session:
            if s.pending: raise RuntimeError('Reconcile pending orders before rollover')
            s.session, s.day_start, s.day_stopped, s.turnover = session, s.equity, False, D('0')

    def blocked(self, t):
        s, p = self.state, self.policy
        if s.day_stopped: return 'daily stop latched'
        if s.equity <= 0: return 'nonpositive equity'
        if s.week_peak - s.equity >= s.week_peak * p.weekly_drawdown_pct / 100: return 'weekly drawdown'
        if t.imoex_pct <= p.imoex_stop_pct: return 'IMOEX risk-off'
        if t.regime not in {'FLAT', 'UPTREND', 'DOWNTREND'}: return 'regime prohibits entries'
        if not t.calendar_complete: return 'calendar unavailable'
        if t.hours_to_event is not None and 0 <= t.hours_to_event <= p.event_block_hours: return 'event blackout'
        return None

    def reject_reason(self, t, i, now):
        s, p, c = self.state, self.policy, i.config
        if i.ticker != t.ticker or i.side not in {'BUY', 'SELL'} or type(i.lots) is not int or i.lots <= 0: return 'invalid intent'
        if t.session != s.session or not t.session_open: return 'session closed/mismatch'
        if not 0 <= (now - t.time).total_seconds() <= p.stale_seconds: return 'stale/future tick'
        if t.regime not in {'FLAT', 'UPTREND', 'DOWNTREND', 'SHOCK'}: return 'all orders prohibited by regime'
        if min(t.bid, t.ask, i.price, t.price_step, t.lot_size, t.nominal) <= 0 or t.ask < t.bid or t.nkd < 0: return 'invalid quote/metadata'
        if i.price % t.price_step: return 'price not aligned to tick size'
        if i.emergency and (not i.reduce_only or i.emergency not in {'SHOCK', 'DAILY_STOP', 'FORCED_EXIT'}): return 'invalid market order'
        if t.ticker in s.pending: return 'working order set exists; cancel acknowledgement required'
        if i.reduce_only:
            pos = s.positions.get(t.ticker)
            if not pos or i.side != ('SELL' if pos.lots > 0 else 'BUY') or i.lots > abs(pos.lots): return 'reduce-only would open/reverse'
            return None
        block = self.blocked(t)
        if block: return block
        if t.regime not in c.regimes or t.regime not in ALLOWED.get(c.kind, set()): return 'strategy regime forbidden'
        if i.side == 'SELL' and not (c.short and t.kind == 'stock' and t.broker_short and t.board_short): return 'short not authorized'
        if t.ticker in s.positions: return 'reference plugins disable pyramiding; position has owner'
        if t.time < s.cooldown.get(t.ticker, t.time): return 'cooldown after stop'
        if (t.ask - t.bid) / t.bid * 10000 > p.max_spread_bps: return 'spread limit'
        if i.lots > c.max_lots: return 'strategy lots limit'
        q = i.lots * t.lot_size
        value = t.unit(i.price) * q
        pos = Position(i.lots if i.side == 'BUY' else -i.lots, i.price, t.unit(i.price), i.lots, c, i.price, t.atr, t.ytm)
        sl = stop_level(pos, t)
        if sl <= 0 or (i.price - sl) * (1 if i.side == 'BUY' else -1) <= 0: return 'stop on wrong side'
        if c.kind == 'MeanReversion' and not (c.stop.mode == 'level' and sl < t.low_n): return 'hard stop below extremum required'
        if c.stop.yield_bps is not None and (t.kind != 'bond' or t.ytm is None): return 'yield stop requires bond YTM'
        risk = abs(t.delta(i.price - sl)) * q + value * (2 * p.fee_bps + p.slippage_bps) / 10000
        if risk > p.trade_risk_rub: return 'risk per trade including fees/slippage'
        if value > s.equity * p.max_weight_pct / 100: return 'instrument weight'
        entries = [o for o in s.pending.values() if not o.intent.reduce_only]
        if len(set(s.positions) | {o.intent.ticker for o in entries}) >= p.max_positions: return 'position count with reservations'
        reserved = sum(o.reserve for o in entries)
        if s.turnover + reserved + value > p.daily_turnover_rub: return 'daily turnover with reservations'
        if reserved + value * (1 + p.fee_bps / 10000) > s.cash: return 'cash with reservations'
        return None

    def evaluate(self, t, intents, now):
        self.latch()
        result = []
        for i in sorted(intents, key=lambda x: (not x.reduce_only, x.config.priority, x.config.id)):
            reason = self.reject_reason(t, i, now)
            if reason:
                self.log(t, i.config.id, 'REJECT', f'{i.rule}; {reason}', i)
                continue
            reserve = D('0') if i.reduce_only else t.unit(i.price) * i.lots * t.lot_size * (1 + self.policy.fee_bps / 10000)
            order = OrderDraft(str(uuid4()), i, 'MARKET' if i.emergency else 'LIMIT', reserve)
            self.state.pending[t.ticker] = order
            result.append(order)
            self.log(t, i.config.id, 'SUBMIT', i.rule, i, order)
        return result

    def protective(self, t):
        p = self.state.positions.get(t.ticker)
        if not p: return []
        long = p.lots > 0
        mark = t.bid if long else t.ask
        p.best = max(p.best, mark) if long else min(p.best, mark)
        emergency = 'DAILY_STOP' if self.state.day_stopped else ('SHOCK' if t.regime == 'SHOCK' else None)
        rule, lots, tp_index = '', abs(p.lots), None
        sl = stop_level(p, t)
        if emergency: rule = emergency
        elif t.imoex_pct <= self.policy.imoex_stop_pct: rule = 'IMOEX defensive exit'
        elif self.blocked(t) == 'weekly drawdown': rule = 'weekly drawdown exit'
        elif (long and mark <= sl) or (not long and mark >= sl): rule = 'position stop'
        elif p.config.stop.yield_bps is not None and t.ytm is not None and p.entry_ytm is not None and (t.ytm - p.entry_ytm) * 100 >= p.config.stop.yield_bps: rule = 'bond yield stop'
        elif t.hours_to_event is not None and self.policy.event_close_hours > 0 and 0 <= t.hours_to_event <= self.policy.event_close_hours: rule = 'calendar exit'
        elif p.config.kind == 'MeanReversion' and mark >= t.mean: rule = 'return to mean'
        elif p.config.kind == 'Grid':
            step = D(str(p.config.params.get('step', 1))) * (p.atr_at_entry if p.config.params.get('step_unit') == 'atr' else p.entry / 100)
            if mark >= p.entry + step: rule = 'reverse grid level'
        elif p.config.kind == 'BondSpread' and t.ytm is not None and t.ytm <= D(str(p.config.params.get('target_ytm', 10))): rule = 'target YTM'
        if not rule and p.tp_done < len(p.config.tp):
            target, share = p.config.tp[p.tp_done]
            if (mark - p.entry) / p.entry * (100 if long else -100) >= target:
                rule, tp_index = 'TP ladder', p.tp_done
                lots = abs(p.lots) if p.tp_done == len(p.config.tp) - 1 else min(abs(p.lots), max(1, int(p.initial_lots * share / 100)))
        if not rule: return []
        return [Intent(t.ticker, p.config, 'SELL' if long else 'BUY', lots, mark, rule, True, emergency, tp_index)]

class PaperBroker:
    """Full fills, immediate cancellation ACK. Never connected to live account."""
    def __init__(self, risk): self.risk = risk
    def cancel(self, t):
        o = self.risk.state.pending.pop(t.ticker, None)
        if o:
            self.risk.log(t, o.intent.config.id, 'CANCEL', 'paper cancellation acknowledged', o.intent, o)
            self.risk.state.journal[-1]['status'] = 'CANCELLED'
    def match(self, t):
        s = self.risk.state
        o = s.pending.get(t.ticker)
        if not o or t.regime not in {'FLAT', 'UPTREND', 'DOWNTREND', 'SHOCK'} or not t.session_open: return
        i = o.intent
        px = t.ask if i.side == 'BUY' else t.bid
        if o.order_type == 'LIMIT' and ((i.side == 'BUY' and px > i.price) or (i.side == 'SELL' and px < i.price)): return
        value = t.unit(px) * i.lots * t.lot_size
        s.cash += (-value if i.side == 'BUY' else value) - value * self.risk.policy.fee_bps / 10000
        s.turnover += value
        if i.reduce_only:
            p = s.positions[i.ticker]
            p.lots += i.lots if i.side == 'BUY' else -i.lots
            if i.tp_index is not None: p.tp_done = i.tp_index + 1
            if 'stop' in i.rule.lower() or i.emergency: s.cooldown[i.ticker] = t.time + timedelta(seconds=self.risk.policy.cooldown_seconds)
            if p.lots == 0: del s.positions[i.ticker]
        else:
            s.positions[i.ticker] = Position(i.lots if i.side == 'BUY' else -i.lots, px, t.unit(px), i.lots, i.config, px, t.atr, t.ytm)
        del s.pending[i.ticker]
        self.risk.log(t, i.config.id, 'FILL', i.rule, replace(i, price=px), o)
        s.journal[-1]['status'] = 'FILLED'

class Engine:
    def __init__(self, policy, plugins):
        self.state = State()
        self.risk = RiskEngine(policy, self.state)
        self.broker = PaperBroker(self.risk)
        self.plugins, self.marks = plugins, {}
    def mark_equity(self):
        self.state.equity = self.state.cash + sum(self.marks[k].unit(self.marks[k].bid if p.lots > 0 else self.marks[k].ask) * p.lots * self.marks[k].lot_size for k, p in self.state.positions.items())
    def tick(self, t, now=None):
        now = now or t.time
        numeric = (t.price, t.bid, t.ask, t.price_step, t.nominal, t.nkd, t.atr, t.mean)
        if (any(not v.is_finite() for v in numeric) or min(t.price, t.bid, t.ask, t.price_step, t.nominal, t.atr, t.mean) <= 0
                or t.ask < t.bid or t.nkd < 0 or type(t.lot_size) is not int or t.lot_size <= 0):
            self.risk.log(t, 'RiskOff', 'REJECT', 'invalid quote/metadata; no state update')
            return []
        if t.session != self.state.session:
            self.risk.log(t, 'RiskOff', 'REJECT', 'session mismatch; calendar reconciliation required')
            return []
        if not 0 <= (now - t.time).total_seconds() <= self.risk.policy.stale_seconds:
            self.risk.log(t, 'RiskOff', 'REJECT', 'stale/future tick; no state update')
            return []
        self.marks[t.ticker] = t
        self.mark_equity()
        self.risk.latch()
        if self.state.day_stopped or self.risk.blocked(t) in {'weekly drawdown', 'IMOEX risk-off'}:
            for ticker, order in list(self.state.pending.items()):
                if not order.intent.reduce_only:
                    self.broker.cancel(replace(self.marks.get(ticker, t), time=t.time))
        defensive = self.risk.protective(t)
        pending = self.state.pending.get(t.ticker)
        if pending and (defensive or (not pending.intent.reduce_only and (self.risk.blocked(t) or t.regime not in pending.intent.config.regimes))): self.broker.cancel(t)
        intents = list(defensive)
        for plugin in self.plugins.get(t.ticker, []):
            generated = plugin.on_tick(t)
            intents.extend(generated)
            if not generated: self.risk.log(t, plugin.config.id, 'HOLD', 'regime forbidden' if t.regime not in plugin.config.regimes else 'entry condition false')
        if not intents and not self.plugins.get(t.ticker): self.risk.log(t, 'RiskOff', 'HOLD', self.risk.blocked(t) or 'no strategy assigned')
        drafts = self.risk.evaluate(t, intents, now)
        if t.session == self.state.session: self.broker.match(t)
        self.mark_equity()
        self.risk.latch()
        return drafts

def demo():
    cfg = Config('grid-sber', 'Grid', frozenset({'FLAT'}))
    engine = Engine(RiskPolicy(), {'SBER': [Grid(cfg)]})
    now = datetime.now(timezone.utc)
    for n, (regime, price) in enumerate([('UPTREND', '98'), ('FLAT', '98'), ('SHOCK', '95')]):
        px = D(price)
        engine.tick(Tick('SBER', regime, px, px, px + D('.01'), now + timedelta(seconds=n), lot_size=10))
    return engine

if __name__ == '__main__':
    import json
    print(json.dumps(demo().state.journal, ensure_ascii=False, indent=2))
