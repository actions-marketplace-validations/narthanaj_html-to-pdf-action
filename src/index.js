#!/usr/bin/env node

const core = require('@actions/core');
const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');

// Helper function to get input from environment or CLI arguments
function getInput(name, options = {}) {
  // Check if running in GitHub Actions
  if (process.env[`INPUT_${name.toUpperCase()}`]) {
    return core.getInput(name, options);
  }
  
  // Check for CLI arguments
  const argPrefix = `--${name}=`;
  const arg = process.argv.find(arg => arg.startsWith(argPrefix));
  if (arg) {
    return arg.substring(argPrefix.length);
  }
  
  // Check for environment variables
  if (process.env[name.toUpperCase()]) {
    return process.env[name.toUpperCase()];
  }
  
  // Return empty string or throw if required
  if (options.required) {
    throw new Error(`Input '${name}' is required`);
  }
  
  return '';
}

// Function to log output (works in both GitHub Actions and CLI)
function log(message, level = 'info') {
  if (typeof core[level] === 'function') {
    core[level](message);
  } else {
    console.log(message);
  }
}

// Function to set output (works in both GitHub Actions and CLI)
function setOutput(name, value) {
  if (typeof core.setOutput === 'function') {
    core.setOutput(name, value);
  } else {
    console.log(`Output ${name}: ${value}`);
  }
}

// Function to report failure (works in both GitHub Actions and CLI)
function setFailed(message) {
  if (typeof core.setFailed === 'function') {
    core.setFailed(message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

// Function to check if string is a URL
function isUrl(str) {
  try {
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Function to check if string is a file path
async function isFilePath(str) {
  try {
    const stats = await fs.stat(str);
    return stats.isFile();
  } catch (e) {
    return false;
  }
}

// Function to parse margins
function parseMargins(marginStr) {
  const margins = marginStr.split(',').map(m => parseInt(m.trim(), 10));
  if (margins.length === 1) {
    return { top: margins[0], right: margins[0], bottom: margins[0], left: margins[0] };
  } else if (margins.length === 4) {
    return {
      top: margins[0],
      right: margins[1],
      bottom: margins[2],
      left: margins[3]
    };
  } else {
    throw new Error('Margins must be in format: top,right,bottom,left or a single value for all sides');
  }
}

// Main function
async function run() {
  try {
    // Get inputs
    const source = getInput('source', { required: true });
    const output = getInput('output', { required: true });
    const waitForSelector = getInput('wait_for');
    const format = getInput('format') || 'A4';
    const marginInput = getInput('margin') || '10,10,10,10';
    const orientation = getInput('orientation') || 'portrait';
    const headerTemplate = getInput('header_template') || '';
    const footerTemplate = getInput('footer_template') || '';
    const timeout = parseInt(getInput('timeout') || '30000', 10);
    const scale = parseFloat(getInput('scale') || '1');
    const customCss = getInput('custom_css') || '';
    const cookiesStr = getInput('cookies') || '[]';
    const userAgent = getInput('user_agent');
    const printBackground = getInput('print_background') === 'true';

    // Parse margins
    const margin = parseMargins(marginInput);

    // Parse cookies if provided
    let cookies = [];
    if (cookiesStr) {
      try {
        cookies = JSON.parse(cookiesStr);
      } catch (e) {
        log(`Failed to parse cookies: ${e.message}`, 'warning');
      }
    }

    // Create output directory if it doesn't exist
    await fs.ensureDir(path.dirname(output));

    // Launch browser
    log('Launching browser...');
    const browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--font-render-hinting=none' // Improves font rendering
      ],
      headless: true
    });

    // Create a new page
    const page = await browser.newPage();
    
    // Set user agent if provided
    if (userAgent) {
      await page.setUserAgent(userAgent);
    }

    // Set cookies if provided
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }

    // Set timeout
    page.setDefaultTimeout(timeout);

    // Determine how to load the source
    if (await isFilePath(source)) {
      // Source is a file path
      const html = await fs.readFile(source, 'utf8');
      await page.setContent(html, { waitUntil: 'networkidle0' });
      log(`Loaded HTML from file: ${source}`);
    } else if (isUrl(source)) {
      // Source is a URL
      await page.goto(source, { waitUntil: 'networkidle0' });
      log(`Loaded HTML from URL: ${source}`);
    } else {
      // Source is HTML content
      await page.setContent(source, { waitUntil: 'networkidle0' });
      log('Loaded HTML from input content');
    }

    // Inject custom CSS if provided
    if (customCss) {
      await page.addStyleTag({ content: customCss });
      log('Injected custom CSS');
    }

    // Wait for selector if provided
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector);
      log(`Waited for selector: ${waitForSelector}`);
    }

    // Generate PDF
    log('Generating PDF...');
    await page.pdf({
      path: output,
      format,
      landscape: orientation === 'landscape',
      margin,
      printBackground,
      displayHeaderFooter: !!(headerTemplate || footerTemplate),
      headerTemplate,
      footerTemplate,
      scale
    });

    // Close browser
    await browser.close();

    log(`PDF generated successfully: ${output}`);
    setOutput('pdf_path', output);
  } catch (error) {
    setFailed(`Action failed: ${error.message}`);
  }
}

run();