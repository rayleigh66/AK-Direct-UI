// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EnglishDateField } from '../src/components/ui/EnglishDateField';
import { SearchableCombobox } from '../src/components/ui/SearchableCombobox';
import { formatEnglishDate } from '../src/utils/dateDisplay';
import {
  INVENTORY_TEMPLATE_CSV,
  INVENTORY_TEMPLATE_HEADERS,
} from '../src/utils/inventoryTemplate';
import { parseCsv, parseInventoryTable } from '../src/utils/inventoryImport';
import {
  InternalLanguageProvider,
  Localized,
  translateInternalText,
} from '../src/real/internalLanguage';
import { TierPreviewView } from '../src/real/views/TierPreviewView';
import {
  readShippingDraft,
  shippingDraftKey,
} from '../src/real/shippingDraft';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('customer English dates', () => {
  it('formats ISO dates and timestamps without system-locale month names', () => {
    expect(formatEnglishDate('2026-11-09')).toBe('Nov 9, 2026');
    expect(formatEnglishDate('2026-12-01 08:30:00')).toBe('Dec 1, 2026');
    expect(formatEnglishDate('')).toBe('');
    expect(formatEnglishDate('not-a-date')).toBe('not-a-date');
    expect(formatEnglishDate('2026-11-09')).not.toMatch(/[年月日]/);
  });

  it('shows the English closed-state value while keeping the ISO input value', () => {
    let value = '2026-11-09';
    const { rerender } = render(
      <EnglishDateField
        value={value}
        onChange={next => {
          value = next;
        }}
        ariaLabel="Expected ship date"
        testId="date"
      />
    );
    expect(screen.getByTestId('date-display').textContent).toBe('Nov 9, 2026');
    expect((screen.getByTestId('date') as HTMLInputElement).value).toBe('2026-11-09');
    fireEvent.change(screen.getByTestId('date'), { target: { value: '2026-12-01' } });
    expect(value).toBe('2026-12-01');
    rerender(<EnglishDateField value="2026-12-01" onChange={() => undefined} ariaLabel="Expected ship date" testId="date" />);
    expect(screen.getByTestId('date-display').textContent).toBe('Dec 1, 2026');
  });

  it('uses an English placeholder before a date is chosen', () => {
    render(<EnglishDateField value="" onChange={() => undefined} ariaLabel="Expected ship date" testId="date" />);
    expect(screen.getByTestId('date-display').textContent).toBe('Select date');
  });
});


describe('destination combobox selection integrity', () => {
  const options = [
    { value: 'USA', label: 'USA — United States' },
    { value: 'GBR', label: 'GBR — United Kingdom' },
  ];

  function Harness({ strict = true }: { strict?: boolean }) {
    const [value, setValue] = React.useState('USA');
    return (
      <>
        <SearchableCombobox
          options={options}
          value={value}
          onChange={setValue}
          ariaLabel="Destination"
          testId="combo"
          clearOnUnselectedQuery={strict}
        />
        <output data-testid="value">{value}</output>
      </>
    );
  }

  it('clears a saved destination when an unmatched query is abandoned by blur', () => {
    render(<Harness />);
    const input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ZZZ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('');
    expect(input.value).toBe('');
  });

  it('clears on an outside pointer press before the submit click', () => {
    render(<Harness />);
    const input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ZZZ' } });
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('clears on Escape after typing, but keeps the selection when Escape only closes the menu', () => {
    const { unmount } = render(<Harness />);
    let input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ZZZ' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('value').textContent).toBe('');
    unmount();

    render(<Harness />);
    input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('value').textContent).toBe('USA');
  });

  it('supports pointer and keyboard selection', () => {
    const { unmount } = render(<Harness />);
    let input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'United Kingdom' } });
    const option = screen.getByRole('option', { name: /GBR/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(screen.getByTestId('value').textContent).toBe('GBR');
    unmount();

    render(<Harness />);
    input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'GBR' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('GBR');
  });

  it('restores the previous selection after an abandoned query when strict mode is off', () => {
    render(<Harness strict={false} />);
    const input = screen.getByTestId('combo') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ZZZ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('value').textContent).toBe('USA');
    expect(input.value).toBe('USA — United States');
  });
});

describe('real shipping draft compatibility', () => {
  it('defaults to Sea for empty and malformed drafts', () => {
    expect(readShippingDraft('C000001').shippingMethod).toBe('Sea');
    window.localStorage.setItem(
      shippingDraftKey('C000001'),
      JSON.stringify({
        version: 1,
        shippingMethod: '',
        destinationCountryAlpha3: '',
        expectedShipDate: '',
        shippingRequirements: '',
      })
    );
    expect(readShippingDraft('C000001').shippingMethod).toBe('Sea');
    expect(readShippingDraft('C000001').destinationCountryAlpha3).toBe('');
  });

  it('keeps a valid saved method and ISO destination, rejects invalid text', () => {
    window.localStorage.setItem(
      shippingDraftKey('C000002'),
      JSON.stringify({
        version: 1,
        shippingMethod: 'Air',
        destinationCountryAlpha3: 'usa',
        expectedShipDate: '2026-12-01',
        shippingRequirements: '',
      })
    );
    expect(readShippingDraft('C000002')).toMatchObject({
      shippingMethod: 'Air',
      destinationCountryAlpha3: 'USA',
      expectedShipDate: '2026-12-01',
    });
    window.localStorage.setItem(
      shippingDraftKey('C000003'),
      JSON.stringify({
        version: 1,
        shippingMethod: 'Teleport',
        destinationCountryAlpha3: 'ZZZ',
      })
    );
    expect(readShippingDraft('C000003')).toMatchObject({
      shippingMethod: 'Sea',
      destinationCountryAlpha3: '',
    });
  });
});

describe('inventory CSV template', () => {
  it('uses the exact parser headers and remains parseable after filling', () => {
    expect(INVENTORY_TEMPLATE_HEADERS).toEqual([
      'sku_code',
      'warehouse_code',
      'on_hand',
      'unsellable',
    ]);
    const filled = `${INVENTORY_TEMPLATE_CSV}AKT-0001-BLK,WH-SH,120,0\n`;
    const parsed = parseInventoryTable(parseCsv(filled));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines[0]).toMatchObject({
      skuCode: 'AKT-0001-BLK',
      warehouseCode: 'WH-SH',
      onHand: 120,
      unsellable: 0,
    });
    const headerOnly = parseInventoryTable(parseCsv(INVENTORY_TEMPLATE_CSV));
    expect(headerOnly.errors.join(' ')).not.toContain('Missing required column');
    expect(headerOnly.errors.join(' ')).toContain('No data rows');
  });
});

describe('shared internal language', () => {
  it('switches bilingual and known internal text without concatenating both languages', () => {
    expect(translateInternalText('Inventory', 'zh')).toBe('库存');
    expect(translateInternalText('Inventory', 'en')).toBe('Inventory');
    expect(translateInternalText('Stock import / 库存导入', 'zh')).toBe('库存导入');
    expect(translateInternalText('Stock import / 库存导入', 'en')).toBe('Stock import');
    expect(translateInternalText('没有匹配的 SKU', 'en')).toBe('No matching SKU');
    expect(translateInternalText('没有匹配的 SKU', 'zh')).toBe('没有匹配的 SKU');
    expect(translateInternalText('Colour ZH', 'zh')).toBe('颜色中文');
    expect(translateInternalText('No series', 'zh')).toBe('无系列');
    expect(translateInternalText('库存视图', 'en')).toBe('Inventory view');
    expect(translateInternalText('Prepare registration', 'zh')).toBe('准备登记');
  });

  it('translates rendered host text and attributes in Chinese mode', () => {
    window.localStorage.setItem('aoking.internal.language.unit', 'zh');
    render(
      <InternalLanguageProvider userKey="unit">
        <Localized>
          <div>
            <span>Inventory</span>
            <input aria-label="Search SKU, product or warehouse" />
            <span>Register stock</span>
          </div>
        </Localized>
      </InternalLanguageProvider>
    );
    expect(screen.getByText('库存')).toBeTruthy();
    expect(screen.getByText('登记库存')).toBeTruthy();
    expect(screen.getByRole('textbox').getAttribute('aria-label')).toBe('搜索 SKU、商品或仓库');
    expect(screen.queryByText('Inventory')).toBeNull();
  });
});

describe('approved tier preview', () => {
  it('shows the five approved levels and never claims persistence', () => {
    window.localStorage.setItem('aoking.internal.language.tier-unit', 'en');
    render(
      <InternalLanguageProvider userKey="tier-unit">
        <TierPreviewView />
      </InternalLanguageProvider>
    );
    expect(screen.getByText(/UI preview only/i)).toBeTruthy();
    for (let level = 1; level <= 5; level += 1) {
      expect(screen.getByTestId(`tier-preview-badge-${level}`)).toBeTruthy();
    }
    expect(screen.queryByText(/saved to the database/i)).toBeNull();
    expect(screen.getByText(/No Real tier endpoint/i)).toBeTruthy();
  });

  it('validates edits and only updates the local preview', () => {
    window.localStorage.setItem('aoking.internal.language.tier-unit-2', 'en');
    render(
      <InternalLanguageProvider userKey="tier-unit-2">
        <TierPreviewView />
      </InternalLanguageProvider>
    );
    fireEvent.click(screen.getByTestId('tier-edit-2'));
    fireEvent.change(screen.getByTestId('tier-threshold-2'), { target: { value: '200000' } });
    fireEvent.click(screen.getByTestId('tier-apply-2'));
    expect(screen.getByRole('alert').textContent).toContain('ascending');
    fireEvent.change(screen.getByTestId('tier-threshold-2'), { target: { value: '12000' } });
    fireEvent.click(screen.getByTestId('tier-apply-2'));
    expect(screen.getByRole('status').textContent).toContain('Preview updated in this browser only');
    expect(screen.getByTestId('tier-preview-row-2').textContent).toContain('12,000');
  });
});
