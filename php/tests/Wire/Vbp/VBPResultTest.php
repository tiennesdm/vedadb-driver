<?php
declare(strict_types=1);

namespace VedaDB\Tests\Wire\Vbp;

use PHPUnit\Framework\TestCase;
use VedaDB\Wire\Vbp\VBPResult;
use VedaDB\Wire\Vbp\VBPException;
use VedaDB\Wire\Vbp\VBPError;
use VedaDB\Wire\Vbp\VBPOpcodes as Ops;

final class VBPResultTest extends TestCase
{
    public function testEmptyResult(): void
    {
        $r = new VBPResult();
        $this->assertSame(0, $r->rowCount());
        $this->assertSame([], $r->columns);
        $this->assertSame([], $r->rows);
        $this->assertSame('', $r->commandTag);
        $this->assertSame(0, $r->rowsAffected);
    }

    public function testSingleRow(): void
    {
        $r = new VBPResult(
            ['n'],
            [Ops::T_INT4],
            [[1]],
            'SELECT 1',
            0,
        );
        $this->assertSame(1, $r->rowCount());
        $this->assertSame(1, $r->scalar());
    }

    public function testScalarReturnsDefaultOnEmpty(): void
    {
        $r = new VBPResult();
        $this->assertNull($r->scalar());
        $this->assertSame(42, $r->scalar(0, 42));
    }

    public function testScalarReturnsDefaultOnOutOfRange(): void
    {
        $r = new VBPResult([], [], [[1, 2]]);
        $this->assertSame('fallback', $r->scalar(99, 'fallback'));
    }

    public function testExceptionCarriesSqlstate(): void
    {
        $e = new VBPException('42601', 'syntax error', 'detail', 'hint');
        $this->assertSame('42601', $e->sqlstate);
        $this->assertSame('detail', $e->detail);
        $this->assertSame('hint', $e->hint);
        $this->assertStringContainsString('42601', $e->getMessage());
        $this->assertStringContainsString('syntax error', $e->getMessage());
    }

    public function testVbpErrorExtendsVbpException(): void
    {
        $e = new VBPError('28000', 'auth failed');
        $this->assertInstanceOf(VBPException::class, $e);
        $this->assertSame('28000', $e->sqlstate);
    }
}
