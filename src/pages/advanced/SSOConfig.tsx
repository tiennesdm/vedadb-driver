/**
 * SSOConfig - Route: /sso-config
 * SAML 2.0, OAuth 2.0/OIDC, and LDAP/AD configuration.
 */
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Fingerprint, Server,
  Key, ExternalLink,
} from 'lucide-react';
import SAMLConfigForm, { type SAMLConfig } from '@/components/advanced/SAMLConfigForm';

/* ─── types ─── */
interface OAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  logoutUrl: string;
}

interface LDAPConfig {
  enabled: boolean;
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
  groupFilter: string;
  userNameAttr: string;
  emailAttr: string;
  useSsl: boolean;
}

/* ─── defaults ─── */
const DEFAULT_OAUTH: OAuthConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  authUrl: '',
  tokenUrl: '',
  userInfoUrl: '',
  scopes: 'openid profile email',
  logoutUrl: '',
};

const DEFAULT_LDAP: LDAPConfig = {
  enabled: false,
  serverUrl: '',
  bindDn: '',
  bindPassword: '',
  baseDn: '',
  userFilter: '(objectClass=person)',
  groupFilter: '(objectClass=group)',
  userNameAttr: 'sAMAccountName',
  emailAttr: 'mail',
  useSsl: true,
};

/* ─── storage helpers ─── */
const SSO_STORAGE = 'veda_sso_config';

function loadSSOConfig() {
  try {
    const raw = localStorage.getItem(SSO_STORAGE);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { saml: undefined, oauth: undefined, ldap: undefined, defaultRedirect: '/dashboard' };
}

function saveSSOConfig(cfg: { saml: SAMLConfig; oauth: OAuthConfig; ldap: LDAPConfig; defaultRedirect: string }) {
  try { localStorage.setItem(SSO_STORAGE, JSON.stringify(cfg)); } catch { /* */ }
}

/* ─── page ─── */
export default function SSOConfig() {
  const saved = loadSSOConfig();
  const [saml, setSaml] = useState<SAMLConfig>(saved.saml);
  const [oauth, setOAuth] = useState<OAuthConfig>(saved.oauth || DEFAULT_OAUTH);
  const [ldap, setLdap] = useState<LDAPConfig>(saved.ldap || DEFAULT_LDAP);
  const [defaultRedirect, setDefaultRedirect] = useState(saved.defaultRedirect || '/dashboard');
  const [testStates, setTestStates] = useState<{ saml: 'idle' | 'testing' | 'success' | 'error'; oauth: 'idle' | 'testing' | 'success' | 'error'; ldap: 'idle' | 'testing' | 'success' | 'error' }>({ saml: 'idle', oauth: 'idle', ldap: 'idle' });

  const persist = useCallback((partial: Partial<{ saml: SAMLConfig; oauth: OAuthConfig; ldap: LDAPConfig; defaultRedirect: string }>) => {
    const next = { saml, oauth, ldap, defaultRedirect, ...partial };
    saveSSOConfig(next);
  }, [saml, oauth, ldap, defaultRedirect]);

  const simulateTest = (key: 'saml' | 'oauth' | 'ldap') => {
    setTestStates((p) => ({ ...p, [key]: 'testing' }));
    setTimeout(() => {
      setTestStates((p) => ({ ...p, [key]: Math.random() > 0.3 ? 'success' : 'error' }));
      setTimeout(() => setTestStates((p) => ({ ...p, [key]: 'idle' })), 3000);
    }, 2000);
  };

  const anyEnabled = saml?.enabled || oauth.enabled || ldap.enabled;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#1a1a1a]">
            <Fingerprint className="h-5 w-5 text-[#c9a87c]" />
            SSO Configuration
          </h1>
          <p className="mt-0.5 text-sm text-[#8a8a8a]">
            Configure SAML 2.0, OAuth 2.0 / OIDC, and LDAP / Active Directory
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8a8a8a]">SSO Active</span>
          <Badge variant={anyEnabled ? 'default' : 'secondary'} className={cn(anyEnabled && 'bg-[#c9a87c]')}>
            {anyEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </div>

      {/* Default redirect */}
      <Card className="border-[#e5e0d5] bg-white">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label className="text-xs font-medium text-[#595959]">Default redirect after login</Label>
              <Input
                value={defaultRedirect}
                onChange={(e) => { setDefaultRedirect(e.target.value); persist({ defaultRedirect: e.target.value }); }}
                placeholder="/dashboard"
                className="mt-1 border-[#e5e0d5] bg-[#fbf9f4] text-sm"
              />
            </div>
            <ExternalLink className="mt-5 h-4 w-4 text-[#e5e0d5]" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="saml" className="w-full">
        <TabsList className="bg-[#fbf9f4] border border-[#e5e0d5]">
          <TabsTrigger value="saml" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Fingerprint className="mr-1 h-3 w-3" />
            SAML 2.0
          </TabsTrigger>
          <TabsTrigger value="oauth" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Key className="mr-1 h-3 w-3" />
            OAuth 2.0 / OIDC
          </TabsTrigger>
          <TabsTrigger value="ldap" className="text-xs data-[state=active]:bg-[#c9a87c] data-[state=active]:text-white">
            <Server className="mr-1 h-3 w-3" />
            LDAP / Active Directory
          </TabsTrigger>
        </TabsList>

        {/* SAML */}
        <TabsContent value="saml" className="mt-4">
          {saml && (
            <SAMLConfigForm
              config={saml}
              onChange={(cfg) => { setSaml(cfg); persist({ saml: cfg }); }}
              onTest={() => simulateTest('saml')}
              testStatus={testStates.saml}
            />
          )}
        </TabsContent>

        {/* OAuth */}
        <TabsContent value="oauth" className="mt-4 space-y-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-[#c9a87c]" />
                  OAuth 2.0 / OpenID Connect
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8a8a8a]">Enable OAuth</span>
                  <Switch
                    checked={oauth.enabled}
                    onCheckedChange={(v) => { setOAuth((p) => ({ ...p, enabled: v })); persist({ oauth: { ...oauth, enabled: v } }); }}
                    className="data-[state=checked]:bg-[#c9a87c]"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Client ID</Label>
                  <Input value={oauth.clientId} onChange={(e) => { setOAuth((p) => ({ ...p, clientId: e.target.value })); persist({ oauth: { ...oauth, clientId: e.target.value } }); }} placeholder="your-client-id" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Client Secret</Label>
                  <Input type="password" value={oauth.clientSecret} onChange={(e) => { setOAuth((p) => ({ ...p, clientSecret: e.target.value })); persist({ oauth: { ...oauth, clientSecret: e.target.value } }); }} placeholder="your-client-secret" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Authorization URL</Label>
                  <Input value={oauth.authUrl} onChange={(e) => { setOAuth((p) => ({ ...p, authUrl: e.target.value })); persist({ oauth: { ...oauth, authUrl: e.target.value } }); }} placeholder="https://idp.example.com/oauth/authorize" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Token URL</Label>
                  <Input value={oauth.tokenUrl} onChange={(e) => { setOAuth((p) => ({ ...p, tokenUrl: e.target.value })); persist({ oauth: { ...oauth, tokenUrl: e.target.value } }); }} placeholder="https://idp.example.com/oauth/token" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">UserInfo URL</Label>
                  <Input value={oauth.userInfoUrl} onChange={(e) => { setOAuth((p) => ({ ...p, userInfoUrl: e.target.value })); persist({ oauth: { ...oauth, userInfoUrl: e.target.value } }); }} placeholder="https://idp.example.com/oauth/userinfo" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Logout URL</Label>
                  <Input value={oauth.logoutUrl} onChange={(e) => { setOAuth((p) => ({ ...p, logoutUrl: e.target.value })); persist({ oauth: { ...oauth, logoutUrl: e.target.value } }); }} placeholder="https://idp.example.com/oauth/logout" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-medium text-[#595959]">Scopes (space separated)</Label>
                  <Input value={oauth.scopes} onChange={(e) => { setOAuth((p) => ({ ...p, scopes: e.target.value })); persist({ oauth: { ...oauth, scopes: e.target.value } }); }} placeholder="openid profile email" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#fbf9f4] p-3">
                <span className="text-xs text-[#8a8a8a]">
                  {oauth.clientId && oauth.authUrl ? 'Required fields filled' : 'Fill Client ID and Authorization URL'}
                </span>
                <Button
                  
                  onClick={() => simulateTest('oauth')}
                  disabled={!oauth.clientId || !oauth.authUrl || testStates.oauth === 'testing'}
                  className={cn(
                    'text-xs',
                    testStates.oauth === 'success' && 'bg-green-600 hover:bg-green-700',
                    testStates.oauth === 'error' && 'bg-red-600 hover:bg-red-700',
                    testStates.oauth === 'idle' && 'bg-[#c9a87c] hover:bg-[#b8996c]'
                  )}
                >
                  {testStates.oauth === 'testing' && <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {testStates.oauth === 'idle' && 'Test Connection'}
                  {testStates.oauth === 'testing' && 'Testing...'}
                  {testStates.oauth === 'success' && 'Connected'}
                  {testStates.oauth === 'error' && 'Failed'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LDAP */}
        <TabsContent value="ldap" className="mt-4 space-y-4">
          <Card className="border-[#e5e0d5] bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base font-semibold text-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-[#c9a87c]" />
                  LDAP / Active Directory
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8a8a8a]">Enable LDAP</span>
                  <Switch
                    checked={ldap.enabled}
                    onCheckedChange={(v) => { setLdap((p) => ({ ...p, enabled: v })); persist({ ldap: { ...ldap, enabled: v } }); }}
                    className="data-[state=checked]:bg-[#c9a87c]"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Server URL</Label>
                  <Input value={ldap.serverUrl} onChange={(e) => { setLdap((p) => ({ ...p, serverUrl: e.target.value })); persist({ ldap: { ...ldap, serverUrl: e.target.value } }); }} placeholder="ldap://ad.example.com:389" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-[#595959]">Use SSL / TLS</Label>
                    <Switch checked={ldap.useSsl} onCheckedChange={(v) => { setLdap((p) => ({ ...p, useSsl: v })); persist({ ldap: { ...ldap, useSsl: v } }); }} className="data-[state=checked]:bg-[#c9a87c]"  />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Bind DN</Label>
                  <Input value={ldap.bindDn} onChange={(e) => { setLdap((p) => ({ ...p, bindDn: e.target.value })); persist({ ldap: { ...ldap, bindDn: e.target.value } }); }} placeholder="CN=admin,DC=example,DC=com" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Bind Password</Label>
                  <Input type="password" value={ldap.bindPassword} onChange={(e) => { setLdap((p) => ({ ...p, bindPassword: e.target.value })); persist({ ldap: { ...ldap, bindPassword: e.target.value } }); }} placeholder="••••••••" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Base DN</Label>
                  <Input value={ldap.baseDn} onChange={(e) => { setLdap((p) => ({ ...p, baseDn: e.target.value })); persist({ ldap: { ...ldap, baseDn: e.target.value } }); }} placeholder="DC=example,DC=com" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">User Filter</Label>
                  <Input value={ldap.userFilter} onChange={(e) => { setLdap((p) => ({ ...p, userFilter: e.target.value })); persist({ ldap: { ...ldap, userFilter: e.target.value } }); }} placeholder="(objectClass=person)" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Group Filter</Label>
                  <Input value={ldap.groupFilter} onChange={(e) => { setLdap((p) => ({ ...p, groupFilter: e.target.value })); persist({ ldap: { ...ldap, groupFilter: e.target.value } }); }} placeholder="(objectClass=group)" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Username Attribute</Label>
                  <Input value={ldap.userNameAttr} onChange={(e) => { setLdap((p) => ({ ...p, userNameAttr: e.target.value })); persist({ ldap: { ...ldap, userNameAttr: e.target.value } }); }} placeholder="sAMAccountName" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#595959]">Email Attribute</Label>
                  <Input value={ldap.emailAttr} onChange={(e) => { setLdap((p) => ({ ...p, emailAttr: e.target.value })); persist({ ldap: { ...ldap, emailAttr: e.target.value } }); }} placeholder="mail" className="border-[#e5e0d5] bg-[#fbf9f4] text-sm" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#fbf9f4] p-3">
                <span className="text-xs text-[#8a8a8a]">
                  {ldap.serverUrl && ldap.bindDn ? 'Required fields filled' : 'Fill Server URL and Bind DN'}
                </span>
                <Button
                  
                  onClick={() => simulateTest('ldap')}
                  disabled={!ldap.serverUrl || !ldap.bindDn || testStates.ldap === 'testing'}
                  className={cn(
                    'text-xs',
                    testStates.ldap === 'success' && 'bg-green-600 hover:bg-green-700',
                    testStates.ldap === 'error' && 'bg-red-600 hover:bg-red-700',
                    testStates.ldap === 'idle' && 'bg-[#c9a87c] hover:bg-[#b8996c]'
                  )}
                >
                  {testStates.ldap === 'testing' && <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {testStates.ldap === 'idle' && 'Test Connection'}
                  {testStates.ldap === 'testing' && 'Testing...'}
                  {testStates.ldap === 'success' && 'Connected'}
                  {testStates.ldap === 'error' && 'Failed'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
