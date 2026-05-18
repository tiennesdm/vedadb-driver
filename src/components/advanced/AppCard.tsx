/**
 * AppCard - Marketplace app/integration card
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Star,
  Download,
  Check,
} from 'lucide-react';
import {
  MessageSquare,
  Users,
  GitBranch,
  Zap,
  Bug,
  Bell,
  BarChart3,
  Cloud,
  Calendar,
  Lock,
  type LucideIcon,
} from 'lucide-react';

export interface AppData {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  rating: number;
  installs: number;
  installed: boolean;
  featured?: boolean;
}

interface AppCardProps {
  app: AppData;
  onInstall: (appId: string) => void;
  onUninstall: (appId: string) => void;
  onViewDetails: (app: AppData) => void;
}

const ICON_MAP: Record<string, LucideIcon> = {
  slack: MessageSquare,
  teams: Users,
  github: GitBranch,
  gitlab: GitBranch,
  jenkins: Zap,
  jira: Bug,
  pagerduty: Bell,
  datadog: BarChart3,
  salesforce: Cloud,
  hubspot: Users,
  'google-calendar': Calendar,
  okta: Lock,
};

const CATEGORY_COLORS: Record<string, string> = {
  Communication: 'bg-blue-50 text-blue-700 border-blue-200',
  Monitoring: 'bg-purple-50 text-purple-700 border-purple-200',
  DevOps: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CRM: 'bg-orange-50 text-orange-700 border-orange-200',
  Productivity: 'bg-teal-50 text-teal-700 border-teal-200',
  Security: 'bg-red-50 text-red-700 border-red-200',
};

export default function AppCard({ app, onInstall, onUninstall, onViewDetails }: AppCardProps) {
  const [isInstalling, setIsInstalling] = useState(false);
  const IconComponent = ICON_MAP[app.icon.toLowerCase()] || Cloud;

  const handleInstall = async () => {
    setIsInstalling(true);
    await new Promise((r) => setTimeout(r, 800));
    onInstall(app.id);
    setIsInstalling(false);
  };

  const handleUninstall = async () => {
    setIsInstalling(true);
    await new Promise((r) => setTimeout(r, 600));
    onUninstall(app.id);
    setIsInstalling(false);
  };

  return (
    <Card
      className={`border bg-white hover:shadow-md transition-all cursor-pointer ${
        app.featured ? 'ring-1 ring-[#c9a87c]' : ''
      }`}
      onClick={() => onViewDetails(app)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f5f2eb] flex items-center justify-center flex-shrink-0">
            <IconComponent className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[#262626] truncate">
                {app.name}
              </h3>
              {app.featured && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-4 border-[#c9a87c] text-[#c9a87c]"
                >
                  Featured
                </Badge>
              )}
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] h-4 mt-1 ${
                CATEGORY_COLORS[app.category] || 'bg-gray-50 text-gray-700'
              }`}
            >
              {app.category}
            </Badge>
          </div>
        </div>

        <p className="text-xs text-[#595959] mt-2 line-clamp-2">
          {app.description}
        </p>

        <div className="flex items-center gap-3 mt-3 text-[10px] text-[#8a8a8a]">
          <div className="flex items-center gap-1">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span>{app.rating.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Download className="w-3 h-3" />
            <span>{app.installs.toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-[#f0ece3]">
          {app.installed ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-emerald-600">
                <Check className="w-3.5 h-3.5" />
                <span>Installed</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-[#8a8a8a] hover:text-red-500 ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUninstall();
                }}
                disabled={isInstalling}
              >
                Uninstall
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="h-7 w-full text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
              onClick={(e) => {
                e.stopPropagation();
                handleInstall();
              }}
              disabled={isInstalling}
            >
              {isInstalling ? 'Installing...' : 'Install'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
