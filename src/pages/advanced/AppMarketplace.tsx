/**
 * AppMarketplace - App/integration marketplace grid
 * Route: /marketplace
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Store,
  Search,
  Star,
  Download,
  Check,
  ExternalLink,
  Image,
} from 'lucide-react';
import AppCard from '@/components/advanced/AppCard';
import type { AppData } from '@/components/advanced/AppCard';

/* ------------------------------------------------------------------ */
/*  Apps catalog                                                       */
/* ------------------------------------------------------------------ */

const INITIAL_APPS: AppData[] = [
  { id: 'slack', name: 'Slack', description: 'Send ticket notifications to Slack channels and create tickets from Slack messages.', category: 'Communication', icon: 'slack', rating: 4.8, installs: 15420, installed: true, featured: true },
  { id: 'teams', name: 'Microsoft Teams', description: 'Integrate with Teams for notifications, ticket creation, and team collaboration.', category: 'Communication', icon: 'teams', rating: 4.5, installs: 12300, installed: false },
  { id: 'github', name: 'GitHub', description: 'Link tickets to GitHub issues, track PRs, and sync development workflows.', category: 'DevOps', icon: 'github', rating: 4.7, installs: 9800, installed: true },
  { id: 'gitlab', name: 'GitLab', description: 'Connect with GitLab for CI/CD pipeline visibility and issue tracking.', category: 'DevOps', icon: 'gitlab', rating: 4.6, installs: 7200, installed: false },
  { id: 'jenkins', name: 'Jenkins', description: 'Trigger builds from ticket updates and monitor pipeline status.', category: 'DevOps', icon: 'jenkins', rating: 4.3, installs: 6500, installed: false },
  { id: 'jira', name: 'Jira', description: 'Sync tickets with Jira issues for cross-platform project management.', category: 'Productivity', icon: 'jira', rating: 4.4, installs: 11200, installed: false, featured: true },
  { id: 'pagerduty', name: 'PagerDuty', description: 'Escalate critical incidents to on-call engineers via PagerDuty.', category: 'Monitoring', icon: 'pagerduty', rating: 4.7, installs: 8900, installed: true },
  { id: 'datadog', name: 'Datadog', description: 'Monitor infrastructure metrics and create tickets from alerts.', category: 'Monitoring', icon: 'datadog', rating: 4.5, installs: 7600, installed: false },
  { id: 'salesforce', name: 'Salesforce', description: 'Sync customer data and create support cases from Salesforce.', category: 'CRM', icon: 'salesforce', rating: 4.2, installs: 5400, installed: false },
  { id: 'hubspot', name: 'HubSpot', description: 'Connect customer interactions with ticket management workflows.', category: 'CRM', icon: 'hubspot', rating: 4.3, installs: 4800, installed: false },
  { id: 'google-calendar', name: 'Google Calendar', description: 'Schedule maintenance windows and sync ticket deadlines with Calendar.', category: 'Productivity', icon: 'google-calendar', rating: 4.4, installs: 9200, installed: true },
  { id: 'okta', name: 'Okta', description: 'Single sign-on and user provisioning integration with Okta.', category: 'Security', icon: 'okta', rating: 4.6, installs: 6100, installed: false, featured: true },
];

const CATEGORIES = ['All', 'Communication', 'Monitoring', 'DevOps', 'CRM', 'Productivity', 'Security'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AppMarketplace() {
  const [apps, setApps] = useState<AppData[]>(INITIAL_APPS);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeTab, setActiveTab] = useState('available');
  const [selectedApp, setSelectedApp] = useState<AppData | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      !search ||
      app.name.toLowerCase().includes(search.toLowerCase()) ||
      app.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategory === 'All' || app.category === activeCategory;
    const matchesTab =
      activeTab === 'available' ? true : app.installed;
    return matchesSearch && matchesCategory && matchesTab;
  });

  const installedCount = apps.filter((a) => a.installed).length;

  const handleInstall = (appId: string) => {
    setApps(apps.map((a) => (a.id === appId ? { ...a, installed: true } : a)));
    const app = apps.find((a) => a.id === appId);
    if (app) {
      toast.success(`${app.name} installed successfully`);
    }
  };

  const handleUninstall = (appId: string) => {
    setApps(apps.map((a) => (a.id === appId ? { ...a, installed: false } : a)));
    const app = apps.find((a) => a.id === appId);
    if (app) {
      toast.success(`${app.name} uninstalled`);
    }
  };

  const viewDetails = (app: AppData) => {
    setSelectedApp(app);
    setShowDetailsDialog(true);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <Store className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">App Marketplace</h1>
            <p className="text-xs text-[#8a8a8a]">
              {apps.length} integrations - {installedCount} installed
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8a8a8a]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps..."
            className="pl-8 h-9 text-xs border-[#e5e0d5]"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex items-center gap-1 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-[#c9a87c] text-white'
                : 'bg-white border border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]'
            }`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-[#f5f2eb]">
          <TabsTrigger value="available" className="text-xs">
            All Apps
          </TabsTrigger>
          <TabsTrigger value="installed" className="text-xs">
            <Check className="w-3 h-3 mr-1" />
            Installed ({installedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="available" className="mt-4">
          {activeCategory === 'All' && (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-[#262626] mb-3">Featured</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredApps
                  .filter((a) => a.featured)
                  .map((app) => (
                    <AppCard
                      key={app.id}
                      app={app}
                      onInstall={handleInstall}
                      onUninstall={handleUninstall}
                      onViewDetails={viewDetails}
                    />
                  ))}
              </div>
            </div>
          )}

          <h2 className="text-sm font-semibold text-[#262626] mb-3">
            {activeCategory === 'All' ? 'All Apps' : activeCategory}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredApps
              .filter((a) => activeCategory !== 'All' || !a.featured)
              .map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onViewDetails={viewDetails}
                />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onViewDetails={viewDetails}
              />
            ))}
          </div>
          {filteredApps.length === 0 && (
            <div className="text-center py-12 text-sm text-[#8a8a8a]">
              No installed apps in this category
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* App Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-lg bg-white border-[#e5e0d5]">
          {selectedApp && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-[#262626]">
                  {selectedApp.name}
                </DialogTitle>
              </DialogHeader>
              <div className="mt-2 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl bg-[#f5f2eb] flex items-center justify-center">
                    <Image className="w-8 h-8 text-[#c9a87c]" />
                  </div>
                  <div>
                    <Badge
                      variant="outline"
                      className="text-[10px] border-[#c9a87c] text-[#c9a87c]"
                    >
                      {selectedApp.category}
                    </Badge>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-medium">{selectedApp.rating.toFixed(1)}</span>
                      </div>
                      <span className="text-xs text-[#8a8a8a]">
                        {selectedApp.installs.toLocaleString()} installs
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[#595959]">{selectedApp.description}</p>

                {/* Screenshots placeholder */}
                <div>
                  <h4 className="text-xs font-semibold text-[#262626] mb-2">Screenshots</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="aspect-[4/3] bg-[#f5f2eb] rounded-md flex items-center justify-center border border-[#e5e0d5]"
                      >
                        <Image className="w-5 h-5 text-[#c5c0b5]" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#f0ece3] flex gap-2">
                  {selectedApp.installed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => {
                        handleUninstall(selectedApp.id);
                        setShowDetailsDialog(false);
                      }}
                    >
                      Uninstall
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
                      onClick={() => {
                        handleInstall(selectedApp.id);
                        setShowDetailsDialog(false);
                      }}
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      Install
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-[#e5e0d5]"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Docs
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
