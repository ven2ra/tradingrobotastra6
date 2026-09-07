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
