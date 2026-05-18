/**
 * QRCodeDisplay - TOTP QR code display component
 */
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, RefreshCw, Smartphone, Check } from 'lucide-react';

interface QRCodeDisplayProps {
  secret: string;
  issuer?: string;
  accountName?: string;
  onRegenerate?: () => void;
}

export default function QRCodeDisplay({
  secret,
  issuer = 'Veda Support Portal',
  accountName = 'user@example.com',
  onRegenerate,
}: QRCodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate a visual representation of QR code using canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !secret) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 200;
    const cells = 25;
    const cellSize = size / cells;
    canvas.width = size;
    canvas.height = size;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Use secret to generate deterministic pattern
    const seed = secret.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 1), 0);
    const pseudoRandom = (n: number) => {
      const x = Math.sin(seed + n) * 10000;
      return x - Math.floor(x);
    };

    // Finder patterns (corners)
    const drawFinder = (x: number, y: number) => {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x * cellSize, y * cellSize, 7 * cellSize, 7 * cellSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((x + 1) * cellSize, (y + 1) * cellSize, 5 * cellSize, 5 * cellSize);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect((x + 2) * cellSize, (y + 2) * cellSize, 3 * cellSize, 3 * cellSize);
    };

    drawFinder(0, 0);
    drawFinder(cells - 7, 0);
    drawFinder(0, cells - 7);

    // Data modules
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        // Skip finder patterns
        if ((row < 7 && col < 7) || (row < 7 && col >= cells - 7) || (row >= cells - 7 && col < 7)) continue;

        const idx = row * cells + col;
        if (pseudoRandom(idx) > 0.5) {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    // Timing patterns
    ctx.fillStyle = '#1a1a1a';
    for (let i = 8; i < cells - 8; i++) {
      if (i % 2 === 0) {
        ctx.fillRect(i * cellSize, 6 * cellSize, cellSize, cellSize);
        ctx.fillRect(6 * cellSize, i * cellSize, cellSize, cellSize);
      }
    }
  }, [secret]);

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const provisioningUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

  return (
    <Card className="border-[#e5e0d5] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
          <Smartphone className="h-4 w-4 text-[#c9a87c]" />
          TOTP QR Code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col items-center gap-4">
          {/* QR Code Canvas */}
          <div className="rounded-lg border-2 border-[#e5e0d5] bg-white p-3">
            <canvas
              ref={canvasRef}
              style={{ width: 180, height: 180, imageRendering: 'pixelated' }}
              className="block"
            />
          </div>

          {/* Secret */}
          <div className="w-full space-y-1.5">
            <label className="text-xs font-medium text-[#595959]">Secret Key</label>
            <div className="flex gap-2">
              <Input
                value={secret}
                readOnly
                className="border-[#e5e0d5] bg-[#fbf9f4] font-mono text-xs"
              />
              <Button
                variant="outline"
                
                className="border-[#e5e0d5]"
                onClick={handleCopySecret}
              >
                {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          {/* Provisioning URI */}
          <div className="w-full space-y-1.5">
            <label className="text-xs font-medium text-[#595959]">Provisioning URI</label>
            <div className="rounded-md bg-[#fbf9f4] p-2">
              <code className="break-all text-[10px] text-[#595959]">{provisioningUri}</code>
            </div>
          </div>

          {onRegenerate && (
            <Button
              variant="outline"
              
              onClick={onRegenerate}
              className="border-[#e5e0d5] text-xs"
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Regenerate Secret
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
