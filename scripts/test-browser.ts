import { chromium } from '@playwright/test';
import { browserScenario } from './browser-scenario.js';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try { const report = await browserScenario(browser, process.env.FACET_BASE_URL || 'http://127.0.0.1:5370'); await mkdir('.local', { recursive: true, mode: 0o700 }); await writeFile('.local/browser-report.json', JSON.stringify(report)); console.log(report.status, report.checks); if (report.status !== 'passed') process.exitCode = 1; }
finally { await browser.close(); }
