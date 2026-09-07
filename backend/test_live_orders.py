import tempfile
import unittest
from decimal import Decimal as D
from pathlib import Path
from unittest.mock import patch

import httpx
import live_orders
import settings_store
from broker import MarketDataError


def _send_status(pid, account_id):
    proposals = live_orders.list_proposals(account_id=account_id)
    match = next((p for p in proposals if p['id'] == pid), None)
    return match['my_status'] if match else None


class LiveOrdersTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orders_patch = patch.object(live_orders, 'DB', Path(self._tmp.name) / 'live_orders.db')
        self._settings_patch = patch.object(settings_store, 'DB', Path(self._tmp.name) / 'settings.db')
        self._orders_patch.start()
        self._settings_patch.start()
        self.addCleanup(self._orders_patch.stop)
        self.addCleanup(self._settings_patch.stop)
        self.addCleanup(self._tmp.cleanup)

    def test_disabled_by_default_and_create_proposal_is_a_noop(self):
        self.assertFalse(live_orders.is_enabled())
        pid = live_orders.create_proposal('SBER', 'uid-1', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        self.assertIsNone(pid)
        self.assertEqual(live_orders.list_proposals(), [])

    def test_enabled_create_then_dedups_same_ticker_and_rule(self):
        live_orders.set_enabled(True)
        pid1 = live_orders.create_proposal('SBER', 'uid-1', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        pid2 = live_orders.create_proposal('SBER', 'uid-1', 'BUY', 1, D('301'), 'LIMIT', 'Grid: level')
        self.assertIsNotNone(pid1)
        self.assertIsNone(pid2)  # Same ticker+rule while pending -> no duplicate spam.
        self.assertEqual(len(live_orders.list_proposals()), 1)

    def test_expired_proposal_cannot_be_approved(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'uid-1', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        con = live_orders._conn()
        con.execute("UPDATE proposals SET created_at='2000-01-01T00:00:00+00:00' WHERE id=?", (pid,))
        con.commit(); con.close()
        proposals = live_orders.list_proposals()
        self.assertEqual(proposals[0]['status'], 'EXPIRED')

    async def test_approve_sends_well_formed_post_order_and_records_broker_id(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 2, D('312.5'), 'LIMIT', 'Grid: level')
        captured = {}
        def handler(request):
            import json
            body = json.loads(request.content)
            captured.update(body)
            return httpx.Response(200, json={'orderId': 'broker-123'})
        result = await live_orders.approve_proposal(pid, 'acc-1', 'tok', transport=httpx.MockTransport(handler))
        self.assertEqual(result['orderId'], 'broker-123')
        self.assertEqual(captured['instrumentId'], 'sber-uid')
        self.assertEqual(captured['quantity'], 2)
        self.assertEqual(captured['direction'], 'ORDER_DIRECTION_BUY')
        self.assertEqual(captured['accountId'], 'acc-1')
        self.assertEqual(captured['orderType'], 'ORDER_TYPE_LIMIT')
        self.assertEqual(captured['price'], {'units': '312', 'nano': 500000000})
        self.assertEqual(_send_status(pid, 'acc-1'), 'SENT')
        # The proposal itself stays PENDING (shared across visitors); only
        # this account's own send record moved to SENT.
        self.assertEqual(live_orders.get_proposal(pid)['status'], 'PENDING')

    async def test_approve_refuses_when_disabled(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        live_orders.set_enabled(False)
        with self.assertRaises(ValueError):
            await live_orders.approve_proposal(pid, 'acc-1', 'tok')

    async def test_approve_unknown_proposal_raises(self):
        live_orders.set_enabled(True)
        with self.assertRaises(ValueError):
            await live_orders.approve_proposal('does-not-exist', 'acc-1', 'tok')

    async def test_second_account_can_approve_same_proposal_independently(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json={'orderId': 'broker-1'}))
        await live_orders.approve_proposal(pid, 'acc-1', 'tok-a', transport=transport)
        # A different visitor, with their own token/account, can still act on
        # the same shared proposal — it is not consumed after one approval.
        await live_orders.approve_proposal(pid, 'acc-2', 'tok-b', transport=transport)
        self.assertEqual(_send_status(pid, 'acc-1'), 'SENT')
        self.assertEqual(_send_status(pid, 'acc-2'), 'SENT')

    async def test_approve_twice_on_same_account_is_refused(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json={'orderId': 'broker-1'}))
        await live_orders.approve_proposal(pid, 'acc-1', 'tok', transport=transport)
        with self.assertRaises(ValueError):
            await live_orders.approve_proposal(pid, 'acc-1', 'tok', transport=transport)

    async def test_orders_client_allowlist_blocks_everything_else(self):
        calls = []
        client = live_orders.OrdersClient('tok', httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200, json={})))
        try:
            with self.assertRaises(ValueError):
                await client.call('MarketDataService', 'GetLastPrices', {})
            self.assertEqual(calls, [])
            await client.call('OrdersService', 'GetOrders', {})
            self.assertEqual(len(calls), 1)
        finally:
            await client.aclose()

    async def test_kill_switch_cancels_only_this_accounts_resting_orders(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        await live_orders.approve_proposal(pid, 'acc-1', 'tok',
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={'orderId': 'broker-999'})))
        cancelled = []
        def handler(request):
            cancelled.append(request)
            return httpx.Response(200, json={})
        result = await live_orders.kill_switch('acc-1', 'tok', transport=httpx.MockTransport(handler))
        self.assertEqual(result['cancelled'], 1)
        self.assertEqual(len(cancelled), 1)
        self.assertEqual(_send_status(pid, 'acc-1'), 'CANCELLED')
        # A kill-switch never touches the shared proposal or other accounts.
        self.assertEqual(live_orders.get_proposal(pid)['status'], 'PENDING')

    async def test_reconcile_marks_filled_from_broker_state(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        await live_orders.approve_proposal(pid, 'acc-1', 'tok',
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={'orderId': 'broker-999'})))
        def handler(request):
            return httpx.Response(200, json={'orders': [
                {'orderId': 'broker-999', 'executionReportStatus': 'EXECUTION_REPORT_STATUS_FILL'}]})
        result = await live_orders.reconcile('acc-1', 'tok', transport=httpx.MockTransport(handler))
        self.assertEqual(result['checked'], 1)
        self.assertEqual(_send_status(pid, 'acc-1'), 'FILLED')

    async def test_broker_rejection_marks_send_error_not_silently_lost(self):
        live_orders.set_enabled(True)
        pid = live_orders.create_proposal('SBER', 'sber-uid', 'BUY', 1, D('300'), 'LIMIT', 'Grid: level')
        with self.assertRaises(MarketDataError):
            await live_orders.approve_proposal(pid, 'acc-1', 'tok',
                transport=httpx.MockTransport(lambda r: httpx.Response(403)))
        self.assertEqual(_send_status(pid, 'acc-1'), 'ERROR')

    async def test_close_position_sends_a_market_sell_for_the_full_quantity(self):
        captured = {}
        def handler(request):
            import json
            captured.update(json.loads(request.content))
            return httpx.Response(200, json={'orderId': 'broker-close-1'})
        result = await live_orders.close_position('acc-1', 'sber-uid', 5, 'tok',
            transport=httpx.MockTransport(handler))
        self.assertEqual(result['orderId'], 'broker-close-1')
        self.assertEqual(captured['instrumentId'], 'sber-uid')
        self.assertEqual(captured['quantity'], 5)
        self.assertEqual(captured['direction'], 'ORDER_DIRECTION_SELL')
        self.assertEqual(captured['accountId'], 'acc-1')
        self.assertEqual(captured['orderType'], 'ORDER_TYPE_MARKET')
        self.assertNotIn('price', captured)  # market order: no limit price

    async def test_close_position_refuses_when_there_is_nothing_to_close(self):
        with self.assertRaises(ValueError):
            await live_orders.close_position('acc-1', 'sber-uid', 0, 'tok')


if __name__ == '__main__':
    unittest.main()
