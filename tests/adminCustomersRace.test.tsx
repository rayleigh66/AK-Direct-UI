// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InternalLanguageProvider } from '../src/real/internalLanguage';
import type {
  AdminCustomerAccountDto,
  AdminCustomerCompanyDto,
  OrderImpactDto,
} from '../src/real/types';

vi.mock('../src/real/RealWorkspace', () => ({
  ErrorBlock: ({ message }: { message: string }) => message,
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

  it('keeps a delayed one-time credential bound to its company and does not create twice', async () => {
    const companyA = company('company-a', 'C000001');
    const companyB = company('company-b', 'C000002');
    const createAccount = deferred<{ username: string; temporaryPassword: string }>();

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA, companyB]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockImplementation(id =>
      Promise.resolve(id === companyA.id ? [account('account-a', 'AK000001A')] : [account('account-b', 'AK000002A')])
    );
    vi.mocked(api.createCompanyAccount).mockReturnValue(createAccount.promise);

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');

    fireEvent.click(rows[0]);
    await waitFor(() => expect(api.listCompanyAccounts).toHaveBeenCalledWith(companyA.id));
    const add = screen.getByTestId('company-add-account');
    fireEvent.click(add);
    fireEvent.click(add);
    expect(api.createCompanyAccount).toHaveBeenCalledTimes(1);

    // Switch to B while A's account creation is still in flight.
    fireEvent.click(screen.getAllByTestId('customer-company-row')[1]);
    await waitFor(() => expect(api.listCompanyAccounts).toHaveBeenCalledWith(companyB.id));
    createAccount.resolve({ username: 'AK000001B', temporaryPassword: 'one-time-A' });

    await waitFor(() => expect(screen.queryByTestId('temp-credential')).toBeNull());
    const banner = await screen.findByTestId('pending-credential-banner');
    expect(banner.textContent).toContain('C000001');
    expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002');

    // The credential is still recoverable only by returning to company A.
    fireEvent.click(within(banner).getByRole('button', { name: 'C000001' }));
    await waitFor(() => expect(screen.getByTestId('temp-credential')).toBeTruthy());
    expect(screen.getByTestId('temp-credential-company').textContent).toContain('C000001');
    expect(screen.getByTestId('temp-credential-username').textContent).toContain('AK000001B');
    fireEvent.click(screen.getByTestId('temp-credential-close'));
    await waitFor(() => expect(screen.queryByTestId('pending-credential-banner')).toBeNull());
  });

  it('does not show a completed write inside the newly selected company', async () => {
    const companyA = company('company-a', 'C000001');
    const companyB = company('company-b', 'C000002');
    const write = deferred<AdminCustomerCompanyDto>();

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA, companyB]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockImplementation(id =>
      Promise.resolve(id === companyA.id ? [account('account-a', 'AK000001A')] : [account('account-b', 'AK000002A')])
    );
    vi.mocked(api.getPendingOrderImpact).mockResolvedValue({
      kind: 'company_suspend',
      targetId: companyA.id,
      companyId: companyA.id,
      affectedOrders: [],
      impactToken: 'empty',
    });
    vi.mocked(api.setCompanyStatus).mockReturnValue(write.promise);

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('company-status-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('company-status-toggle'));
    await waitFor(() => expect(api.setCompanyStatus).toHaveBeenCalledWith(companyA.id, 'suspended'));

    fireEvent.click(screen.getAllByTestId('customer-company-row')[1]);
    await waitFor(() => expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002'));
    write.resolve({ ...companyA, status: 'suspended' });

    await waitFor(() => expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002'));
    expect(screen.queryByTestId('admin-notice')).toBeNull();
    expect(screen.getByText('AK000002A')).toBeTruthy();
  });

  it('does not show a failed write inside the newly selected company', async () => {
    const companyA = company('company-a', 'C000001');
    const companyB = company('company-b', 'C000002');
    const write = deferred<AdminCustomerCompanyDto>();

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA, companyB]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockImplementation(id =>
      Promise.resolve(id === companyA.id ? [account('account-a', 'AK000001A')] : [account('account-b', 'AK000002A')])
    );
    vi.mocked(api.getPendingOrderImpact).mockResolvedValue({
      kind: 'company_suspend',
      targetId: companyA.id,
      companyId: companyA.id,
      affectedOrders: [],
      impactToken: 'empty',
    });
    vi.mocked(api.setCompanyStatus).mockReturnValue(write.promise);

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('company-status-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('company-status-toggle'));
    await waitFor(() => expect(api.setCompanyStatus).toHaveBeenCalled());

    fireEvent.click(screen.getAllByTestId('customer-company-row')[1]);
    await waitFor(() => expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002'));
    write.reject(new Error('A write failed'));

    await waitFor(() => expect(screen.queryByText('A write failed')).toBeNull());
    expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002');
    expect(screen.getByText('AK000002A')).toBeTruthy();
  });

  it('does not open a destructive dialog after switching away from the previewed company', async () => {
    const companyA = company('company-a', 'C000001');
    const companyB = company('company-b', 'C000002');
    const preview = deferred<OrderImpactDto>();

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA, companyB]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockImplementation(id =>
      Promise.resolve(id === companyA.id ? [account('account-a', 'AK000001A')] : [account('account-b', 'AK000002A')])
    );
    vi.mocked(api.getPendingOrderImpact).mockReturnValue(preview.promise);

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('company-status-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('company-status-toggle'));
    await waitFor(() => expect(api.getPendingOrderImpact).toHaveBeenCalled());

    fireEvent.click(screen.getAllByTestId('customer-company-row')[1]);
    await waitFor(() => expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002'));
    preview.resolve({
      kind: 'company_suspend',
      targetId: companyA.id,
      companyId: companyA.id,
      affectedOrders: [
        {
          id: 'order-a',
          orderNo: 'OD0000000001',
          companyId: companyA.id,
          companyCode: 'C000001',
          status: 'PENDING_CONFIRMATION',
          revision: 1,
          referenceTotalCents: 10000,
          submittedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
      impactToken: 'token-a',
    });

    await waitFor(() => expect(api.getPendingOrderImpact).toHaveBeenCalled());
    expect(screen.queryByTestId('customer-impact-dialog')).toBeNull();
    expect(screen.getByTestId('customer-company-detail').textContent).toContain('C000002');
  });

  it('shows affected orders and only writes after confirming the impact token', async () => {
    const companyA = company('company-a', 'C000001');
    const impact: OrderImpactDto = {
      kind: 'company_suspend',
      targetId: companyA.id,
      companyId: companyA.id,
      affectedOrders: [
        {
          id: 'order-a',
          orderNo: 'OD0000000001',
          companyId: companyA.id,
          companyCode: 'C000001',
          status: 'PENDING_CONFIRMATION',
          revision: 1,
          referenceTotalCents: 10000,
          submittedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
      impactToken: 'token-a',
    };

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockResolvedValue([account('account-a', 'AK000001A')]);
    vi.mocked(api.getPendingOrderImpact).mockResolvedValue(impact);
    vi.mocked(api.setCompanyStatus).mockResolvedValue({ ...companyA, status: 'suspended' });

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('company-status-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('company-status-toggle'));
    const dialog = await screen.findByTestId('customer-impact-dialog');
    expect(dialog.textContent).toContain('OD0000000001');

    fireEvent.click(screen.getByTestId('customer-impact-cancel'));
    await waitFor(() => expect(screen.queryByTestId('customer-impact-dialog')).toBeNull());
    expect(api.setCompanyStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('company-status-toggle'));
    await screen.findByTestId('customer-impact-dialog');
    fireEvent.click(screen.getByTestId('customer-impact-confirm'));
    await waitFor(() =>
      expect(api.setCompanyStatus).toHaveBeenCalledWith(companyA.id, 'suspended', {
        confirmAffectedOrders: true,
        impactToken: 'token-a',
      })
    );
  });

  it('shows a clear error when the impact token changes before confirmation', async () => {
    const companyA = company('company-a', 'C000001');
    const impact: OrderImpactDto = {
      kind: 'company_suspend',
      targetId: companyA.id,
      companyId: companyA.id,
      affectedOrders: [
        {
          id: 'order-a',
          orderNo: 'OD0000000001',
          companyId: companyA.id,
          companyCode: 'C000001',
          status: 'PENDING_CONFIRMATION',
          revision: 1,
          referenceTotalCents: 10000,
          submittedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
      impactToken: 'token-a',
    };

    vi.mocked(api.listAdminCompanies).mockResolvedValue([companyA]);
    vi.mocked(api.listSalesUsers).mockResolvedValue([]);
    vi.mocked(api.listCompanyAccounts).mockResolvedValue([account('account-a', 'AK000001A')]);
    vi.mocked(api.getPendingOrderImpact).mockResolvedValue(impact);
    vi.mocked(api.setCompanyStatus).mockRejectedValue(
      new Error('The affected pending orders changed after the preview. Review the latest impact and confirm again.')
    );

    renderView();
    const rows = await screen.findAllByTestId('customer-company-row');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('company-status-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('company-status-toggle'));
    await screen.findByTestId('customer-impact-dialog');
    fireEvent.click(screen.getByTestId('customer-impact-confirm'));

    await waitFor(() =>
      expect(screen.getByText(/The affected pending orders changed after the preview/)).toBeTruthy()
    );
  });
});
