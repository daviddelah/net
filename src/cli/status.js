#!/usr/bin/env node
import chalk from 'chalk';
import { getDb, getTodayStats, getRecentLaunches, closeDb } from '../db/sqlite.js';
import { config } from '../config.js';

function main() {
  console.log(chalk.bold('\nTrend2Token Status'));
  console.log('='.repeat(40));

  // Initialize database
  getDb();

  // Today's stats
  const signerUuid = config.neynarSignerUuids[0] || null;
  const stats = getTodayStats(signerUuid);
  const today = new Date().toISOString().split('T')[0];

  console.log(chalk.cyan(`\nToday (${today}):`));
  console.log(`  Casts detected:     ${stats.trends_detected}`);
  console.log(`  Above threshold:    ${stats.trends_above_threshold}`);
  console.log(`  Tokens launched:    ${stats.launches_count}/${config.maxLaunchesPerDay}`);

  // Recent launches
  const launches = getRecentLaunches(5, signerUuid);

  if (launches.length > 0) {
    console.log(chalk.cyan('\nRecent Launches:'));
    for (const launch of launches) {
      const status =
        launch.status === 'success'
          ? chalk.green('✓')
          : launch.status === 'failed'
          ? chalk.red('✗')
          : chalk.yellow('○');

      const time = new Date(launch.launched_at).toLocaleTimeString();
      console.log(
        `  ${status} ${chalk.bold('$' + launch.token_ticker)} - ${launch.token_name}`
      );
      console.log(`    Score: ${launch.virality_score.toFixed(1)} | Time: ${time}`);
      if (launch.cast_hash) {
        console.log(`    Cast: ${launch.cast_hash}`);
      }
    }
  } else {
    console.log(chalk.gray('\nNo launches yet today.'));
  }

  // Configuration summary
  console.log(chalk.cyan('\nConfiguration:'));
  console.log(`  Tracked accounts:   ${config.trackedAccounts.join(', ')}`);
  console.log(`  Tracked channels:   ${config.trackedChannels.join(', ')}`);
  console.log(`  Keywords:           ${config.keywords.join(', ')}`);
  console.log(`  Account boost:      ${config.accountBoostMultiplier}x`);
  console.log(`  Virality threshold: ${config.viralityThreshold}`);
  console.log(`  Poll interval:      ${config.pollIntervalMs / 1000}s`);

  console.log('');
  closeDb();
}

main();
