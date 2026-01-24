#!/usr/bin/env bun
/**
 * Chronicle Sync Popup - Simple launcher with rich terminal/JSON output.
 *
 * Popup (default): Simple dialog with count + last sync time
 * Terminal (--terminal): Rich formatted output for command line
 * JSON (--json): Structured output for other tools/UIs
 *
 * Usage:
 *   bun scripts/chronicle-sync-popup.ts              # Simple popup
 *   bun scripts/chronicle-sync-popup.ts --terminal   # Rich terminal preview
 *   bun scripts/chronicle-sync-popup.ts --json       # JSON output
 *   bun scripts/chronicle-sync-popup.ts --force      # Show even if no changes
 */
import {
  loadEnv,
  getSyncPreview,
  getSyncOutput,
  formatTimeAgo,
  showOsascriptDialog,
  showOsascriptNotification,
  openUrl,
  runAnsibleSync,
  updateLastSyncTime,
  generateSuggestions,
  type SyncPreview,
} from "./chronicle-sync-lib";

const DASHBOARD_PORT = process.env.PORT || "3457";
const DASHBOARD_SYNC_URL = `http://localhost:${DASHBOARD_PORT}/sync`;

async function main() {
  const args = process.argv.slice(2);
  const terminalMode = args.includes("--terminal");
  const jsonMode = args.includes("--json");
  const forceShow = args.includes("--force");

  // Load environment
  const env = loadEnv();
  const syncTarget = env.CHRONICLE_SYNC_TARGET;
  const deployDir = env.CHRONICLE_DEPLOY_DIR;

  if (!syncTarget || !deployDir) {
    console.error("Missing required env vars. Set CHRONICLE_SYNC_TARGET and CHRONICLE_DEPLOY_DIR in ~/.claude/.env");
    process.exit(1);
  }

  // Get sync preview
  const preview = getSyncPreview();

  // Exit if no changes (unless forced)
  if (preview.newBlocksSinceSync === 0 && !forceShow) {
    if (jsonMode) {
      console.log(JSON.stringify({ status: "no_changes", sessionsToSync: 0 }));
    } else {
      console.log("No new sessions since last sync.");
    }
    process.exit(0);
  }

  // JSON mode: structured output for other tools
  if (jsonMode) {
    const output = getSyncOutput();
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Terminal mode: rich formatted output
  if (terminalMode) {
    showTerminalPreview(preview, syncTarget, deployDir);
    return;
  }

  // Default: simple popup
  const count = preview.newBlocksSinceSync;
  const lastSyncAgo = preview.lastSyncTime ? formatTimeAgo(preview.lastSyncTime) : "never";
  const simpleMessage = `${count} session${count !== 1 ? "s" : ""} ready to sync\n\nLast sync: ${lastSyncAgo}`;

  const response = await showOsascriptDialog(
    simpleMessage,
    ["View Details", "Later", "Sync Now"],
    "Sync Now",
    "Chronicle Sync"
  );

  if (response.includes("View Details")) {
    console.log("Opening dashboard sync view...");
    openUrl(DASHBOARD_SYNC_URL);
    return;
  }

  if (response.includes("Later") || response === "cancelled") {
    console.log("Sync deferred.");
    return;
  }

  if (response.includes("Sync Now")) {
    console.log(`Syncing to ${syncTarget}...`);
    const success = runAnsibleSync(deployDir);

    if (success) {
      updateLastSyncTime();
      showPostSyncSummary(preview, syncTarget);
    } else {
      showOsascriptNotification(
        "Sync failed. Check logs for details.",
        "Chronicle Sync Error"
      );
    }
  }
}

function showTerminalPreview(preview: SyncPreview, syncTarget: string, deployDir: string): void {
  console.log("=== Chronicle Sync Preview ===\n");
  console.log(`Sessions to sync: ${preview.sessionCount}`);
  console.log(`Projects: ${preview.projectCount}`);
  console.log(`Last sync: ${preview.lastSyncTime ? formatTimeAgo(preview.lastSyncTime) : "never"}`);
  console.log(`Target: ${syncTarget}`);

  if (preview.pendingThreads.length > 0) {
    console.log("\n⚡ PENDING THREADS");
    for (const thread of preview.pendingThreads.slice(0, 5)) {
      const stale = thread.daysActive > 7 ? " [STALLED]" : "";
      console.log(`  • ${thread.project}: ${thread.text}${stale} (${thread.daysActive}d)`);
    }
  }

  if (preview.recentSessions.length > 0) {
    console.log("\n📝 RECENT SESSIONS");
    for (const session of preview.recentSessions.slice(0, 5)) {
      const summary = session.summary.length > 50 ? session.summary.slice(0, 50) + "..." : session.summary;
      console.log(`  • [${session.project}] ${summary}`);
    }
  }

  const [sug1, sug2] = generateSuggestions(preview);
  console.log("\n💡 SUGGESTED ACTIONS");
  console.log(`  [1] ${sug1.title}`);
  console.log(`      ${sug1.detail}`);
  console.log(`  [2] ${sug2.title}`);
  console.log(`      ${sug2.detail}`);

  console.log(`\nView full details: ${DASHBOARD_SYNC_URL}`);
}

function showPostSyncSummary(preview: SyncPreview, syncTarget: string): void {
  showOsascriptNotification(
    `${preview.sessionCount} session${preview.sessionCount !== 1 ? "s" : ""} synced`,
    "Chronicle Synced",
    syncTarget
  );

  console.log("\n=== Sync Complete ===");
  console.log(`${preview.sessionCount} sessions synced to ${syncTarget}`);

  const [sug1, sug2] = generateSuggestions(preview);
  console.log("\nSuggested next actions:");
  console.log(`  [1] ${sug1.title} - ${sug1.detail}`);
  console.log(`  [2] ${sug2.title} - ${sug2.detail}`);
  console.log(`\nView full details: ${DASHBOARD_SYNC_URL}`);
}

main().catch(console.error);
