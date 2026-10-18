import { useStore, unsavedCounts, isSignedIn, sheetUrl, doSignIn, doSignOut } from '../store.ts';

export function Account() {
  const state = useStore();
  const u = unsavedCounts();
  const pending = u.fresh + u.edited;
  return (
    <div className="account">
      <div className="account-box">
        {isSignedIn() ? (
          <>
            {pending > 0 && <span className="unsaved">{pending} unsaved</span>}
            <span className="who">{state.email}</span>
            {state.sheetId && <a href={sheetUrl(state.sheetId)} target="_blank" rel="noopener">Open tracker ↗</a>}
            <button className="ghost" onClick={doSignOut}>Sign out</button>
          </>
        ) : (
          <button disabled={state.busy} onClick={() => doSignIn()}>{state.email ? 'Sign in again' : 'Sign in with Google'}</button>
        )}
      </div>
      <div className={`muted small ${state.status.cls}`}>{state.status.msg}</div>
    </div>
  );
}
