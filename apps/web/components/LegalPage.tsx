import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { isLocale, t, type Locale } from '@flatrimony/i18n';
import { legalContent, type LegalNode, type LegalPageId } from '../lib/legal';
import '../app/legal.css';

/** The tags a legal content tree may use; anything else renders its text only. */
const BLOCK = {
  h3: 'h3',
  h4: 'h4',
  p: 'p',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  strong: 'strong',
  em: 'em',
  blockquote: 'blockquote',
  table: 'table',
  thead: 'thead',
  tbody: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
} as const;

function render(node: LegalNode, key: number): ReactNode {
  if (typeof node === 'string') return <Fragment key={key}>{node}</Fragment>;
  if (node.t === 'hr') return <hr key={key} />;
  const children = (node.c ?? []).map(render);
  const Tag = BLOCK[node.t as keyof typeof BLOCK];
  // A table needs a body around its rows for valid HTML.
  if (Tag === 'table')
    return (
      <div key={key} className="legal-table">
        <table>
          {(node.c ?? []).some((c) => typeof c !== 'string' && c.t === 'tr') ? (
            <tbody>{children}</tbody>
          ) : (
            children
          )}
        </table>
      </div>
    );
  return Tag ? <Tag key={key}>{children}</Tag> : <Fragment key={key}>{children}</Fragment>;
}

/** <title> from the page's own heading. */
export function legalMetadata(page: LegalPageId) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    if (!isLocale(locale)) return {};
    return { title: `${legalContent(page, locale).title} · ${t(locale, 'app.name')}` };
  };
}

/**
 * Terms (W07), Privacy (W08), Community Standards (W09) and Tenancy Guidelines (W10): the design's
 * draft text with a "pending legal review" banner, a table of contents and the 112 note from the
 * design's sidebar. Server-rendered and static.
 */
export function LegalPage({ page, locale }: { page: LegalPageId; locale: Locale }) {
  const content = legalContent(page, locale);
  const other: Locale = locale === 'en' ? 'hi' : 'en';
  const [subtitle, ...meta] = content.intro;
  return (
    <main className="legal">
      <nav className="legal-crumbs" aria-label={t(locale, 'web.legalPage.legal')}>
        <Link href={`/${locale}`}>{t(locale, 'web.legalPage.home')}</Link>
        <span aria-hidden="true">›</span>
        <span>{t(locale, 'web.legalPage.legal')}</span>
        <Link className="legal-lang" href={`/${other}/${page}`} hrefLang={other} lang={other}>
          {t(locale, 'web.legalPage.otherLanguage')}
        </Link>
      </nav>
      <header className="legal-header">
        <h1>{content.title}</h1>
        {subtitle ? <div className="legal-subtitle">{render(subtitle, 0)}</div> : null}
        {meta.length ? <div className="legal-meta">{meta.map(render)}</div> : null}
        <p className="legal-draft" role="note">
          {t(locale, 'web.legalPage.draft')}
        </p>
      </header>
      <div className="legal-layout">
        <aside className="legal-aside">
          <nav aria-labelledby="legal-toc">
            <h2 id="legal-toc">{t(locale, 'web.legalPage.onThisPage')}</h2>
            <ol>
              {content.sections.map((s, i) => (
                <li key={i}>
                  <a href={`#section-${i + 1}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="legal-emergency">
            <p className="legal-emergency-title">{t(locale, 'web.legalPage.emergencyTitle')}</p>
            <p>{t(locale, 'web.legalPage.emergency', { number: '112' })}</p>
          </div>
        </aside>
        <article className="legal-body">
          {content.sections.map((s, i) => (
            <section key={i} id={`section-${i + 1}`} aria-labelledby={`section-${i + 1}-title`}>
              <h2 id={`section-${i + 1}-title`}>{s.title}</h2>
              {s.blocks.map(render)}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
