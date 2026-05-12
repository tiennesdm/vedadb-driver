<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * URI parser for VedaDB connection strings.
 *
 * Format: vedadb://[user:pass@]host[:port][/database][?option1=value1&...]
 *
 * Examples:
 *   vedadb://localhost:6380
 *   vedadb://admin:secret@db.example.com:6380
 *   vedadb://replica1:6380,replica2:6380?pool_size=10
 *   vedadbs://user:pass@host:6380/?tls_verify=1
 */
class VedaURIParser
{
    private string $originalUri;

    /** @var list<array{host: string, port: int}> */
    private array $hosts = [];

    private ?string $username;
    private ?string $password;
    private ?string $database;
    private bool $tls = false;

    /** @var array<string, mixed> */
    private array $options = [];

    public function __construct(string $uri)
    {
        $this->originalUri = $uri;
        $this->parse($uri);
    }

    private function parse(string $uri): void
    {
        // Handle multi-node URIs
        if (str_contains($uri, ',')) {
            $this->parseMultiNode($uri);
            return;
        }

        $parsed = parse_url($uri);
        if ($parsed === false) {
            throw new ValidationException("Invalid URI: {$uri}");
        }

        $scheme = $parsed['scheme'] ?? '';
        if (!in_array($scheme, ['vedadb', 'vedadbs', 'tcp', 'tcps'], true)) {
            throw new ValidationException("Unsupported scheme: {$scheme}");
        }

        $this->tls = $scheme === 'vedadbs' || $scheme === 'tcps';

        $host = $parsed['host'] ?? 'localhost';
        $port = isset($parsed['port']) ? (int) $parsed['port'] : 6380;

        $this->hosts[] = ['host' => $host, 'port' => $port];
        $this->username = isset($parsed['user']) && $parsed['user'] !== '' ? $parsed['user'] : null;
        $this->password = $parsed['pass'] ?? null;
        $this->database = isset($parsed['path']) && $parsed['path'] !== '/' && $parsed['path'] !== ''
            ? ltrim($parsed['path'], '/')
            : null;

        if (isset($parsed['query'])) {
            parse_str($parsed['query'], $this->options);
        }
    }

    /**
     * Parse a multi-node URI with comma-separated hosts.
     */
    private function parseMultiNode(string $uri): void
    {
        // Extract scheme and credentials from first part
        $firstComma = strpos($uri, ',');
        if ($firstComma === false) {
            $this->parseSingle($uri);
            return;
        }

        $prefix = substr($uri, 0, $firstComma);
        $parsed = parse_url($prefix);
        if ($parsed === false) {
            throw new ValidationException("Invalid multi-node URI prefix");
        }

        $scheme = $parsed['scheme'] ?? 'vedadb';
        $this->tls = in_array($scheme, ['vedadbs', 'tcps'], true);
        $this->username = $parsed['user'] ?? null;
        $this->password = $parsed['pass'] ?? null;

        // Parse query from end of URI
        if (str_contains($uri, '?')) {
            $queryPos = strpos($uri, '?');
            $queryStr = substr($uri, $queryPos + 1);
            parse_str($queryStr, $this->options);
            $uri = substr($uri, 0, $queryPos);
        }

        // Split hosts
        $hostStr = substr($uri, strlen($scheme) + 3); // after scheme://
        // Remove credentials if present
        if (str_contains($hostStr, '@')) {
            $atPos = strpos($hostStr, '@');
            $hostStr = substr($hostStr, $atPos + 1);
        }

        $parts = explode(',', $hostStr);
        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '') continue;

            if (str_contains($part, '/')) {
                $slashPos = strpos($part, '/');
                $db = ltrim(substr($part, $slashPos), '/');
                if ($db !== '') {
                    $this->database = $db;
                }
                $part = substr($part, 0, $slashPos);
            }

            if (str_contains($part, ':')) {
                [$host, $portStr] = explode(':', $part, 2);
                $this->hosts[] = [
                    'host' => $host,
                    'port' => (int) $portStr,
                ];
            } else {
                $this->hosts[] = ['host' => $part, 'port' => 6380];
            }
        }
    }

    private function parseSingle(string $uri): void
    {
        $parsed = parse_url($uri);
        if ($parsed === false) {
            throw new ValidationException("Invalid URI: {$uri}");
        }

        $this->tls = ($parsed['scheme'] ?? '') === 'vedadbs';
        $this->hosts[] = [
            'host' => $parsed['host'] ?? 'localhost',
            'port' => (int) ($parsed['port'] ?? 6380),
        ];
        $this->username = $parsed['user'] ?? null;
        $this->password = $parsed['pass'] ?? null;
        $this->database = isset($parsed['path']) ? ltrim($parsed['path'], '/') : null;
        if (isset($parsed['query'])) {
            parse_str($parsed['query'], $this->options);
        }
    }

    /**
     * Get parsed configuration as array.
     *
     * @return array<string, mixed>
     */
    public function toConfig(): array
    {
        $config = [
            'hosts'    => $this->hosts,
            'tls'      => $this->tls,
            'username' => $this->username,
            'password' => $this->password,
        ];

        if ($this->database !== null) {
            $config['database'] = $this->database;
        }

        // Use first host as primary
        if (!empty($this->hosts)) {
            $config['host'] = $this->hosts[0]['host'];
            $config['port'] = $this->hosts[0]['port'];
        }

        // Merge query options
        foreach ($this->options as $key => $value) {
            $config[$key] = $this->coerceValue($value);
        }

        return $config;
    }

    /**
     * Coerce string values to appropriate types.
     */
    private function coerceValue(mixed $value): mixed
    {
        if (!is_string($value)) {
            return $value;
        }

        if (strtolower($value) === 'true')  return true;
        if (strtolower($value) === 'false') return false;
        if (strtolower($value) === 'null')  return null;
        if (is_numeric($value)) {
            return str_contains($value, '.') ? (float) $value : (int) $value;
        }
        return $value;
    }

    /**
     * Get the list of hosts.
     *
     * @return list<array{host: string, port: int}>
     */
    public function getHosts(): array
    {
        return $this->hosts;
    }

    public function getPrimaryHost(): string
    {
        return $this->hosts[0]['host'] ?? 'localhost';
    }

    public function getPrimaryPort(): int
    {
        return $this->hosts[0]['port'] ?? 6380;
    }

    public function getUsername(): ?string
    {
        return $this->username;
    }

    public function getPassword(): ?string
    {
        return $this->password;
    }

    public function getDatabase(): ?string
    {
        return $this->database;
    }

    public function isTLS(): bool
    {
        return $this->tls;
    }

    /**
     * @return array<string, mixed>
     */
    public function getOptions(): array
    {
        return $this->options;
    }

    public function getOriginalUri(): string
    {
        return $this->originalUri;
    }

    /**
     * Parse a URI string and return configuration.
     *
     * @return array<string, mixed>
     */
    public static function parse(string $uri): array
    {
        $parser = new self($uri);
        return $parser->toConfig();
    }
}
