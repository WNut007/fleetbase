<?php

namespace Tests\Unit;

use App\Providers\AppServiceProvider;
use Fleetbase\Models\Setting;
use Fleetbase\Models\User;
use Mockery;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Changing language must clear the cached users/me payload, otherwise a reload
 * shows the previous language until the user cache expires.
 */
class AppServiceProviderLocaleCacheTest extends TestCase
{
    private const UUID = '0b6f1c7e-5d2a-4c3b-9e8f-1a2b3c4d5e6f';

    private function invoke(AppServiceProvider $provider, string $method, array $args = [])
    {
        $ref = new ReflectionMethod($provider, $method);
        $ref->setAccessible(true);

        return $ref->invokeArgs($provider, $args);
    }

    private function partialProvider()
    {
        return Mockery::mock(AppServiceProvider::class, [$this->app])
            ->makePartial()
            ->shouldAllowMockingProtectedMethods();
    }

    public function test_a_user_locale_setting_invalidates_that_users_cache(): void
    {
        $user     = new User();
        $provider = $this->partialProvider();
        $provider->shouldReceive('findUserByUuid')->once()->with(self::UUID)->andReturn($user);
        $provider->shouldReceive('forgetUserCache')->once()->with($user);

        $this->assertTrue($this->invoke($provider, 'invalidateUserCacheForSetting', ['user.' . self::UUID . '.locale']));
    }

    public function test_other_settings_leave_the_cache_alone(): void
    {
        $provider = $this->partialProvider();
        $provider->shouldNotReceive('findUserByUuid');
        $provider->shouldNotReceive('forgetUserCache');

        $this->assertFalse($this->invoke($provider, 'invalidateUserCacheForSetting', ['system.branding.logo_uuid']));
        $this->assertFalse($this->invoke($provider, 'invalidateUserCacheForSetting', ['user.' . self::UUID . '.dashboard']));
        $this->assertFalse($this->invoke($provider, 'invalidateUserCacheForSetting', [null]));
    }

    public function test_an_unknown_user_is_ignored(): void
    {
        $provider = $this->partialProvider();
        $provider->shouldReceive('findUserByUuid')->once()->andReturn(null);
        $provider->shouldNotReceive('forgetUserCache');

        $this->assertFalse($this->invoke($provider, 'invalidateUserCacheForSetting', ['user.' . self::UUID . '.locale']));
    }

    public function test_saving_a_setting_runs_the_invalidation(): void
    {
        $provider = $this->partialProvider();
        $provider->shouldReceive('invalidateUserCacheForSetting')->once()->with('user.' . self::UUID . '.locale')->andReturn(true);
        $this->invoke($provider, 'configureLocaleCacheInvalidation');

        // Call the listener just registered, not every saved listener: core-api's own ones touch the cache store.
        $listeners = Setting::getEventDispatcher()->getListeners('eloquent.saved: ' . Setting::class);
        $setting   = new Setting(['key' => 'user.' . self::UUID . '.locale', 'value' => 'th-th']);
        end($listeners)('eloquent.saved: ' . Setting::class, [$setting]);
    }

    public function test_forget_user_cache_tolerates_a_user_without_companies(): void
    {
        // UserCacheService::invalidateUser logs and swallows lookup failures, so an unsaved user is safe.
        $this->invoke(new AppServiceProvider($this->app), 'forgetUserCache', [new User()]);
        $this->addToAssertionCount(1);
    }

    public function test_find_user_by_uuid_returns_null_for_an_unknown_uuid(): void
    {
        $host = config('database.connections.' . config('database.default') . '.host');
        $port = (int) config('database.connections.' . config('database.default') . '.port', 3306);
        if (!$host || !@fsockopen($host, $port, $errno, $errstr, 1)) {
            $this->markTestSkipped('Needs the database.');
        }

        try {
            $user = $this->invoke(new AppServiceProvider($this->app), 'findUserByUuid', [self::UUID]);
        } catch (\Illuminate\Database\QueryException $e) {
            $this->markTestSkipped('Needs the database: ' . $e->getMessage());
        }

        $this->assertNull($user);
    }
}
