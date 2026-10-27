import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
const App = lazy(() => import('./App'));
const BusDemoPage = lazy(() => import('./pages/BusDemoPage'));
import './index.css';
import './app-shell.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={<div style={{ padding: 32 }}>Loading BATRASCO…</div>}>
      <Routes>
        <Route path="/demo" element={<BusDemoPage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);
