import { module, test } from 'qunit';
import {
    deviceTimeZone,
    forceGregorianCalendar,
    gregorianFallback,
    initialize,
    nativeIntlSupports,
    pinDefaultLocale,
    pinDefaultTimeZone,
    preferredLanguage,
} from '@fleetbase/console/initializers/load-intl-polyfills';

// An Intl with no locale data, so initialize() takes the polyfill path.
const NO_NATIVE_INTL = {};

module('Unit | Initializer | load-intl-polyfills | native Intl', function () {
    test('native Intl with every language is kept: no polyfills, readiness untouched', function (assert) {
        const calls = [];
        const supports = (langs) => langs;
        const native = {
            NumberFormat: { supportedLocalesOf: supports },
            PluralRules: { supportedLocalesOf: supports },
            DateTimeFormat: { supportedLocalesOf: supports },
            RelativeTimeFormat: { supportedLocalesOf: supports },
        };

        initialize({ deferReadiness: () => calls.push('defer'), advanceReadiness: () => calls.push('advance') }, native);

        assert.deepEqual(calls, [], 'nothing to wait for');
    });

    test('nativeIntlSupports needs every service to have every language', function (assert) {
        const all = (langs) => langs;
        const noThai = (langs) => langs.filter((lang) => lang !== 'th');
        const make = (dtf) => ({
            NumberFormat: { supportedLocalesOf: all },
            PluralRules: { supportedLocalesOf: all },
            DateTimeFormat: { supportedLocalesOf: dtf },
            RelativeTimeFormat: { supportedLocalesOf: all },
        });

        assert.true(nativeIntlSupports(['en', 'th'], make(all)));
        assert.false(nativeIntlSupports(['en', 'th'], make(noThai)), 'a missing language needs the polyfill');
        assert.false(nativeIntlSupports(['en'], {}), 'no Intl services');
        assert.false(
            nativeIntlSupports(
                ['en'],
                make(() => {
                    throw new Error('broken');
                })
            ),
            'a throwing Intl needs the polyfill'
        );
        assert.true(nativeIntlSupports(['en', 'th']), 'this browser has English and Thai natively');
    });
});

module('Unit | Initializer | load-intl-polyfills', function () {
    test('it defers readiness while the polyfills load and advances afterwards', async function (assert) {
        const calls = [];
        let advanced;
        const didAdvance = new Promise((resolve) => (advanced = resolve));

        const application = {
            deferReadiness: () => calls.push('defer'),
            advanceReadiness: () => {
                calls.push('advance');
                advanced();
            },
        };

        initialize(application, NO_NATIVE_INTL);

        assert.deepEqual(calls, ['defer'], 'readiness is deferred synchronously');

        // The polyfills load through dynamic imports in a bare async IIFE, which settled()
        // does not track — wait on advanceReadiness itself.
        await didAdvance;

        assert.deepEqual(calls, ['defer', 'advance'], 'readiness advances once the polyfills resolve');
    });
});

module('Unit | Initializer | load-intl-polyfills | default locale', function () {
    test('the preferred language is the first browser language with locale data, else English', function (assert) {
        const langs = ['ar', 'de', 'en', 'fr'];

        assert.strictEqual(preferredLanguage(langs, ['fr-CA', 'en-US']), 'fr');
        assert.strictEqual(preferredLanguage(langs, ['ja-JP', 'en-SG']), 'en');
        assert.strictEqual(preferredLanguage(langs, ['ja-JP']), 'en');
        assert.strictEqual(preferredLanguage(['ar', 'de'], []), 'ar');
    });

    test('a polyfill is pinned to that language instead of the first locale data it loaded', function (assert) {
        // A polyfill records the first locale data it receives as its default ("ar" here); native
        // constructors carry no __defaultLocale and must be left untouched.
        const polyfilled = { __defaultLocale: 'ar' };
        const native = function NativeDateTimeFormat() {};
        const intl = { NumberFormat: polyfilled, PluralRules: { __defaultLocale: 'ar' }, DateTimeFormat: native };

        pinDefaultLocale('en', intl);

        assert.strictEqual(intl.NumberFormat.__defaultLocale, 'en');
        assert.strictEqual(intl.PluralRules.__defaultLocale, 'en');
        assert.strictEqual(native.__defaultLocale, undefined);
    });

    test('after loading, formatting without a locale follows the browser language, not the first locale loaded', async function (assert) {
        let advanced;
        const didAdvance = new Promise((resolve) => (advanced = resolve));

        initialize({ deferReadiness() {}, advanceReadiness: () => advanced() }, NO_NATIVE_INTL);
        await didAdvance;

        const language = (tag) => String(tag).toLowerCase().split('-')[0];
        // The console ships English and Thai only (config/ember-intl.js includeLocales).
        const browser = preferredLanguage(['en', 'th'], navigator.languages);

        assert.strictEqual(language(new Intl.NumberFormat().resolvedOptions().locale), browser);
        assert.strictEqual(language(new Intl.DateTimeFormat().resolvedOptions().locale), browser);
        // Every console language still has data, which ember-intl needs to start.
        assert.strictEqual(Intl.NumberFormat.supportedLocalesOf(['th']).length, 1);
    });

    test('with no browser languages it falls back to English', function (assert) {
        assert.strictEqual(preferredLanguage(['ar', 'en', 'mn']), 'en');
    });
});

module('Unit | Initializer | load-intl-polyfills | time zones and calendars', function () {
    test('the device time zone comes from the native constructor, or is undefined when it throws', function (assert) {
        const native = {
            DateTimeFormat: class {
                resolvedOptions() {
                    return { timeZone: 'Asia/Bangkok' };
                }
            },
        };
        const broken = {
            DateTimeFormat: class {
                constructor() {
                    throw new Error('no Intl');
                }
            },
        };

        assert.strictEqual(deviceTimeZone(native), 'Asia/Bangkok');
        assert.strictEqual(deviceTimeZone(broken), undefined);
    });

    test('the polyfill default time zone is pinned only when it can be', function (assert) {
        const seen = [];
        const polyfilled = {
            DateTimeFormat: {
                __setDefaultTimeZone(zone) {
                    seen.push(zone);
                },
            },
        };
        const rejects = {
            DateTimeFormat: {
                __setDefaultTimeZone() {
                    throw new RangeError('Invalid timeZoneName');
                },
            },
        };
        const native = { DateTimeFormat: function NativeDateTimeFormat() {} };

        assert.true(pinDefaultTimeZone('Asia/Bangkok', polyfilled));
        assert.deepEqual(seen, ['Asia/Bangkok']);
        assert.false(pinDefaultTimeZone(undefined, polyfilled), 'no zone, nothing to pin');
        assert.false(pinDefaultTimeZone('Mars/Base', rejects), 'a zone the polyfill rejects is ignored');
        assert.false(pinDefaultTimeZone('Asia/Bangkok', native), 'a native constructor is left alone');
    });

    test('a locale whose default calendar the polyfill lacks falls back to gregorian', function (assert) {
        class FakeDateTimeFormat {
            static supportedLocalesOf = () => ['th'];
            constructor(locale, options = {}) {
                if (locale === 'th' && options.calendar !== 'gregory') {
                    throw new RangeError(`Calendar "${options.calendar ?? 'buddhist'}" is not supported.`);
                }
                if (locale === 'bad') {
                    throw new RangeError('Incorrect locale information provided');
                }
                this.options = { locale, ...options };
            }
        }
        const intl = { DateTimeFormat: FakeDateTimeFormat };

        gregorianFallback(intl);
        const wrapped = intl.DateTimeFormat;
        gregorianFallback(intl);

        assert.strictEqual(intl.DateTimeFormat, wrapped, 'wrapping twice is a no-op');
        assert.deepEqual(new intl.DateTimeFormat('th', { hour: 'numeric' }).options, { locale: 'th', hour: 'numeric', calendar: 'gregory' });
        assert.deepEqual(intl.DateTimeFormat('th').options, { locale: 'th', calendar: 'gregory' }, 'calling without new works too');
        assert.deepEqual(new intl.DateTimeFormat('en').options, { locale: 'en' });
        assert.true(new intl.DateTimeFormat('en') instanceof intl.DateTimeFormat);
        assert.deepEqual(intl.DateTimeFormat.supportedLocalesOf(), ['th'], 'statics pass through');
        assert.throws(() => new intl.DateTimeFormat('th', { calendar: 'buddhist' }), /buddhist/, 'an explicit calendar is not overridden');
        assert.throws(() => new intl.DateTimeFormat('bad'), /locale/, 'other errors still surface');
        assert.strictEqual(gregorianFallback({}), undefined, 'nothing to wrap without a DateTimeFormat');
    });

    test('after loading, Thai dates format and explicit time zones are honoured', async function (assert) {
        let advanced;
        const didAdvance = new Promise((resolve) => (advanced = resolve));

        initialize({ deferReadiness() {}, advanceReadiness: () => advanced() }, NO_NATIVE_INTL);
        await didAdvance;

        const noon = new Date('2026-11-19T05:00:00Z');
        const bangkok = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(noon);

        assert.strictEqual(bangkok, '12:00', 'Asia/Bangkok is UTC+7, not UTC');
        assert.ok(new Intl.DateTimeFormat('th-th', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(noon), 'a Thai format no longer throws');
    });
});

module('Unit | Initializer | load-intl-polyfills | gregorian calendar', function () {
    test('Thai dates use C.E. years everywhere, an explicit calendar still wins', function (assert) {
        const date = new Date(Date.UTC(2026, 10, 22, 5));
        const fakeIntl = { DateTimeFormat: Intl.DateTimeFormat };
        const proto = { toLocaleString: Date.prototype.toLocaleString, toLocaleDateString: Date.prototype.toLocaleDateString, toLocaleTimeString: Date.prototype.toLocaleTimeString };

        forceGregorianCalendar(fakeIntl, proto);
        forceGregorianCalendar(fakeIntl, proto); // a second call is a no-op

        const year = (format) => format.formatToParts(date).find((part) => part.type === 'year').value;
        assert.strictEqual(year(new fakeIntl.DateTimeFormat('th-th', { year: 'numeric', timeZone: 'UTC' })), '2026', 'new');
        assert.strictEqual(year(fakeIntl.DateTimeFormat('th-th', { year: 'numeric', timeZone: 'UTC' })), '2026', 'called without new');
        // An explicit calendar passes through untouched (checked on a stub: the polyfill, loaded by
        // earlier tests, supports gregory only).
        const seen = [];
        const stub = {
            DateTimeFormat: class {
                constructor(locales, options) {
                    seen.push(options);
                }
            },
        };
        forceGregorianCalendar(stub, {});
        new stub.DateTimeFormat('th-th', { calendar: 'buddhist' });
        new stub.DateTimeFormat('th-th');
        assert.deepEqual(seen, [{ calendar: 'buddhist' }, { calendar: 'gregory' }], 'explicit calendar kept, gregory added otherwise');
        assert.true(proto.toLocaleDateString.call(date, 'th-th', { year: 'numeric', timeZone: 'UTC' }).includes('2026'), 'toLocaleDateString');
        assert.true(proto.toLocaleString.call(date, 'th-th', { timeZone: 'UTC' }).includes('2026'), 'toLocaleString');
        assert.true(proto.toLocaleTimeString.call(date, 'th-th', { timeZone: 'UTC' }).length > 0, 'toLocaleTimeString');
        assert.true(fakeIntl.DateTimeFormat.__forceGregorian);
        assert.strictEqual(forceGregorianCalendar({}), undefined, 'nothing to wrap without a DateTimeFormat');
    });
});
