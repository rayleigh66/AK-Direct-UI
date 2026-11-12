import { expect, type Page } from '@playwright/test';

export async function waitForInternalWorkspace(page: Page): Promise<void> {
  await expect(page.getByTestId('internal-shell')).toBeVisible();
}

export async function openInternalSidebar(page: Page): Promise<void> {
  await waitForInternalWorkspace(page);
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1024) return;
  const sidebar = page.getByTestId('real-sidebar');
  if (!(await sidebar.isVisible())) {
    await page.getByTestId('internal-nav-open').click();
    await expect(sidebar).toBeVisible();
  }
}

export async function openInternalTab(page: Page, tab: string): Promise<void> {
  await openInternalSidebar(page);
  const width = page.viewportSize()?.width ?? 1440;
  await page.getByTestId(`real-tab-${tab}`).click();
  if (width < 1024) await expect(page.getByTestId('real-sidebar')).toBeHidden();
}
