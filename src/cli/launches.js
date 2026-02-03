#!/usr/bin/env node
import chalk from 'chalk';
import { program } from 'commander';
import { getDb, getRecentLaunches, closeDb } from '../db/sqlite.js';
import { config } from '../config.js';

program
  .option('-n, --limit <number>', 'Number of launches to show', '20')
  .option('-s, --status <status>', 'Filter by status (success, failed, pending)')
  .parse();

const options = program.opts();

function formatStatus(status) {
  switch (status) {
    case 'success':
      return chalk.green('✓ success');
    case 'failed':
      return chalk.red('✗ failed');
    case 'pending':
      return chalk.yellow('○ pending');
    default:
      return chalk.gray(status);
  }
}

function main() {
  console.log(chalk.bold('\nToken Launches'));
  console.log('='.repeat(60));

  // Initialize database
  getDb();

  const signerUuid = config.neynarSignerUuids[0] || null;
  let launches = getRecentLaunches(parseInt(options.limit, 10), signerUuid);

  // Filter by status if specified
  if (options.status) {
    launches = launches.filter((l) => l.status === options.status);
  }

  if (launches.length === 0) {
    console.log(chalk.gray('\nNo token launches found.'));
    closeDb();
    return;
  }

  for (const launch of launches) {
    const time = new Date(launch.launched_at).toLocaleString();

    console.log('');
    console.log(
      chalk.bold(`$${launch.token_ticker}`) +
        chalk.white(` - ${launch.token_name}`) +
        ` ${formatStatus(launch.status)}`
    );

    console.log(chalk.gray(`  Launched: ${time}`));
    console.log(chalk.gray(`  Virality Score: ${launch.virality_score.toFixed(1)}`));

    if (launch.trend_text) {
      const maxLen = 60;
      const text =
        launch.trend_text.length > maxLen
          ? launch.trend_text.slice(0, maxLen) + '...'
          : launch.trend_text;
      console.log(chalk.gray(`  Trend: "${text}"`));
      console.log(chalk.gray(`  Author: @${launch.author_handle}`));
    }

    if (launch.cast_hash) {
      console.log(chalk.cyan(`  Cast: ${launch.cast_hash}`));
    }

    if (launch.error_message) {
      console.log(chalk.red(`  Error: ${launch.error_message}`));
    }
  }

  // Summary
  const successful = launches.filter((l) => l.status === 'success').length;
  const failed = launches.filter((l) => l.status === 'failed').length;

  console.log('');
  console.log(
    chalk.gray(
      `Showing ${launches.length} launches | ` +
        `${chalk.green(successful + ' success')} | ` +
        `${chalk.red(failed + ' failed')}`
    )
  );
  console.log('');

  closeDb();
}

main();
