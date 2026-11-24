/**
 * The legal pages (W07–W10) while their text is in legal review: each loads in both languages
 * with its title, the "being prepared" note and the 112 note, none of the unreviewed draft text,
 * a working language switch, nothing serious for axe — and the sign-in consent links open them
 * (they were 404s before).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { messages } from '@flatrimony/i18n';

const PAGES = ['terms', 'privacy', 'community-standards', 'tenancy-guidelines'] as const;

for (const locale of ['en', 'hi'] as const) {
  const m = messages[locale].web.legalPage;
  for (const page of PAGES) {
    test(`${locale}/${page}`, async ({ page: tab }) => {
      const res = await tab.goto(`/${locale}/${page}`);
      expect(res?.status()).toBe(200);
      await expect(tab.getByRole('heading', { level: 1 })).toHaveText(m.titles[page]);
      await expect(tab.getByRole('note')).toHaveText(m.preparing);
      await expect(tab.locator('main')).toContainText('112');
      // The design's unreviewed drafts stay off the page (invented claims; docs/07 T0.15).
      await expect(tab.locator('main')).not.toContainText(
        /Pvt\. Ltd|@flatrimony\.in|ISO|AES-256|DigiLocker partner|%|₹/,
      );
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

test('the language switch opens the same page in the other language', async ({ page }) => {
  await page.goto('/en/privacy');
  await page.getByRole('link', { name: messages.en.web.legalPage.otherLanguage }).click();
  await expect(page).toHaveURL(/\/hi\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    messages.hi.web.legalPage.titles.privacy,
  );
});

test('the sign-in consent links open the Terms and the Privacy Policy', async ({
  page,
  context,
}) => {
  await page.goto('/en/sign-in');
  for (const [name, title] of [
    [messages.en.legal.terms, messages.en.web.legalPage.titles.terms],
    [messages.en.legal.privacy, messages.en.web.legalPage.titles.privacy],
  ] as const) {
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name, exact: true }).click(),
    ]);
    await tab.waitForLoadState();
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText(title);
    await tab.close();
  }
});
