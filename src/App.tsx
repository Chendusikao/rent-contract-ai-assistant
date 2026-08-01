import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import '@tdesign-react/chat/es/style/index.js';

import { useTheme } from './hooks/useTheme';
import { useIsMobile } from './hooks/useIsMobile';

import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { SettingsPage } from './components/SettingsPage';
import { ContractPage } from './pages/ContractPage';
import { AdminPage } from './pages/AdminPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { APP_CONFIG } from './config';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/contract/:contractId" element={<AppContent />} />
      <Route path="/settings" element={<AppContent />} />
      <Route path="/admin" element={<AppContent />} />
      <Route path="/knowledge" element={<AppContent />} />
    </Routes>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsPage = location.pathname === '/settings';
  const isAdminPage = location.pathname === '/admin';
  const isKnowledgePage = location.pathname === '/knowledge';
  const isContractDetail = location.pathname.startsWith('/contract/');

  // Hooks
  const { theme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();

  // 页面标题（侧边栏/顶栏展示）
  const getPageTitle = () => {
    if (isAdminPage) return '分析记录';
    if (isKnowledgePage) return '知识库';
    if (isSettingsPage) return '设置';
    if (isContractDetail) return '分析报告';
    return APP_CONFIG.name;
  };

  // 侧边栏事件
  const handleHome = () => {
    navigate('/');
    setSidebarOpen(false);
  };
  const handleOpenSettings = () => {
    navigate('/settings');
    setSidebarOpen(false);
  };
  const handleOpenAdmin = () => {
    navigate('/admin');
    setSidebarOpen(false);
  };
  const handleOpenKnowledge = () => {
    navigate('/knowledge');
    setSidebarOpen(false);
  };

  // Sidebar 状态
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 路由切换时自动收起移动端抽屉
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile]);

  // 移动端：抽屉始终绝对定位，由 open 控制显隐
  const mobileDrawer = isMobile && sidebarOpen;

  return (
    <div
      className="flex h-screen w-screen"
      style={{ backgroundColor: 'var(--td-bg-color-page)' }}
    >
      {/* 移动端遮罩 */}
      {mobileDrawer && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏（移动端为抽屉） */}
      <div
        className={isMobile ? 'fixed z-40 top-0 bottom-0 left-0 transition-transform duration-300' : ''}
        style={{
          transform: isMobile ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : undefined,
        }}
      >
        <Sidebar
          isSettingsPage={isSettingsPage}
          isAdminPage={isAdminPage}
          isKnowledgePage={isKnowledgePage}
          sidebarOpen={isMobile ? true : sidebarOpen}
          onHome={handleHome}
          onOpenSettings={handleOpenSettings}
          onOpenAdmin={handleOpenAdmin}
          onOpenKnowledge={handleOpenKnowledge}
        />
      </div>

      {/* 主内容区 */}
      <main
        className="flex-1 flex flex-col min-w-0"
        style={{ backgroundColor: 'var(--td-bg-color-page)' }}
      >
        {/* 顶部栏 */}
        <Header
          isSettingsPage={isSettingsPage}
          isAdminPage={isAdminPage}
          sidebarOpen={sidebarOpen}
          theme={theme}
          pageTitle={getPageTitle()}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleTheme={toggleTheme}
        />

        {/* 页面 */}
        {isAdminPage ? (
          <AdminPage />
        ) : isKnowledgePage ? (
          <KnowledgePage />
        ) : isSettingsPage ? (
          <SettingsPage />
        ) : (
          <ContractPage />
        )}
      </main>
    </div>
  );
}

export default App;
