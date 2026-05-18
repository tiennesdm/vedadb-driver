/**
 * SAMLConfigForm - SAML 2.0 configuration form
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Fingerprint, Upload, Globe, Key, FileText, Check } from 'lucide-react';

export interface SAMLConfig {
  enabled: boolean;
  entityId: string;
  acsUrl: string;
  idpMetadataUrl: string;
  idpLoginUrl: string;
  idpLogoutUrl: string;
  certificate: string;
  nameIdFormat: string;
  signatureAlgorithm: string;
}

const DEFAULT_SAML: SAMLConfig = {
  enabled: false,
  entityId: '',
  acsUrl: '',
  idpMetadataUrl: '',
  idpLoginUrl: '',
  idpLogoutUrl: '',
  certificate: '',
  nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  signatureAlgorithm: 'rsa-sha256',
};

const NAMEID_FORMATS = [
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
];

interface SAMLConfigFormProps {
  config?: SAMLConfig;
  onChange: (config: SAMLConfig) => void;
  onTest: () => void;
  testStatus?: 'idle' | 'testing' | 'success' | 'error';
}

export default function SAMLConfigForm({
  config = DEFAULT_SAML,
  onChange,
  onTest,
  testStatus = 'idle',
}: SAMLConfigFormProps) {
  const [showCert, setShowCert] = useState(false);

  const update = (partial: Partial<SAMLConfig>) => {
    onChange({ ...config, ...partial });
  };

  const handleCertUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      update({ certificate: String(ev.target?.result || '') });
    };
    reader.readAsText(file);
  };

  const hasRequired = config.entityId && config.acsUrl && config.idpLoginUrl;

  return (
    <Card className="border-[#e5e0d5] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-[#c9a87c]" />
            SAML 2.0 Configuration
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8a8a8a]">Enable SAML</span>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
              className="data-[state=checked]:bg-[#c9a87c]"
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Entity ID */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs font-medium text-[#595959]">
              <Globe className="h-3 w-3" />
              Entity ID
            </Label>
            <Input
              value={config.entityId}
              onChange={(e) => update({ entityId: e.target.value })}
              placeholder="https://your-domain.com/sp"
              className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          {/* ACS URL */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs font-medium text-[#595959]">
              <Globe className="h-3 w-3" />
              ACS (Assertion Consumer Service) URL
            </Label>
            <Input
              value={config.acsUrl}
              onChange={(e) => update({ acsUrl: e.target.value })}
              placeholder="https://your-domain.com/sso/acs"
              className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          {/* IdP Metadata URL */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs font-medium text-[#595959]">
              <FileText className="h-3 w-3" />
              IdP Metadata URL
            </Label>
            <Input
              value={config.idpMetadataUrl}
              onChange={(e) => update({ idpMetadataUrl: e.target.value })}
              placeholder="https://idp.example.com/metadata.xml"
              className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          {/* IdP Login URL */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs font-medium text-[#595959]">
              <Key className="h-3 w-3" />
              IdP Login URL (SSO URL)
            </Label>
            <Input
              value={config.idpLoginUrl}
              onChange={(e) => update({ idpLoginUrl: e.target.value })}
              placeholder="https://idp.example.com/saml/sso"
              className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          {/* IdP Logout URL */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#595959]">IdP Logout URL (SLO)</Label>
            <Input
              value={config.idpLogoutUrl}
              onChange={(e) => update({ idpLogoutUrl: e.target.value })}
              placeholder="https://idp.example.com/saml/slo"
              className="border-[#e5e0d5] bg-[#fbf9f4] text-sm"
            />
          </div>

          {/* Name ID Format */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#595959]">Name ID Format</Label>
            <select
              value={config.nameIdFormat}
              onChange={(e) => update({ nameIdFormat: e.target.value })}
              className="w-full rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:ring-2 focus:ring-[#c9a87c]/20"
            >
              {NAMEID_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Certificate */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1 text-xs font-medium text-[#595959]">
              <FileText className="h-3 w-3" />
              IdP Certificate (X.509)
            </Label>
            <div className="flex items-center gap-2">
              {config.certificate && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-green-50 text-green-600">
                  <Check className="mr-0.5 h-2 w-2" />
                  Loaded
                </Badge>
              )}
              <Button
                variant="outline"
                
                className="h-6 border-[#e5e0d5] text-xs"
                onClick={() => setShowCert(!showCert)}
              >
                {showCert ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>
          {showCert && (
            <Textarea
              value={config.certificate}
              onChange={(e) => update({ certificate: e.target.value })}
              placeholder="-----BEGIN CERTIFICATE-----\n..."
              rows={4}
              className="font-mono text-xs border-[#e5e0d5] bg-[#fbf9f4]"
            />
          )}
          <div className="flex items-center gap-2">
            <Label className="flex cursor-pointer items-center gap-1 rounded-md border border-[#e5e0d5] bg-[#fbf9f4] px-3 py-1.5 text-xs text-[#595959] hover:bg-[#f5f3ee]">
              <Upload className="h-3 w-3" />
              Upload Certificate
              <input type="file" accept=".pem,.crt,.cer" className="hidden" onChange={handleCertUpload} />
            </Label>
            {config.certificate && (
              <span className="text-[10px] text-[#8a8a8a]">
                {config.certificate.length} chars
              </span>
            )}
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center justify-between rounded-lg bg-[#fbf9f4] p-3">
          <div className="text-xs text-[#8a8a8a]">
            {hasRequired ? 'Required fields filled' : 'Fill Entity ID, ACS URL, and IdP Login URL'}
          </div>
          <Button
            
            onClick={onTest}
            disabled={!hasRequired || testStatus === 'testing'}
            className={cn(
              'text-xs',
              testStatus === 'success' && 'bg-green-600 hover:bg-green-700',
              testStatus === 'error' && 'bg-red-600 hover:bg-red-700',
              testStatus === 'idle' && 'bg-[#c9a87c] hover:bg-[#b8996c]'
            )}
          >
            {testStatus === 'testing' && (
              <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {testStatus === 'idle' && 'Test Connection'}
            {testStatus === 'testing' && 'Testing...'}
            {testStatus === 'success' && 'Connected'}
            {testStatus === 'error' && 'Failed'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
