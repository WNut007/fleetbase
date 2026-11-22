<?php

namespace App\Providers;

use Fleetbase\Models\Setting;
use Fleetbase\Models\User;
use Fleetbase\Services\UserCacheService;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Database\Events\TransactionCommitting;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Psr\Http\Message\RequestInterface;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Ring buffer of recent statements, kept only while the transaction tripwire is armed.
     *
     * @var array<int, string>
     */
    protected static array $recentStatements = [];

    /**
     * Whether a divergence has already been reported on this worker pass.
     */
    protected static bool $divergenceReported = false;

    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {
        // Cached country lookups (see CachedLookupController).
        $this->app->bind(\Fleetbase\Http\Controllers\Internal\v1\LookupController::class, \App\Http\Controllers\Internal\CachedLookupController::class);
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        $this->configureOutboundHttpLogging();
        $this->configureTransactionTripwire();
        $this->configureLocaleCacheInvalidation();
    }

    /**
     * Clear a user's cached `users/me` payload when they change language.
     *
     * core-api saves the language as the setting `user.<uuid>.locale` but leaves the
     * cached `users/me` response (UserCacheService, 15 minutes) in place. The console
     * reads the language from that response, so after a reload it showed the old
     * language until the cache expired.
     */
    protected function configureLocaleCacheInvalidation(): void
    {
        Setting::saved(function (Setting $setting) {
            $this->invalidateUserCacheForSetting($setting->key);
        });
    }

    /**
     * Invalidate the cached user when the key is a user's locale setting.
     *
     * @return bool whether a user cache was invalidated
     */
    protected function invalidateUserCacheForSetting(?string $key): bool
    {
        if (!is_string($key) || !preg_match('/^user\.([0-9a-f-]{36})\.locale$/i', $key, $matches)) {
            return false;
        }

        $user = $this->findUserByUuid($matches[1]);
        if (!$user) {
            return false;
        }

        $this->forgetUserCache($user);

        return true;
    }

    protected function findUserByUuid(string $uuid): ?User
    {
        return User::where('uuid', $uuid)->first();
    }

    protected function forgetUserCache(User $user): void
    {
        UserCacheService::invalidateUser($user);
    }

    /**
     * Detect the moment Laravel's transaction counter stops agreeing with the MySQL session.
     *
     * Laravel decides whether to issue a COMMIT from its own integer counter
     * (ManagesTransactions::commit(), and the inline twin inside transaction()),
     * while PDO decides whether a COMMIT is legal from the server's
     * SERVER_STATUS_IN_TRANS flag. If anything ends the server-side transaction
     * without going through the Connection - an implicit commit from DDL, or a
     * second PDO handle aliasing the same persistent MySQL session - the counter
     * keeps saying "1". Every statement issued since BEGIN is then already
     * durable, and the eventual commit throws "There is no active transaction",
     * so the caller reports failure for a write that landed.
     *
     * This logs the divergence at the statement that caused it, which is the
     * only place the culprit is still identifiable.
     */
    protected function configureTransactionTripwire(): void
    {
        if (!env('DB_TXN_TRIPWIRE_ENABLED', false)) {
            return;
        }

        // One report per transaction, not one per worker: a worker serves up to
        // --max-requests before it recycles, and a single latched flag would hide
        // every occurrence after the first.
        Event::listen(TransactionBeginning::class, function (TransactionBeginning $event) {
            if ($event->connection->transactionLevel() === 1) {
                static::$divergenceReported = false;
            }
        });

        // Subscribe through the dispatcher rather than DB::listen(): the facade resolves the default
        // connection, and the spatial MysqlConnection opens a PDO handle in its constructor, so
        // DB::listen() would connect to MySQL on every boot - including `artisan package:discover`
        // during `composer install`, where no database is reachable.
        Event::listen(QueryExecuted::class, function (QueryExecuted $query) {
            $this->recordStatement($query->sql);

            if ($query->connection->transactionLevel() < 1) {
                return;
            }

            $pdo = $query->connection->getRawPdo();

            if (!$pdo instanceof \PDO || $pdo->inTransaction()) {
                return;
            }

            $this->reportTransactionDivergence($query->connection, 'after-statement', $query->sql);
        });

        // Backstop: the divergence may be caused by something we never see as a
        // query of ours (another PDO handle on the same session). This catches it
        // immediately before the doomed COMMIT.
        Event::listen(TransactionCommitting::class, function (TransactionCommitting $event) {
            $pdo = $event->connection->getRawPdo();

            if ($pdo instanceof \PDO && !$pdo->inTransaction()) {
                $this->reportTransactionDivergence($event->connection, 'at-commit', null);
            }
        });
    }

    protected function recordStatement(string $sql): void
    {
        static::$recentStatements[] = Str::limit(preg_replace('/\s+/', ' ', $sql), 200);

        if (count(static::$recentStatements) > 25) {
            array_shift(static::$recentStatements);
        }
    }

    protected function reportTransactionDivergence(Connection $connection, string $phase, ?string $sql): void
    {
        // One report per worker pass. Re-entrancy guard as well: the CONNECTION_ID()
        // lookup below is itself a query and would otherwise trip the listener.
        if (static::$divergenceReported) {
            return;
        }

        static::$divergenceReported = true;

        $pdo = $connection->getRawPdo();

        try {
            $mysqlConnectionId = $pdo instanceof \PDO
                ? $pdo->query('SELECT CONNECTION_ID()')->fetchColumn()
                : null;
        } catch (\Throwable $e) {
            $mysqlConnectionId = 'unavailable: ' . $e->getMessage();
        }

        Log::error('[db:txn:divergence] transaction ended outside the Connection', [
            'phase'               => $phase,
            'statement'           => $sql === null ? null : Str::limit(preg_replace('/\s+/', ' ', $sql), 300),
            'connection'          => $connection->getName(),
            'transaction_level'   => $connection->transactionLevel(),
            'pdo_object_id'       => $pdo instanceof \PDO ? spl_object_id($pdo) : null,
            'connection_object_id'=> spl_object_id($connection),
            'mysql_connection_id' => $mysqlConnectionId,
            'recent_statements'   => static::$recentStatements,
            'trace'               => $this->applicationTrace(),
        ]);
    }

    protected function applicationTrace(): array
    {
        return collect(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 60))
            ->map(fn ($frame) => ($frame['file'] ?? '?') . ':' . ($frame['line'] ?? '?'))
            ->values()
            ->all();
    }

    protected function configureOutboundHttpLogging(): void
    {
        if (!env('HTTP_CLIENT_TRACE_ENABLED', false)) {
            return;
        }

        Http::globalMiddleware(function (callable $handler) {
            return function (RequestInterface $request, array $options) use ($handler) {
                $id      = (string) Str::uuid();
                $started = microtime(true);

                Log::info('[http:out:start]', [
                    'id'              => $id,
                    'method'          => $request->getMethod(),
                    'url'             => $this->redactOutboundHttpUrl((string) $request->getUri()),
                    'timeout'         => $options['timeout'] ?? null,
                    'connect_timeout' => $options['connect_timeout'] ?? null,
                    'trace'           => $this->outboundHttpTrace(),
                ]);

                return $handler($request, $options)->then(
                    function ($response) use ($id, $started) {
                        Log::info('[http:out:finish]', [
                            'id'         => $id,
                            'status'     => $response->getStatusCode(),
                            'elapsed_ms' => $this->elapsedMilliseconds($started),
                        ]);

                        return $response;
                    },
                    function ($reason) use ($id, $started) {
                        Log::warning('[http:out:error]', [
                            'id'         => $id,
                            'elapsed_ms' => $this->elapsedMilliseconds($started),
                            'error'      => $reason instanceof \Throwable ? $reason->getMessage() : (string) $reason,
                        ]);

                        if ($reason instanceof \Throwable) {
                            throw $reason;
                        }

                        throw new \RuntimeException((string) $reason);
                    }
                );
            };
        });
    }

    protected function redactOutboundHttpUrl(string $url): string
    {
        return preg_replace('/([?&](?:token|access_token|api_key|apikey|key|secret|signature)=)[^&#]*/i', '$1[redacted]', $url) ?? $url;
    }

    protected function outboundHttpTrace(): array
    {
        return collect(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 20))
            ->filter(function ($frame) {
                $file = $frame['file'] ?? null;

                return $file && !str_contains($file, '/vendor/');
            })
            ->map(fn ($frame) => $frame['file'] . ':' . ($frame['line'] ?? '?'))
            ->values()
            ->take(8)
            ->all();
    }

    protected function elapsedMilliseconds(float $started): int
    {
        return (int) ((microtime(true) - $started) * 1000);
    }
}
