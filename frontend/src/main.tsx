import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-500.css';
import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/fira-sans/latin-ext-400.css';
import '@fontsource/fira-sans/latin-ext-500.css';
import '@fontsource/fira-sans/latin-ext-600.css';
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-500.css';
import './styles/app.css';
import './i18n';
import { applyTheme, loadThemePreference } from './lib/theme';
import { createQueryClient } from './lib/query';
import { createRouter } from './router';
import { App, wireSessionEnd } from './app';

// Before the first render, so a dark preference never flashes light.
applyTheme(loadThemePreference());

const queryClient = createQueryClient();
const router = createRouter();
wireSessionEnd(router, queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);
