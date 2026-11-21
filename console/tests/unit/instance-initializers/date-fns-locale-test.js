import { module, test } from 'qunit';
import { format, formatDistance, getDefaultOptions, setDefaultOptions } from 'date-fns';
import th from 'date-fns/locale/th';
import { applyDateFnsLocale, dateFnsLocaleFor, initialize } from '@fleetbase/console/instance-initializers/date-fns-locale';

module('Unit | Instance Initializer | date-fns-locale', function (hooks) {
    hooks.afterEach(function () {
        setDefaultOptions({ locale: undefined });
    });

    test('maps locale codes to date-fns locales', function (assert) {
        assert.strictEqual(dateFnsLocaleFor('th-th'), th);
        assert.strictEqual(dateFnsLocaleFor('TH_TH'), th);
        assert.strictEqual(dateFnsLocaleFor('en-us'), undefined);
        assert.strictEqual(dateFnsLocaleFor(undefined), undefined);
    });

    test('Thai formats dates and relative times in Thai, English restores the default', function (assert) {
        const date = new Date(2026, 10, 22, 9, 0);
        applyDateFnsLocale({ primaryLocale: 'th-th' });
        assert.strictEqual(getDefaultOptions().locale, th);
        assert.true(format(date, 'MMM').includes('พ.ย.'), format(date, 'MMM'));
        assert.true(/ชั่วโมง/.test(formatDistance(date, new Date(2026, 10, 22, 15, 0))));

        applyDateFnsLocale({ primaryLocale: 'en-us' });
        assert.strictEqual(getDefaultOptions().locale, undefined);
        assert.strictEqual(format(date, 'MMM d, yyyy'), 'Nov 22, 2026');
    });

    test('initialize applies the current locale and follows locale changes', function (assert) {
        let listener;
        const intl = {
            primaryLocale: 'th-th',
            onLocaleChanged(fn) {
                listener = fn;
            },
        };
        initialize({ lookup: () => intl });
        assert.strictEqual(getDefaultOptions().locale, th);

        intl.primaryLocale = 'en-us';
        listener();
        assert.strictEqual(getDefaultOptions().locale, undefined);
    });

    test('initialize does nothing without an intl service', function (assert) {
        initialize({ lookup: () => undefined });
        assert.strictEqual(getDefaultOptions().locale, undefined);
    });
});
