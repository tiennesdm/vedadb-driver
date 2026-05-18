/**
 * EndpointCard - API endpoint documentation card
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  Lock,
  Unlock,
  Copy,
  Check,
} from 'lucide-react';

export interface EndpointData {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  auth: boolean;
  parameters?: { name: string; type: string; required: boolean; description: string }[];
  requestBody?: Record<string, any>;
  responseExample?: Record<string, any>;
  codeExamples?: { curl: string; javascript: string; python: string };
}

interface EndpointCardProps {
  endpoint: EndpointData;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-100 text-blue-700 border-blue-200',
  PUT: 'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
};

export default function EndpointCard({ endpoint }: EndpointCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedLang, setCopiedLang] = useState<string | null>(null);

  const copyCode = (lang: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedLang(lang);
    setTimeout(() => setCopiedLang(null), 2000);
  };

  const examples = endpoint.codeExamples || {
    curl: `curl -X ${endpoint.method} \\\n  "${endpoint.path}" \\\n  -H "X-API-Key: YOUR_API_KEY" \\\n  -H "Content-Type: application/json"`,
    javascript: `fetch('${endpoint.path}', {
  method: '${endpoint.method}',
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
})
.then(r => r.json())
.then(console.log);`,
    python: `import requests

response = requests.${endpoint.method.toLowerCase()}(
    '${endpoint.path}',
    headers={'X-API-Key': 'YOUR_API_KEY'},
)
print(response.json())`,
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border border-[#e5e0d5] bg-white">
        <CollapsibleTrigger asChild>
          <CardHeader className="p-4 cursor-pointer hover:bg-[#fbf9f4] transition-colors">
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={`text-[10px] font-bold ${METHOD_COLORS[endpoint.method]}`}
              >
                {endpoint.method}
              </Badge>
              <code className="text-sm text-[#262626] font-mono">
                {endpoint.path}
              </code>
              {endpoint.auth ? (
                <Lock className="w-3.5 h-3.5 text-[#c9a87c] ml-auto" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-[#8a8a8a] ml-auto" />
              )}
              <ChevronDown
                className={`w-4 h-4 text-[#8a8a8a] transition-transform ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </div>
            <p className="text-xs text-[#8a8a8a] mt-1 ml-[72px]">
              {endpoint.description}
            </p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Parameters */}
            {endpoint.parameters && endpoint.parameters.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[#262626] mb-2">
                  Parameters
                </h4>
                <div className="space-y-1.5">
                  {endpoint.parameters.map((param) => (
                    <div
                      key={param.name}
                      className="flex items-start gap-2 text-xs"
                    >
                      <code className="font-mono text-[#c9a87c] min-w-[100px]">
                        {param.name}
                      </code>
                      <span className="text-[#8a8a8a]">{param.type}</span>
                      {param.required && (
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 border-red-200 text-red-500"
                        >
                          required
                        </Badge>
                      )}
                      <span className="text-[#595959]">{param.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request Body */}
            {endpoint.requestBody && (
              <div>
                <h4 className="text-xs font-semibold text-[#262626] mb-1">
                  Request Body
                </h4>
                <pre className="bg-[#f8f8f8] p-2 rounded-md text-[11px] font-mono text-[#595959] overflow-auto">
                  {JSON.stringify(endpoint.requestBody, null, 2)}
                </pre>
              </div>
            )}

            {/* Response Example */}
            {endpoint.responseExample && (
              <div>
                <h4 className="text-xs font-semibold text-[#262626] mb-1">
                  Response Example
                </h4>
                <pre className="bg-[#f8f8f8] p-2 rounded-md text-[11px] font-mono text-[#595959] overflow-auto">
                  {JSON.stringify(endpoint.responseExample, null, 2)}
                </pre>
              </div>
            )}

            {/* Code Examples */}
            <Tabs defaultValue="curl" className="w-full">
              <TabsList className="h-7 bg-[#f5f2eb]">
                <TabsTrigger value="curl" className="text-[10px] h-6 px-2">
                  cURL
                </TabsTrigger>
                <TabsTrigger value="javascript" className="text-[10px] h-6 px-2">
                  JavaScript
                </TabsTrigger>
                <TabsTrigger value="python" className="text-[10px] h-6 px-2">
                  Python
                </TabsTrigger>
              </TabsList>
              {(['curl', 'javascript', 'python'] as const).map((lang) => (
                <TabsContent key={lang} value={lang} className="relative mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 h-6 w-6 p-0"
                    onClick={() => copyCode(lang, examples[lang])}
                  >
                    {copiedLang === lang ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3 text-[#8a8a8a]" />
                    )}
                  </Button>
                  <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded-md text-[11px] font-mono overflow-auto max-h-[200px]">
                    {examples[lang]}
                  </pre>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
