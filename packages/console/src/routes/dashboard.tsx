import { useKilnSocket } from "../hooks/useKilnSocket";
import { SessionStatusBar } from "../components/SessionStatusBar";
import { PhaseProgress } from "../components/PhaseProgress";
import { TerminalOutput } from "../components/TerminalOutput";
import { CostPanel } from "../components/CostPanel";
import { TaskTree } from "../components/TaskTree";
import { QualityGates } from "../components/QualityGates";
import { ActivityLog } from "../components/ActivityLog";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardPage() {
  const { state, startSession, stopSession } = useKilnSocket();

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-4 h-full">
      {/* Session Status Bar */}
      <Card>
        <CardContent className="p-4">
          <SessionStatusBar
            sessionStatus={state.sessionStatus}
            statusMessage={state.statusMessage}
            task={null}
            cost={state.cost}
            error={state.error}
            onStart={startSession}
            onStop={stopSession}
          />
        </CardContent>
      </Card>

      {/* Phase Progress */}
      {state.sessionStatus !== "idle" && (
        <Card>
          <CardContent className="p-4">
            <PhaseProgress phase={state.phase} />
          </CardContent>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Left: Terminal Output (2/3 width) */}
        <div className="lg:col-span-2 min-h-[400px]">
          <TerminalOutput lines={state.output} />
        </div>

        {/* Right: Sidebar (1/3 width) */}
        <div className="flex flex-col gap-4">
          <CostPanel cost={state.cost} />
          <TaskTree tasks={state.tasks} />
          <QualityGates gates={state.qualityGates} />
        </div>
      </div>

      {/* Bottom: Activity Log */}
      <ActivityLog events={state.events} />

      {/* Error banner (fallback for non-session errors) */}
      {state.error && state.sessionStatus !== "error" && (
        <Card className="border-red-800/50 bg-red-950/30">
          <CardContent className="p-3 text-sm text-red-300">
            {state.error}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
