import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';
const App = lazy(() => import('./App'));
import './index.css';
import './app-shell.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={<div style={{ padding: 32 }}>Loading BATRASCO…</div>}>
      <App />
    </Suspense>
  </BrowserRouter>
);
