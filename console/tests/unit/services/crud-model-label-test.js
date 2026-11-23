import { module, test } from 'qunit';
import { setupTest } from '@fleetbase/console/tests/helpers';

module('Unit | Service | crud | modelLabel (ember-core patch)', function (hooks) {
    setupTest(hooks);

    test('uses resource translations and falls back to the humanized name', async function (assert) {
        const intl = this.owner.lookup('service:intl');
        intl.addTranslations('th-th', { resource: { order: 'ออเดอร์', 'service-area': 'พื้นที่ให้บริการ' } });
        intl.setLocale(['th-th']);
        const crud = this.owner.lookup('service:crud');

        assert.strictEqual(crud.modelLabel('order'), 'ออเดอร์');
        assert.strictEqual(crud.modelLabel('Order'), 'ออเดอร์');
        assert.strictEqual(crud.modelLabel('serviceArea'), 'พื้นที่ให้บริการ');
        assert.strictEqual(crud.modelLabel('Service Area'), 'พื้นที่ให้บริการ');
        assert.strictEqual(crud.modelLabel('unknown-thing'), 'Unknown Thing');
    });
});
