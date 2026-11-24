'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { parseRich } from '@flatrimony/client';
import { useT } from '../lib/client/app-context';

/** Primary or secondary action; `busy` keeps its size and announces the wait. */
export function Button({
  children,
  variant = 'primary',
  busy = false,
  disabled = false,
  type = 'button',
  onClick,
  testId,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'text';
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      // While busy the button stays focusable (keyboard focus is not lost) but does nothing.
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={(e) => {
        if (busy) return e.preventDefault();
        onClick?.();
      }}
      data-testid={testId}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

/** An error (announced at once) or an info message (announced politely). */
export function Notice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** "Agree to our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>." with links. */
export function LegalConsent() {
  const { raw, locale } = useT();
  return (
    <p className="legal">
      {parseRich(raw('legal.consent'), ['terms', 'privacy']).map((part, i) =>
        part.tag === 'terms' || part.tag === 'privacy' ? (
          <Link key={i} href={`/${locale}/${part.tag}`} target="_blank" rel="noopener">
            {part.text}
          </Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Top of every onboarding step: back, the step count with a progress bar, the title (focused when
 * the step opens, so screen readers announce the new step) and a short explanation.
 */
export function StepHeader({
  step,
  overline,
  title,
  subtitle,
  backHref,
}: {
  /** 1–6, or none for "About you". */
  step?: number;
  overline: string;
  title: string;
  subtitle?: string;
  backHref?: string;
}) {
  const { t } = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <header className="step-header">
      <div className="step-top">
        {backHref ? (
          <Link className="back" href={backHref} aria-label={t('common.back')}>
            <span aria-hidden="true">←</span>
          </Link>
        ) : null}
        {step ? (
          <div
            className="progress"
            role="progressbar"
            aria-label={t('onboarding.stepOf', { n: step })}
            aria-valuemin={1}
            aria-valuemax={6}
            aria-valuenow={step}
          >
            <div className="progress-fill" style={{ width: `${(step / 6) * 100}%` }} />
          </div>
        ) : null}
      </div>
      <p className="overline">{overline}</p>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {subtitle ? <p className="subtitle">{subtitle}</p> : null}
    </header>
  );
}

/** One choice from a few, as chips (native radios: arrow keys and screen readers just work). */
export function RadioChips<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  hideLegend = false,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** For screen readers only, when the page title already says it. */
  hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="group">
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label key={String(o.value)} className="chip">
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One choice as cards with a title and an explanation (intent, category). */
export function RadioCards<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 1,
}: {
  legend: string;
  options: readonly { value: T; title: string; sub: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns?: 1 | 2;
}) {
  const name = useId();
  return (
    <fieldset className="group">
      <legend className="visually-hidden">{legend}</legend>
      <div className={columns === 2 ? 'cards cards-2' : 'cards'}>
        {options.map((o) => (
          <label key={o.value} className="card-option">
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="card-title">{o.title}</span>
            <span className="card-sub">{o.sub}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** − value + with named buttons (budget, lease). */
export function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  canMinus,
  canPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  canMinus: boolean;
  canPlus: boolean;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" aria-label={minusLabel} disabled={!canMinus} onClick={onMinus}>
          <span aria-hidden="true">−</span>
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={plusLabel} disabled={!canPlus} onClick={onPlus}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}

/** Page frame for sign-in and onboarding: one column, the actions at the end. */
export function Frame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="frame">
      <div className="frame-body">{children}</div>
      {actions ? <div className="frame-actions">{actions}</div> : null}
    </main>
  );
}
