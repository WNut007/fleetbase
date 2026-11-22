import Inflector from 'ember-inflector';

/**
 * Thai has no plural form, but ember-inflector pluralizes every word with English rules:
 * {{pluralize 38 "ออเดอร์"}} rendered "38 ออเดอร์S". Words ending in a Thai character stay
 * as they are; English words keep their English plurals.
 */
export const THAI_WORD_END = /([฀-๿])$/;

export function initialize(application, inflector = Inflector.inflector) {
    inflector.plural(THAI_WORD_END, '$1');
}

export default {
    name: 'thai-inflector',
    initialize,
};
