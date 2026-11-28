/**
 * Fills gaps in the JavaScript engine's Intl before any screen renders. Hermes (the Android app's
 * engine) has no Intl.PluralRules, which every plural message needs; the web build keeps the
 * browser's own. Imported first by app/_layout.tsx.
 */
import { ensurePluralRules } from '@flatrimony/i18n';

ensurePluralRules();
