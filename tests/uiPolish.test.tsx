// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpTooltip } from '../src/components/ui/HelpTooltip';
import { SelectAllOnFocusInput } from '../src/components/ui/SelectAllOnFocusInput';
import { QuantityField } from '../src/components/ui/QuantityField';
import { SearchableCombobox } from '../src/components/ui/SearchableCombobox';
import { OrderStatusBadge } from '../src/components/ui/OrderStatusBadge';
import { TierBadge } from '../src/components/ui/TierBadge';
import { LanguageToggle } from '../src/components/ui/LanguageToggle';
import { auditActionLabel, auditDetailsLabel } from '../src/utils/auditDisplay';
import { findCountry, ISO_COUNTRIES, countrySearchText } from '../src/data/isoCountries';
import { INITIAL_AUDIT_LOGS, INITIAL_TIER_RULES } from '../src/data/mockData';

afterEach(cleanup);

describe('customer help tooltip', () => {
  it('opens on hover, click and focus, and closes on Escape', () => {
    render(
      <HelpTooltip label="Reservation details" testId="help">
        Order requests do not reserve stock.
      </HelpTooltip>
    );
    const button = screen.getByTestId('help-button');
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toContain('do not reserve stock');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('exposes an accessible label and expanded state', () => {
    render(<HelpTooltip label="MOQ">10 PCS minimum.</HelpTooltip>);
    const button = screen.getByRole('button', { name: 'MOQ help' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.focus(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('reusable per-focus selection', () => {
  it('selects all on every new focus session and preserves later cursor placement', () => {
    render(<SelectAllOnFocusInput data-testid="quantity" defaultValue="10" />);
    const input = screen.getByTestId('quantity') as HTMLInputElement;

    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);

    input.setSelectionRange(1, 1);
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);

    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });

  it('does not collapse a pointer focus selection and does not reselect a focused click', () => {
    render(<SelectAllOnFocusInput data-testid="quantity" defaultValue="10" />);
    const input = screen.getByTestId('quantity') as HTMLInputElement;

    fireEvent.pointerDown(input);
    fireEvent.focus(input);
    fireEvent.mouseUp(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);

    // A second pointer click while the input is already focused keeps the caret.
    input.setSelectionRange(1, 1);
    fireEvent.pointerDown(input);
    fireEvent.pointerUp(input);
    fireEvent.mouseUp(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);

    fireEvent.blur(input);
    fireEvent.pointerDown(input);
    fireEvent.focus(input);
    fireEvent.mouseUp(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });

  it('keeps normal editing and copy/paste available', () => {
    render(<SelectAllOnFocusInput data-testid="quantity" defaultValue="10" />);
    const input = screen.getByTestId('quantity') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '25' } });
    expect(input.value).toBe('25');
    input.setSelectionRange(0, 1);
    expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe('2');
  });

  it('does not force selection when the behaviour is disabled', () => {
    render(
      <SelectAllOnFocusInput
        data-testid="quantity"
        defaultValue="10"
        selectAllOnFirstFocus={false}
      />
    );
    const input = screen.getByTestId('quantity') as HTMLInputElement;
    input.setSelectionRange(1, 1);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });
});

describe('quantity field', () => {
  const Harness = () => {
    const [value, setValue] = useState('10');
    return (
      <QuantityField
        value={value}
        min={10}
        max={20}
        onValueChange={setValue}
        ariaLabel="Quantity"
        testId="quantity"
      />
    );
  };

  it('steps while the pointer is over the field, even without focus', () => {
    render(<Harness />);
    const input = screen.getByTestId('quantity') as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    act(() => {
      input.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    });
    expect(input.value).toBe('11');

    act(() => {
      input.dispatchEvent(new WheelEvent('wheel', { deltaY: 5, bubbles: true, cancelable: true }));
    });
    // Damping: the small delta has not accumulated a whole step yet.
    expect(input.value).toBe('11');
  });

  it('leaves wheel events outside the field for normal page scrolling', () => {
    render(<Harness />);
    const input = screen.getByTestId('quantity') as HTMLInputElement;
    const event = new WheelEvent('wheel', {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(input.value).toBe('10');
    expect(event.defaultPrevented).toBe(false);
  });

  it('clamps wheel steps to MOQ and stock and keeps integer values', () => {
    const BoundaryHarness = ({ initial }: { initial: string }) => {
      const [value, setValue] = useState(initial);
      return (
        <QuantityField
          value={value}
          min={10}
          max={20}
          onValueChange={setValue}
          ariaLabel="Quantity"
          testId="quantity"
        />
      );
    };
    const { unmount } = render(<BoundaryHarness initial="20" />);
    const upperInput = screen.getByTestId('quantity') as HTMLInputElement;
    act(() => {
      upperInput.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
      );
    });
    expect(upperInput.value).toBe('20');
    unmount();

    render(<BoundaryHarness initial="10" />);
    const lowerInput = screen.getByTestId('quantity') as HTMLInputElement;
    act(() => {
      lowerInput.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
      );
    });
    expect(lowerInput.value).toBe('10');
  });
});

describe('searchable combobox', () => {
  const options = [
    { value: 'USA', label: 'USA — United States / 美国', keywords: 'USA US United States 美国' },
    { value: 'DEU', label: 'DEU — Germany / 德国', keywords: 'DEU DE Germany 德国' },
    { value: 'JPN', label: 'JPN — Japan / 日本', keywords: 'JPN JP Japan 日本' },
  ];

  it('filters by Chinese name, English name and three-letter code', () => {
    const onChange = vi.fn();
    render(
      <SearchableCombobox
        options={options}
        value="USA"
        onChange={onChange}
        ariaLabel="Country"
        testId="country"
      />
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '日本' } });
    expect(screen.getByRole('option', { name: /Japan/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Germany/ })).toBeNull();

    fireEvent.change(input, { target: { value: 'Germany' } });
    fireEvent.click(screen.getByRole('option', { name: /Germany/ }));
    expect(onChange).toHaveBeenCalledWith('DEU');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'JPN' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('JPN');
  });
});

describe('order status and tier badges', () => {
  it('uses one colour/label vocabulary in both languages', () => {
    render(
      <div>
        <OrderStatusBadge status="PENDING_CONFIRMATION" language="zh" />
        <OrderStatusBadge status="PENDING_CONFIRMATION" language="en" />
        <OrderStatusBadge status="CANCELLED" language="zh" />
      </div>
    );
    expect(screen.getByText('待确认').className).toContain('bg-amber-50');
    expect(screen.getByText('Pending confirmation').className).toContain('bg-amber-50');
    expect(screen.getByText('已取消').className).toContain('bg-rose-50');
  });

  it('shows the existing Diamond-to-Bronze levels only', () => {
    render(
      <div>
        {INITIAL_TIER_RULES.map(tier => (
          <TierBadge key={tier.id} tier={tier} testId={`tier-${tier.tier_level}`} />
        ))}
      </div>
    );
    for (const label of ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByTestId('tier-5').className).toContain('bg-violet-50');
    expect(screen.getByTestId('tier-1').className).toContain('bg-amber-50');
  });

  it('switches the internal language mode with accessible pressed state', () => {
    const Wrapper = () => {
      const [language, setLanguage] = useState<'zh' | 'en'>('en');
      return <LanguageToggle value={language} onChange={setLanguage} label="Language" />;
    };
    render(<Wrapper />);
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Chinese audit presentation and ISO data', () => {
  it('translates known action codes/details without changing the raw log', () => {
    const raw = INITIAL_AUDIT_LOGS[0];
    expect(raw.action).toBe('CREATE_COMPANY');
    expect(raw.details).toMatch(/Company registered/);
    expect(auditActionLabel(raw.action)).toBe('创建客户公司');
    const translated = auditDetailsLabel(raw.details);
    expect(translated).toContain('已登记客户公司');
    expect(translated).not.toMatch(/Company registered/);
    expect(raw.details).toMatch(/Company registered/);
  });

  it('covers the initial audit trail in Chinese', () => {
    for (const log of INITIAL_AUDIT_LOGS) {
      expect(auditDetailsLabel(log.details)).toMatch(/[一-鿿]/);
      expect(auditActionLabel(log.action)).toMatch(/[一-鿿]/);
    }
  });

  it('points to the expandable raw view for untranslated details instead of hiding them', () => {
    const rawDetails = 'New audit template: warehouse=WH-02 ref=unmapped';
    const label = auditDetailsLabel(rawDetails);
    expect(label).toContain('查看原始明细');
    expect(label).not.toContain('业务明细已记录');
    expect(label).not.toBe(rawDetails);
  });

  it('provides searchable Chinese, English and alpha-3 country labels', () => {
    expect(ISO_COUNTRIES).toHaveLength(249);
    expect(findCountry('USA')).toMatchObject({ nameEn: 'United States of America', nameZh: '美国' });
    expect(countrySearchText(findCountry('JPN')!)).toContain('japan');
    expect(countrySearchText(findCountry('DEU')!)).toContain('德国');
  });
});
