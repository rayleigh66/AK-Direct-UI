// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InternalLanguageProvider } from '../src/real/internalLanguage';
import type { AdminCustomerAccountDto, AdminCustomerCompanyDto } from '../src/real/types';

vi.mock('../src/real/RealWorkspace', () => ({
  ErrorBlock: () => null,
  LoadingBlock: () => null,
}));

vi.mock('../src/real/api', () => ({
  createAdminCompany: vi.fn(),
  createCompanyAccount: vi.fn(),
  getPendingOrderImpact: vi.fn(),
  listAdminBrands: vi.fn(),
  listAdminCompanies: vi.fn(),
  listCompanyAccounts: vi.fn(),
  listCompanyBrandIds: vi.fn(),
  listSalesUsers: vi.fn(),
  setCompanyBrandGrant: vi.fn(),
  setCompanySalesAssignment: vi.fn(),
  setCompanyStatus: vi.fn(),
  setCustomerStatus: vi.fn(),
}));

import { AdminCustomersView } from '../src/real/views/AdminCustomersView';
import * as api from '../src/real/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function company(id: string, customerCode: string): AdminCustomerCompanyDto {
  return {
    id,
    customerCode,
    shortName: `Company ${customerCode}`,
    countryAlpha3: 'USA',
    status: 'active',
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
  };
}

function account(id: string, username: string): AdminCustomerAccountDto {
  return {
    id,
    username,
    accountLetter: 'A',
    status: 'active',
    mustChangePassword: false,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
  };
}

function renderView() {
  return render(
    <InternalLanguageProvider userKey="race-test">
      <AdminCustomersView
        canManageCompanies
        canManageAccounts
        canManageBrands={false}
        canReadCatalog={false}
      />
    </InternalLanguageProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('admin customer detail selection', () => {
  it('keeps the latest company when an earlier account request resolves last', async () => {
    const companyA = company('company-a', 'C000001');
    const companyB = company('company-b', 'C000002');
    const accountsA = deferred<AdminCustomerAccountDto[]>();
    const accountsB = deferred<AdminCustomerAccountDto[]>();

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA, companyB]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockImplementation(id =>
      id === companyA.id ? accountsA.promise : accountsB.promise
    );

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    await waitFor(() => expect(api.listCompanyAccounts).toHaveBeenCalledTimes(2));

    // The second company's response arrives first.
    accountsB.resolve([account('account-b', 'AK000002A')]);
    await waitFor(() => expect(screen.getByText('AK000002A')).toBeTruthy());

    // The first company's slow response must not replace the second company.
    accountsA.resolve([account('account-a', 'AK000001A')]);
    await waitFor(() => expect(screen.queryByText('AK000001A')).toBeNull());
    expect(screen.getByText('AK000002A')).toBeTruthy();
    expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002');
  });
});
