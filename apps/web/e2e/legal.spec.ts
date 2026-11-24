/**
 * The legal pages (W07–W10): each loads in both languages with the draft banner, its contents
 * list leads to its sections, axe finds nothing serious, and the sign-in page's consent links
 * open them (they were 404s before).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { messages } from '@flatrimony/i18n';

const PAGES = ['terms', 'privacy', 'community-standards', 'tenancy-guidelines'] as const;

for (const locale of ['en', 'hi'] as const) {
  for (const page of PAGES) {
    test(`${locale}/${page}`, async ({ page: tab }) => {
      const res = await tab.goto(`/${locale}/${page}`);
      expect(res?.status()).toBe(200);
      await expect(tab.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(tab.getByRole('note')).toHaveText(messages[locale].web.legalPage.draft);
      // No invented company details (founder rule): the placeholders stand in for them.
      await expect(tab.locator('main')).not.toContainText(/Pvt\. Ltd|Private Limited|Building 10/);
      const contents = tab.getByRole('navigation', {
        name: messages[locale].web.legalPage.onThisPage,
      });
      const first = contents.getByRole('link').first();
      await first.click();
      await expect(tab).toHaveURL(/#section-1$/);
      const { violations } = await new AxeBuilder({ page: tab })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`),
      ).toEqual([]);
    });
  }
}

test('the sign-in consent links open the Terms and the Privacy Policy', async ({
  page,
  context,
}) => {
  await page.goto('/en/sign-in');
  for (const name of [messages.en.legal.terms, messages.en.legal.privacy]) {
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name, exact: true }).click(),
    ]);
    await tab.waitForLoadState();
    await expect(tab.getByRole('heading', { level: 1 })).toBeVisible();
    await tab.close();
  }
});
