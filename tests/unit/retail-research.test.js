import assert from 'node:assert/strict';
import test from 'node:test';
import { retailCsvItems } from '../../app/core/service/retail-csv.js';
import { createTaobaoAlliance } from '../../app/server/taobao-alliance.js';
import { createProviderResearch, providerReportInput } from '../../app/core/service/provider-research.js';
import { ok } from '../../app/core/shared/result.js';

test('20 元文具导入保留恰好 20 元、超预算与缺价商品，保留淘宝商品 ID 参数', async () => {
  const items = retailCsvItems('\uFEFFtitle,price,spec,url,id\r\n"A5,方格本",12.9,A5,https://item.taobao.com/item.htm?id=42&track=foo,42\r\n中性笔,20,0.5mm,,43\r\n笔套装,22,,,44\r\n替芯,,,,45');
  const values = [];
  const research = createProviderResearch({ set: async (_key, value) => values.push({ value }), list: async () => ok(values) });
  const report = await research.save(providerReportInput({ provider: 'retail_csv', platform: 'taobao', market: 'CN',
    query: '文具', budget: 20, tool: '测试导出', window: '2026-11-27', items }));
  assert.equal(report.ok, true);
  assert.equal(report.data.items[0].url, 'https://item.taobao.com/item.htm?id=42');
  assert.deepEqual(report.data.items.map((item) => item.price), [12.9, 20, 22, null]);
  assert.deepEqual(report.data.items.filter((item) => item.price !== null && item.price <= report.data.budget).map((item) => item.title), ['A5,方格本', '中性笔']);
  assert.equal((await research.list('fastmoss')).data.length, 0);
  assert.throws(() => retailCsvItems('title,id\n"x,1'), /引号/);
});

test('淘宝联盟查询固定 HTTPS 官方接口，估价和原页按官方响应取值', async () => {
  const source = createTaobaoAlliance({
    AUTO_PICK_TBK_APP_KEY: 'fixture', AUTO_PICK_TBK_APP_SECRET: 'fixture-secret',
    AUTO_PICK_TBK_SESSION: 'fixture-session', AUTO_PICK_TBK_ADZONE_ID: '123',
  }, async (url, options) => {
    assert.equal(url, 'https://eco.taobao.com/router/rest');
    assert.equal(options.body.get('q'), 'A5 笔记本');
    assert.equal(options.body.get('end_price'), '20');
    assert.match(options.body.get('sign'), /^[0-9A-F]{32}$/);
    return { ok: true, json: async () => ({ tbk_sc_material_optional_upgrade_response: {
      result_list: { map_data: [{ item_id: 'opaque', item_basic_info: { title: '笔记本' },
        price_promotion_info: { final_promotion_price: '20.00' },
        publish_info: { click_url: '//item.taobao.com/item.htm?id=123&tracking=abc' } }] },
    } }) };
  });
  const [item] = await source.search('A5 笔记本', 20);
  assert.deepEqual(item, { id: 'opaque', title: '笔记本', price: 20, currency: 'CNY',
    price_type: '联盟预估到手价', url: 'https://item.taobao.com/item.htm?id=123' });
  await assert.rejects(createTaobaoAlliance({}).search('文具'), /尚未配置/);
});
