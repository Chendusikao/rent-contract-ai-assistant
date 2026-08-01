import { Button, Tooltip } from 'tdesign-react';
import {
  SunnyIcon,
  MoonIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
} from 'tdesign-icons-react';
import { Theme } from '../types';

interface HeaderProps {
  isSettingsPage: boolean;
  isAdminPage: boolean;
  sidebarOpen: boolean;
  theme: Theme;
  pageTitle: string;
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
}

export function Header({
  sidebarOpen,
  theme,
  pageTitle,
  onToggleSidebar,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header
      className="h-14 flex justify-between items-center px-4 flex-shrink-0"
      style={{
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="flex items-center gap-3">
        <Button
          variant="text"
          shape="circle"
          icon={sidebarOpen ? <MenuFoldIcon /> : <MenuUnfoldIcon />}
          onClick={onToggleSidebar}
        />
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--td-text-color-primary)' }}
        >
          {pageTitle}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>
          <Button
            variant="outline"
            shape="circle"
            icon={theme === 'light' ? <MoonIcon /> : <SunnyIcon />}
            onClick={onToggleTheme}
          />
        </Tooltip>
      </div>
    </header>
  );
}
