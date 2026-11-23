import { module, test } from 'qunit';
import { setupTest } from '@fleetbase/console/tests/helpers';
import { permissionNames } from '@fleetbase/ember-core/abilities/dynamic';

module('Unit | Ability | dynamic permissions (ember-core patch)', function (hooks) {
    setupTest(hooks);

    test('permission names are built once per permissions array', function (assert) {
        const permissions = [{ name: 'fleet-ops view order' }, { name: 'iam * user' }];
        const names = permissionNames(permissions);

        assert.true(names.has('fleet-ops view order'));
        assert.strictEqual(permissionNames(permissions), names, 'the same set is reused');
        assert.notStrictEqual(permissionNames([...permissions]), names, 'a new permissions array gets a new set');
        assert.strictEqual(permissionNames(null).size, 0);
    });

    test('can checks still follow the user permissions', function (assert) {
        const currentUser = this.owner.lookup('service:current-user');
        currentUser.isAdmin = false;
        currentUser.permissions = [{ name: 'fleet-ops view order' }, { name: 'fleet-ops * driver' }, { name: 'iam *' }];
        const abilities = this.owner.lookup('service:abilities');

        assert.true(abilities.can('fleet-ops view orders'));
        assert.true(abilities.can('fleet-ops delete drivers'), 'resource wildcard');
        assert.true(abilities.can('iam update users'), 'service wildcard');
        assert.false(abilities.can('fleet-ops delete orders'));

        currentUser.permissions = [];
        assert.false(abilities.can('fleet-ops view orders'), 'a new permissions list is picked up');
    });
});
