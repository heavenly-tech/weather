import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { DeskRoutes } from "@/client/pages";
import { NavProvider } from "@/client/nav";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <NavProvider>
      <TooltipProvider>
        <AppShell>
          <DeskRoutes />
        </AppShell>
      </TooltipProvider>
    </NavProvider>
  </StrictMode>
);
