import translations from 'ember-intl/translations';
import { all } from 'rsvp';

const isBrowser = typeof window !== 'undefined';
const isValidLang = (lang) => typeof lang === 'string' && /^[a-z]{2,3}$/i.test(lang);

// The only caller maps over ember-intl's translation manifest, so a tag is always
// present; the default exists purely as a guard.
/* istanbul ignore next -- unreachable default argument */
function langOf(tag = 'en') {
    return String(tag).toLowerCase().split('-')[0];
}

const INTL_SERVICES = ['NumberFormat', 'PluralRules', 'DateTimeFormat', 'RelativeTimeFormat'];

/**
 * Whether the browser's own Intl has data for every console language. Native Intl is far
 * faster than the formatjs polyfills (a polyfilled date format costs milliseconds, native
 * microseconds; a dashboard formats thousands), so the polyfills load only when it doesn't.
 */
export function nativeIntlSupports(langs, intl = Intl) {
    try {
        return INTL_SERVICES.every((name) => typeof intl[name]?.supportedLocalesOf === 'function' && intl[name].supportedLocalesOf(langs).length === langs.length);
    } catch {
        return false;
    }
}

// When the browser lacks a console language (Mongolian, for one), the polyfills replace
// native Intl: ember-intl refuses to start without locale data.
async function loadBasePolyfills() {
    await import('@formatjs/intl-numberformat/polyfill-force');
    await import('@formatjs/intl-pluralrules/polyfill-force');
    await import('@formatjs/intl-datetimeformat/polyfill-force');
    // Without time zone data the polyfill knows only UTC: every time zone, the device's and
    // any explicit one such as Asia/Bangkok, formatted as UTC.
    await import('@formatjs/intl-datetimeformat/add-all-tz');
    await import('@formatjs/intl-relativetimeformat/polyfill-force');
}

/**
 * The device's time zone as the native Intl reports it. Read it before the polyfill replaces
 * Intl.DateTimeFormat: the polyfill itself always starts at UTC.
 */
export function deviceTimeZone(intl = Intl) {
    try {
        return new intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

/**
 * Give the polyfilled DateTimeFormat the device's time zone as its default, so times format in
 * local time as they would natively. Returns whether it was applied; a native constructor (no
 * __setDefaultTimeZone) or a zone the polyfill doesn't know is left alone.
 */
export function pinDefaultTimeZone(timeZone, intl = Intl) {
    const setDefault = intl.DateTimeFormat?.__setDefaultTimeZone;
    if (!timeZone || typeof setDefault !== 'function') {
        return false;
    }

    try {
        setDefault.call(intl.DateTimeFormat, timeZone);
        return true;
    } catch {
        return false;
    }
}

/**
 * The DateTimeFormat polyfill supports only the gregorian calendar, so a locale whose default
 * calendar is another one (Thai: buddhist) throws a RangeError, which broke every date on a
 * Thai page. Retry such a call with calendar: 'gregory'. Statics such as supportedLocalesOf and
 * __defaultLocale pass through to the polyfill unchanged.
 */
export function gregorianFallback(intl = Intl) {
    const Original = intl.DateTimeFormat;
    if (!Original || Original.__gregorianFallback) {
        return;
    }

    const create = (args) => {
        try {
            return Reflect.construct(Original, args);
        } catch (error) {
            const [locales, options] = args;
            if (error instanceof RangeError && /calendar/i.test(error.message) && !options?.calendar) {
                return Reflect.construct(Original, [locales, { ...(options ?? {}), calendar: 'gregory' }]);
            }

            throw error;
        }
    };

    intl.DateTimeFormat = new Proxy(Original, {
        construct: (target, args) => create(args),
        apply: (target, thisArg, args) => create(args),
        get: (target, key, receiver) => (key === '__gregorianFallback' ? true : Reflect.get(target, key, receiver)),
    });
}

/**
 * Every date in the console uses the gregorian calendar (C.E. years), in every language.
 * Thai's default calendar is buddhist (B.E.: 2569 for 2026), so native Intl and
 * Date#toLocale*String would show B.E. years while date-fns shows C.E.: mixed years on one
 * page. Adds calendar: 'gregory' to any date format that doesn't name a calendar itself.
 */
export function forceGregorianCalendar(intl = Intl, dateProto = Date.prototype) {
    const Original = intl.DateTimeFormat;
    if (!Original || Original.__forceGregorian) {
        return;
    }

    const withGregorian = (options) => (options?.calendar ? options : { ...(options ?? {}), calendar: 'gregory' });
    const create = ([locales, options]) => Reflect.construct(Original, [locales, withGregorian(options)]);

    intl.DateTimeFormat = new Proxy(Original, {
        construct: (target, args) => create(args),
        apply: (target, thisArg, args) => create(args),
        get: (target, key, receiver) => (key === '__forceGregorian' ? true : Reflect.get(target, key, receiver)),
    });

    for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
        const original = dateProto[name];
        dateProto[name] = function (locales, options) {
            return original.call(this, locales, withGregorian(options));
        };
    }
}

/**
 * The first of the browser's preferred languages that has locale data loaded, or English.
 */
export function preferredLanguage(langs, browserLanguages = []) {
    const match = browserLanguages.map((tag) => langOf(tag)).find((lang) => langs.includes(lang));

    return match ?? (langs.includes('en') ? 'en' : langs[0]);
}

/**
 * A formatjs polyfill takes its default locale from whichever locale data registers first.
 * Locale data loads for every translation at once, so without this the default becomes an
 * arbitrary language (Arabic, being first alphabetically) and every Intl call made without
 * an explicit locale formats numbers and dates in it. Pins the polyfills to the user's
 * language instead. A native constructor has no __defaultLocale and is left alone.
 */
export function pinDefaultLocale(lang, intl = Intl) {
    for (const name of ['NumberFormat', 'PluralRules', 'DateTimeFormat', 'RelativeTimeFormat']) {
        const constructor = intl[name];

        if (constructor && typeof constructor.__defaultLocale === 'string') {
            constructor.__defaultLocale = lang;
        }
    }
}

async function loadLocaleData(lang) {
    // initialize() already filters the language list through isValidLang, so this is a
    // second line of defence that the initializer itself can never trigger.
    /* istanbul ignore next -- unreachable via initialize() */
    if (!isValidLang(lang)) return;

    return all([
        import(`@formatjs/intl-numberformat/locale-data/${lang}.js`),
        import(`@formatjs/intl-pluralrules/locale-data/${lang}.js`),
        import(`@formatjs/intl-datetimeformat/locale-data/${lang}.js`),
        import(`@formatjs/intl-relativetimeformat/locale-data/${lang}.js`),
    ]);
}

export function initialize(application, intl = Intl) {
    // There is no window to polyfill outside a browser. The test suite only ever runs in
    // one, so this arm cannot be exercised.
    /* istanbul ignore next -- no browser, nothing to polyfill */
    if (!isBrowser) return;

    const locales = translations.map(([locale]) => String(locale));
    const langs = [...new Set(locales.map(langOf).filter(isValidLang))];

    // The browser already has every language: keep native Intl and start straight away.
    if (nativeIntlSupports(langs, intl)) {
        forceGregorianCalendar(intl);
        return;
    }

    application.deferReadiness();

    (async () => {
        const timeZone = deviceTimeZone();
        await loadBasePolyfills();
        await all(langs.map(loadLocaleData));
        pinDefaultLocale(preferredLanguage(langs, window.navigator.languages));
        pinDefaultTimeZone(timeZone);
        gregorianFallback();
        forceGregorianCalendar();
        application.advanceReadiness();
    })();
}

export default {
    name: 'load-intl-polyfills',
    initialize,
};
