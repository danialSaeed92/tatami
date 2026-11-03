import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useLDClient } from 'launchdarkly-react-client-sdk';
import { api } from './lib/api.js';
import { initials } from './lib/format.js';
import { markIdentify } from './lib/identify.js';
import { ToastProvider } from './components/Toasts.jsx';
import FlagChangeListener from './components/FlagChangeListener.jsx';
import DemoPanel from './components/DemoPanel.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import BeltBadge from './components/BeltBadge.jsx';
import Login from './pages/Login.jsx';
import Join from './pages/Join.jsx';
import Wall from './pages/Wall.jsx';
import Schedule from './pages/Schedule.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import NewSession from './pages/NewSession.jsx';
import Members from './pages/Members.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

export default function App({ ldConfigured }) {
  const ldClient = useLDClient();
  const [auth, setAuth] = useState({ loading: true, user: null, ldContext: null });

  // Fetch the signed-in member and tell LaunchDarkly who they are.
  // The server builds the context (server/src/launchdarkly.js -> buildContext)
  // so browser and API evaluate flags against identical attributes.
  const refresh = useCallback(async () => {
    const { user, ldContext } = await api.get('/auth/me');
    if (ldClient) {
      markIdentify();
      await ldClient.identify(ldContext ?? { kind: 'user', anonymous: true });
      markIdentify();
    }
    setAuth({ loading: false, user, ldContext });
    return user;
  }, [ldClient]);

  useEffect(() => {
    refresh().catch(() => setAuth({ loading: false, user: null, ldContext: null }));
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    await refresh();
  }, [refresh]);

  if (auth.loading) return <div className="splash"><Logo /> Loading…</div>;

  return (
    <AuthContext.Provider value={{ ...auth, refresh, logout, ldConfigured, demoMode: DEMO_MODE }}>
      <ToastProvider>
        <FlagChangeListener />
        {auth.user ? <SignedIn /> : (
          <Routes>
            <Route path="/join/:code" element={<Join />} />
            <Route path="*" element={<Login />} />
          </Routes>
        )}
        {DEMO_MODE && <DemoPanel />}
      </ToastProvider>
    </AuthContext.Provider>
  );
}

function SignedIn() {
  const { user, logout, ldConfigured } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => navigate('/')}><Logo /><span>Tatami</span><small>{user.dojo.name}</small></button>
          <nav className="nav">
            <NavLink to="/" end>Wall</NavLink>
            <NavLink to="/schedule">Schedule</NavLink>
            <NavLink to="/members">Members</NavLink>
          </nav>
          <div className="me">
            <div className="avatar" title={user.name}>{initials(user.name)}</div>
            <div className="me-text">
              <strong>{user.name}</strong>
              <span>{user.role === 'parent' ? `Parent of ${user.childName}` : user.role === 'coach' ? 'Coach' : 'Student'} · <BeltBadge belt={user.belt} small /></span>
            </div>
            <button className="btn ghost sm" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      {!ldConfigured && (
        <div className="banner warn">LaunchDarkly is not configured (VITE_LD_CLIENT_SIDE_ID missing) - all features use their default variation. See README.</div>
      )}
      <main className="container">
        <Routes>
          <Route path="/" element={<Wall />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/schedule/new" element={user.role === 'coach' ? <NewSession /> : <Navigate to="/schedule" />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
          <Route path="/members" element={<Members />} />
          <Route path="/join/:code" element={<Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <ChatWidget />
    </div>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--ink)" />
      <rect x="10" y="10" width="44" height="44" rx="4" fill="var(--straw)" />
      <rect x="10" y="30" width="44" height="6" fill="var(--accent)" />
      <circle cx="32" cy="33" r="6" fill="var(--ink)" />
    </svg>
  );
}
