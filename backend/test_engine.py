import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from engine import *

class RiskTests(unittest.TestCase):
    def setUp(self):
        self.t = Tick('SBER', 'FLAT', D('97'), D('97'), D('97.01'), datetime.now(timezone.utc), rsi=D('20'))
        self.c = Config('grid', 'Grid', frozenset({'FLAT'}))
        self.s = State()
        self.r = RiskEngine(RiskPolicy(), self.s)
    def intent(self, c=None, **kw):
        return replace(Intent('SBER', c or self.c, 'BUY', 1, D('97.01'), 'test entry'), **kw)
    def test_grid_not_uptrend_even_forged_intent(self):
        t = replace(self.t, regime='UPTREND')
        self.assertEqual(Grid(self.c).on_tick(t), [])
        self.assertEqual(self.r.evaluate(t, [self.intent()], t.time), [])
    def test_mean_reversion_not_downtrend(self):
        c = Config('mean', 'MeanReversion', frozenset({'FLAT'}), stop=Stop('level', D('95')))
        t = replace(self.t, regime='DOWNTREND')
        self.assertEqual(MeanReversion(c).on_tick(t), [])
        self.assertEqual(self.r.evaluate(t, [self.intent(c)], t.time), [])
    def test_daily_stop_latches_after_recovery(self):
        self.s.equity = D('94000')
        self.assertEqual(self.r.evaluate(self.t, [self.intent()], self.t.time), [])
        self.s.equity = D('100000')
        self.assertEqual(self.r.evaluate(self.t, [self.intent()], self.t.time), [])
        self.r.begin_session('NEXT')
        t = replace(self.t, session='NEXT')
        self.assertEqual(len(self.r.evaluate(t, [self.intent()], t.time)), 1)
    def test_bond_pnl_nkd(self):
        self.assertEqual(bond_pnl(2, 10, D('100'), D('1000'), D('10'), D('100'), D('1000'), D('15')), D('100'))
    def test_coupon_rollover_and_amortization(self):
        self.assertEqual(bond_pnl(1, 1, D('100'), D('1000'), D('20'), D('100'), D('900'), D('0'), D('20'), D('100')), D('0'))
    def test_no_risk_policy_no_engine(self):
        with self.assertRaises(ValueError): RiskEngine(None, self.s)
    def test_short_requires_three_permissions(self):
        c = Config('trend', 'Trend', frozenset({'DOWNTREND'}))
        t = replace(self.t, regime='DOWNTREND')
        self.assertEqual(self.r.evaluate(t, [self.intent(c, side='SELL', price=t.bid)], t.time), [])
    def test_conflict_priority_one_order(self):
        high = replace(self.c, id='priority', priority=1)
        out = self.r.evaluate(self.t, [self.intent(), self.intent(high)], self.t.time)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].intent.config.id, 'priority')
    def test_reduce_only_cannot_reverse(self):
        self.s.positions['SBER'] = Position(1, D('100'), D('100'), 1, self.c, D('100'), D('1'))
        self.assertEqual(self.r.evaluate(self.t, [self.intent(side='SELL', lots=2, reduce_only=True)], self.t.time), [])
    def test_low_liquidity_blocks_even_emergency(self):
        self.s.positions['SBER'] = Position(1, D('100'), D('100'), 1, self.c, D('100'), D('1'))
        t = replace(self.t, regime='LOW_LIQUIDITY')
        self.assertEqual(self.r.evaluate(t, [self.intent(side='SELL', reduce_only=True, emergency='DAILY_STOP')], t.time), [])
    def test_market_entry_forbidden(self):
        self.assertEqual(self.r.evaluate(self.t, [self.intent(emergency='SHOCK')], self.t.time), [])
    def test_risk_budget_enforced(self):
        r = RiskEngine(replace(RiskPolicy(), trade_risk_rub=D('.01')), self.s)
        self.assertEqual(r.evaluate(self.t, [self.intent()], self.t.time), [])
    def test_position_slots_include_pending(self):
        r = RiskEngine(replace(RiskPolicy(), max_positions=1), self.s)
        r.evaluate(self.t, [self.intent()], self.t.time)
        t = replace(self.t, ticker='GAZP')
        self.assertEqual(r.evaluate(t, [self.intent(ticker='GAZP')], t.time), [])
    def test_event_and_stale(self):
        for t, now in [(replace(self.t, hours_to_event=D('2')), self.t.time),
                       (self.t, self.t.time + timedelta(seconds=60))]:
            self.assertEqual(self.r.evaluate(t, [self.intent()], now), [])
    def test_paper_entry_then_shock_exit(self):
        e = demo()
        self.assertEqual(e.state.positions, {})
        self.assertEqual([j['action'] for j in e.state.journal].count('FILL'), 2)
    def test_bond_yield_stop_independent_of_price(self):
        c = Config('bond', 'BondSpread', frozenset({'FLAT'}), stop=Stop('points', D('5'), yield_bps=D('50')))
        self.s.positions['SBER'] = Position(1, D('100'), D('1000'), 1, c, D('100'), D('1'), D('12'))
        t = replace(self.t, kind='bond', price=D('100'), bid=D('100'), ask=D('100.01'), ytm=D('12.6'))
        self.assertEqual(self.r.protective(t)[0].rule, 'bond yield stop')
    def test_daily_stop_cancels_entries_for_other_tickers(self):
        e = Engine(RiskPolicy(), {})
        e.marks['SBER'] = self.t
        e.risk.evaluate(self.t, [self.intent(price=D('90'))], self.t.time)
        e.state.cash = D('94000')
        e.tick(replace(self.t, ticker='GAZP'))
        self.assertTrue(e.state.day_stopped)
        self.assertEqual(e.state.pending, {})
    def test_invalid_tick_does_not_change_equity(self):
        e = Engine(RiskPolicy(), {})
        e.tick(replace(self.t, bid=D('-1')))
        self.assertEqual(e.state.equity, D('100000'))
        self.assertEqual(e.marks, {})
    def test_trend_breakout_margin_pct_allows_entry_before_full_breakout(self):
        c = Config('trend', 'Trend', frozenset({'UPTREND'}))
        # price sits just below high_n/mean -> no breakout yet under strict (default) rules.
        t = replace(self.t, regime='UPTREND', price=D('99.5'), high_n=D('102'), mean=D('100'), adx=D('30'))
        self.assertEqual(Trend(c).on_tick(t), [])
        loose = Config('trend', 'Trend', frozenset({'UPTREND'}), params={'breakout_margin_pct': 5})
        self.assertEqual(len(Trend(loose).on_tick(t)), 1)
    def test_trend_breakout_margin_pct_default_reproduces_strict_breakout(self):
        c = Config('trend', 'Trend', frozenset({'UPTREND'}))
        t = replace(self.t, regime='UPTREND', price=D('103'), high_n=D('102'), mean=D('100'), adx=D('30'))
        self.assertEqual(len(Trend(c).on_tick(t)), 1)

if __name__ == '__main__': unittest.main()
