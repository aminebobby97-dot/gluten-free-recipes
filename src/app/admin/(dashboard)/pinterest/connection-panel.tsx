import { connectPinterestAction, disconnectPinterestAction, refreshPinterestAction, selectPinterestBoardAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { Notice, Panel, formatDateTime } from "@/components/admin/ui";
import { PREFERRED_BOARD_NAME, getPinterestConfig, renewalDue, tokenHealth, type PinterestConnection, type TokenHealth } from "@/lib/services/pinterest-connection";

const CONNECT_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Pinterest is connected. Check the board below, then you can publish a Ready Pin from its page." },
  denied: { ok: false, text: "Pinterest was not connected: access was not allowed on Pinterest's screen." },
  state_mismatch: { ok: false, text: "Pinterest was not connected: the security check failed (the link was old, opened in another browser, or not started from this dashboard). Click Connect Pinterest again." },
  missing_code: { ok: false, text: "Pinterest was not connected: Pinterest did not send a sign-in code. Click Connect Pinterest again." },
  not_configured: { ok: false, text: "Pinterest is not set up on the server yet (see the message below)." },
  forbidden: { ok: false, text: "Pinterest refused access (403). This can happen with Trial access or if the app is not allowed for this account. Check your app in Pinterest Developers." },
  failed: { ok: false, text: "Pinterest was not connected because of an error. Try again; if it keeps failing, check the Vercel logs (they never contain your tokens)." },
};

const HEALTH: Record<TokenHealth, { label: string; tone: "ok" | "warn" | "bad" }> = {
  valid: { label: "Valid", tone: "ok" },
  refresh_soon: { label: "Expires soon; refreshed automatically on next use", tone: "warn" },
  expired_refreshable: { label: "Expired; refreshed automatically on next use", tone: "warn" },
  reconnect: { label: "Sign-in expired: connect again", tone: "bad" },
};

const TONE = { ok: "text-sage-dark", warn: "text-honey", bad: "text-danger" } as const;

export function ConnectResult({ code }: { code: string | undefined }) {
  const result = code ? CONNECT_RESULTS[code] : undefined;
  if (!result) return null;
  return <Notice tone={result.ok ? "success" : "error"}>{result.text}</Notice>;
}

export function PinterestConnectionPanel({ installed, connection }: { installed: boolean; connection: PinterestConnection | null }) {
  const config = getPinterestConfig();

  if (!installed) {
    return (
      <Panel title="Pinterest account">
        <Notice>The Pinterest connection database update has not been applied yet. Run the Pinterest OAuth migration in the Supabase SQL Editor (see docs/PINTEREST.md), then reload this page.</Notice>
      </Panel>
    );
  }

  return (
    <Panel title="Pinterest account">
      <div className="space-y-5 text-sm">
        {!config.ok && (
          <Notice tone="error">
            Pinterest is not set up on the server yet. In Vercel, add these environment variables and redeploy: {config.problems.join(" ")}
          </Notice>
        )}

        {!connection ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ink-soft">
              <strong className="text-ink">Not connected.</strong> Connect your Pinterest Business account to read your boards and publish Pins one at a time.
            </p>
            <ConnectButton label="Connect Pinterest" disabled={!config.ok} />
          </div>
        ) : (
          <ConnectedDetails connection={connection} configOk={config.ok} />
        )}

        <p className="text-xs text-ink-faint">
          Your app has Pinterest <strong>Trial</strong> access: Pins it creates are visible only to you, and Pinterest allows only a small number of requests per day. Public
          publishing needs Standard access, which you request in Pinterest Developers. Nothing is posted automatically: each Pin is published only when you click Publish Pin on it.
        </p>
      </div>
    </Panel>
  );
}

function ConnectButton({ label, disabled = false, secondary = false }: { label: string; disabled?: boolean; secondary?: boolean }) {
  return (
    <ActionForm action={connectPinterestAction}>
      {disabled ? (
        <button type="button" className="btn btn-primary opacity-60" disabled>
          {label}
        </button>
      ) : (
        <SubmitButton className={secondary ? "btn btn-secondary" : "btn btn-primary"} pendingLabel="Opening Pinterest…">
          {label}
        </SubmitButton>
      )}
    </ActionForm>
  );
}

function ConnectedDetails({ connection, configOk }: { connection: PinterestConnection; configOk: boolean }) {
  const health = tokenHealth(connection);
  const healthInfo = HEALTH[health];
  const publicBoards = connection.boards.filter((b) => b.privacy === "PUBLIC");
  const preferred = publicBoards.find((b) => b.name.trim().toLowerCase() === PREFERRED_BOARD_NAME.toLowerCase());
  const defaultBoard = connection.selected_board_id ?? preferred?.id ?? "";
  const refreshSoon = health !== "reconnect" && renewalDue(connection);

  const rows: Array<[string, React.ReactNode]> = [
    ["Status", connection.status === "connected" && health !== "reconnect" ? <span className="font-semibold text-sage-dark">Connected</span> : <span className="font-semibold text-danger">Needs reconnecting</span>],
    ["Account", connection.pinterest_username ? `@${connection.pinterest_username}${connection.pinterest_account_type ? ` (${connection.pinterest_account_type.toLowerCase()})` : ""}` : "Unknown"],
    ["Sign-in (token)", <span key="h" className={TONE[healthInfo.tone]}>{healthInfo.label}</span>],
    ["Access token expires", formatDateTime(connection.access_token_expires_at)],
    ["Renewal deadline", connection.refresh_token_expires_at ? formatDateTime(connection.refresh_token_expires_at) : "Not given by Pinterest"],
    ["Board for new Pins", connection.selected_board_name ? `“${connection.selected_board_name}”` : <span className="text-danger">Not chosen yet</span>],
    ["Permissions", connection.scopes.length ? connection.scopes.join(", ") : "Unknown"],
  ];

  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {connection.last_error && <Notice tone="error">{connection.last_error}</Notice>}
      {refreshSoon && (
        <Notice tone="error">
          The saved sign-in must be renewed before {formatDateTime(connection.refresh_token_expires_at)}. Click <strong>Refresh sign-in and boards</strong> (or publish a Pin) before then, or you will need to connect again.
        </Notice>
      )}

      <ActionForm action={selectPinterestBoardAction} className="space-y-2">
        <label className="block">
          <span className="field-label">Board</span>
          <select name="board_id" defaultValue={defaultBoard} required className="field-input">
            <option value="" disabled>
              Choose a board…
            </option>
            {connection.boards.map((b) => (
              <option key={b.id} value={b.id} disabled={b.privacy !== "PUBLIC"}>
                {b.name}
                {b.pin_count !== null ? ` (${b.pin_count} Pins)` : ""}
                {b.privacy !== "PUBLIC" ? ` – ${b.privacy.toLowerCase()}, not allowed` : ""}
              </option>
            ))}
          </select>
          <span className="field-hint block">
            {connection.boards.length} board(s) found{connection.boards_fetched_at ? `, last checked ${formatDateTime(connection.boards_fetched_at)}` : ""}.{" "}
            {!preferred && `No public board named “${PREFERRED_BOARD_NAME}” was found. Create it on Pinterest, then click Refresh.`}
          </span>
        </label>
        <SubmitButton className="btn btn-secondary">Use this board</SubmitButton>
      </ActionForm>

      <div className="flex flex-wrap items-start gap-3">
        <ActionForm action={refreshPinterestAction}>
          <SubmitButton className="btn btn-secondary" pendingLabel="Refreshing…">
            Refresh sign-in and boards
          </SubmitButton>
        </ActionForm>
        {configOk && <ConnectButton label="Reconnect Pinterest" secondary />}
      </div>

      <details className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer text-ink-soft">Disconnect Pinterest</summary>
        <ActionForm action={disconnectPinterestAction} className="mt-3 space-y-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
            <span>Delete the saved Pinterest sign-in from this site. Pins already on Pinterest stay there.</span>
          </label>
          <SubmitButton className="btn btn-secondary" pendingLabel="Disconnecting…">
            Disconnect
          </SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
