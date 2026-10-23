import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Standalone demo entry for dsh-node-flow.
 * In the DSH client this same Canvas component is mounted by the plugin;
 * here it runs standalone via Vite for development and screenshots.
 *
 * @module ui/main
 */
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import { Canvas } from '../components/Canvas.js';
import '../components/canvas.css';
const rootEl = document.getElementById('root');
if (rootEl) {
    createRoot(rootEl).render(_jsx("div", { className: "wf-overlay", "data-theme": "dark", style: { height: '100vh' }, children: _jsx(Canvas, {}) }));
}
