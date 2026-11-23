<?php

namespace App\Http\Controllers\Internal;

use Fleetbase\Http\Controllers\Internal\v1\LookupController;
use Fleetbase\Types\Country;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * core-api's lookup controller with cached country lookups.
 *
 * GET int/v1/lookup/country/{code} loads the whole country dataset on every request
 * (~0.75 s, several seconds under Docker on Windows). Tables show a country cell per row and
 * each cell asks for its country, so a page of 30 drivers queued 30 of these requests and
 * one took 24 s, holding up every other API call behind it. Country data does not change at
 * runtime, so keep each answer for a day.
 */
class CachedLookupController extends LookupController
{
    public const COUNTRY_CACHE_TTL = 86400;

    /**
     * Flag fields kept in country lists. The others are raw SVG markup (up to 350 KB for one
     * country) that no screen uses.
     */
    public const LIST_FLAG_FIELDS = ['emoji', 'flag-icon', 'flag-icon-squared'];

    /**
     * GET int/v1/lookup/countries, cached and without the flag SVG markup.
     *
     * With the SVGs the list was ~5 MB. The console keeps it in localStorage, and every write
     * to that cache re-serialised all 5 MB: a page load stalled the browser for seconds and
     * filled the browser's 5 MB storage quota.
     */
    public function countries(Request $request)
    {
        $countries = Cache::remember(static::countriesCacheKey($request), static::COUNTRY_CACHE_TTL, function () use ($request) {
            return array_map([static::class, 'withoutFlagMarkup'], parent::countries($request)->getData(true));
        });

        return response()->json($countries);
    }

    /**
     * One cache entry per distinct list query.
     */
    public static function countriesCacheKey(Request $request): string
    {
        return 'lookup:countries:' . md5(json_encode([
            $request->input('query'),
            $request->boolean('simple'),
            $request->inputArray('columns'),
            $request->inputArray('only'),
            $request->inputArray('except'),
        ]));
    }

    /**
     * A country with only the light flag fields (emoji and CSS class names).
     */
    public static function withoutFlagMarkup($country)
    {
        if (is_array($country) && is_array($country['flag'] ?? null)) {
            $country['flag'] = array_intersect_key($country['flag'], array_flip(static::LIST_FLAG_FIELDS));
        }

        return $country;
    }

    public function country($code, Request $request)
    {
        $simple = $request->boolean('simple', true);
        $key    = sprintf('lookup:country:%s:%s', $simple ? 'simple' : 'full', strtoupper((string) $code));

        $country = Cache::remember($key, static::COUNTRY_CACHE_TTL, function () use ($code, $simple) {
            $country = Country::getByIso2((string) $code);

            if (!$country) {
                return null;
            }

            return $simple ? $country->simple() : $country->toArray();
        });

        return response()->json($country);
    }
}
