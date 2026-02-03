#!/usr/bin/env node
import chalk from 'chalk';
import { program } from 'commander';
import { getDb, getHistoricalStats, closeDb } from '../db/sqlite.js';
import { config } from '../config.js';

program.option('-d, --days <number>', 'Number of days to show', '30').parse();

const options = program.opts();

function main() {
  console.log(chalk.bold('\nHistorical Statistics'));
  console.log('='.repeat(60));

  // Initialize database
  getDb();

  const signerUuid = config.neynarSignerUuids[0] || null;
  const stats = getHistoricalStats(parseInt(options.days, 10), signerUuid);

  if (stats.length === 0) {
    console.log(chalk.gray('\nNo historical data available.'));
    closeDb();
    return;
  }

  // Header
  console.log('');
  console.log(
    chalk.gray(
      'Date'.padEnd(12) +
        'Detected'.padStart(10) +
        'Viral'.padStart(10) +
        'Launched'.padStart(10) +
        'Rate'.padStart(10)
    )
  );
  console.log(chalk.gray('-'.repeat(52)));

  // Totals
  let totalDetected = 0;
  let totalViral = 0;
  let totalLaunched = 0;

  for (const day of stats) {
    totalDetected += day.trends_detected;
    totalViral += day.trends_above_threshold;
    totalLaunched += day.launches_count;

    const conversionRate =
      day.trends_above_threshold > 0
        ? ((day.launches_count / day.trends_above_threshold) * 100).toFixed(0) + '%'
        : '-';

    const launchColor = day.launches_count > 0 ? chalk.green : chalk.white;

    console.log(
      day.date.padEnd(12) +
        String(day.trends_detected).padStart(10) +
        String(day.trends_above_threshold).padStart(10) +
        launchColor(String(day.launches_count).padStart(10)) +
        conversionRate.padStart(10)
    );
  }

  // Totals row
  console.log(chalk.gray('-'.repeat(52)));
  const overallRate =
    totalViral > 0 ? ((totalLaunched / totalViral) * 100).toFixed(0) + '%' : '-';

  console.log(
    chalk.bold('Total'.padEnd(12)) +
      chalk.bold(String(totalDetected).padStart(10)) +
      chalk.bold(String(totalViral).padStart(10)) +
      chalk.bold(String(totalLaunched).padStart(10)) +
      chalk.bold(overallRate.padStart(10))
  );

  // Summary
  console.log('');
  console.log(chalk.cyan('Summary:'));
  console.log(`  Days tracked:       ${stats.length}`);
  console.log(`  Total trends:       ${totalDetected}`);
  console.log(`  Viral trends:       ${totalViral} (${((totalViral / Math.max(1, totalDetected)) * 100).toFixed(1)}%)`);
  console.log(`  Tokens launched:    ${totalLaunched}`);
  console.log(`  Launch rate:        ${overallRate}`);

  if (totalLaunched > 0) {
    console.log(`  Avg launches/day:   ${(totalLaunched / stats.length).toFixed(1)}`);
  }

  console.log('');
  closeDb();
}

main();
