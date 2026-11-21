import { setDefaultOptions } from 'date-fns';
import th from 'date-fns/locale/th';

/**
 * date-fns locales by language code. Every Fleetbase package formats dates and relative
 * times ("about 6 hours ago", "Nov 22, 2026") with the shared date-fns module, so setting
 * its default locale here translates them without changing each package.
 */
export const DATE_FNS_LOCALES = { th };

export function dateFnsLocaleFor(locale) {
    const language = String(locale ?? '')
        .toLowerCase()
        .split(/[-_]/)[0];
    return DATE_FNS_LOCALES[language];
}

export function applyDateFnsLocale(intl) {
    // An undefined locale removes the default, so date-fns falls back to English.
    setDefaultOptions({ locale: dateFnsLocaleFor(intl?.primaryLocale) });
}

export function initialize(appInstance) {
    const intl = appInstance.lookup('service:intl');
    if (!intl) return;
    applyDateFnsLocale(intl);
    intl.onLocaleChanged?.(() => applyDateFnsLocale(intl));
}

export default {
    initialize,
};
