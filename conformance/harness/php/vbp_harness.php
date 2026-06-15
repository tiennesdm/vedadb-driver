<?php
// vbp_harness.php — VBP v1 conformance skeleton harness (PHP).
//
// Loads conformance/vbp_suite.yaml using only the PHP stdlib
// (a hand-rolled block-style YAML parser — the yaml ext is not
// always available, and we want the harness to be runnable in
// any environment with a bare `php` interpreter). Iterates every
// test, emits a JUnit XML report, and SKIPs all tests. Exit code
// 0 on success, 1 on any FAIL/ERROR.
//
// Usage:
//   php vbp_harness.php --suite=../../vbp_suite.yaml \
//                       --out=./vbp-conformance-php.junit.xml
//
// PHP 8.0+ is recommended (uses named args and match). Tested
// against PHP 8.3 in CI.

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Tiny block-style YAML loader (stdlib-only).
// ---------------------------------------------------------------------------

function parse_scalar(string $v): mixed {
    $v = trim($v);
    if ($v === '') return null;
    $low = strtolower($v);
    if ($low === 'true')  return true;
    if ($low === 'false') return false;
    if ($low === 'null' || $low === '~') return null;
    if ((str_starts_with($v, '"') && str_ends_with($v, '"')) ||
        (str_starts_with($v, "'") && str_ends_with($v, "'"))) {
        return substr($v, 1, -1);
    }
    if (str_starts_with($v, '[') && str_ends_with($v, ']')) {
        $inner = trim(substr($v, 1, -1));
        if ($inner === '') return [];
        $parts = explode(',', $inner);
        return array_map(fn($p) => parse_scalar(trim($p)), $parts);
    }
    if (preg_match('/^-?\d+$/', $v)) return (int)$v;
    if (is_numeric($v)) return (float)$v;
    return $v;
}

function leading_spaces(string $s): int {
    return strlen($s) - strlen(ltrim($s));
}

function load_yaml(string $path): array {
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    $out = [];
    $tests = [];
    $i = 0;
    while ($i < count($lines)) {
        $line = $lines[$i];
        $s = trim($line);
        if ($s === '' || str_starts_with($s, '#')) { $i++; continue; }
        $indent = leading_spaces($line);
        if (str_starts_with($s, '- ') && $indent === 2) {
            $cur = [];
            $first = trim(substr($s, 2));
            $colon = strpos($first, ':');
            if ($colon !== false) {
                $k = trim(substr($first, 0, $colon));
                $v = trim(substr($first, $colon + 1));
                $cur[$k] = parse_scalar($v);
            }
            $i++;
            while ($i < count($lines)) {
                $nx = $lines[$i];
                if (trim($nx) === '') { $i++; continue; }
                $stripped = ltrim($nx);
                $ix = strlen($nx) - strlen($stripped);
                if ($ix === 2 && str_starts_with($stripped, '- ')) break;
                if ($ix === 0 && $stripped !== '') break;
                $c = strpos($stripped, ':');
                if ($c !== false) {
                    $cur[trim(substr($stripped, 0, $c))] = parse_scalar(trim(substr($stripped, $c + 1)));
                }
                $i++;
            }
            $tests[] = $cur;
            continue;
        }
        if ($indent === 0 && str_contains($s, ':')) {
            $c = strpos($s, ':');
            $out[trim(substr($s, 0, $c))] = parse_scalar(trim(substr($s, $c + 1)));
        }
        $i++;
    }
    if (!empty($tests)) $out['tests'] = $tests;
    return $out;
}

// ---------------------------------------------------------------------------
// JUnit emit
// ---------------------------------------------------------------------------

function xml_escape(string $s): string {
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function write_junit(array $outcomes, string $out_path, string $suite_name): void {
    $byCat = [];
    foreach ($outcomes as $o) {
        $byCat[$o['category']][] = $o;
    }
    ksort($byCat);
    $lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<testsuites>'];
    foreach ($byCat as $cat => $oo) {
        $fails = count(array_filter($oo, fn($x) => $x['status'] === 'fail'));
        $skips = count(array_filter($oo, fn($x) => $x['status'] === 'skip'));
        $errs  = count(array_filter($oo, fn($x) => $x['status'] === 'error'));
        $totalDur = array_sum(array_column($oo, 'duration'));
        $lines[] = sprintf(
            '  <testsuite name="%s" tests="%d" failures="%d" skipped="%d" errors="%d" time="%.3f">',
            xml_escape($cat), count($oo), $fails, $skips, $errs, $totalDur
        );
        foreach ($oo as $o) {
            $lines[] = sprintf(
                '    <testcase classname="%s" name="%s" time="%.3f">',
                xml_escape($suite_name),
                xml_escape("{$o['id']} {$o['name']}"),
                $o['duration']
            );
            if ($o['status'] === 'fail')  $lines[] = '      <failure>'  . xml_escape($o['message']) . '</failure>';
            if ($o['status'] === 'skip')  $lines[] = '      <skipped>'  . xml_escape($o['message']) . '</skipped>';
            if ($o['status'] === 'error') $lines[] = '      <error>'    . xml_escape($o['message']) . '</error>';
            $lines[] = '    </testcase>';
        }
        $lines[] = '  </testsuite>';
    }
    $lines[] = '</testsuites>';
    file_put_contents($out_path, implode("\n", $lines) . "\n");
}

// ---------------------------------------------------------------------------
// Test runner (skeleton — all SKIP)
// ---------------------------------------------------------------------------

function run_test(array $t): array {
    return [
        'id'       => (int)($t['id'] ?? 0),
        'name'     => (string)($t['name'] ?? 'unknown'),
        'category' => (string)($t['category'] ?? 'unknown'),
        'status'   => 'skip',
        'message'  => 'PHP harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to php)',
        'duration' => 0.0,
    ];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

$opts = [
    'suite'    => 'conformance/vbp_suite.yaml',
    'addr'     => '127.0.0.1:6380',
    'out'      => 'vbp-conformance-php.junit.xml',
    'user'     => 'admin',
    'pass'     => 'TestPassword123!',
    'category' => '',
];
foreach (array_slice($argv, 1) as $i => $a) {
    if (str_starts_with($a, '--suite='))    $opts['suite']    = substr($a, 8);
    if (str_starts_with($a, '--addr='))     $opts['addr']     = substr($a, 7);
    if (str_starts_with($a, '--out='))      $opts['out']      = substr($a, 6);
    if (str_starts_with($a, '--user='))     $opts['user']     = substr($a, 7);
    if (str_starts_with($a, '--pass='))     $opts['pass']     = substr($a, 7);
    if (str_starts_with($a, '--category=')) $opts['category'] = substr($a, 11);
}
$_ = [$opts['addr'], $opts['user'], $opts['pass']]; // silence unused in skeleton
unset($_);

if (!file_exists($opts['suite'])) {
    fwrite(STDERR, "ERROR: suite file not found: {$opts['suite']}\n");
    exit(2);
}

$data = load_yaml($opts['suite']);
$tests = $data['tests'] ?? [];
if ($opts['category'] !== '') {
    $tests = array_values(array_filter($tests, fn($t) => ($t['category'] ?? '') === $opts['category']));
}
$suite_name = $data['suite'] ?? 'vbp-conformance-v1';

$outcomes = array_map('run_test', $tests);
write_junit($outcomes, $opts['out'], $suite_name);

$passN = count(array_filter($outcomes, fn($o) => $o['status'] === 'pass'));
$failN = count(array_filter($outcomes, fn($o) => $o['status'] === 'fail'));
$skipN = count(array_filter($outcomes, fn($o) => $o['status'] === 'skip'));
$errN  = count(array_filter($outcomes, fn($o) => $o['status'] === 'error'));

echo "VBP v1 conformance (PHP skeleton)\n";
echo "  tests:  " . count($outcomes) . "\n";
echo "  pass:   $passN\n";
echo "  fail:   $failN\n";
echo "  skip:   $skipN\n";
echo "  error:  $errN\n";
echo "  report: {$opts['out']}\n";
exit(($failN + $errN) > 0 ? 1 : 0);
