import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from './store/graphStore';
import { useAuthStore } from './store/authStore';
import { SearchForm } from './components/SearchForm';
import { AccessGranted, LoginForm } from './components/LoginForm';
import { LoadingScreen } from './components/LoadingScreen';
import { SavedQueriesList } from './components/SavedQueriesList';
import { Topbar } from './components/painel/Topbar';
import { FiltersSidebar } from './components/painel/FiltersSidebar';
import { Workspace } from './components/painel/Workspace';
import { EntityDetail } from './components/painel/EntityDetail';
import { HomeShell, LogoCore } from './components/home/HomeParts';
import { prefersReducedMotion } from './lib/motion';
import './home.css';

export default function App() {
  const rootId = useGraphStore((s) => s.rootId);
  const loading = useGraphStore((s) => s.loading);
  const authStatus = useAuthStore((s) => s.status);
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [view, setView] = useState<'search' | 'saved'>('search');

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // "Acesso liberado" só depois de um login de verdade (não ao reabrir com sessão válida)
  const prevStatus = useRef(authStatus);
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (prevStatus.current === 'unauthenticated' && authStatus === 'authenticated' && !prefersReducedMotion()) {
      setGranted(true);
    }
    prevStatus.current = authStatus;
  }, [authStatus]);

  const main = renderMain();
  return (
    <>
      {main}
      {granted && <AccessGranted name={user?.nome} onDone={() => setGranted(false)} />}
    </>
  );

  function renderMain() {
    if (authStatus === 'checking') {
      return (
        <HomeShell>
          <div className="loading-stage">
            <LogoCore size={150} scanning />
            <p className="loading-sub">Verificando sessão…</p>
          </div>
        </HomeShell>
      );
    }

    if (authStatus === 'unauthenticated') {
      return <LoginForm />;
    }

    if (!rootId) {
      if (loading) {
        return <LoadingScreen />;
      }
      const header = (
        <>
          {user?.nome && (
            <span className="home-user">
              <span className="home-user-avatar">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
                </svg>
              </span>
              {user.nome}
            </span>
          )}
          <button type="button" onClick={() => void logout()} className="home-logout">
            <span className="home-logout-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M9 5l6 7-6 7" />
              </svg>
            </span>
            Sair
          </button>
        </>
      );
      if (view === 'saved') {
        return (
          <HomeShell header={header}>
            <SavedQueriesList onBack={() => setView('search')} />
          </HomeShell>
        );
      }
      return (
        <HomeShell header={header}>
          <SearchForm onOpenSavedQueries={() => setView('saved')} />
        </HomeShell>
      );
    }

    return (
      <div className={`painel app right-collapsed ${leftOpen ? '' : 'left-collapsed'}`}>
        <Topbar
          workspaceRef={workspaceRef}
          onToggleFilters={() => setLeftOpen((v) => !v)}
          onNavigateToSearch={() => setView('search')}
          onNavigateToSaved={() => setView('saved')}
        />
        <FiltersSidebar open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
        <Workspace workspaceRef={workspaceRef} />
        <EntityDetail />
      </div>
    );
  }
}
