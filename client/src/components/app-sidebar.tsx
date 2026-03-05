import { useLocation, Link } from 'wouter';
import {
  Activity,
  Shield,
  Clock,
  History,
  FileText,
  Sun,
  Moon,
  BookOpen,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/components/theme-provider';
import { useStore } from '../store/use-store';

const primaryNav = [
  { title: 'Dashboard', url: '/', icon: Activity },
  { title: 'Rules', url: '/rules', icon: Shield },
  { title: 'History', url: '/history', icon: Clock },
  { title: 'Replay', url: '/replay', icon: History },
];

const secondaryNav = [
  { title: 'Audit Log', url: '/audit', icon: FileText },
  { title: 'Architecture', url: '/architecture', icon: BookOpen },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const ruleResults = useStore((s) => s.ruleResults);

  const activeAlerts = ruleResults.filter((r) => r.triggered).length;

  const renderNav = (items: typeof primaryNav) =>
    items.map((item) => {
      const isActive = location === item.url;
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            asChild
            tooltip={item.title}
            isActive={isActive}
            className={`h-9 rounded-lg transition-all duration-200 group-data-[collapsible=icon]:!h-9 group-data-[collapsible=icon]:!w-9 group-data-[collapsible=icon]:justify-center ${
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
            }`}
            data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, '-')}`}
          >
            <Link href={item.url} aria-current={isActive ? 'page' : undefined}>
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
              {item.title === 'Rules' && activeAlerts > 0 && (
                <Badge variant="destructive" className="ml-auto h-4 min-w-[1.2rem] justify-center rounded-full px-1 py-0 text-[9px] group-data-[collapsible=icon]:hidden">
                  {activeAlerts}
                </Badge>
              )}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/80">
      <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-4 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-3">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-sidebar-accent-foreground">Incident Monitor</span>
            </div>
          </div>
        </div>
        <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20">
            <Activity className="h-4 w-4" />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pt-2 group-data-[collapsible=icon]:px-0">
        <SidebarGroup className="group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
          <SidebarGroupLabel className="section-label px-2">Monitor</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="group-data-[collapsible=icon]:items-center">{renderNav(primaryNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
          <SidebarGroupLabel className="section-label px-2">System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="group-data-[collapsible=icon]:items-center">{renderNav(secondaryNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 px-3 py-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2">
        <div className="flex items-center justify-end gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleTheme}
                className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                data-testid="button-theme-toggle"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
