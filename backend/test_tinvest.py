import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from unittest.mock import patch

import httpx
from tinvest import TInvest, Observer, MarketDataError, quotation, indicators, classify, select_universe


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_allowlist_blocks_trading_and_does_not_send_token_elsewhere(self):
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(200,json={'lastPrices':[]})
        api=TInvest('test-secret',httpx.MockTransport(handler),min_interval=0)
        try:
            with self.assertRaises(ValueError):
                await api.call('OrdersService','PostOrder',{})
            self.assertEqual(calls,[])
            await api.call('MarketDataService','GetLastPrices',{})
            self.assertEqual(calls[0].url.host,'invest-public-api.tbank.ru')
        finally: await api.client.aclose()

    async def test_errors_never_expose_response_or_token(self):
        api=TInvest('test-secret',httpx.MockTransport(lambda r:httpx.Response(401,json={'message':'test-secret'})),min_interval=0)
        try:
            with self.assertRaises(MarketDataError) as raised:
                await api.call('MarketDataService','GetLastPrices',{})
            self.assertEqual(raised.exception.status_code,401)
            self.assertNotIn('test-secret',str(raised.exception))
        finally: await api.client.aclose()

    async def test_rate_limit_sets_shared_cooldown(self):
        api=TInvest('test',httpx.MockTransport(lambda r:httpx.Response(429,headers={'Retry-After':'2'})),min_interval=0)
        try:
            with self.assertRaises(MarketDataError): await api.call('MarketDataService','GetLastPrices',{})
            self.assertGreater(api._blocked_until,asyncio.get_running_loop().time())
        finally: await api.client.aclose()

    async def test_catalog_discovery_retries_after_transient_error(self):
        calls=0
        def handler(request):
            nonlocal calls
            calls+=1
            if calls==1:return httpx.Response(500)
            return httpx.Response(200,json={'instruments':[{'ticker':'SBER','uid':'sber-uid','classCode':'TQBR','currency':'rub','apiTradeAvailableFlag':True,'liquidityFlag':True}]})
        with patch.dict('os.environ',{'T_INVEST_INSTRUMENTS':''}):
            o=Observer('test',transport=httpx.MockTransport(handler))
        o.api.min_interval=0
        try:
            await o.discover()
            self.assertIsNone(o.ids)
            await o.discover()
            self.assertEqual(o.ids,['SBER_TQBR'])
        finally: await o.api.client.aclose()

    async def test_snapshot_ages_quotes_without_new_successful_poll(self):
        o=Observer('',instruments=['SBER_TQBR'])
        past=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()
        o.marks={'SBER_TQBR':{'time':past,'book_time':past,'regime':'UPTREND','stale':False}}
        result=o.snapshot()
        self.assertEqual(result['marks']['SBER_TQBR']['regime'],'UNDEFINED')
        self.assertTrue(result['marks']['SBER_TQBR']['stale'])
        self.assertEqual(o.marks['SBER_TQBR']['regime'],'UPTREND')

    async def test_priority_refresh_updates_only_watched_tickers_price_and_time(self):
        calls = []
        def handler(request):
            calls.append(request)
            body = json.loads(request.content)
            by_uid = {'sber-uid': 'SBER', 'gazp-uid': 'GAZP'}
            return httpx.Response(200, json={'lastPrices': [
                {'instrumentUid': uid, 'price': {'units': '111', 'nano': 0}, 'time': '2026-01-01T00:00:00Z'}
                for uid in body['instrumentId'] if uid in by_uid]})
        o = Observer('test', ['SBER_TQBR', 'GAZP_TQBR', 'LKOH_TQBR'], httpx.MockTransport(handler))
        o.api.min_interval = 0
        o.metadata = {'SBER_TQBR': {'uid': 'sber-uid'}, 'GAZP_TQBR': {'uid': 'gazp-uid'}, 'LKOH_TQBR': {'uid': 'lkoh-uid'}}
        o.marks = {k: {'price': '1', 'time': None, 'regime': 'FLAT'} for k in o.metadata}
        o.set_priority(['sber', 'gazp'])  # case-insensitive
        self.assertEqual(o.priority_ids, {'SBER_TQBR', 'GAZP_TQBR'})
        try:
            await o.refresh_priority_prices()
            self.assertEqual(len(calls), 1)  # one batched call regardless of watch-list size
            self.assertEqual(o.marks['SBER_TQBR']['price'], '111')
            self.assertEqual(o.marks['SBER_TQBR']['time'], '2026-01-01T00:00:00Z')
            self.assertEqual(o.marks['SBER_TQBR']['regime'], 'FLAT')  # untouched by the fast path
            self.assertEqual(o.marks['LKOH_TQBR']['price'], '1')  # not watched -> not refreshed
        finally:
            await o.api.client.aclose()

    async def test_priority_signal_refresh_analyzes_only_watched_tickers(self):
        now = datetime.now(timezone.utc).isoformat()
        def handler(request):
            method = request.url.path.rsplit('/', 1)[-1]
            data = {
                'GetLastPrices': {'lastPrices': [{'price': {'units': '100', 'nano': 0}, 'time': now}]},
                'GetOrderBook': {'bids': [{'price': {'units': '99', 'nano': 0}}],
                                  'asks': [{'price': {'units': '101', 'nano': 0}}], 'orderbookTs': now},
                'GetTradingStatus': {'tradingStatus': 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
                                      'limitOrderAvailableFlag': True},
                'GetCandles': {'candles': []},
            }
            return httpx.Response(200, json=data[method])
        o = Observer('test', ['SBER_TQBR', 'GAZP_TQBR'], httpx.MockTransport(handler))
        o.api.min_interval = 0
        o.metadata = {
            'SBER_TQBR': {'uid': 'sber-uid', 'ticker': 'SBER', 'name': 'Sber', 'lot': 10, 'instrumentType': 'share', 'currency': 'rub'},
            'GAZP_TQBR': {'uid': 'gazp-uid', 'ticker': 'GAZP', 'name': 'Gazprom', 'lot': 10, 'instrumentType': 'share', 'currency': 'rub'},
        }
        o.marks = {k: {} for k in o.metadata}
        o.set_priority(['SBER'])
        try:
            await o.refresh_priority_signals()
            # Not enough candles for indicators() -> classified UNDEFINED, but
            # the point here is only SBER (the watched ticker) got analyzed.
            self.assertEqual(o.marks['SBER_TQBR']['regime'], 'UNDEFINED')
            self.assertEqual(o.marks['SBER_TQBR']['price'], '100')
            self.assertEqual(o.marks['GAZP_TQBR'], {})  # untouched: not in priority_ids
        finally:
            await o.api.client.aclose()

    async def test_candle_history_spans_three_weekly_windows_to_reach_60(self):
        now = datetime.now(timezone.utc)
        # A single 7-calendar-day window realistically holds ~5 trading days
        # of hourly candles (a weekend falls inside it) — well under the 60
        # indicators() requires. Model that: 25 candles per window, spread
        # across three non-overlapping weekly windows so the merge clears 60.
        def make_window(end):
            q = lambda v: {'units': str(v), 'nano': 0}
            return [{'time': (end - timedelta(hours=i)).isoformat(), 'isComplete': True,
                     'open': q(100), 'close': q(100), 'high': q(101), 'low': q(99)} for i in range(25)]
        candle_calls = []
        def handler(request):
            method = request.url.path.rsplit('/', 1)[-1]
            if method == 'GetCandles':
                body = json.loads(request.content)
                candle_calls.append(body)
                end = datetime.fromisoformat(body['to'])
                return httpx.Response(200, json={'candles': make_window(end)})
            now_iso = now.isoformat()
            data = {
                'GetLastPrices': {'lastPrices': [{'price': {'units': '100', 'nano': 0}, 'time': now_iso}]},
                'GetOrderBook': {'bids': [{'price': {'units': '99', 'nano': 0}}],
                                  'asks': [{'price': {'units': '101', 'nano': 0}}], 'orderbookTs': now_iso},
                'GetTradingStatus': {'tradingStatus': 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
                                      'limitOrderAvailableFlag': True},
            }
            return httpx.Response(200, json=data[method])
        o = Observer('test', ['SBER_TQBR'], httpx.MockTransport(handler))
        o.api.min_interval = 0
        o.metadata = {'SBER_TQBR': {'uid': 'sber-uid', 'ticker': 'SBER', 'name': 'Sber', 'lot': 10,
                                     'instrumentType': 'share', 'currency': 'rub',
                                     'minPriceIncrement': {'units': '0', 'nano': 10000000}}}
        try:
            await o.instrument('SBER_TQBR')
            self.assertEqual(len(candle_calls), 3)  # three chunked requests, not one starved 7-day call
            self.assertLess((datetime.fromisoformat(candle_calls[0]['to']) -
                              datetime.fromisoformat(candle_calls[0]['from'])).days, 8)  # each respects the API cap
            self.assertIsNotNone(o.candle_cache['SBER_TQBR'][1])  # 75 candles merged -> indicators() succeeds
        finally:
            await o.api.client.aclose()

    async def test_priority_refresh_is_a_noop_with_no_watched_tickers(self):
        calls = []
        o = Observer('test', ['SBER_TQBR'], httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200, json={})))
        try:
            await o.refresh_priority_prices()
            self.assertEqual(calls, [])
        finally:
            await o.api.client.aclose()

    async def test_empty_last_prices_is_contained_and_does_not_kill_worker(self):
        now=datetime.now(timezone.utc).isoformat()
        def handler(request):
            method=request.url.path.rsplit('/',1)[-1]
            data={'GetInstrumentBy':{'instrument':{'uid':'uid','ticker':'SBER','name':'Sber','currency':'rub','instrumentType':'share','lot':10}},
                  'GetLastPrices':{'lastPrices':[]},'GetOrderBook':{'bids':[],'asks':[]},'GetTradingStatus':{},'GetCandles':{'candles':[]}}
            return httpx.Response(200,json=data[method])
        o=Observer('test',['SBER_TQBR'],httpx.MockTransport(handler));o.api.min_interval=0
        try:
            await o.refresh()
            self.assertEqual(o.status,'error')
            self.assertIsNone(o.updated)
            self.assertEqual(o.journal[-1]['regime'],'UNDEFINED')
        finally: await o.api.client.aclose()


class BuildTickTests(unittest.TestCase):
    def _observer(self):
        o = Observer('', instruments=['SBER_TQBR'])
        o.metadata = {'SBER_TQBR': {'uid': 'sber-uid', 'ticker': 'SBER', 'lot': 10, 'instrumentType': 'share',
                                     'minPriceIncrement': {'units': '0', 'nano': 10000000}}}
        now = datetime.now(timezone.utc).isoformat()
        o.marks = {'SBER_TQBR': {'ticker': 'SBER', 'name': 'Sber', 'kind': 'stock', 'price': '100', 'bid': '99.9',
                                  'ask': '100.1', 'lot_size': 10, 'regime': 'FLAT', 'time': now, 'book_time': now,
                                  'stale': False, 'session_open': True, 'reason': ''}}
        o.candle_cache = {'SBER_TQBR': (datetime.now(timezone.utc), {
            'mean': D('99'), 'atr': D('1'), 'high_n': D('102'), 'low_n': D('97'), 'adx': D('30'), 'rsi': D('55'),
            'previous_mean': D('98'), 'previous_close': D('99.5'), 'candle_time': now})}
        return o

    def test_builds_a_real_tick_from_current_mark_and_indicators(self):
        tick = self._observer().build_tick('SBER')
        self.assertIsNotNone(tick)
        self.assertEqual(tick.ticker, 'SBER')
        self.assertEqual(tick.regime, 'FLAT')
        self.assertEqual(tick.price, D('100'))
        self.assertEqual(tick.lot_size, 10)
        self.assertEqual(tick.mean, D('99'))
        self.assertEqual(tick.price_step, D('0.01'))

    def test_returns_none_for_unknown_ticker(self):
        self.assertIsNone(self._observer().build_tick('GAZP'))

    def test_returns_none_without_candle_history(self):
        o = self._observer()
        o.candle_cache = {}
        self.assertIsNone(o.build_tick('SBER'))

    def test_returns_none_for_stale_quote(self):
        o = self._observer()
        old = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        o.marks['SBER_TQBR']['time'] = old
        o.marks['SBER_TQBR']['book_time'] = old
        self.assertIsNone(o.build_tick('SBER'))

    def test_returns_none_for_bonds(self):
        o = self._observer()
        o.metadata['SBER_TQBR']['instrumentType'] = 'bond'
        self.assertIsNone(o.build_tick('SBER'))

    def test_returns_none_without_two_sided_book(self):
        o = self._observer()
        o.marks['SBER_TQBR']['bid'] = None
        self.assertIsNone(o.build_tick('SBER'))


class IndicatorTests(unittest.TestCase):
    def test_universe_balances_classes_and_excludes_ineligible(self):
        make=lambda i,board:dict(ticker=f'T{i:03}',uid=f'{board}-{i}',classCode=board,currency='rub',apiTradeAvailableFlag=True,liquidityFlag=True)
        stocks=[make(i,'TQBR') for i in range(350)]
        bonds=[make(i,'TQOB') for i in range(350)]
        stocks[0]['liquidityFlag']=False
        stocks[1]['currency']='usd'
        stocks[2]['apiTradeAvailableFlag']=False
        selected=select_universe(stocks,bonds)
        self.assertEqual(len(selected),300)
        self.assertEqual(sum(m['instrumentType']=='share' for m in selected.values()),100)
        self.assertEqual(sum(m['instrumentType']=='bond' for m in selected.values()),200)
        self.assertNotIn('T000_TQBR',selected)
        self.assertNotIn('T001_TQBR',selected)
        self.assertNotIn('T002_TQBR',selected)
        self.assertEqual(len(select_universe(stocks,bonds[:10])),300)
        self.assertEqual(len(select_universe(stocks[:10],bonds[:10])),17)
    def test_exact_quotation_and_missing_data(self):
        self.assertEqual(quotation({'units':'-1','nano':-500000000}),D('-1.5'))
        with self.assertRaises(ValueError): quotation({})

    def test_incomplete_candle_is_excluded(self):
        rows=[]
        start=datetime(2026,8,1,tzinfo=timezone.utc)
        for i in range(70):
            q=lambda v:{'units':str(v),'nano':0}
            rows.append({'time':(start+timedelta(hours=i)).isoformat(),'isComplete':True,
                         'open':q(100+i),'close':q(100+i),'high':q(101+i),'low':q(99+i)})
        expected=indicators(rows)
        rows.append({'time':'2099-01-01T00:00:00Z','isComplete':False})
        self.assertEqual(indicators(rows),expected)
        self.assertEqual(expected['adx'],D(100))
        self.assertEqual(expected['rsi'],D(100))
        self.assertIsNone(indicators(rows[:5]))

    def test_regime_safety_gates(self):
        stats={'atr':D(1),'adx':D(30),'previous_close':D(100),'mean':D(99),'previous_mean':D(98)}
        self.assertEqual(classify(D(100),D(99),D(99.01),stats,999,0)[0],'UNDEFINED')
        self.assertEqual(classify(D(100),None,None,stats,0,0)[0],'LOW_LIQUIDITY')
        self.assertEqual(classify(D(104),D(104),D('104.01'),stats,0,0)[0],'SHOCK')
        self.assertEqual(classify(D(100),D(100),D('100.01'),stats,0,0)[0],'UPTREND')

if __name__=='__main__': unittest.main()
