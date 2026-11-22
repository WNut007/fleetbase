import { module, test } from 'qunit';
import Inflector from 'ember-inflector';
import { initialize } from '@fleetbase/console/initializers/thai-inflector';

module('Unit | Initializer | thai-inflector', function () {
    test('Thai words are not pluralized, English words still are', function (assert) {
        const inflector = new Inflector(Inflector.defaultRules);
        initialize(null, inflector);

        assert.strictEqual(inflector.pluralize('ออเดอร์'), 'ออเดอร์');
        assert.strictEqual(inflector.pluralize('คนขับ'), 'คนขับ');
        assert.strictEqual(inflector.pluralize('order'), 'orders');
        assert.strictEqual(inflector.pluralize('Vehicle'), 'Vehicles');
    });

    test('it registers on the shared inflector by default', function (assert) {
        initialize(null);

        assert.strictEqual(Inflector.inflector.pluralize('รถ'), 'รถ');
    });
});
