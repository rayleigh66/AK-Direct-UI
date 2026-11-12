import { expect, test, type Page } from '@playwright/test';

async function waitForVisibleImages(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      })
      .every((image) => image.complete && image.naturalWidth > 0)
  );
}

test('production customer path keeps hashed images and real submitted totals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shop in-stock wholesale' })).toBeVisible();
  await waitForVisibleImages(page);
  const firstImage = page.locator('[data-testid="product-card"] img').first();
  await expect(firstImage).toHaveAttribute('src', /^\/assets\//);
  expect(await firstImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  await page.locator('[data-testid="product-card"]').first().click();
  const detail = page.getByTestId('product-detail');
  await expect(detail).toBeVisible();
  await waitForVisibleImages(page);
  await detail.locator('[data-testid="sku-color"]').nth(1).click();
  await detail.locator('[data-testid="quantity-input"]').fill('12');
  await detail.locator('[data-testid="add-to-order"]').click();
  await expect(detail.getByText('Added to your order list.')).toBeVisible();
  await detail.getByRole('button', { name: 'View order list' }).click();

  await expect(page.getByRole('heading', { name: 'Order list' })).toBeVisible();
  await expect(page.locator('[data-testid="cart-quantity-sku-9042-gry"]')).toHaveValue('12');
  await page.locator('[data-testid="submit-order"]').click();
  await expect(page.getByRole('heading', { name: 'Order request submitted' })).toBeVisible();
  await expect(page.getByTestId('success-total-pcs')).toHaveText('12 PCS');
  await expect(page.getByTestId('success-total-usd')).toHaveText('USD $410.40');
  const orderNo = (await page.getByTestId('success-order-no').textContent())!.trim();

  await page.getByRole('button', { name: 'View my orders' }).click();
  const orderCard = page.locator('div.bg-white.rounded-2xl', { hasText: orderNo }).first();
  await expect(orderCard.getByText('12 PCS')).toBeVisible();
  await expect(orderCard.getByText('USD $410.40')).toBeVisible();
});
