import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import App from "./App";
import { installOverlayScrollbars } from "./browser/scrollbar";
import { registerAppUpdates } from "./browser/pwa";
import { motionDuration } from "./components/ui/motion";
import "./i18n";
import "../styles.css";

for (const [kind, seconds] of Object.entries(motionDuration)) {
  document.documentElement.style.setProperty(
    `--ui-motion-${kind}`,
    `${seconds * 1000}ms`,
  );
}

const cleanupScrollbar = installOverlayScrollbars();
registerAppUpdates();
if (import.meta.hot) import.meta.hot.dispose(cleanupScrollbar);

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");
createRoot(root).render(
  <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </LazyMotion>,
);
