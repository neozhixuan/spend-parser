import { useEffect, useState } from 'react';
import { useStore, unsavedCounts, type FileEntry } from './store.ts';
import { Account } from './components/Account.tsx';
import { AddStatements } from './components/AddStatements.tsx';
import { ParseLog } from './components/ParseLog.tsx';
import { InsightsCard } from './components/InsightsCard.tsx';
import { ReviewTable } from './components/ReviewTable.tsx';
import { Summary } from './components/Summary.tsx';
import { Rules } from './components/Rules.tsx';
import { ExportCard } from './components/ExportCard.tsx';
import { InspectDialog } from './components/InspectDialog.tsx';

export function App() {
  const state = useStore();
  const [inspecting, setInspecting] = useState<FileEntry | null>(null);
  const hasTxns = state.txns.length > 0;

  // Warn before closing the tab with changes that aren't in the tracker yet.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const u = unsavedCounts();
      if (state.email && (u.fresh || u.edited)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [state]);

  return (
    <>
      <header className="top">
        <div>
          <h1>Spending Parser</h1>
          <p className="sub">Standard Chartered · POSB/DBS · PayLah! — parsed in this browser tab</p>
        </div>
        <Account />
      </header>

      <main>
        <AddStatements onInspect={setInspecting} />
        {state.files.length > 0 && <ParseLog />}
        {hasTxns && <InsightsCard />}
        {hasTxns && <ReviewTable />}
        {hasTxns && <Summary />}
        {(hasTxns || state.rules.length > 0) && <Rules />}
        {(hasTxns || state.showExport) && <ExportCard />}
      </main>

      <InspectDialog file={inspecting} onClose={() => setInspecting(null)} />
      {state.toast && <div className="toast">{state.toast}</div>}
    </>
  );
}
