<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Pub/Sub support for VedaDB.
 */
class VedaPubSub
{
    private VedaClient $client;

    /** @var list<string> */
    private array $subscribedChannels = [];

    private bool $listening = false;
    private float $timeoutMs = 30000.0;

    /** @var callable|null */
    private $messageHandler = null;

    public function __construct(VedaClient $client)
    {
        $this->client = $client;
    }

    /**
     * Subscribe to one or more channels.
     *
     * @param string ...$channels
     */
    public function subscribe(string ...$channels): void
    {
        foreach ($channels as $channel) {
            $safeChannel = str_replace("'", "''", $channel);
            $this->client->query("SUBSCRIBE '{$safeChannel}'");
            if (!in_array($channel, $this->subscribedChannels, true)) {
                $this->subscribedChannels[] = $channel;
            }
        }
    }

    /**
     * Unsubscribe from one or more channels.
     *
     * @param string ...$channels  Empty = unsubscribe all.
     */
    public function unsubscribe(string ...$channels): void
    {
        if (empty($channels)) {
            foreach ($this->subscribedChannels as $ch) {
                $safeCh = str_replace("'", "''", $ch);
                $this->client->query("UNSUBSCRIBE '{$safeCh}'");
            }
            $this->subscribedChannels = [];
            return;
        }

        foreach ($channels as $channel) {
            $safeChannel = str_replace("'", "''", $channel);
            $this->client->query("UNSUBSCRIBE '{$safeChannel}'");
            $idx = array_search($channel, $this->subscribedChannels, true);
            if ($idx !== false) {
                array_splice($this->subscribedChannels, $idx, 1);
            }
        }
    }

    /**
     * Publish a message to a channel.
     */
    public function publish(string $channel, string $message): ?int
    {
        $safeChannel = str_replace("'", "''", $channel);
        $safeMessage = str_replace("'", "''", $message);
        $result = $this->client->query("PUBLISH '{$safeChannel}' '{$safeMessage}'");
        return $result->scalar() !== null ? (int) $result->scalar() : null;
    }

    /**
     * Listen for messages on subscribed channels.
     *
     * @param callable(string $channel, string $message): void $handler
     */
    public function listen(callable $handler, ?float $timeoutMs = null): void
    {
        $this->messageHandler = $handler;
        $this->listening      = true;
        $timeout              = $timeoutMs ?? $this->timeoutMs;
        $endTime              = microtime(true) + ($timeout / 1000);

        while ($this->listening && microtime(true) < $endTime) {
            try {
                $result = $this->client->query('LISTEN');
                $dict   = $result->first();

                if ($dict !== null) {
                    $channel = (string) ($dict['channel'] ?? '');
                    $message = (string) ($dict['message'] ?? '');

                    if ($channel !== '' && $this->messageHandler !== null) {
                        ($this->messageHandler)($channel, $message);
                    }
                }
            } catch (TimeoutException $e) {
                // Timeout is expected, continue listening
                continue;
            } catch (\Throwable $e) {
                $this->listening = false;
                throw $e;
            }
        }
    }

    /**
     * Listen for a single message.
     *
     * @return array{channel: string, message: string}|null
     */
    public function receive(?float $timeoutMs = null): ?array
    {
        $timeout = $timeoutMs ?? $this->timeoutMs;
        $endTime = microtime(true) + ($timeout / 1000);

        while (microtime(true) < $endTime) {
            try {
                $result = $this->client->query('LISTEN');
                $dict   = $result->first();

                if ($dict !== null && isset($dict['channel'])) {
                    return [
                        'channel' => (string) $dict['channel'],
                        'message' => (string) ($dict['message'] ?? ''),
                    ];
                }
            } catch (TimeoutException $e) {
                return null;
            }
        }

        return null;
    }

    /**
     * Stop listening.
     */
    public function stop(): void
    {
        $this->listening = false;
    }

    /**
     * Get subscribed channels.
     *
     * @return list<string>
     */
    public function getChannels(): array
    {
        return $this->subscribedChannels;
    }

    /**
     * Check if currently listening.
     */
    public function isListening(): bool
    {
        return $this->listening;
    }

    /**
     * Set the listen timeout.
     */
    public function setTimeout(float $timeoutMs): void
    {
        $this->timeoutMs = $timeoutMs;
    }
}
