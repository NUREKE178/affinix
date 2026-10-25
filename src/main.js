import { render, html, Fragment } from "./lib/preact.js";
import { App } from "./App.js";
import { ToastHost } from "./components/ui.js";
import { startIdlePreload } from "./lib/idlePreload.js";
import "./lib/pwaInstall.js"; // listens for the install prompt early and registers the service worker

const root = document.getElementById("app");
render(html`<${Fragment}><${App} /><${ToastHost} /><//>`, root);

startIdlePreload();
