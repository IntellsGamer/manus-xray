import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Admin from "./pages/Admin";
import Clients from "./pages/Clients";
import LiveControl from "./pages/LiveControl";
import Devices from "./pages/Devices";
import Recovery from "./pages/Recovery";
import Templates from "./pages/Templates";
import Home from "./pages/Home";
import Terminal from "./pages/Terminal";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/clients" component={Clients} />
      <Route path="/admin/live" component={LiveControl} />
      <Route path="/admin/devices" component={Devices} />
      <Route path="/admin/templates" component={Templates} />
      <Route path="/admin/recovery" component={Recovery} />
      <Route path="/admin/terminal" component={Terminal} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" switchable>
        <TooltipProvider>
          <Toaster richColors theme="dark" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
