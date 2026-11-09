import React, { useMemo, useState } from 'react';
import { CheckCircle2, Pencil, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { TierBadge } from '../../components/ui/TierBadge';
import { SelectAllOnFocusInput } from '../../components/ui/SelectAllOnFocusInput';
import {
  APPROVED_TIER_RULES,
  MAX_APPROVED_DISCOUNT_RATE,
} from '../../data/tierModel';
import type { TierRule } from '../../types';
import { Localized, useInternalLanguage } from '../internalLanguage';

const ORIGINAL = APPROVED_TIER_RULES.map(rule => ({ ...rule }));

export const TierPreviewView: React.FC = () => {
  const { t } = useInternalLanguage();
  const [rules, setRules] = useState<TierRule[]>(ORIGINAL.map(rule => ({ ...rule })));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ threshold: '', discount: '' });
  const [error, setError] = useState('');
  const [previewNotice, setPreviewNotice] = useState('');

  const editing = useMemo(
    () => rules.find(rule => rule.id === editingId) ?? null,
    [editingId, rules]
  );

  const beginEdit = (rule: TierRule) => {
    setEditingId(rule.id);
    setDraft({
      threshold: String(rule.threshold_usd),
      discount: (rule.discount_rate * 100).toFixed(2),
    });
    setError('');
    setPreviewNotice('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ threshold: '', discount: '' });
    setError('');
  };

  const applyEdit = () => {
    if (!editing) return;
    const threshold = Number(draft.threshold);
    const discountPercent = Number(draft.discount);
    if (!draft.threshold.trim() || !draft.discount.trim()) {
      setError(t('Enter both a threshold and a discount.', '请输入门槛与折扣率。'));
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0) {
      setError(t('Threshold must be a whole non-negative USD amount.', '门槛必须是非负整数美元金额。'));
      return;
    }
    if (editing.tier_level === 1 && threshold !== 0) {
      setError(t('Tier 1 threshold must remain USD 0.', 'Tier 1 门槛必须保持 USD 0。'));
      return;
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > MAX_APPROVED_DISCOUNT_RATE * 100) {
      setError(
        t(
          `Discount must be between 0% and ${(MAX_APPROVED_DISCOUNT_RATE * 100).toFixed(0)}%.`,
          `折扣率必须介于 0% 与 ${(MAX_APPROVED_DISCOUNT_RATE * 100).toFixed(0)}% 之间。`
        )
      );
      return;
    }
    const next = rules.map(rule =>
      rule.id === editing.id
        ? { ...rule, threshold_usd: threshold, discount_rate: discountPercent / 100 }
        : rule
    );
    for (let index = 0; index < next.length; index++) {
      if (index > 0 && next[index].threshold_usd < next[index - 1].threshold_usd) {
        setError(t('Thresholds must stay in ascending tier order.', '门槛必须保持按等级升序。'));
        return;
      }
      if (index > 0 && next[index].discount_rate < next[index - 1].discount_rate) {
        setError(t('Discount rates must stay in ascending tier order.', '折扣率必须保持按等级升序。'));
        return;
      }
    }
    setRules(next);
    setEditingId(null);
    setError('');
    setPreviewNotice(
      t(
        'Preview updated in this browser only. Nothing was written to the database or applied to real orders.',
        '仅在本浏览器更新预览。未写入数据库，也未应用于真实订单。'
      )
    );
  };

  const resetPreview = () => {
    setRules(ORIGINAL.map(rule => ({ ...rule })));
    setEditingId(null);
    setDraft({ threshold: '', discount: '' });
    setError('');
    setPreviewNotice(
      t('Preview reset to the approved values.', '预览已恢复为已批准数值。')
    );
  };

  return (
    <Localized>
      <div className="space-y-4" data-testid="tier-preview">
        <section className="fo-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--orange-pale)] text-[var(--orange-deep)]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="fo-page-title text-xl">{t('Customer tier and discount preview', '客户等级与折扣预览')}</h1>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                {t(
                  'Interface preview only. Real mode has no tier persistence or pricing backend, and these edits are not applied to real orders.',
                  '界面预览，尚未应用于真实订单。Real 模式尚无等级持久化或定价后端，此编辑不会应用于真实订单。'
                )}
              </p>
            </div>
            <span className="fo-tag bg-[var(--yellow-pale)] text-[var(--yellow)]">
              {t('Preview only', '仅预览')}
            </span>
          </div>
          <div className="mt-3 rounded-xl border border-[var(--yellow)]/25 bg-[var(--yellow-pale)] px-3 py-2 text-[11px] font-semibold text-[var(--yellow)]">
            {t(
              'This is a UI preview only. It is not persisted and is not applied to real orders.',
              '界面预览，尚未应用于真实订单。'
            )}
          </div>
        </section>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            {error}
          </div>
        )}
        {previewNotice && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            <CheckCircle2 className="h-4 w-4" />
            {previewNotice}
          </div>
        )}

        <section className="fo-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] p-4">
            <div>
              <h2 className="text-sm font-extrabold">{t('Approved five-level model', '已批准五级模型')}</h2>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {t(
                  'No tier can be added or removed. Threshold order and the existing maximum discount are validated.',
                  '不可新增或删除等级；系统会校验门槛顺序与既有最大折扣。'
                )}
              </p>
            </div>
            <button type="button" onClick={resetPreview} className="fo-btn flex items-center gap-1.5" data-testid="tier-preview-reset">
              <RotateCcw className="h-3.5 w-3.5" /> {t('Reset preview', '重置预览')}
            </button>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {rules.map(rule => {
              const isEditing = editingId === rule.id;
              return (
                <article key={rule.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_160px_150px_130px] sm:items-center" data-testid={`tier-preview-row-${rule.tier_level}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <TierBadge tier={rule} testId={`tier-preview-badge-${rule.tier_level}`} />
                      <span className="text-sm font-bold">
                        {rule.tier_level} · {rule.name_en ?? rule.name}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">{rule.name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      {t('Threshold (USD)', '门槛 (USD)')}
                    </div>
                    {isEditing ? (
                      <SelectAllOnFocusInput
                        type="number"
                        min={0}
                        step={1}
                        value={draft.threshold}
                        onChange={event => setDraft(current => ({ ...current, threshold: event.target.value }))}
                        aria-label={`${t('Threshold', '门槛')} ${rule.tier_level}`}
                        className="fo-input mt-1 font-mono"
                        data-testid={`tier-threshold-${rule.tier_level}`}
                      />
                    ) : (
                      <div className="mt-1 font-mono text-sm font-bold">${rule.threshold_usd.toLocaleString('en-US')}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      {t('Discount', '折扣率')}
                    </div>
                    {isEditing ? (
                      <SelectAllOnFocusInput
                        type="number"
                        min={0}
                        max={MAX_APPROVED_DISCOUNT_RATE * 100}
                        step={0.01}
                        value={draft.discount}
                        onChange={event => setDraft(current => ({ ...current, discount: event.target.value }))}
                        aria-label={`${t('Discount', '折扣率')} ${rule.tier_level}`}
                        className="fo-input mt-1 font-mono"
                        data-testid={`tier-discount-${rule.tier_level}`}
                      />
                    ) : (
                      <div className="mt-1 font-mono text-sm font-bold text-[var(--green)]">
                        {(rule.discount_rate * 100).toFixed(0)}% OFF
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={applyEdit} className="fo-btn fo-btn-primary" data-testid={`tier-apply-${rule.tier_level}`}>
                          {t('Apply preview', '应用预览')}
                        </button>
                        <button type="button" onClick={cancelEdit} className="fo-btn" data-testid={`tier-cancel-${rule.tier_level}`}>
                          <X className="h-3.5 w-3.5" /> {t('Cancel', '取消')}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => beginEdit(rule)} className="fo-btn flex items-center gap-1.5" data-testid={`tier-edit-${rule.tier_level}`}>
                        <Pencil className="h-3.5 w-3.5" /> {t('Edit', '编辑')}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="fo-card p-4 text-[11px] leading-relaxed text-[var(--muted)]">
          <h2 className="text-xs font-bold text-[var(--ink)]">{t('Backend status', '后端状态')}</h2>
          <p className="mt-1">
            {t(
              'No Real tier endpoint, migration, permission or pricing calculation is connected in this PR. The approved five-level values are displayed from a shared UI model only. A separate Owner decision is required before persistence or order application.',
              '本 PR 未接入 Real 等级接口、迁移、权限或价格计算。界面仅展示共享的五级 UI 模型。若要持久化或应用到订单，需 Owner 另行批准。'
            )}
          </p>
        </section>
      </div>
    </Localized>
  );
};
