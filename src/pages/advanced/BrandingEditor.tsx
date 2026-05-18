/**
 * BrandingEditor - Route: /branding
 * Upload logo, color theme editor, custom CSS, portal name, login background.
 */
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { cn } from '@/lib/utils';
import {
  Palette, Image, Type, Code, RotateCcw, Eye, Upload, Monitor,
} from 'lucide-react';
import ThemeColorPicker from '@/components/advanced/ThemeColorPicker';

interface BrandingConfig {
  portalName: string;
  primaryColor: string;
  secondaryColor: string;
  successColor: string;
  warningColor: string;
  dangerColor: string;
  infoColor: string;
  customCSS: string;
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
  loginBgDataUrl: string | null;
}

const DEFAULT_BRANDING: BrandingConfig = {
  portalName: 'Veda Support Portal',
  primaryColor: '#c9a87c',
  secondaryColor: '#1a1a1a',
  successColor: '#52c41a',
  warningColor: '#faad14',
  dangerColor: '#f5222d',
  infoColor: '#1890ff',
  customCSS: '',
  logoDataUrl: null,
  faviconDataUrl: null,
  loginBgDataUrl: null,
};

const STORAGE_KEY = 'veda_branding';

function loadBranding(): BrandingConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) };
  } catch { /* */ }
  return DEFAULT_BRANDING;
}

function saveBranding(cfg: BrandingConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* */ }
}

export default function BrandingEditor() {
  const [config, setConfig] = useState<BrandingConfig>(loadBranding);
  const [previewMode, setPreviewMode] = useState<'header' | 'login'>('header');

  const update = useCallback((partial: Partial<BrandingConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      saveBranding(next);
      return next;
    });
  }, []);

  const handleImageUpload = (field: 'logoDataUrl' | 'faviconDataUrl' | 'loginBgDataUrl', file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      update({ [field]: e.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleReset = () => {
    setConfig(DEFAULT_BRANDING);
    saveBranding(DEFAULT_BRANDING);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Palette className="h-5 w-5 text-[#c9a87c]" />
            Branding Editor
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">Customize the look and feel of your portal</p>
        </div>
        <Button variant="outline"  className="border-[#e5e0d5] text-xs" onClick={handleReset}>
          <RotateCcw className="mr-1 h-3 w-3" />
          Reset to Defaults
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Editor */}
        <div className="lg:col-span-3 space-y-4">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
              <TabsTrigger value="general" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
                <Type className="mr-1 h-3 w-3" />
                General
              </TabsTrigger>
              <TabsTrigger value="colors" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
                <Palette className="mr-1 h-3 w-3" />
                Colors
              </TabsTrigger>
              <TabsTrigger value="images" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
                <Image className="mr-1 h-3 w-3" />
                Images
              </TabsTrigger>
              <TabsTrigger value="css" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
                <Code className="mr-1 h-3 w-3" />
                Custom CSS
              </TabsTrigger>
            </TabsList>

            {/* General */}
            <TabsContent value="general" className="mt-4">
              <Card className="border-[#e5e0d5] bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-[#1a1a1a]">Portal Identity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-[#595959]">Portal Name</Label>
                    <Input
                      value={config.portalName}
                      onChange={(e) => update({ portalName: e.target.value })}
                      placeholder="Veda Support Portal"
                      className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Colors */}
            <TabsContent value="colors" className="mt-4">
              <Card className="border-[#e5e0d5] bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-[#1a1a1a]">Theme Colors</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <ThemeColorPicker label="Primary" color={config.primaryColor} onChange={(c) => update({ primaryColor: c })} description="Main brand color, buttons, active states" />
                    <ThemeColorPicker label="Secondary" color={config.secondaryColor} onChange={(c) => update({ secondaryColor: c })} description="Text, headings, dark elements" />
                    <ThemeColorPicker label="Success" color={config.successColor} onChange={(c) => update({ successColor: c })} description="Positive actions, completed states" />
                    <ThemeColorPicker label="Warning" color={config.warningColor} onChange={(c) => update({ warningColor: c })} description="Caution, pending states" />
                    <ThemeColorPicker label="Danger" color={config.dangerColor} onChange={(c) => update({ dangerColor: c })} description="Errors, destructive actions" />
                    <ThemeColorPicker label="Info" color={config.infoColor} onChange={(c) => update({ infoColor: c })} description="Informational elements, links" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Images */}
            <TabsContent value="images" className="mt-4 space-y-4">
              <Card className="border-[#e5e0d5] bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-[#1a1a1a]">Logo & Images</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Logo upload */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-[#595959]">Header Logo</Label>
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#e5e0d5] bg-[#fbf9f4]">
                        {config.logoDataUrl ? (
                          <img src={config.logoDataUrl} alt="Logo" className="max-h-10 max-w-10 object-contain" />
                        ) : (
                          <Image className="h-5 w-5 text-[#e5e0d5]" />
                        )}
                      </div>
                      <Label className="flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-xs text-[#595959] hover:bg-[#f5f3ee]">
                        <Upload className="h-3 w-3" />
                        Upload Logo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload('logoDataUrl', e.target.files[0])}
                        />
                      </Label>
                      {config.logoDataUrl && (
                        <Button variant="ghost"  className="h-6 text-xs text-red-600" onClick={() => update({ logoDataUrl: null })}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Favicon */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-[#595959]">Favicon</Label>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded border border-[#e5e0d5] bg-[#fbf9f4]">
                        {config.faviconDataUrl ? (
                          <img src={config.faviconDataUrl} alt="Favicon" className="max-h-6 max-w-6 object-contain" />
                        ) : (
                          <Monitor className="h-4 w-4 text-[#e5e0d5]" />
                        )}
                      </div>
                      <Label className="flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-xs text-[#595959] hover:bg-[#f5f3ee]">
                        <Upload className="h-3 w-3" />
                        Upload Favicon
                        <input
                          type="file"
                          accept="image/x-icon,image/png"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload('faviconDataUrl', e.target.files[0])}
                        />
                      </Label>
                    </div>
                  </div>

                  {/* Login Background */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-[#595959]">Login Page Background</Label>
                    <div className="flex items-center gap-3">
                      <div className="flex h-16 w-28 items-center justify-center rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] overflow-hidden">
                        {config.loginBgDataUrl ? (
                          <img src={config.loginBgDataUrl} alt="Background" className="h-full w-full object-cover" />
                        ) : (
                          <Image className="h-5 w-5 text-[#e5e0d5]" />
                        )}
                      </div>
                      <Label className="flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-xs text-[#595959] hover:bg-[#f5f3ee]">
                        <Upload className="h-3 w-3" />
                        Upload Background
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleImageUpload('loginBgDataUrl', e.target.files[0])}
                        />
                      </Label>
                      {config.loginBgDataUrl && (
                        <Button variant="ghost"  className="h-6 text-xs text-red-600" onClick={() => update({ loginBgDataUrl: null })}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Custom CSS */}
            <TabsContent value="css" className="mt-4">
              <Card className="border-[#e5e0d5] bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-[#1a1a1a]">Custom CSS</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={config.customCSS}
                    onChange={(e) => update({ customCSS: e.target.value })}
                    placeholder="/* Enter custom CSS here */\n.header { background: #c9a87c; }"
                    rows={12}
                    className="font-mono text-xs border-[#e5e0d5] bg-[#fbf9f4]"
                  />
                  <p className="text-[10px] text-[#8a8a8a]">
                    Custom CSS is injected into the page. Use with caution — invalid CSS may break the layout.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Live Preview */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#c9a87c]" />
                  Live Preview
                </div>
                <div className="flex gap-1">
                  <Button
                    variant={previewMode === 'header' ? 'default' : 'outline'}
                    
                    className={cn('h-6 text-xs', previewMode === 'header' && 'bg-[#c9a87c] hover:bg-[#b8996c]')}
                    onClick={() => setPreviewMode('header')}
                  >
                    Header
                  </Button>
                  <Button
                    variant={previewMode === 'login' ? 'default' : 'outline'}
                    
                    className={cn('h-6 text-xs', previewMode === 'login' && 'bg-[#c9a87c] hover:bg-[#b8996c]')}
                    onClick={() => setPreviewMode('login')}
                  >
                    Login
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {previewMode === 'header' ? (
                <div className="space-y-3">
                  {/* Simulated header */}
                  <div
                    className="flex items-center justify-between rounded-lg px-4 py-3"
                    style={{ backgroundColor: config.primaryColor }}
                  >
                    <div className="flex items-center gap-2">
                      {config.logoDataUrl ? (
                        <img src={config.logoDataUrl} alt="Logo" className="h-6 w-6 object-contain" />
                      ) : (
                        <div className="h-6 w-6 rounded bg-white/20" />
                      )}
                      <span className="text-sm font-semibold text-white">{config.portalName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-12 rounded-full bg-white/20" />
                      <div className="h-6 w-6 rounded-full bg-white/30" />
                    </div>
                  </div>
                  {/* Simulated card */}
                  <div className="rounded-lg border p-3" style={{ borderColor: config.primaryColor + '40' }}>
                    <div className="mb-2 h-3 w-24 rounded" style={{ backgroundColor: config.secondaryColor }} />
                    <div className="mb-1 h-2 w-full rounded bg-[#e5e0d5]" />
                    <div className="mb-3 h-2 w-3/4 rounded bg-[#e5e0d5]" />
                    <div className="flex gap-2">
                      <div className="h-6 w-16 rounded" style={{ backgroundColor: config.primaryColor }} />
                      <div className="h-6 w-16 rounded border" style={{ borderColor: config.primaryColor }} />
                    </div>
                  </div>
                  {/* Color swatches */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Success', color: config.successColor },
                      { label: 'Warning', color: config.warningColor },
                      { label: 'Danger', color: config.dangerColor },
                      { label: 'Info', color: config.infoColor },
                      { label: 'Primary', color: config.primaryColor },
                      { label: 'Secondary', color: config.secondaryColor },
                    ].map((sw) => (
                      <div key={sw.label} className="flex flex-col items-center gap-1 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] p-2">
                        <div className="h-6 w-full rounded" style={{ backgroundColor: sw.color }} />
                        <span className="text-[10px] text-[#8a8a8a]">{sw.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="relative flex min-h-[240px] items-center justify-center rounded-lg overflow-hidden"
                  style={{
                    backgroundImage: config.loginBgDataUrl ? `url(${config.loginBgDataUrl})` : undefined,
                    backgroundColor: config.loginBgDataUrl ? undefined : config.primaryColor + '15',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <div className="w-64 rounded-lg border border-[#e5e0d5] bg-white/95 p-4 shadow-lg backdrop-blur">
                    <div className="mb-3 flex items-center justify-center gap-2">
                      {config.logoDataUrl ? (
                        <img src={config.logoDataUrl} alt="Logo" className="h-6 w-6 object-contain" />
                      ) : (
                        <div className="h-6 w-6 rounded" style={{ backgroundColor: config.primaryColor }} />
                      )}
                      <span className="text-sm font-semibold" style={{ color: config.secondaryColor }}>
                        {config.portalName}
                      </span>
                    </div>
                    <div className="mb-2 h-8 rounded border border-[#e5e0d5] bg-[#fbf9f4]" />
                    <div className="mb-3 h-8 rounded border border-[#e5e0d5] bg-[#fbf9f4]" />
                    <div className="h-8 rounded" style={{ backgroundColor: config.primaryColor }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
