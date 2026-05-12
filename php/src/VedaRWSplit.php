<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Read/Write splitting: sends writes to the master and reads to replicas.
 */
class VedaRWSplit
{
    private VedaClient $writer;

    /** @var list<VedaClient> */
    private array $readers = [];

    private int $readIndex = 0;
    private string $strategy; // 'round_robin', 'random', 'least_loaded'

    /** @var array<string, int> */
    private array $readerLoad = [];

    public function __construct(
        VedaClient $writer,
        array $readers = [],
        string $strategy = 'round_robin',
    ) {
        $this->writer   = $writer;
        $this->readers  = $readers;
        $this->strategy = $strategy;

        foreach ($readers as $i => $reader) {
            $this->readerLoad[spl_object_id($reader)] = 0;
        }
    }

    /**
     * Get the writer (master) client.
     */
    public function getWriter(): VedaClient
    {
        return $this->writer;
    }

    /**
     * Get a reader (replica) client based on strategy.
     */
    public function getReader(): VedaClient
    {
        if (empty($this->readers)) {
            return $this->writer;
        }

        return match ($this->strategy) {
            'round_robin'  => $this->nextRoundRobin(),
            'random'       => $this->nextRandom(),
            'least_loaded' => $this->nextLeastLoaded(),
            default        => $this->nextRoundRobin(),
        };
    }

    private function nextRoundRobin(): VedaClient
    {
        $client = $this->readers[$this->readIndex];
        $this->readIndex = ($this->readIndex + 1) % count($this->readers);
        return $client;
    }

    private function nextRandom(): VedaClient
    {
        return $this->readers[array_rand($this->readers)];
    }

    private function nextLeastLoaded(): VedaClient
    {
        $minLoad = PHP_INT_MAX;
        $selected = $this->readers[0];

        foreach ($this->readers as $reader) {
            $oid = spl_object_id($reader);
            $load = $this->readerLoad[$oid] ?? 0;
            if ($load < $minLoad) {
                $minLoad = $load;
                $selected = $reader;
            }
        }

        $this->readerLoad[spl_object_id($selected)]++;
        return $selected;
    }

    /**
     * Execute a write query on the master.
     */
    public function write(string $sql): VedaResult
    {
        return $this->writer->query($sql);
    }

    /**
     * Execute a read query on a replica.
     */
    public function read(string $sql): VedaResult
    {
        return $this->getReader()->query($sql);
    }

    /**
     * Execute a callback on the writer.
     *
     * @template T
     * @param callable(VedaClient): T $fn
     * @return T
     */
    public function onWrite(callable $fn): mixed
    {
        return $fn($this->writer);
    }

    /**
     * Execute a callback on a reader.
     *
     * @template T
     * @param callable(VedaClient): T $fn
     * @return T
     */
    public function onRead(callable $fn): mixed
    {
        return $fn($this->getReader());
    }

    /**
     * Add a reader.
     */
    public function addReader(VedaClient $reader): void
    {
        $this->readers[] = $reader;
        $this->readerLoad[spl_object_id($reader)] = 0;
    }

    /**
     * Remove a reader.
     */
    public function removeReader(VedaClient $reader): void
    {
        $oid = spl_object_id($reader);
        $idx = null;
        foreach ($this->readers as $i => $r) {
            if (spl_object_id($r) === $oid) {
                $idx = $i;
                break;
            }
        }
        if ($idx !== null) {
            array_splice($this->readers, $idx, 1);
            unset($this->readerLoad[$oid]);
        }
    }

    /**
     * Get the number of readers.
     */
    public function getReaderCount(): int
    {
        return count($this->readers);
    }

    /**
     * Check all reader health.
     *
     * @return list<array{client: VedaClient, healthy: bool}>
     */
    public function healthCheck(): array
    {
        $results = [];
        foreach ($this->readers as $reader) {
            $results[] = [
                'client'  => $reader,
                'healthy' => $reader->ping(),
            ];
        }
        return $results;
    }

    /**
     * Get configuration info.
     */
    public function getInfo(): array
    {
        return [
            'strategy'      => $this->strategy,
            'reader_count'  => count($this->readers),
            'reader_load'   => $this->readerLoad,
        ];
    }
}
