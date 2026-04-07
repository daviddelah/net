#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { getDb, getPosts, getPostStats, getPlatforms, getRecentLogs } from '../db/sqlite.js';

const program = new Command();
program.name('net').description('Net — Social media scheduling CLI').version('1.0.0');

program
  .command('status')
  .description('Show current status')
  .action(async () => {
    await getDb();
    const stats = await getPostStats();
    const platforms = await getPlatforms();

    console.log(chalk.bold('\n📊 Net Status\n'));
    console.log(`  Platforms:  ${chalk.cyan(platforms.length)} configured`);
    platforms.forEach(p => {
      const status = p.enabled ? chalk.green('●') : chalk.gray('○');
      console.log(`    ${status} ${p.name} (${p.type})`);
    });

    console.log(`\n  Posts:`);
    console.log(`    Drafts:    ${chalk.yellow(stats.drafts || 0)}`);
    console.log(`    Scheduled: ${chalk.blue(stats.scheduled || 0)}`);
    console.log(`    Queued:    ${chalk.cyan(stats.queued || 0)}`);
    console.log(`    Posted:    ${chalk.green(stats.posted || 0)}`);
    console.log(`    Failed:    ${chalk.red(stats.failed || 0)}`);
    console.log(`    Total:     ${stats.total || 0}\n`);
  });

program
  .command('posts')
  .description('List posts')
  .option('-s, --status <status>', 'Filter by status')
  .option('-n, --limit <n>', 'Number of posts', '20')
  .action(async (opts) => {
    await getDb();
    const posts = await getPosts({ status: opts.status, limit: parseInt(opts.limit) });

    if (posts.length === 0) {
      console.log(chalk.gray('\nNo posts found.\n'));
      return;
    }

    console.log(chalk.bold(`\n📝 Posts (${posts.length})\n`));
    for (const post of posts) {
      const statusColors = {
        draft: chalk.yellow, scheduled: chalk.blue, queued: chalk.cyan,
        posting: chalk.magenta, posted: chalk.green, partial: chalk.yellow, failed: chalk.red,
      };
      const colorFn = statusColors[post.status] || chalk.white;
      const text = post.body.length > 60 ? post.body.slice(0, 57) + '...' : post.body;
      console.log(`  ${chalk.gray(`#${post.id}`)} ${colorFn(`[${post.status}]`)} ${text}`);
      if (post.scheduled_at) console.log(`       ${chalk.gray(`Scheduled: ${new Date(post.scheduled_at).toLocaleString()}`)}`);
    }
    console.log();
  });

program
  .command('logs')
  .description('Show recent activity')
  .option('-n, --limit <n>', 'Number of entries', '20')
  .action(async (opts) => {
    await getDb();
    const logs = await getRecentLogs(parseInt(opts.limit));

    if (logs.length === 0) {
      console.log(chalk.gray('\nNo activity yet.\n'));
      return;
    }

    console.log(chalk.bold(`\n📋 Recent Activity\n`));
    for (const log of logs) {
      const time = new Date(log.timestamp).toLocaleString();
      console.log(`  ${chalk.gray(time)} ${log.action}`);
      if (log.details) {
        try {
          const d = JSON.parse(log.details);
          console.log(`    ${chalk.gray(JSON.stringify(d))}`);
        } catch {
          console.log(`    ${chalk.gray(log.details)}`);
        }
      }
    }
    console.log();
  });

program.parse();
