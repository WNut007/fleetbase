import Route from '@ember/routing/route';
import { inject as service } from '@ember/service';

export default class ConsoleSettingsVirtualRoute extends Route {
    @service('universe/menu-service') menuService;
    @service universe;
    @service router;

    queryParams = {
        view: {
            refreshModel: true,
        },
    };

    model({ slug }, transition) {
        const view = this.universe.getViewFromTransition(transition);
        return this.menuService.lookupMenuItem('console:settings', slug, view);
    }

    /**
     * A settings slug no extension registered (e.g. /settings/organization, the organization page
     * lives at /settings) rendered an empty page: send it to the settings index instead.
     */
    afterModel(model) {
        if (!model) {
            this.router.replaceWith('console.settings.index');
        }
    }
}
