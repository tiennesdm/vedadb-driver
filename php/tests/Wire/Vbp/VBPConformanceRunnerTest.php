<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPConformanceRunner;

final class VBPConformanceRunnerTest extends TestCase
{
    public function testParseSimpleSuiteYaml(): void
    {
        $yaml = <<<YAML
version: 1
suite: vbp-conformance-v1
tests:
  - id: 1
    name: connect_plain
    category: connect
    operation: { kind: connect, params: { tls: false } }
    expect: { ok: true }
  - id: 2
    name: query_select_one
    category: query
    operation:
      kind: query
      sql: "SELECT 1 AS n;"
    expect:
      ok: true
      columns: ["n"]
      rows: [["1"]]
YAML;
        $tests = VBPConformanceRunner::parseSuiteYaml($yaml);
        $this->assertCount(2, $tests);
        $this->assertSame(1, $tests[0]['id']);
        $this->assertSame('connect', $tests[0]['category']);
        $this->assertSame('connect', $tests[0]['operation']['kind']);
        $this->assertFalse($tests[0]['operation']['params']['tls']);
        $this->assertSame('SELECT 1 AS n;', $tests[1]['operation']['sql']);
    }

    public function testLoadSuiteReadsFromFile(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'vbpsy');
        file_put_contents($path, "version: 1\ntests:\n  - id: 100\n    name: foo\n    category: x\n    operation: { kind: query, sql: 'SELECT 1' }\n    expect: { ok: true }\n");
        $runner = new VBPConformanceRunner();
        $runner->loadSuite($path);
        $summary = $this->invokeRunOnFake($runner, []);
        $this->assertSame(2, $summary['total']); // 1 from yaml + 1 streaming
        @unlink($path);
    }

    public function testEmitJUnitContainsTestsuites(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'vbpsy');
        file_put_contents($path, "version: 1\ntests: []\n");
        $runner = new VBPConformanceRunner();
        $runner->loadSuite($path);
        $summary = $this->invokeRunOnFake($runner, []);
        $outPath = tempnam(sys_get_temp_dir(), 'vbpxml');
        $runner->emitJUnit($outPath);
        $xml = file_get_contents($outPath);
        $this->assertStringContainsString('<testsuites', $xml);
        $this->assertStringContainsString('<testcase', $xml);
        $this->assertStringContainsString('multiplexer_streaming_multichunk', $xml);
        @unlink($path);
        @unlink($outPath);
    }

    public function testParseEmptySuite(): void
    {
        $tests = VBPConformanceRunner::parseSuiteYaml("version: 1\nsuite: empty\n");
        $this->assertSame([], $tests);
    }

    public function testParseSuiteWithComments(): void
    {
        $yaml = <<<YAML
# top comment
version: 1
suite: x
tests:
  # mid comment
  - id: 1
    name: foo
    category: y
    operation: { kind: query, sql: 'SELECT 1' }
    expect: { ok: true }
YAML;
        $tests = VBPConformanceRunner::parseSuiteYaml($yaml);
        $this->assertCount(1, $tests);
        $this->assertSame('foo', $tests[0]['name']);
    }

    /**
     * Invoke the run() method with a "fake" connection that does nothing.
     * The fake just records calls and returns nothing. We don't connect.
     */
    private function invokeRunOnFake(VBPConformanceRunner $runner, array $filter): array
    {
        $fake = new class extends \VedaDB\Wire\Vbp\VBPConnection {
            public function __construct() {}
            public function execute(string $sql, ?array $params = null): \VedaDB\Wire\Vbp\VBPResult {
                return new \VedaDB\Wire\Vbp\VBPResult();
            }
            public function ping(): array { return ['latencyMs' => 0.0, 'nonce' => '']; }
        };
        return $runner->run($fake, $filter);
    }
}
