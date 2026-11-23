import { module, test } from 'qunit';
import { setupRenderingTest } from '@fleetbase/console/tests/helpers';
import { render, settled } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import { tracked } from '@glimmer/tracking';

class State {
    @tracked icon = 'truck';
}

module('Integration | Component | fa-icon (cached patch)', function (hooks) {
    setupRenderingTest(hooks);

    test('it renders the icon and follows a changed @icon', async function (assert) {
        this.state = new State();
        await render(hbs`<FaIcon @icon={{this.state.icon}} />`);

        assert.dom('svg').hasAttribute('data-icon', 'truck');
        assert.dom('svg path').exists();

        this.state.icon = 'user';
        await settled();
        assert.dom('svg').hasAttribute('data-icon', 'user', 'the cached icon is recomputed when @icon changes');
    });
});
