'use client';

import {useState} from 'react';
import {useQuery, useMutation, useConvex} from 'convex/react';
import {LoginLink, LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {api} from '../../convex/_generated/api';
import {ROLE_SCOPES, ROLE_TO_AGENT, type RoleName} from '../lib/authz';

interface SessionInfo {
  sub: string | null;
  displayName: string | null;
  orgCode: string | null;
  permissions: string[];
}

type AuthzMode = 'broken' | 'enforced';
type VerifyChainResult = {ok: true; length: number} | {ok: false; brokenAtSeq: number; reason: string};
type FileInfo = {title: string; status: string; classification: string | null};

const ROLES: RoleName[] = ['Analyst', 'Reviewer', 'Custodian'];

// The cast — three agents and what each does (their Kinde permissions).
const AGENT_LEGEND: {name: string; does: string; note?: string}[] = [
  {name: 'Intake', does: 'ingests files'},
  {name: 'Review', does: 'reads + annotates', note: 'not allowed to delete'},
  {name: 'Disposition', does: 'redacts, exports, deletes'}
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}
function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
// The M2M subject is the agent's client id (e.g. "m2m_review"); show "review".
function agentLabel(sub: string): string {
  return sub.startsWith('m2m_') ? sub.slice(4) : sub;
}

export default function Dashboard(props: {orgCode: string; signedIn: boolean; session: SessionInfo | null}) {
  const {orgCode, signedIn, session} = props;
  const convex = useConvex();
  const setMode = useMutation(api.authzMode.setMode);

  const [role, setRole] = useState<RoleName>('Reviewer');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [chain, setChain] = useState<VerifyChainResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [switching, setSwitching] = useState(false);

  const mode = useQuery(api.authzMode.getMode);
  const eventRuns = useQuery(api.runEvents.listRuns, {orgCode});
  const provenance = useQuery(api.provenance.list, {orgCode});
  const activity = useQuery(api.activityLog.list, {orgCode});
  const records = useQuery(api.records.list, {orgCode});

  // resourceId -> human-readable case file (title + current status).
  const fileIndex = new Map<string, FileInfo>(
    (records ?? []).map((r) => [r._id, {title: r.title, status: r.status, classification: r.classification ?? null}])
  );
  const fileFor = (id: string): FileInfo => fileIndex.get(id) ?? {title: shortId(id), status: 'unknown', classification: null};

  // Unified run list (events + provenance) so an enforced run is selectable and the
  // authority panel fills for the selected run.
  const runIndex = new Map<string, {correlationId: string; lastAt: number; events: number; decisions: number}>();
  for (const run of eventRuns ?? []) {
    runIndex.set(run.correlationId, {correlationId: run.correlationId, lastAt: run.lastAt, events: run.count, decisions: 0});
  }
  for (const row of provenance ?? []) {
    const current = runIndex.get(row.correlationId) ?? {correlationId: row.correlationId, lastAt: row.ts, events: 0, decisions: 0};
    current.decisions += 1;
    current.lastAt = Math.max(current.lastAt, row.ts);
    runIndex.set(row.correlationId, current);
  }
  const allRuns = Array.from(runIndex.values()).sort((a, b) => b.lastAt - a.lastAt);
  const activeRun = selectedRun ?? allRuns[0]?.correlationId ?? null;

  const events = useQuery(
    api.runEvents.listRunEvents,
    activeRun === null ? 'skip' : {orgCode, correlationId: activeRun}
  );
  const runProvenance = (provenance ?? []).filter((row) => activeRun !== null && row.correlationId === activeRun);

  async function switchMode(next: AuthzMode) {
    setSwitching(true);
    try {
      await setMode({mode: next});
    } finally {
      setSwitching(false);
    }
  }

  async function triggerRun() {
    setRunning(true);
    setRunError(null);
    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({orgCode})
      });
      const data = (await response.json()) as {correlationId?: string; error?: string};
      if (data.correlationId !== undefined) {
        setSelectedRun(data.correlationId);
        setChain(null);
      } else {
        setRunError(data.error ?? 'Run failed');
      }
    } catch {
      setRunError('Could not reach the run endpoint.');
    } finally {
      setRunning(false);
    }
  }

  async function verifyIntegrity() {
    setVerifying(true);
    try {
      setChain(await convex.query(api.provenance.verifyChain, {orgCode}));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <h1>Evidence Locker</h1>
          <p>Agents act on case files — authorized by Kinde, recorded tamper-evidently.</p>
        </div>
        <div className="session">
          {signedIn ? (
            <>
              <span className="session-name">{session?.displayName ?? 'Signed in'}</span>
              <LogoutLink className="linkish">Sign out</LogoutLink>
            </>
          ) : (
            <LoginLink className="btn-ghost btn">Sign in with Kinde</LoginLink>
          )}
        </div>
      </header>

      {/* The scenario + the problem, stated plainly. */}
      <section className="intro">
        <p>
          This is an evidence locker for legal case files. AI agents intake, review, and dispose of documents. The problem:
          normal logs record <strong>what</strong> an agent did, not <strong>whether it was allowed</strong> — so you can’t
          prove to an auditor that a deletion was authorized. Kinde issues each agent’s identity and permissions; the
          authorization component checks every action against them and writes a tamper-evident record.
        </p>
        <p className="intro-lead">Watch the Review agent try to delete a file it isn’t permitted to.</p>
        <div className="agents-legend">
          {AGENT_LEGEND.map((agent) => (
            <div key={agent.name} className="agent-def">
              <span className="agent-name">{agent.name}</span>
              <span className="agent-can">{agent.does}</span>
              {agent.note !== undefined && <span className="agent-note">{agent.note}</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Demo control (one global server mode) + banner. */}
      <section className="controlbar">
        <ModeToggle mode={mode} pending={switching} onSet={switchMode} />
        <ModeBanner mode={mode} />
      </section>

      {/* Guided progress strip. */}
      <Stepper current={activeRun === null ? 1 : mode === 'enforced' ? 3 : 2} />

      <section className="section viewas">
        <span className="label">View as</span>
        <div className="roleswitch">
          {ROLES.map((r) => (
            <button key={r} className={r === role ? 'active' : ''} onClick={() => setRole(r)}>
              {r}
            </button>
          ))}
        </div>
        <span className="muted">
          acts through <code className="mono">{ROLE_TO_AGENT[role]}</code>
        </span>
        <div className="role-scopes">
          {ROLE_SCOPES[role].map((scope) => (
            <span key={scope} className="chip">
              {scope}
            </span>
          ))}
        </div>
      </section>

      {/* Step 1 — RUN */}
      <section className="step">
        <StepHead n={1} title="Run the agents" hint="The three agents act on the case files. Watch it stream in." />
        <div className="controls">
          <button className="btn" onClick={triggerRun} disabled={running}>
            {running ? 'Running…' : 'Run the agents'}
          </button>
          <select
            className="run-select"
            value={activeRun ?? ''}
            onChange={(e) => setSelectedRun(e.target.value.length > 0 ? e.target.value : null)}
          >
            {allRuns.length === 0 ? (
              <option value="">no runs yet</option>
            ) : (
              allRuns.map((run) => (
                <option key={run.correlationId} value={run.correlationId}>
                  {shortId(run.correlationId)} · {run.events} events · {run.decisions} decisions · {formatTime(run.lastAt)}
                </option>
              ))
            )}
          </select>
        </div>
        {runError !== null && <p className="hint">{runError}</p>}
        <div className="card" style={{marginTop: 14}}>
          <div className="card-body">
            {events === undefined ? (
              <EmptyState title="Nothing running yet" hint="Click “Run the agents” to watch events stream in live." />
            ) : events.length === 0 ? (
              <EmptyState title="Waiting for events" hint="This run hasn’t emitted anything yet." />
            ) : (
              <ul className="stream">
                {events.map((event) => (
                  <li key={event._id}>
                    <span className="agent-tag">{event.agentId}</span>
                    <span className="evt-type">{event.type}</span>
                    <span className="evt-time">{formatTime(event.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <RunSummary provenance={runProvenance} events={events} />
      </section>

      {/* Steps 2 & 3 — the contrast. */}
      <section className="step">
        <StepHead
          n={2}
          title="See the gap, then the fix"
          hint="Broken mode fills the blind log; enforced mode fills the authority record. Toggle above and re-run."
        />
        <p className="claim">
          The blind log can’t tell an allowed delete from a denied one. The authority record can — and proves it wasn’t
          tampered with.
        </p>
        <div className="two-col">
          <ActivityLogCard rows={activity} fileFor={fileFor} />
          <ProvenanceCard
            rows={runProvenance}
            loading={provenance === undefined}
            chain={chain}
            verifying={verifying}
            onVerify={verifyIntegrity}
            fileFor={fileFor}
          />
        </div>
      </section>
    </div>
  );
}

function ModeToggle(props: {mode: AuthzMode | undefined; pending: boolean; onSet: (mode: AuthzMode) => void}) {
  const {mode, pending, onSet} = props;
  return (
    <div className="mode-toggle">
      <span className="toggle-caption">Demo control — sets the server mode for everyone</span>
      <div className="segmented" role="group" aria-label="Server mode">
        <button
          type="button"
          className={mode === 'broken' ? 'active' : ''}
          disabled={pending}
          onClick={() => onSet('broken')}
        >
          Broken
        </button>
        <button
          type="button"
          className={mode === 'enforced' ? 'active' : ''}
          disabled={pending}
          onClick={() => onSet('enforced')}
        >
          Enforced
        </button>
      </div>
    </div>
  );
}

function Stepper({current}: {current: number}) {
  const steps = [
    {n: 1, label: 'Run the agents'},
    {n: 2, label: 'See the gap · Broken mode'},
    {n: 3, label: 'See the fix · Enforced mode'}
  ];
  return (
    <ol className="stepper">
      {steps.map((step) => {
        const state = step.n === current ? 'active' : step.n < current ? 'done' : 'todo';
        return (
          <li key={step.n} className={`stepper-item stepper-${state}`}>
            <span className="stepper-num">{step.n}</span>
            <span className="stepper-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ModeBanner({mode}: {mode: AuthzMode | undefined}) {
  if (mode === undefined) {
    return <div className="banner">Reading mode…</div>;
  }
  if (mode === 'enforced') {
    return (
      <div className="banner banner-enforced">
        <span className="dot" />
        <div>
          <strong>Enforced mode</strong> — <span>every action is authorized and recorded.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="banner banner-broken">
      <span className="dot" />
      <div>
        <strong>Broken mode</strong> — <span>actions are logged but not authorized.</span>
      </div>
    </div>
  );
}

function StepHead({n, title, hint}: {n: number; title: string; hint?: string}) {
  return (
    <div className="step-head">
      <span className="step-badge">{n}</span>
      <div>
        <h2>{title}</h2>
        {hint !== undefined && <p>{hint}</p>}
      </div>
    </div>
  );
}

interface ProvenanceRow {
  _id: string;
  seq: number;
  actorSub: string;
  action: string;
  decision: 'allow' | 'deny';
  effectiveScopes: string[];
  requiredScopes?: string[];
  denyReason?: string;
  resourceId: string;
}

function RunSummary({provenance, events}: {provenance: ProvenanceRow[]; events: {type: string}[] | undefined}) {
  const deletes = provenance.filter((row) => row.action === 'records:delete');
  if (deletes.length > 0) {
    const allowed = deletes.filter((row) => row.decision === 'allow').map((row) => agentLabel(row.actorSub));
    const denied = deletes.filter((row) => row.decision === 'deny').map((row) => agentLabel(row.actorSub));
    const parts: string[] = [];
    if (allowed.length > 0) parts.push(`${allowed.length} allowed (${allowed.join(', ')})`);
    if (denied.length > 0) parts.push(`${denied.length} denied (${denied.join(', ')})`);
    return (
      <p className="run-summary">
        This run: {deletes.length} delete {deletes.length === 1 ? 'attempt' : 'attempts'} — {parts.join(', ')}.
        {denied.length > 0 ? ' Files intact where denied.' : ''}
      </p>
    );
  }
  const blindDeletes = (events ?? []).filter(
    (event) => event.type === 'record.deleted' || event.type === 'record.delete.denied'
  );
  if (blindDeletes.length > 0) {
    return (
      <p className="run-summary">
        This run: {blindDeletes.length} {blindDeletes.length === 1 ? 'delete' : 'deletes'} — logged blindly, no
        authorization recorded.
      </p>
    );
  }
  return null;
}

function ClassTag({classification}: {classification: string | null}) {
  if (classification === null) return null;
  const sensitive = classification === 'privileged' || classification === 'pii';
  return <span className={sensitive ? 'cls-tag cls-sensitive' : 'cls-tag'}>{classification}</span>;
}

function EmptyState({title, hint}: {title: string; hint?: string}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <div className="empty-title">{title}</div>
      {hint !== undefined && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

interface ActivityRow {
  _id: string;
  actorAgentId: string;
  action: string;
  resourceId: string;
  ts: number;
}

function ActivityLogCard({rows, fileFor}: {rows: ActivityRow[] | undefined; fileFor: (id: string) => FileInfo}) {
  const recent = (rows ?? []).slice().sort((a, b) => b.ts - a.ts).slice(0, 12);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Step 2 · activityLog — the blind log</h3>
          <p>The log can’t tell you which delete was allowed. Both look the same.</p>
        </div>
      </div>
      <div className="card-body">
        {rows === undefined ? (
          <EmptyState title="Loading…" />
        ) : recent.length === 0 ? (
          <EmptyState title="No activity logged" hint="Switch to broken mode, run, and this blind log fills." />
        ) : (
          <ul className="rows">
            {recent.map((row) => {
              const file = fileFor(row.resourceId);
              return (
                <li key={row._id}>
                  <div className="row-top">
                    <div className="row-actor">
                      <code className="mono">{row.action}</code>
                      <span className="by">by {row.actorAgentId}</span>
                    </div>
                    <span className="evt-time">{formatTime(row.ts)}</span>
                  </div>
                  <div className="file-line">
                    <span className="file-title">{file.title}</span>
                    <ClassTag classification={file.classification} />
                  </div>
                  <div className="row-note">no authority recorded — identical whether allowed or denied</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProvenanceCard(props: {
  rows: ProvenanceRow[];
  loading: boolean;
  chain: VerifyChainResult | null;
  verifying: boolean;
  onVerify: () => void;
  fileFor: (id: string) => FileInfo;
}) {
  const {rows, loading, chain, verifying, onVerify, fileFor} = props;
  const ordered = rows.slice().sort((a, b) => a.seq - b.seq);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Step 3 · provenance — the authority record</h3>
          <p>Now every action carries its authority, and you can prove it.</p>
        </div>
        <button className="btn-ghost btn" onClick={onVerify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify integrity'}
        </button>
      </div>
      <div className="card-body">
        {loading ? (
          <EmptyState title="Loading…" />
        ) : ordered.length === 0 ? (
          <EmptyState title="No authority recorded" hint="Switch to enforced mode, run, and each decision lands here." />
        ) : (
          <ul className="rows">
            {ordered.map((row) => {
              const file = fileFor(row.resourceId);
              return (
                <li key={row._id}>
                  <div className="row-top">
                    <div className="row-actor">
                      <span className={row.decision === 'allow' ? 'badge badge-allow' : 'badge badge-deny'}>
                        {row.decision === 'allow' ? 'ALLOW' : 'DENY'}
                      </span>
                      <code className="mono">{row.action}</code>
                      <span className="by">by {agentLabel(row.actorSub)}</span>
                    </div>
                    <span className="hash">seq {row.seq}</span>
                  </div>
                  <div className="file-line">
                    <span className="file-title">{file.title}</span>
                    <ClassTag classification={file.classification} />
                    <span className={file.status === 'deleted' ? 'file-status file-status-gone' : 'file-status'}>
                      {file.status}
                    </span>
                  </div>
                  <div className="row-meta">
                    <span className="label">sub</span>
                    <code className="hash">{row.actorSub}</code>
                    <span className="label">scopes</span>
                    {row.effectiveScopes.map((scope) => (
                      <span key={scope} className="chip">
                        {scope}
                      </span>
                    ))}
                  </div>
                  {row.decision === 'deny' && (
                    <div className="row-note row-note-deny">
                      DENIED — <code className="mono">{row.denyReason ?? 'insufficient_scope'}</code>, needed{' '}
                      {(row.requiredScopes ?? []).map((scope) => (
                        <span key={scope} className="chip">
                          {scope}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {chain !== null && (
          <div style={{padding: '0 18px 16px'}}>
            {chain.ok ? (
              <div className="verify verify-ok">Chain verified — {chain.length} rows, unbroken.</div>
            ) : (
              <div className="verify verify-bad">
                Broken at seq {chain.brokenAtSeq}: {chain.reason}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
