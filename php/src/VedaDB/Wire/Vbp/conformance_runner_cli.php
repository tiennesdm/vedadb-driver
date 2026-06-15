<?php
declare(strict_types=1);

/**
 * VBPConformanceRunner CLI entrypoint.
 *
 * Usage:
 *   php VBPConformanceRunner.php \
 *     --yaml /path/to/vbp_suite.yaml \
 *     --host 127.0.0.1 --port 6380 \
 *     --user admin --pass 'TestPassword123!' \
 *     --filter connect,hello,auth,query \
 *     --out /tmp/conformance.xml
 */

require __DIR__ . '/VBPConformanceRunner.php';
require __DIR__ . '/VBPConnection.php';
require __DIR__ . '/VBPException.php';
require __DIR__ . '/VBPError.php';
require __DIR__ . '/VBPAuth.php';
require __DIR__ . '/VBPScramState.php';
require __DIR__ . '/VBPMultiplexer.php';
require __DIR__ . '/VBPFrame.php';
require __DIR__ . '/VBPTypeCodec.php';
require __DIR__ . '/VBPOpcodes.php';
require __DIR__ . '/VBPProtocolError.php';
require __DIR__ . '/VBPProtocolException.php';
require __DIR__ . '/VBPResult.php';
require __DIR__ . '/VBPHandlers.php';

use VedaDB\Wire\Vbp\VBPConformanceRunner;
use VedaDB\Wire\Vbp\VBPConnection;

// Minimal argv parser.
$opts = [
    'yaml' => null, 'host' => '127.0.0.1', 'port' => 6380,
    'user' => 'admin', 'pass' => '', 'filter' => '', 'out' => '-',
    'db' => '', 'timeout' => 30,
];
for ($i = 1; $i < count($argv); $i++) {
    $a = $argv[$i];
    if (!str_starts_with($a, '--')) {
        fwrite(STDERR, "skipping non-flag arg: $a\n");
        continue;
    }
    $key = substr($a, 2);
    $val = $argv[$i + 1] ?? null;
    if ($val === null || str_starts_with($val, '--')) {
        $opts[$key] = true;
        continue;
    }
    $opts[$key] = $val;
    $i++;
}

$yamlPath = $opts['yaml'];
if (!$yamlPath) {
    fwrite(STDERR, "ERROR: --yaml <path> is required\n");
    exit(1);
}
$filter = $opts['filter'] ? array_filter(array_map('trim', explode(',', $opts['filter']))) : [];

$runner = new VBPConformanceRunner();
$runner->loadSuite((string) $yamlPath);

$conn = new VBPConnection(
    (string) $opts['host'],
    (int) $opts['port'],
    (string) $opts['user'],
    (string) $opts['pass'],
    (string) $opts['db'],
    (int) $opts['timeout'],
);
try {
    $conn->connect();
} catch (\Throwable $e) {
    fwrite(STDERR, "WARN: connect failed, will run against disconnected connection: " . $e->getMessage() . "\n");
}


$summary = $runner->run($conn, $filter);
$conn->close();

$runner->emitJUnit((string) $opts['out']);

fwrite(STDERR, sprintf(
    "conformance: total=%d passed=%d failed=%d skipped=%d\n",
    $summary['total'], $summary['passed'], $summary['failed'], $summary['skipped'],
));
foreach ($summary['byCategory'] as $cat => $n) {
    fwrite(STDERR, "  $cat: $n\n");
}

exit($summary['failed'] > 0 ? 1 : 0);
