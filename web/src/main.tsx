import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './screens/App';
import './tokens.css';
import './styles.css';
import './motion/motion.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
