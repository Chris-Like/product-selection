/** 采集编排：页面一致性校验 + 记录成立前置条件 + 字段态正交。
 * 新形态改写：站点 / 市场 / 渠道 / 样本类型由采集命令注入，不再写死 MV3 浏览场景。
 */
import { failure } from '../shared/errors.js';
import { ok } from '../shared/result.js';
import { FIELD_STATUS } from '../shared/types.js';
import { createSnapshot } from '../domain/snapshot/entity.js';
import { validateRawFields, satisfiesRecordGate } from '../domain/snapshot/validator.js';
import { fingerprintIdFor } from '../domain/fingerprint/matcher.js';
import { isRuleReady } from '../domain/rule/site-rule.js';

export function createCaptureService({ snapshots, rules, admin }) {
  /**
   * @param {Object} command CAPTURE_PAGE（含 expectedPageKind / expectedUrl）
   * @param {Object} fieldResult content 回传的当前 DOM 结果（含当前 pageKind / url）
   */
  async function capture(command, fieldResult) {
    // P1 落地校验点：popup 打开期间 SPA 跳转 → 不得采到上一页
    if (
      command.expectedPageKind !== fieldResult.pageKind
      || command.expectedUrl !== fieldResult.url
    ) {
      return failure('PAGE_CHANGED');
    }
    if (command.expectedPageKind === 'UNSUPPORTED') return failure('PAGE_UNSUPPORTED');
    if (fieldResult.rulePending) return failure('RULE_MISSING', { field: '字段定位' });

    const site = command.site || 'taobao';
    const ruleResult = await rules.get(site, fieldResult.ruleVersion || 'v1');
    const rule = ruleResult.ok ? ruleResult.data : null;
    const ready = isRuleReady(rule, fieldResult.pageKind);
    if (!ready.ok) return failure('RULE_MISSING', { field: ready.reason });

    // 每次重读 DOM 得到的原始行；PG-1 一条，PG-2 一屏多条
    const rows = fieldResult.items && fieldResult.items.length
      ? fieldResult.items
      : [fieldResult.fields || {}];
    const asOf = fieldResult.asOf || new Date().toISOString();
    const batchId = command.batchId;
    await admin.ensureBatch(batchId, {
      site,
      market: command.market || 'domestic',
      channel: command.channel || site,
      sample_kind: command.sampleKind || 'auto',
      keywords: command.keywords ?? null,
      pages: command.pages ?? null,
      started_at: asOf,
      ended_at: asOf,
    });

    const stored = [];
    const fingerprintIds = [];
    const preview = [];
    const skipped = [];
    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i] || {};
      const v = validateRawFields(raw, rule, fieldResult.pageKind);
      const gate = satisfiesRecordGate({
        pageKind: fieldResult.pageKind,
        url: fieldResult.url,
        fields: { ...v.fields, source_url: v.fields.source_url || fieldResult.url },
      });
      if (!gate.ok) {
        skipped.push({ index: i, code: gate.code });
        continue; // 不阻断其他记录入库（Y-04）
      }
      // snapshotId 由 commandId + 行号派生：重放时不会重复写入
      const snapshotId = `${command.commandId}:${i}`;
      const fingerprintId = fingerprintIdFor({
        itemId: v.fields.item_id,
        title: v.fields.title,
      });
      const snapshot = createSnapshot({
        raw: v.fields,
        fieldStatus: { ...v.fieldStatus },
        snapshotId,
        batchId,
        queryId: command.queryId,
        fingerprintId,
        pageKind: fieldResult.pageKind,
        asOf,
        sourceUrl: v.fields.source_url || fieldResult.url,
      });
      const r = await snapshots.append(snapshot);
      if (r.ok) {
        stored.push(snapshotId);
        fingerprintIds.push(fingerprintId);
        if (preview.length === 0) {
          preview.push(...Object.entries(v.fieldStatus).map(([field, status]) => ({
            field, status, value: v.fields[field] ?? null,
          })));
        }
      } else skipped.push({ index: i, code: r.code });
    }

    return ok({
      batchId,
      stored,
      fingerprintIds,
      preview,
      skipped,
      abnormalFieldCount: preview.filter((p) => p.status !== FIELD_STATUS.NORMAL).length,
      ruleVersion: fieldResult.ruleVersion || 'v1',
    });
  }

  return Object.freeze({ capture });
}
