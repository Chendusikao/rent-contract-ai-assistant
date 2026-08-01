import { Button } from 'tdesign-react';
import { HomeIcon, DashboardIcon, SettingIcon, BookIcon } from 'tdesign-icons-react';
import { APP_CONFIG } from '../config';

interface SidebarProps {
  isSettingsPage: boolean;
  isAdminPage: boolean;
  isKnowledgePage: boolean;
  sidebarOpen: boolean;
  onHome: () => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onOpenKnowledge: () => void;
}

export function Sidebar({
  isSettingsPage,
  isAdminPage,
  isKnowledgePage,
  sidebarOpen,
  onHome,
  onOpenSettings,
  onOpenAdmin,
  onOpenKnowledge,
}: SidebarProps) {
  return (
    <aside
      className="flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden"
      style={{
        width: sidebarOpen ? 240 : 0,
        backgroundColor: 'var(--td-bg-color-container)'
      }}
    >
      {/* Logo */}
      <div className="h-14 px-4 flex items-center flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <span className="text-white text-sm font-bold">{APP_CONFIG.nameInitial}</span>
          </div>
          <span
            className="text-lg font-semibold"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </span>
        </div>
      </div>

      {/* 导航 */}
      <div className="p-3 space-y-1">
        <Button
          icon={<HomeIcon />}
          onClick={onHome}
          block
          variant={!isSettingsPage && !isAdminPage ? 'base' : 'text'}
          theme={!isSettingsPage && !isAdminPage ? 'primary' : 'default'}
        >
          合同分析
        </Button>
        <Button
          icon={<DashboardIcon />}
          onClick={onOpenAdmin}
          block
          variant={isAdminPage ? 'base' : 'text'}
          theme={isAdminPage ? 'primary' : 'default'}
        >
          分析记录
        </Button>
        <Button
          icon={<BookIcon />}
          onClick={onOpenKnowledge}
          block
          variant={isKnowledgePage ? 'base' : 'text'}
          theme={isKnowledgePage ? 'primary' : 'default'}
        >
          知识库
        </Button>
      </div>

      <div className="flex-1" />

      {/* 底部设置按钮 */}
      <div
        className="p-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--td-component-border)' }}
      >
        <Button
          icon={<SettingIcon />}
          onClick={onOpenSettings}
          block
          variant={isSettingsPage ? 'outline' : 'text'}
          theme={isSettingsPage ? 'primary' : 'default'}
        >
          设置
        </Button>
      </div>
    </aside>
  );
}
