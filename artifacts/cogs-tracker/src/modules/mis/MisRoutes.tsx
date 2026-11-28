import { Switch, Route } from "wouter";
import { MisLayout } from "./components/MisLayout";
import Dashboard from "./pages/Dashboard";
import OverviewReport from "./pages/OverviewReport";
import Projects from "./pages/Projects";
import ProjectSettings from "./pages/ProjectSettings";
import Authorities from "./pages/Authorities";
import Configuration from "./pages/Configuration";
import BulkEntry from "./pages/BulkEntry";
import BulkEntryHistory from "./pages/BulkEntryHistory";
import BulkEntryDetail from "./pages/BulkEntryDetail";
import Analytics from "./pages/Analytics";
import Comparison from "./pages/Comparison";
import DynamicReport from "./pages/DynamicReport";
import ProjectSecurity from "./pages/ProjectSecurity";
import ServiceRates from "./pages/ServiceRates";

import Entries from "./pages/Entries";
import EntryForm from "./pages/EntryForm";
import Reports from "./pages/Reports";

export default function MisRoutes() {
  return (
    <MisLayout>
      <Switch>
        <Route path="/"><Dashboard /></Route>
        <Route path="/overview-report" component={OverviewReport} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:id/security" component={ProjectSecurity} />
        <Route path="/projects/:id" component={ProjectSettings} />
        <Route path="/entries" component={Entries} />
        <Route path="/entries/bulk" component={BulkEntry} />
        <Route path="/bulk-entries" component={BulkEntryHistory} />
        <Route path="/entries/parents/:id" component={BulkEntryDetail} />
        <Route path="/entries/new" component={EntryForm} />
        <Route path="/entries/:id" component={EntryForm} />
        <Route path="/reports" component={Reports} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/comparison" component={Comparison} />
        <Route path="/report-builder" component={DynamicReport} />
        <Route path="/project-security" component={ProjectSecurity} />
        <Route path="/service-rates" component={ServiceRates} />
        <Route path="/authorities" component={Authorities} />
        <Route path="/configuration" component={Configuration} />
        <Route>
          <div className="p-8 text-center text-muted-foreground">MIS Page Not Found</div>
        </Route>
      </Switch>
    </MisLayout>
  );
}
