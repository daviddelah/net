#!/usr/bin/env node
import chalk from 'chalk';
import { program } from 'commander';
import { getDb, getRecentTrends, closeDb } from '../db/sqlite.js';
import { config } from '../config.js';

program
  .option('-n, --limit <number>', 'Number of trends to show', '20')
  .option('-a, --all', 'Show all trends including processed')
  .parse();

const options = program.opts();

function formatStatus(processed) {
  switch (processed) {
    case 0:
      return chalk.gray('pending');
    case 1:
      return chalk.yellow('scored');
    case 2:
      return chalk.red('rejected');
    case 3:
      return chalk.green('launched');
    default:
      return chalk.gray('unknown');
  }
}

function main() {
  console.log(chalk.bold('\nRecent Casts'));
  console.log('='.repeat(60));

  // Initialize database
  getDb();

  const trends = getRecentTrends(parseInt(options.limit, 10));

  if (trends.length === 0) {
    console.log(chalk.gray('\nNo casts detected yet.'));
    closeDb();
    return;
  }

  for (const trend of trends) {
    const isAboveThreshold = trend.virality_score >= config.viralityThreshold;
    const scoreColor = isAboveThreshold ? chalk.green : chalk.white;

    console.log('');
    console.log(
      `${chalk.cyan('@' + trend.author_handle)} ` +
        `${chalk.gray('|')} Score: ${scoreColor(trend.virality_score.toFixed(1))} ` +
        `${chalk.gray('|')} ${formatStatus(trend.processed)}`
    );

    // Truncate text
    const maxLen = 80;
    const text =
      trend.text.length > maxLen ? trend.text.slice(0, maxLen) + '...' : trend.text;
    console.log(chalk.white(`  "${text}"`));

    // Engagement stats
    console.log(
      chalk.gray(
        `  ❤️  ${trend.like_count} | 🔄 ${trend.recast_count || 0} | 💬 ${trend.reply_count} ` +
          `| 👥 ${trend.author_followers?.toLocaleString() || 0} followers`
      )
    );

    // Source, channel, and keyword
    const details = [`Source: ${trend.source}`];
    if (trend.channel) {
      details.push(`Channel: /${trend.channel}`);
    }
    if (trend.keyword_match) {
      details.push(`Keyword: ${trend.keyword_match}`);
    }
    console.log(chalk.gray(`  ${details.join(' | ')}`));
  }

  console.log('');
  closeDb();
}

main();
