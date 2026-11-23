<?php

namespace Tests\Unit;

use App\Http\Controllers\Internal\CachedLookupController;
use Fleetbase\Http\Controllers\Internal\v1\LookupController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CachedLookupControllerTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['cache.default' => 'array']);
        Cache::flush();
    }

    public function test_the_core_lookup_controller_resolves_to_the_cached_one(): void
    {
        $this->assertInstanceOf(CachedLookupController::class, $this->app->make(LookupController::class));
    }

    public function test_a_country_lookup_is_cached_by_code_and_shape(): void
    {
        $controller = new CachedLookupController();

        $simple = $controller->country('th', new Request())->getData(true);
        $this->assertSame('Thailand', $simple['name']);
        $this->assertSame($simple, Cache::get('lookup:country:simple:TH'));

        $full = $controller->country('TH', new Request(['simple' => false]))->getData(true);
        $this->assertSame('Thailand', $full['name']);
        $this->assertTrue(Cache::has('lookup:country:full:TH'));
        $this->assertGreaterThanOrEqual(count($simple), count($full));

        // Served from the cache on the next call.
        Cache::put('lookup:country:simple:TH', ['name' => 'from cache']);
        $this->assertSame(['name' => 'from cache'], $controller->country('TH', new Request())->getData(true));
    }

    public function test_an_unknown_country_is_null(): void
    {
        // Same as core-api: a null country is an empty JSON object.
        $this->assertSame([], (new CachedLookupController())->country('zz', new Request())->getData(true));
    }

    public function test_the_country_list_drops_flag_svg_markup_and_is_cached(): void
    {
        $controller = new CachedLookupController();
        $request    = new Request(['columns' => ['name', 'cca2', 'flag', 'emoji']]);

        $countries = $controller->countries($request)->getData(true);
        $thailand  = collect($countries)->firstWhere('cca2', 'TH');

        $this->assertNotNull($thailand);
        $this->assertSame(['emoji', 'flag-icon', 'flag-icon-squared'], array_keys($thailand['flag']));
        $this->assertLessThan(500 * 1024, strlen(json_encode($countries)), 'the list stays small without SVG markup');

        // The same query is answered from the cache.
        $key = CachedLookupController::countriesCacheKey($request);
        $this->assertTrue(Cache::has($key));
        Cache::put($key, [['name' => 'from cache']]);
        $this->assertSame([['name' => 'from cache']], $controller->countries($request)->getData(true));
        $this->assertNotSame($key, CachedLookupController::countriesCacheKey(new Request(['columns' => ['name']])));
    }

    public function test_countries_without_a_flag_array_are_left_alone(): void
    {
        $this->assertSame(['name' => 'X', 'flag' => 'x.svg'], CachedLookupController::withoutFlagMarkup(['name' => 'X', 'flag' => 'x.svg']));
        $this->assertSame('plain', CachedLookupController::withoutFlagMarkup('plain'));
    }
}
